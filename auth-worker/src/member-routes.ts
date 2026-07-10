import type { Env } from "./env.js";
import { hashPin, verifyPin, pinHashNeedsUpgrade } from "./crypto.js";
import { signSession, verifySession } from "./jwt.js";
import { checkLockout, clearAttempts, recordFailure } from "./ratelimit.js";
import { canonicalLoginKey, getMember, rehashPin, resolveMember, setPin, updateProfile, type ProfilePatch } from "./roster.js";
import * as db from "./db.js";
import { bearer, clientIp, json, readJson } from "./http.js";
import { requireAuth, ttl } from "./authz.js";
import { kvRateLimited } from "./kv-rate-limit.js";
import { RECORD_PAGE_DEFAULTS, parseWindow } from "./input.js";
import { getMemberRatings, summarizeRatingRows } from "./ratings.js";
import { readD1OrFallback } from "./d1-retry.js";

// Iteration count must stay <=100000 to match crypto.ts / the workerd PBKDF2 cap, so the
// no-such-member path computes a real PBKDF2 (constant-time-ish) instead of throwing immediately.
const DUMMY_HASH =
  "pbkdf2$sha256$100000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const LOGIN_BODY_BYTES = 2_048;
const PROFILE_BODY_BYTES = 350_000;
const LOGIN_IP_LIMIT = 20;
const LOGIN_IDENTIFIER_IP_LIMIT = 10;
const SETPIN_LIMIT = 5;
const MAX_PHOTO_LEN = 200_000;

function validPhoto(p: string): boolean {
  return p.length <= MAX_PHOTO_LEN && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(p);
}

export async function handleLogin(request: Request, env: Env, origin: string | null): Promise<Response> {
  const body = await readJson(request, LOGIN_BODY_BYTES);
  const identifier = typeof body?.identifier === "string" ? body.identifier : "";
  const pin = typeof body?.pin === "string" ? body.pin : "";
  if (!identifier || !pin) return json({ error: "invalid_request" }, 400, origin);

  const rk = canonicalLoginKey(identifier);
  const ip = clientIp(request);
  const now = Date.now();

  if (await kvRateLimited(env, "login:ip:" + ip, LOGIN_IP_LIMIT, 60)) return json({ error: "rate_limited" }, 429, origin);
  if (await kvRateLimited(env, "login:ip_id:" + ip + ":" + rk, LOGIN_IDENTIFIER_IP_LIMIT, 60)) return json({ error: "rate_limited" }, 429, origin);

  const lock = await checkLockout(env.RATELIMIT, rk, now);
  if (lock.locked) {
    return json({ error: "locked_out", retryAfterSec: lock.retryAfterSec }, 423, origin, {
      "Retry-After": String(lock.retryAfterSec),
    });
  }

  const member = await resolveMember(env.ROSTER, identifier);
  const ok = await verifyPin(pin, member?.pinHash ?? DUMMY_HASH, env.PIN_PEPPER);

  if (!member || !ok) {
    await recordFailure(env.RATELIMIT, rk, now);
    return json({ error: "invalid_credentials" }, 401, origin);
  }

  await clearAttempts(env.RATELIMIT, rk);
  // Transparently upgrade a legacy (un-peppered) hash to the peppered form now that we hold the plaintext
  // PIN and the login succeeded — one-time re-hash, no pinVer/mustChangePin change so sessions aren't disturbed.
  if (pinHashNeedsUpgrade(member.pinHash, !!env.PIN_PEPPER)) {
    try { await rehashPin(env.ROSTER, member.memberId, await hashPin(pin, env.PIN_PEPPER)); } catch { /* best-effort; login still succeeds */ }
  }
  const token = await signSession({ sub: member.memberId, mustChangePin: member.mustChangePin, pinVer: member.pinVer ?? 0 }, env.JWT_SECRET, ttl(env));
  return json(
    {
      token,
      mustChangePin: member.mustChangePin,
      name: member.name,
      pdgaNo: member.pdgaNo ?? null,
      udisc: member.udisc ?? null,
      photo: member.photo ?? null,
      isAdmin: member.isAdmin === true,
    },
    200,
    origin,
  );
}

export async function handleMe(request: Request, env: Env, origin: string | null): Promise<Response> {
  const token = bearer(request);
  const claims = token ? await verifySession(token, env.JWT_SECRET) : null;
  if (!claims) return json({ error: "unauthorized" }, 401, origin);
  const member = await getMember(env.ROSTER, claims.sub);
  if (!member) return json({ error: "unauthorized" }, 401, origin);
  return json(
    {
      sub: member.memberId,
      mustChangePin: member.mustChangePin,
      name: member.name,
      pdgaNo: member.pdgaNo ?? null,
      udisc: member.udisc ?? null,
      photo: member.photo ?? null,
      isAdmin: member.isAdmin === true,
    },
    200,
    origin,
  );
}

export async function handleMyResults(request: Request, env: Env, origin: string | null): Promise<Response> {
  const claims = await requireAuth(request, env);
  if (!claims) return json({ error: "unauthorized" }, 401, origin);
  const q = new URL(request.url).searchParams;
  const { limit, offset } = parseWindow(q, { limit: RECORD_PAGE_DEFAULTS.memberResults.defaultLimit }, {
    maxLimit: RECORD_PAGE_DEFAULTS.memberResults.maxLimit,
  });
  const requestedLimit = q.get("all") === "1" ? RECORD_PAGE_DEFAULTS.memberResults.maxLimit : limit;
  const results = await readD1OrFallback(() => db.listMemberResults(env.DB, claims.sub, { limit: requestedLimit, offset }), () => []);
  return json({ results }, 200, origin);
}

export async function handleMyRatings(request: Request, env: Env, origin: string | null): Promise<Response> {
  const claims = await requireAuth(request, env);
  if (!claims) return json({ error: "unauthorized" }, 401, origin);
  const q = new URL(request.url).searchParams;
  const all = q.get("all") === "1";
  const competitive = parseWindow(q, { limit: RECORD_PAGE_DEFAULTS.memberRatings.defaultLimit }, {
    maxLimit: RECORD_PAGE_DEFAULTS.memberRatings.maxLimit,
    limitParam: "competitiveLimit",
    offsetParam: "competitiveOffset",
  });
  const casual = parseWindow(q, { limit: RECORD_PAGE_DEFAULTS.memberRatings.defaultLimit }, {
    maxLimit: RECORD_PAGE_DEFAULTS.memberRatings.maxLimit,
    limitParam: "casualLimit",
    offsetParam: "casualOffset",
  });

  const ratings = await readD1OrFallback(
    () => getMemberRatings(env.DB, claims.sub, {
      competitiveLimit: all ? RECORD_PAGE_DEFAULTS.memberRatings.maxLimit : competitive.limit,
      competitiveOffset: competitive.offset,
      casualLimit: all ? RECORD_PAGE_DEFAULTS.memberRatings.maxLimit : casual.limit,
      casualOffset: casual.offset,
    }),
    () => ({
      competitive: summarizeRatingRows("competitive", []),
      casual: summarizeRatingRows("casual", []),
    }),
  );
  return json(ratings, 200, origin);
}

export async function handleMyRegistrations(request: Request, env: Env, origin: string | null): Promise<Response> {
  const claims = await requireAuth(request, env);
  if (!claims) return json({ error: "unauthorized" }, 401, origin);
  const registrations = await readD1OrFallback(() => db.listMyRegistrations(env.DB, claims.sub), () => []);
  return json({ registrations }, 200, origin);
}

export async function handleMyLiveRounds(request: Request, env: Env, origin: string | null): Promise<Response> {
  const claims = await requireAuth(request, env);
  if (!claims) return json({ error: "unauthorized" }, 401, origin);
  const rounds = await readD1OrFallback(() => db.listMemberLiveEvents(env.DB, claims.sub), () => []);
  return json({ rounds }, 200, origin);
}

export async function handleProfile(request: Request, env: Env, origin: string | null): Promise<Response> {
  const claims = await requireAuth(request, env);
  if (!claims) return json({ error: "unauthorized" }, 401, origin);
  const body = await readJson(request, PROFILE_BODY_BYTES);
  if (!body) return json({ error: "invalid_request" }, 400, origin);

  const patch: ProfilePatch = {};
  if ("pdgaNo" in body) {
    const v = body.pdgaNo;
    if (v !== null && v !== "" && !(typeof v === "string" && /^\d+$/.test(v.trim()))) {
      return json({ error: "invalid_pdga" }, 400, origin);
    }
    patch.pdgaNo = v === null ? null : String(v).trim();
  }
  if ("udisc" in body) {
    const v = body.udisc;
    if (v !== null && v !== "" && !(typeof v === "string" && /^[A-Za-z0-9._-]{1,50}$/.test(v.trim()))) {
      return json({ error: "invalid_udisc" }, 400, origin);
    }
    patch.udisc = v === null ? null : String(v).trim();
  }
  if ("photo" in body) {
    const v = body.photo;
    if (v !== null && v !== "" && !(typeof v === "string" && validPhoto(v))) {
      return json({ error: "invalid_photo" }, 400, origin);
    }
    patch.photo = v === null || v === "" ? null : (v as string);
  }

  const result = await updateProfile(env.ROSTER, claims.sub, patch);
  if (!result.ok) return json({ error: "conflict", field: result.conflict }, 409, origin);
  const m = result.member;
  return json(
    { pdgaNo: m.pdgaNo ?? null, udisc: m.udisc ?? null, photo: m.photo ?? null, name: m.name, mustChangePin: m.mustChangePin },
    200,
    origin,
  );
}

export async function handleSetPin(request: Request, env: Env, origin: string | null): Promise<Response> {
  const token = bearer(request);
  const claims = token ? await verifySession(token, env.JWT_SECRET) : null;
  if (!claims) return json({ error: "unauthorized" }, 401, origin);

  // Rate-limit the change-PIN path per member so a stolen token can't be used to grind PINs.
  if (await kvRateLimited(env, "setpin:" + claims.sub, SETPIN_LIMIT, 60)) {
    return json({ error: "rate_limited" }, 429, origin);
  }

  const body = await readJson(request);
  const newPin = typeof body?.newPin === "string" ? body.newPin : "";
  if (!/^\d{4}$/.test(newPin)) return json({ error: "invalid_pin_format" }, 400, origin);

  // An established member (not on a forced first-login change) must prove the CURRENT PIN before
  // setting a new one, so a transiently-stolen 15-minute session token can't be turned into a
  // permanent account takeover. The forced-change flow has no current PIN to verify, so it is exempt.
  if (!claims.mustChangePin) {
    const member = await getMember(env.ROSTER, claims.sub);
    if (!member) return json({ error: "unauthorized" }, 401, origin);
    const currentPin = typeof body?.currentPin === "string" ? body.currentPin : "";
    if (!(await verifyPin(currentPin, member.pinHash, env.PIN_PEPPER))) {
      return json({ error: "invalid_credentials" }, 401, origin);
    }
  }

  const newVer = await setPin(env.ROSTER, claims.sub, await hashPin(newPin, env.PIN_PEPPER));
  const fresh = await signSession({ sub: claims.sub, mustChangePin: false, pinVer: newVer }, env.JWT_SECRET, ttl(env));
  return json({ token: fresh, mustChangePin: false }, 200, origin);
}
