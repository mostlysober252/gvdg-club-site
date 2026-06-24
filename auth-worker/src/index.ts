// GVDG member auth Worker — entrypoint.
// Routes: POST /login, GET /me, POST /set-pin, plus CORS preflight.

import { hashPin, verifyPin } from "./crypto.js";
import { signSession, verifySession } from "./jwt.js";
import { checkLockout, recordFailure, clearAttempts, type KVLike } from "./ratelimit.js";
import { resolveMember, getMember, setPin, updateProfile, type ProfilePatch } from "./roster.js";
import {
  registrationOptions,
  registrationVerify,
  authenticationOptions,
  authenticationVerify,
} from "./webauthn.js";
import type { RegistrationResponseJSON, AuthenticationResponseJSON } from "@simplewebauthn/server";
import * as db from "./db.js";
import { EVENT_TYPES, EVENT_STATUSES, EVENT_FORMATS, type D1Like } from "./db.js";
import { safeFetch, normalizeDgs, normalizeCsvEvents, parseCsvRows, parseUdiscLayout, ImportError } from "./imports.js";
import { enrichHoles, type LayoutHole } from "./layouts.js";
import { buildMessages, generateReply, MAX_HISTORY, type ChatTurn, type ChatMessage, type ReplyProvider } from "./assistant.js";
import { computeLeagueStandings } from "./scoring.js";
import { computeOwed, paypalBase, createOrder as ppCreateOrder, captureOrder as ppCaptureOrder } from "./payments.js";
import { assignShotgun, assignTeams, assignCards } from "./assign.js";

// Fisher-Yates shuffle (Workers runtime permits Math.random) — used for random shotgun/team assignment.
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

// Default discgolfscene feed = the club scraper's committed tournaments.json.
const DEFAULT_DGS_FEED = "https://raw.githubusercontent.com/mostlysober252/GVDG-DGS-Scraper-2.0/main/tournaments.json";

export interface Env {
  ROSTER: KVLike;
  RATELIMIT: KVLike;
  DB: D1Like; // Cloudflare D1 — club operations (events, courses, leagues, results, …)
  JWT_SECRET: string;
  /** Comma-separated allowlist of browser origins permitted to call the API. */
  ALLOWED_ORIGINS: string;
  SESSION_TTL_SEC?: string;
  // WebAuthn / passkeys relying-party config.
  RP_ID?: string;
  RP_NAME?: string;
  EXPECTED_ORIGIN?: string;
  // "Crotts" assistant brains. Primary = OpenRouter (free models); fallback = Cloudflare Workers AI.
  // OPENROUTER_API_KEY is a SECRET (wrangler secret put OPENROUTER_API_KEY); absent → skip OpenRouter.
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
  AI?: { run(model: string, opts: { messages: { role: string; content: string }[]; max_tokens?: number }): Promise<{ response?: string }> };
  ASSISTANT_MODEL?: string;
  // Durable Object namespace for live scoring (one instance per in-progress event).
  LIVE: DurableObjectNamespace;
  // PayPal Checkout (Track G). Payments activate only when BOTH client-id + secret are configured;
  // otherwise the club uses the manual "paid" flag. CLIENT_ID is public; SECRET is a wrangler secret.
  PAYPAL_CLIENT_ID?: string;
  PAYPAL_SECRET?: string;
  PAYPAL_ENV?: string; // "sandbox" (default) | "live"
  PAYPAL_API_BASE?: string; // optional override (local testing against a mock)
}

export { LiveEventDO } from "./live.js";

// A well-formed but unmatchable hash. Verifying a submitted PIN against this when the
// identifier is unknown keeps login timing ~constant, preventing user enumeration via timing.
const DUMMY_HASH =
  "pbkdf2$sha256$120000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

const SECURITY_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

function allowedOrigin(env: Env, request: Request): string | null {
  const origin = request.headers.get("Origin");
  if (!origin) return null;
  const allow = env.ALLOWED_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);
  return allow.includes(origin) ? origin : null;
}

function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(
  data: unknown,
  status: number,
  origin: string | null,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...SECURITY_HEADERS, ...corsHeaders(origin), ...extraHeaders },
  });
}

/** Fail closed: a missing/short signing secret must never produce a weakly-signed token. */
function secretOk(env: Env): boolean {
  return typeof env.JWT_SECRET === "string" && env.JWT_SECRET.length >= 32;
}

function ttl(env: Env): number {
  const n = Number(env.SESSION_TTL_SEC);
  return Number.isFinite(n) && n > 0 ? n : 900;
}

function rateKey(identifier: string): string {
  return identifier.trim().toLowerCase();
}

function bearer(request: Request): string | null {
  const h = request.headers.get("Authorization") ?? "";
  const m = h.match(/^Bearer (.+)$/);
  return m ? m[1]! : null;
}

async function requireAuth(request: Request, env: Env) {
  const token = bearer(request);
  const claims = token ? await verifySession(token, env.JWT_SECRET) : null;
  // Enforce the PIN-change gate server-side too (not just in the UI): a member still on their admin-issued
  // default PIN can't reach protected routes until they set their own PIN via /set-pin (which is exempt —
  // it uses bearer()+verifySession directly, as does /me).
  if (!claims || claims.mustChangePin) return null;
  return claims;
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const v = await request.json();
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function handleLogin(request: Request, env: Env, origin: string | null): Promise<Response> {
  const body = await readJson(request);
  const identifier = typeof body?.identifier === "string" ? body.identifier : "";
  const pin = typeof body?.pin === "string" ? body.pin : "";
  if (!identifier || !pin) return json({ error: "invalid_request" }, 400, origin);

  const rk = rateKey(identifier);
  const now = Date.now();

  const lock = await checkLockout(env.RATELIMIT, rk, now);
  if (lock.locked) {
    return json({ error: "locked_out", retryAfterSec: lock.retryAfterSec }, 423, origin, {
      "Retry-After": String(lock.retryAfterSec),
    });
  }

  const member = await resolveMember(env.ROSTER, identifier);
  // Always run a verify (against a dummy hash if unknown) to equalize timing / avoid enumeration.
  const ok = await verifyPin(pin, member?.pinHash ?? DUMMY_HASH);

  if (!member || !ok) {
    await recordFailure(env.RATELIMIT, rk, now);
    return json({ error: "invalid_credentials" }, 401, origin);
  }

  await clearAttempts(env.RATELIMIT, rk);
  const token = await signSession({ sub: member.memberId, mustChangePin: member.mustChangePin }, env.JWT_SECRET, ttl(env));
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

async function handleMe(request: Request, env: Env, origin: string | null): Promise<Response> {
  const token = bearer(request);
  const claims = token ? await verifySession(token, env.JWT_SECRET) : null;
  if (!claims) return json({ error: "unauthorized" }, 401, origin);
  // Load the member so /me is authoritative (reflects PIN resets / profile changes), not just the token.
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

// A member's own GVDG event history (results from finalized club events) — for the dashboard.
async function handleMyResults(request: Request, env: Env, origin: string | null): Promise<Response> {
  const claims = await requireAuth(request, env);
  if (!claims) return json({ error: "unauthorized" }, 401, origin);
  return json({ results: await db.listMemberResults(env.DB, claims.sub) }, 200, origin);
}

async function handleMyRounds(request: Request, env: Env, origin: string | null): Promise<Response> {
  const claims = await requireAuth(request, env);
  if (!claims) return json({ error: "unauthorized" }, 401, origin);
  return json({ rounds: await db.listMemberRoundResults(env.DB, claims.sub) }, 200, origin);
}

// A member's own event registrations (across events) — for the dashboard sign-up section.
async function handleMyRegistrations(request: Request, env: Env, origin: string | null): Promise<Response> {
  const claims = await requireAuth(request, env);
  if (!claims) return json({ error: "unauthorized" }, 401, origin);
  return json({ registrations: await db.listMyRegistrations(env.DB, claims.sub) }, 200, origin);
}

// Members message board — members-only (read + post require a valid member JWT). Flat feed + replies.
const BOARD_LIMIT = 15; // posts per member per minute
// Fixed-window per-key rate limiter backed by the RATELIMIT KV (shared by the board + assistant).
async function kvRateLimited(env: Env, key: string, limit: number, windowSec: number): Promise<boolean> {
  const cur = parseInt((await env.RATELIMIT.get(key)) || "0", 10) || 0;
  if (cur >= limit) return true;
  await env.RATELIMIT.put(key, String(cur + 1), { expirationTtl: windowSec });
  return false;
}
async function handleBoard(request: Request, env: Env, origin: string | null): Promise<Response> {
  const claims = await requireAuth(request, env);
  if (!claims) return json({ error: "unauthorized" }, 401, origin); // members-only, incl. reads
  const seg = new URL(request.url).pathname.split("/").filter(Boolean); // ["board"] | ["board", id]
  const method = request.method.toUpperCase();

  if (method === "GET" && seg.length === 1) {
    return json({ posts: await db.getBoardFeed(env.DB, 50) }, 200, origin);
  }
  if (method === "POST" && seg.length === 1) {
    if (await kvRateLimited(env, "board:" + claims.sub, BOARD_LIMIT, 60)) return json({ error: "rate_limited" }, 429, origin);
    const b = await readJson(request);
    const body = b && typeof b.body === "string" ? b.body.trim() : "";
    if (!body) return json({ error: "empty_post" }, 400, origin);
    if (body.length > 4000) return json({ error: "post_too_long" }, 413, origin);
    const parentId = b!.parent_id == null ? null : asInt(b!.parent_id);
    if (parentId != null) {
      const parent = (await db.getBoardPost(env.DB, parentId)) as { parent_id?: number | null } | null;
      if (!parent || parent.parent_id != null) return json({ error: "bad_parent" }, 400, origin); // replies only on top-level posts
    }
    const member = await getMember(env.ROSTER, claims.sub);
    const row = await db.createBoardPost(env.DB, { parent_id: parentId, member_id: claims.sub, author_name: member?.name ?? "Member", body });
    return json({ post: row }, 201, origin);
  }
  if (method === "DELETE" && seg.length === 2) {
    const id = asInt(seg[1]);
    if (id == null) return json({ error: "not_found" }, 404, origin);
    const post = (await db.getBoardPost(env.DB, id)) as { member_id?: string } | null;
    if (!post) return json({ error: "not_found" }, 404, origin);
    const member = await getMember(env.ROSTER, claims.sub);
    if (post.member_id !== claims.sub && member?.isAdmin !== true) return json({ error: "forbidden" }, 403, origin); // author or admin
    await db.deleteBoardPost(env.DB, id);
    return json({ ok: true }, 200, origin);
  }
  return json({ error: "not_found" }, 404, origin);
}

// Self-service profile fields a member may add when they couldn't be auto-matched.
const MAX_PHOTO_LEN = 200_000; // ~150KB of base64 — small avatar only
function validPhoto(p: string): boolean {
  return p.length <= MAX_PHOTO_LEN && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(p);
}

async function handleProfile(request: Request, env: Env, origin: string | null): Promise<Response> {
  const claims = await requireAuth(request, env);
  if (!claims) return json({ error: "unauthorized" }, 401, origin);
  const body = await readJson(request);
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

async function handleSetPin(request: Request, env: Env, origin: string | null): Promise<Response> {
  const token = bearer(request);
  const claims = token ? await verifySession(token, env.JWT_SECRET) : null;
  if (!claims) return json({ error: "unauthorized" }, 401, origin);

  const body = await readJson(request);
  const newPin = typeof body?.newPin === "string" ? body.newPin : "";
  if (!/^\d{4}$/.test(newPin)) return json({ error: "invalid_pin_format" }, 400, origin);

  await setPin(env.ROSTER, claims.sub, await hashPin(newPin));
  const fresh = await signSession({ sub: claims.sub, mustChangePin: false }, env.JWT_SECRET, ttl(env));
  return json({ token: fresh, mustChangePin: false }, 200, origin);
}

// ============================ club API (D1) ============================
function asInt(v: unknown): number | null {
  // non-negative integers only (ids, fees-in-cents, hole numbers, counts — none are legitimately negative)
  if (typeof v === "number" && Number.isInteger(v) && v >= 0) return v;
  if (typeof v === "string" && /^\d+$/.test(v.trim())) return parseInt(v, 10);
  return null;
}
function asStr(v: unknown, max = 500): string | null {
  return typeof v === "string" && v.trim().length > 0 && v.length <= max ? v.trim() : null;
}
function asNum(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
const inSet = (arr: readonly string[], v: unknown): v is string => typeof v === "string" && arr.includes(v);
const isUniqueViolation = (e: unknown): boolean => /UNIQUE constraint failed/i.test(String(e));
// Sanitize a JSON array column input: keep only strings, cap length, stringify (null if not an array).
const jsonStringArray = (v: unknown, max: number): string | null =>
  Array.isArray(v) ? JSON.stringify(v.filter((x) => typeof x === "string").slice(0, max)) : null;
const validLat = (n: number | null): number | null => (n != null && n >= -90 && n <= 90 ? n : null);
const validLng = (n: number | null): number | null => (n != null && n >= -180 && n <= 180 ? n : null);

/** Sanitize a tee/target position object ({label, lat?, lng?}); null if no usable label. */
// Tee/target colors a sign might use. Allowlist of named colors + #RGB/#RRGGBB hex; anything else → null.
// (Matches the tee-sign spec's sanitizer so the two tracks render the same swatches safely — never raw
// into markup.)
const TEE_COLORS = new Set(["blue", "red", "white", "gold", "yellow", "black", "green", "orange", "purple", "silver", "gray", "grey", "brown", "pink", "teal", "navy"]);
function safeColor(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  if (!s) return null;
  if (TEE_COLORS.has(s)) return s;
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(s) ? s : null;
}
function cleanPosition(raw: unknown): { label: string; lat: number | null; lng: number | null; color: string | null } | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const label = asStr(o.label, 80);
  if (!label) return null;
  return { label, lat: validLat(asNum(o.lat)), lng: validLng(asNum(o.lng)), color: safeColor(o.color) };
}

/** Sanitize a layout's holes (incl. SAFARI tee/target + manual distance). Returns null if any
 *  hole is malformed, so the admin gets a clear 400 rather than silently dropped holes. */
function sanitizeHoles(raw: unknown[]): LayoutHole[] | null {
  const out: LayoutHole[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") return null;
    const o = r as Record<string, unknown>;
    const hole = asInt(o.hole);
    const par = asInt(o.par);
    if (hole == null || par == null || par < 1 || par > 15) return null;
    const md = asNum(o.manual_distance);
    out.push({
      hole, par,
      tee: cleanPosition(o.tee),
      target: cleanPosition(o.target),
      manual_distance: md != null && md > 0 ? md : null,
    });
  }
  return out;
}

/** Authenticated AND admin. Returns the admin's memberId, or a 401/403 Response. */
async function adminGate(request: Request, env: Env, origin: string | null): Promise<{ adminId: string } | Response> {
  const claims = await requireAuth(request, env);
  if (!claims) return json({ error: "unauthorized" }, 401, origin);
  const member = await getMember(env.ROSTER, claims.sub);
  if (!member || member.isAdmin !== true) return json({ error: "forbidden" }, 403, origin);
  return { adminId: member.memberId };
}

/** Member identity for card/score writes — resolves the roster record so names are trusted (not client
 *  input) and admin status is known. The live Durable Object authorizes from THIS (never client input). */
async function requireMember(
  request: Request,
  env: Env,
  origin: string | null,
): Promise<{ memberId: string; isAdmin: boolean; name: string } | Response> {
  const claims = await requireAuth(request, env);
  if (!claims) return json({ error: "unauthorized" }, 401, origin);
  const member = await getMember(env.ROSTER, claims.sub);
  if (!member) return json({ error: "unauthorized" }, 401, origin);
  return { memberId: member.memberId, isAdmin: member.isAdmin === true, name: member.name || member.memberId };
}

/** Forward a card/score mutation to the live DO, injecting the Worker-verified identity as headers the
 *  DO authorizes from (clients can never reach the DO directly, so these headers are trusted). */
function liveForward(
  stub: DurableObjectStub,
  path: string,
  body: unknown,
  auth: { memberId: string | null; isAdmin: boolean },
  origin: string | null,
): Promise<Response> {
  return liveProxy(stub, path, {
    method: "POST",
    body: JSON.stringify(body ?? {}),
    headers: { "X-Auth-Member": auth.memberId ?? "", "X-Auth-Admin": auth.isAdmin ? "1" : "0" },
  }, origin);
}

function validEventInput(b: Record<string, unknown>): db.EventInput | null {
  const name = asStr(b.name, 200);
  if (!inSet(EVENT_TYPES, b.type) || !name) return null;
  const status = b.status == null ? "scheduled" : b.status;
  if (!inSet(EVENT_STATUSES, status)) return null;
  let format: string | null = null;
  if (b.format != null && b.format !== "") {
    if (!inSet(EVENT_FORMATS, b.format)) return null;
    format = b.format;
  }
  const source = b.source == null ? "manual" : b.source;
  if (!inSet(["manual", "dgs", "csv", "udisc"], source)) return null;
  const ext = b.external_url == null ? null : asStr(b.external_url, 1000);
  if (b.external_url != null && (!ext || !/^https?:\/\//.test(ext))) return null;
  return {
    type: b.type as string, name, status, format,
    date: b.date == null ? null : asStr(b.date, 40),
    course_id: b.course_id == null ? null : asInt(b.course_id),
    layout_id: b.layout_id == null ? null : asInt(b.layout_id),
    league_id: b.league_id == null ? null : asInt(b.league_id),
    source, external_url: ext,
    notes: b.notes == null ? null : asStr(b.notes, 5000),
  };
}

// "Crotts" assistant. Public (no auth) but IP-throttled to bound AI cost/abuse.
const ASSISTANT_LIMIT = 20; // requests per IP per window
const ASSISTANT_WINDOW = 60; // seconds
const DEFAULT_MODEL = "@cf/meta/llama-3.1-8b-instruct"; // Cloudflare Workers AI fallback
const DEFAULT_OR_MODEL = "meta-llama/llama-3.3-70b-instruct:free"; // OpenRouter free-tier primary

// Primary brain: OpenRouter (OpenAI-compatible). Uses a free model by default; the call throws on
// any non-2xx (e.g. the free model is unavailable/rate-limited) so the chain falls back to Workers AI.
function openRouterProvider(env: Env): ReplyProvider {
  return {
    name: "openrouter",
    async generate(messages: ChatMessage[]): Promise<string> {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + env.OPENROUTER_API_KEY,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://greenvillediscgolf.com",
          "X-Title": "GVDG Crotts",
        },
        body: JSON.stringify({ model: env.OPENROUTER_MODEL || DEFAULT_OR_MODEL, messages, max_tokens: 512 }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error("openrouter_" + res.status);
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      return data?.choices?.[0]?.message?.content ?? "";
    },
  };
}
// Fallback brain: Cloudflare Workers AI.
function workersAiProvider(env: Env): ReplyProvider {
  return {
    name: "workers-ai",
    async generate(messages: ChatMessage[]): Promise<string> {
      const out = await env.AI!.run(env.ASSISTANT_MODEL || DEFAULT_MODEL, { messages, max_tokens: 512 });
      return (out && out.response) || "";
    },
  };
}

async function handleAssistant(request: Request, env: Env, origin: string | null): Promise<Response> {
  const body = await readJson(request);
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) return json({ error: "invalid_request" }, 400, origin);
  if (message.length > 2000) return json({ error: "message_too_long" }, 413, origin);

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (await kvRateLimited(env, "asst:" + ip, ASSISTANT_LIMIT, ASSISTANT_WINDOW)) return json({ error: "rate_limited" }, 429, origin);

  const history: ChatTurn[] = Array.isArray(body?.history)
    ? body.history.slice(-MAX_HISTORY).filter((t: unknown): t is ChatTurn => !!t && typeof t === "object" && typeof (t as ChatTurn).content === "string")
    : [];

  // Live club context (best-effort — never fail the chat if D1 is unavailable).
  let events: Record<string, unknown>[] = [];
  let courses: Record<string, unknown>[] = [];
  try { events = (await db.listEvents(env.DB, {})) as Record<string, unknown>[]; } catch { /* ignore */ }
  try { courses = (await db.listCourses(env.DB)) as Record<string, unknown>[]; } catch { /* ignore */ }

  const messages = buildMessages({
    userMessage: message,
    history,
    events: events.map((e) => ({ name: String(e.name ?? ""), date: (e.date as string) ?? null, status: (e.status as string) ?? null })),
    courses: courses.map((c) => ({ name: String(c.name ?? ""), location: (c.location as string) ?? null })),
  });

  // Provider chain: OpenRouter (free model) first, then Cloudflare Workers AI.
  const providers: ReplyProvider[] = [];
  if (env.OPENROUTER_API_KEY) providers.push(openRouterProvider(env));
  if (env.AI) providers.push(workersAiProvider(env));

  if (!providers.length) {
    // Local dev / no brain configured: deterministic stub so the UI + plumbing are verifiable.
    return json({ reply: "🥏 (dev stub) Hi, I'm Crotts! No AI provider is configured in this environment, so I can't think for real yet — but your message reached the worker and the club context loaded fine.", stub: true }, 200, origin);
  }
  const out = await generateReply(providers, messages);
  return out ? json({ reply: out.reply, provider: out.provider }, 200, origin) : json({ error: "assistant_unavailable" }, 502, origin);
}

// Forward a JSON request to the live-event Durable Object and re-emit its response with CORS.
async function liveProxy(stub: DurableObjectStub, path: string, init: RequestInit | undefined, origin: string | null): Promise<Response> {
  const r = await stub.fetch("https://do" + path, init);
  const data = await r.json().catch(() => ({}));
  return json(data, r.status, origin);
}

/** Handles /courses, /events, /leagues (public reads) and /admin/* (admin writes). Returns null if not a club route. */
async function clubApi(request: Request, env: Env, origin: string | null, pathname: string, method: string): Promise<Response | null> {
  const seg = pathname.split("/").filter(Boolean);

  // ---- public reads ----
  if (method === "GET" && pathname === "/courses") return json({ courses: await db.listCourses(env.DB) }, 200, origin);
  if (method === "GET" && pathname === "/leagues") return json({ leagues: await db.listLeagues(env.DB) }, 200, origin);
  if (method === "GET" && seg[0] === "leagues" && seg.length === 2) {
    const lid = asInt(seg[1]);
    const league = lid == null ? null : await db.getLeague(env.DB, lid);
    if (!league) return json({ error: "not_found" }, 404, origin);
    const standings = computeLeagueStandings((await db.leagueResultRows(env.DB, lid!)) as { member_id: string | null; name: string; place: number | null; to_par: number | null }[]);
    return json({ league, standings, events: await db.listLeagueEvents(env.DB, lid!) }, 200, origin);
  }
  if (method === "GET" && pathname === "/fundraisers") return json({ fundraisers: await db.listFundraisers(env.DB) }, 200, origin);
  if (method === "GET" && seg[0] === "fundraisers" && seg.length === 2) {
    const fid = asInt(seg[1]);
    const f = fid == null ? null : await db.getFundraiser(env.DB, fid);
    return f ? json({ fundraiser: f }, 200, origin) : json({ error: "not_found" }, 404, origin);
  }
  if (method === "GET" && pathname === "/registration/open") return json({ events: await db.listOpenRegistrationEvents(env.DB) }, 200, origin);
  if (method === "GET" && pathname === "/payments/config") {
    // public: tells the frontend whether to show PayPal Checkout (client-id is public) or the manual flow.
    return json({ enabled: !!(env.PAYPAL_CLIENT_ID && env.PAYPAL_SECRET), clientId: env.PAYPAL_CLIENT_ID ?? null, env: env.PAYPAL_ENV ?? "sandbox" }, 200, origin);
  }
  if (method === "GET" && pathname === "/meetings") return json({ meetings: await db.listMeetings(env.DB) }, 200, origin);
  if (method === "GET" && seg[0] === "meetings" && seg.length === 2) {
    const mid = asInt(seg[1]);
    const m = mid == null ? null : await db.getMeeting(env.DB, mid);
    return m ? json({ meeting: m }, 200, origin) : json({ error: "not_found" }, 404, origin);
  }
  if (method === "GET" && pathname === "/events") {
    const p = new URL(request.url).searchParams;
    return json({ events: await db.listEvents(env.DB, { status: p.get("status") ?? undefined, type: p.get("type") ?? undefined }) }, 200, origin);
  }
  if (method === "GET" && seg[0] === "events" && seg.length === 2) {
    const id = asInt(seg[1]);
    const ev = id == null ? null : await db.getEvent(env.DB, id);
    return ev ? json({ event: ev }, 200, origin) : json({ error: "not_found" }, 404, origin);
  }

  // members-authed: the registered roster for an event — powers the "add a cardmate" picker in score.html.
  if (method === "GET" && seg[0] === "events" && seg.length === 3 && seg[2] === "roster") {
    const eid = asInt(seg[1]);
    if (eid == null) return json({ error: "not_found" }, 404, origin);
    const who = await requireMember(request, env, origin);
    if (who instanceof Response) return who;
    // Only event participants (or an admin) may read the roster — it's the cardmate picker, not public data.
    if (!who.isAdmin && !(await db.getMyRegistration(env.DB, eid, who.memberId))) return json({ error: "not_registered" }, 403, origin);
    const regs = (await db.listRegistrations(env.DB, eid)) as { member_id?: string; name?: string; division?: string | null; checked_in?: number }[];
    return json({ roster: regs.map((r) => ({ memberId: r.member_id ?? null, name: r.name ?? "Player", division: r.division ?? null, checkedIn: !!r.checked_in })) }, 200, origin);
  }

  // ---- live scoring (Durable Object): /events/:id/live[/{start,finalize,score,ws}] + /live/cards/* ----
  // Reads (snapshot, ws) are public. start/finalize are admin-gated (official lifecycle + results).
  // score + card operations are MEMBER-authed and authorized inside the DO by card membership — this
  // is the UDisc model: any cardmate keeps score; an admin may write any card.
  if (seg[0] === "events" && seg[2] === "live") {
    const eid = asInt(seg[1]);
    if (eid == null) return json({ error: "not_found" }, 404, origin);
    const sub = seg[3]; // undefined (snapshot) | start | finalize | score | ws | cards
    const stub = env.LIVE.get(env.LIVE.idFromName("event:" + eid));

    if (method === "GET" && !sub) return liveProxy(stub, "/snapshot", undefined, origin); // public leaderboard
    if (sub === "ws") return stub.fetch(request); // public WebSocket viewer — forward the upgrade
    if (method !== "POST") return json({ error: "not_found" }, 404, origin);

    // ---- admin lifecycle: start (seed from registrations) + finalize (write official results) ----
    if (sub === "start" || sub === "finalize") {
      const gate = await adminGate(request, env, origin);
      if (gate instanceof Response) return gate;
      if (sub === "finalize") return liveForward(stub, "/finalize", {}, { memberId: gate.adminId, isAdmin: true }, origin);

      const startBody = (await readJson(request)) ?? {};
      const ev = (await db.getEvent(env.DB, eid)) as (Record<string, unknown> & { course_id?: number | null; layout_id?: number | null; players?: Record<string, unknown>[] }) | null;
      if (!ev) return json({ error: "not_found" }, 404, origin);
      const holes = await db.getLayoutHoles(env.DB, ev.layout_id);
      if (!holes.length) return json({ error: "no_layout_holes" }, 400, origin); // event needs a layout with pars
      // Seed cards from REGISTRATIONS (division + assigned starting hole + card label), else manual
      // event_players, else nothing (members self-organize their own cards on their phones).
      const regs = (await db.listRegistrations(env.DB, eid)) as { member_id?: string; name?: string; division?: string | null; starting_hole?: number | null; card_label?: string | null }[];
      const seed =
        regs.length
          ? regs.map((r) => ({ memberId: r.member_id ?? null, name: String(r.name ?? "Player"), division: r.division ?? null, startingHole: r.starting_hole ?? null, cardLabel: r.card_label ?? null }))
          : (Array.isArray(ev.players) ? ev.players : []).map((p) => ({ memberId: (p.member_id as string) ?? null, name: String(p.name ?? "Player"), division: (p.division as string) ?? null, startingHole: null, cardLabel: null }));
      const r = await stub.fetch("https://do/start", {
        method: "POST",
        body: JSON.stringify({ type: "event", eventId: eid, courseId: ev.course_id ?? null, layoutId: ev.layout_id ?? null, holes, seed, startedAt: new Date().toISOString(), force: startBody.force === true }),
      });
      const data = await r.json().catch(() => ({}));
      if (r.status === 200) await db.updateEvent(env.DB, eid, { status: "live" });
      return json(data, r.status, origin);
    }

    // ---- member-authed: score + card formation ----
    const who = await requireMember(request, env, origin);
    if (who instanceof Response) return who;
    // Per-member flood guard on live writes (generous: ~3/sec covers fast tapping, blocks abuse of the DO).
    if (await kvRateLimited(env, "live:" + who.memberId, 180, 60)) return json({ error: "rate_limited" }, 429, origin);

    if (sub === "score") {
      const body = (await readJson(request)) ?? {};
      return liveForward(stub, "/score", body, who, origin);
    }

    if (sub === "cards") {
      const cid = seg[4];
      const cardAct = seg[5];
      // To self-organize/score an EVENT, a non-admin must be registered for it (admins bypass).
      const myReg = (await db.getMyRegistration(env.DB, eid, who.memberId)) as { division?: string | null } | null;
      if (!who.isAdmin && !myReg && (!cid || cardAct === "join")) return json({ error: "not_registered" }, 403, origin);
      const myDivision = myReg?.division ?? null;
      const body = (await readJson(request)) ?? {};

      if (!cid) return liveForward(stub, "/card", { label: body.label, name: who.name, division: myDivision }, who, origin);
      if (cardAct === "join") return liveForward(stub, "/join", { cardId: cid, name: who.name, division: myDivision }, who, origin);
      if (cardAct === "guest") return liveForward(stub, "/guest", { cardId: cid, name: body.name }, who, origin);
      if (cardAct === "leave") return liveForward(stub, "/leave", { cardId: cid, pid: body.pid }, who, origin);
      if (cardAct === "scorekeeper") return liveForward(stub, "/scorekeeper", { cardId: cid, pid: body.pid }, who, origin);
      if (cardAct === "cardmate") {
        const targetId = typeof body.memberId === "string" ? body.memberId : "";
        const m = targetId ? await getMember(env.ROSTER, targetId) : null;
        if (!m) return json({ error: "no_member" }, 404, origin);
        const reg = (await db.getMyRegistration(env.DB, eid, targetId)) as { division?: string | null } | null;
        if (!who.isAdmin && !reg) return json({ error: "member_not_registered" }, 403, origin); // admin may add a walk-up
        return liveForward(stub, "/cardmate", { cardId: cid, memberId: targetId, name: m.name, division: reg?.division ?? null }, who, origin);
      }
    }
    return json({ error: "not_found" }, 404, origin);
  }

  // ---- casual rounds (UDisc-style anytime play): /rounds + /rounds/:id[/live/{score,cards/*,finish,ws}] ----
  // A casual round's id is an unguessable uuid that doubles as the CardCast share token + DO key. The
  // snapshot is public (anyone with the link can watch); writes require card membership (enforced in the DO).
  // No registration gate (casual). Finish writes each player's casual round_results (personal history).
  if (seg[0] === "rounds") {
    if (method === "POST" && seg.length === 1) {
      const who = await requireMember(request, env, origin);
      if (who instanceof Response) return who;
      if (await kvRateLimited(env, "newround:" + who.memberId, 10, 60)) return json({ error: "rate_limited" }, 429, origin);
      const body = (await readJson(request)) ?? {};
      const layoutId = asInt(body.layout_id ?? body.layoutId);
      const courseId = asInt(body.course_id ?? body.courseId);
      const holes = await db.getLayoutHoles(env.DB, layoutId);
      if (!holes.length) return json({ error: "no_layout_holes" }, 400, origin); // a round needs a layout with pars
      const roundId = crypto.randomUUID();
      await db.createRound(env.DB, { id: roundId, course_id: courseId, layout_id: layoutId, created_by: who.memberId });
      const stub = env.LIVE.get(env.LIVE.idFromName("round:" + roundId));
      const r = await stub.fetch("https://do/start", {
        method: "POST",
        body: JSON.stringify({ type: "casual", roundId, courseId, layoutId, holes, seed: [{ memberId: who.memberId, name: who.name }], startedAt: new Date().toISOString() }),
      });
      const data = await r.json().catch(() => ({}));
      return json({ ...data, roundId }, r.status, origin);
    }
    const rid = seg[1];
    if (!rid) return json({ error: "not_found" }, 404, origin);
    const stub = env.LIVE.get(env.LIVE.idFromName("round:" + rid));
    if (method === "GET" && seg.length === 2) return liveProxy(stub, "/snapshot", undefined, origin); // public CardCast snapshot
    if (seg[2] === "live" && seg[3] === "ws") return stub.fetch(request); // public WebSocket viewer
    if (seg[2] === "live" && method === "POST") {
      const sub = seg[3]; // score | cards | finish
      const who = await requireMember(request, env, origin);
      if (who instanceof Response) return who;
      if (await kvRateLimited(env, "live:" + who.memberId, 180, 60)) return json({ error: "rate_limited" }, 429, origin);
      if (sub === "finish") return liveForward(stub, "/finalize", {}, who, origin); // DO checks the requester is on a card
      if (sub === "score") return liveForward(stub, "/score", (await readJson(request)) ?? {}, who, origin);
      if (sub === "cards") {
        const cid = seg[4];
        const cardAct = seg[5];
        const body = (await readJson(request)) ?? {};
        if (!cid) return liveForward(stub, "/card", { label: body.label, name: who.name, division: null }, who, origin);
        if (cardAct === "join") return liveForward(stub, "/join", { cardId: cid, name: who.name, division: null }, who, origin);
        if (cardAct === "guest") return liveForward(stub, "/guest", { cardId: cid, name: body.name }, who, origin);
        if (cardAct === "leave") return liveForward(stub, "/leave", { cardId: cid, pid: body.pid }, who, origin);
        if (cardAct === "scorekeeper") return liveForward(stub, "/scorekeeper", { cardId: cid, pid: body.pid }, who, origin);
        if (cardAct === "cardmate") {
          const targetId = typeof body.memberId === "string" ? body.memberId : "";
          const m = targetId ? await getMember(env.ROSTER, targetId) : null;
          if (!m) return json({ error: "no_member" }, 404, origin);
          return liveForward(stub, "/cardmate", { cardId: cid, memberId: targetId, name: m.name, division: null }, who, origin);
        }
      }
    }
    return json({ error: "not_found" }, 404, origin);
  }

  if (method === "GET" && seg[0] === "events" && seg.length === 3 && seg[2] === "results") {
    const eid = asInt(seg[1]); // public: final results for a past event (club archive)
    return eid == null ? json({ error: "not_found" }, 404, origin) : json({ results: await db.listResults(env.DB, eid) }, 200, origin);
  }
  if (method === "GET" && seg[0] === "events" && seg.length === 3 && seg[2] === "ctps") {
    const eid = asInt(seg[1]);
    return eid == null ? json({ error: "not_found" }, 404, origin) : json({ ctps: await db.listCtps(env.DB, eid) }, 200, origin);
  }
  if (method === "GET" && seg[0] === "events" && seg.length === 3 && seg[2] === "ace-pot") {
    const eid = asInt(seg[1]);
    if (eid == null) return json({ error: "not_found" }, 404, origin);
    const [pot, cfg, contributors] = (await Promise.all([db.getAcePot(env.DB, eid), db.getEventConfig(env.DB, eid), db.aceContributors(env.DB, eid)])) as [Record<string, unknown> | null, { ace_fee_cents?: number } | null, number];
    const aceFee = cfg?.ace_fee_cents || 0;
    const carryIn = Number(pot?.carryover_in_cents || 0);
    return json({ ace_pot: { ...(pot || {}), contributors, ace_fee_cents: aceFee, total_cents: carryIn + contributors * aceFee } }, 200, origin);
  }
  if (method === "GET" && seg[0] === "courses" && seg.length === 3 && (seg[2] === "layouts" || seg[2] === "positions")) {
    const cid = asInt(seg[1]);
    if (cid == null) return json({ error: "not_found" }, 404, origin);
    return seg[2] === "layouts"
      ? json({ layouts: await db.listLayouts(env.DB, cid) }, 200, origin)
      : json({ positions: await db.listPositions(env.DB, cid) }, 200, origin);
  }

  // ---- member-authed event registration (Track G): /events/:id/{registration,register,checkin,pay} ----
  if (seg[0] === "events" && (seg[2] === "registration" || seg[2] === "register" || seg[2] === "checkin" || seg[2] === "pay")) {
    const claims = await requireAuth(request, env);
    if (!claims) return json({ error: "unauthorized" }, 401, origin);
    const eid = asInt(seg[1]);
    if (eid == null) return json({ error: "not_found" }, 404, origin);

    // PayPal Checkout: /events/:id/pay/{create-order,capture} (only when credentials are configured)
    if (seg[2] === "pay" && method === "POST") {
      if (!(env.PAYPAL_CLIENT_ID && env.PAYPAL_SECRET)) return json({ error: "payments_not_configured" }, 503, origin);
      const reg = (await db.getMyRegistration(env.DB, eid, claims.sub)) as { id: number; addons?: string; paid_entry?: number; payment_ref?: string } | null;
      if (!reg) return json({ error: "not_registered" }, 400, origin);
      const cfg = (await db.getEventConfig(env.DB, eid)) as { entry_fee_cents?: number; ctp_fee_cents?: number; ace_fee_cents?: number } | null;
      let addons: { ctp?: boolean; ace?: boolean } = {};
      try { addons = JSON.parse(reg.addons || "{}"); } catch { addons = {}; }
      const owed = computeOwed(cfg ?? {}, addons);
      if (owed <= 0) return json({ error: "nothing_owed" }, 400, origin);
      const creds = { clientId: env.PAYPAL_CLIENT_ID, secret: env.PAYPAL_SECRET, base: paypalBase(env.PAYPAL_ENV, env.PAYPAL_API_BASE) };
      try {
        if (seg[3] === "create-order") {
          if (reg.paid_entry === 1) return json({ error: "already_paid" }, 409, origin); // don't start a 2nd charge
          const orderId = await ppCreateOrder(creds, owed, "GVDG event entry");
          return json({ orderId }, 200, origin);
        }
        if (seg[3] === "capture") {
          const b = (await readJson(request)) ?? {};
          const orderId = asStr(b.orderId, 100);
          if (!orderId) return json({ error: "invalid_request" }, 400, origin);
          if (reg.paid_entry === 1) {
            // already paid: replaying the SAME order is an idempotent success; a DIFFERENT order is refused
            return reg.payment_ref === orderId ? json({ registration: reg }, 200, origin) : json({ error: "already_paid" }, 409, origin);
          }
          const cap = await ppCaptureOrder(creds, orderId);
          if (cap.status !== "COMPLETED" || cap.amountCents < owed) return json({ error: "payment_incomplete" }, 402, origin); // verify amount server-side
          // markRegistrationPaid only writes when paid_entry is still 0 (atomic) — closes the concurrent-capture race.
          const updated = await db.markRegistrationPaid(env.DB, reg.id, orderId, cap.amountCents);
          return json({ registration: updated ?? (await db.getRegistration(env.DB, reg.id)) }, 200, origin);
        }
      } catch (e) {
        return json({ error: "paypal_error", reason: String(e instanceof Error ? e.message : e) }, 502, origin);
      }
      return json({ error: "not_found" }, 404, origin);
    }

    if (seg[2] === "registration" && method === "GET") {
      return json({ config: await db.getEventConfig(env.DB, eid), registration: await db.getMyRegistration(env.DB, eid, claims.sub) }, 200, origin);
    }
    if (seg[2] === "register" && method === "POST") {
      const status = await db.getEventStatus(env.DB, eid);
      if (status !== "scheduled" && status !== "live") return json({ error: "registration_closed" }, 403, origin); // can't register for a cancelled/final/missing event
      const cfg = (await db.getEventConfig(env.DB, eid)) as { registration_open?: number; divisions?: string } | null;
      if (!cfg || cfg.registration_open !== 1) return json({ error: "registration_closed" }, 403, origin);
      const b = (await readJson(request)) ?? {};
      const division = asStr(b.division, 60);
      let divs: string[] = [];
      try { divs = JSON.parse(cfg.divisions || "[]"); } catch { divs = []; }
      if (division && divs.length && !divs.includes(division)) return json({ error: "invalid_division" }, 400, origin);
      const member = await getMember(env.ROSTER, claims.sub);
      const addons = b.addons && typeof b.addons === "object" ? JSON.stringify({ ctp: !!(b.addons as Record<string, unknown>).ctp, ace: !!(b.addons as Record<string, unknown>).ace }) : null;
      const row = await db.registerForEvent(env.DB, { event_id: eid, member_id: claims.sub, name: member?.name ?? "Member", division, team: asStr(b.team, 40), addons });
      return json({ registration: row }, 201, origin);
    }
    if (seg[2] === "register" && method === "DELETE") {
      const reg = (await db.getMyRegistration(env.DB, eid, claims.sub)) as { paid_entry?: number } | null;
      if (reg?.paid_entry === 1) return json({ error: "paid_contact_admin" }, 403, origin); // don't self-withdraw a paid spot (refund is an admin action)
      await db.withdrawRegistration(env.DB, eid, claims.sub);
      return json({ ok: true }, 200, origin);
    }
    if (seg[2] === "checkin" && method === "POST") {
      const row = await db.setCheckedIn(env.DB, eid, claims.sub, true);
      return row ? json({ registration: row }, 200, origin) : json({ error: "not_registered" }, 404, origin);
    }
    return json({ error: "not_found" }, 404, origin);
  }

  // ---- admin writes ----
  if (seg[0] !== "admin") return null;
  const gate = await adminGate(request, env, origin);
  if (gate instanceof Response) return gate;
  const adminId = gate.adminId;
  const sub = seg[1];
  const id = seg[2] != null ? asInt(seg[2]) : null;

  if (sub === "courses") {
    // tee/target position pool: /admin/courses/:id/positions[/:posId]
    if (seg[3] === "positions" && id != null) {
      if (method === "GET") return json({ positions: await db.listPositions(env.DB, id) }, 200, origin);
      if (method === "POST") {
        const b = await readJson(request);
        const kind = b && asStr(b.kind, 10);
        const pos = b && cleanPosition(b);
        if (!b || (kind !== "tee" && kind !== "target") || !pos) return json({ error: "invalid_position" }, 400, origin);
        const row = await db.createPosition(env.DB, { course_id: id, kind, label: pos.label, lat: pos.lat, lng: pos.lng, color: pos.color });
        return json({ position: row }, 201, origin);
      }
      if (method === "PATCH" && seg[4] != null) {
        // map editor: patch one position (drag → lat/lng, recolor, rename). Only provided fields change.
        const pid = asInt(seg[4]);
        if (pid == null) return json({ error: "not_found" }, 404, origin);
        const b = (await readJson(request)) ?? {};
        const patch: { label?: string; lat?: number | null; lng?: number | null; color?: string | null } = {};
        if (b.label !== undefined) { const l = asStr(b.label, 80); if (!l) return json({ error: "invalid_label" }, 400, origin); patch.label = l; }
        if (b.lat !== undefined) patch.lat = validLat(asNum(b.lat));
        if (b.lng !== undefined) patch.lng = validLng(asNum(b.lng));
        if (b.color !== undefined) patch.color = safeColor(b.color);
        return json({ position: await db.updatePosition(env.DB, id, pid, patch) }, 200, origin);
      }
      if (method === "PUT") {
        // bulk replace the pool (e.g. from a UDisc import)
        const b = (await readJson(request)) ?? {};
        const raw = Array.isArray(b.positions) ? b.positions : [];
        const positions: db.PositionInput[] = [];
        for (const r of raw) {
          const o = r as Record<string, unknown>;
          const kind = asStr(o?.kind, 10);
          const pos = cleanPosition(o);
          if ((kind === "tee" || kind === "target") && pos) positions.push({ course_id: id, kind, label: pos.label, lat: pos.lat, lng: pos.lng, color: pos.color });
        }
        return json({ positions: await db.replacePositions(env.DB, id, positions) }, 200, origin);
      }
      if (method === "DELETE" && seg[4] != null) {
        const pid = asInt(seg[4]);
        if (pid == null) return json({ error: "not_found" }, 404, origin);
        await db.deletePosition(env.DB, id, pid);
        return json({ ok: true }, 200, origin);
      }
    }
    if (method === "POST") {
      const b = await readJson(request);
      const name = b && asStr(b.name, 200);
      if (!b || !name) return json({ error: "invalid_course" }, 400, origin);
      const udisc = b.udisc_url == null ? null : asStr(b.udisc_url, 1000);
      if (b.udisc_url != null && (!udisc || !/^https?:\/\//.test(udisc))) return json({ error: "invalid_course" }, 400, origin);
      try {
        const row = await db.createCourse(env.DB, { name, location: asStr(b.location, 200), udisc_url: udisc, lat: asNum(b.lat), lng: asNum(b.lng), created_by: adminId });
        return json({ course: row }, 201, origin);
      } catch (e) {
        if (isUniqueViolation(e)) return json({ error: "course_exists" }, 409, origin); // courses.name is UNIQUE
        throw e;
      }
    }
    if (method === "PATCH" && id != null) {
      const b = (await readJson(request)) ?? {};
      try {
        const row = await db.updateCourse(env.DB, id, { name: asStr(b.name, 200), location: asStr(b.location, 200), udisc_url: asStr(b.udisc_url, 1000), lat: asNum(b.lat), lng: asNum(b.lng) });
        return row ? json({ course: row }, 200, origin) : json({ error: "not_found" }, 404, origin);
      } catch (e) {
        if (isUniqueViolation(e)) return json({ error: "course_exists" }, 409, origin);
        throw e;
      }
    }
    if (method === "DELETE" && id != null) { await db.deleteCourse(env.DB, id); return json({ ok: true }, 200, origin); }
  }

  if (sub === "events") {
    if (seg[3] === "players" && id != null) {
      if (method === "POST") {
        const b = await readJson(request);
        const name = b && asStr(b.name, 100);
        if (!b || !name) return json({ error: "invalid_player" }, 400, origin);
        const row = await db.addEventPlayer(env.DB, { event_id: id, member_id: asStr(b.member_id, 64), name, pdga_no: asStr(b.pdga_no, 20), division: asStr(b.division, 40), team: asStr(b.team, 40) });
        return json({ player: row }, 201, origin);
      }
      if (method === "DELETE" && seg[4] != null) {
        const pid = asInt(seg[4]);
        if (pid == null) return json({ error: "not_found" }, 404, origin);
        await db.removeEventPlayer(env.DB, id, pid);
        return json({ ok: true }, 200, origin);
      }
    }
    // registration config: PUT /admin/events/:id/config
    if (seg[3] === "config" && id != null && method === "PUT") {
      const b = (await readJson(request)) ?? {};
      const divs = jsonStringArray(b.divisions, 40);
      const fmt = b.play_format == null ? null : (inSet(["singles", "doubles", "teams"], b.play_format) ? (b.play_format as string) : undefined);
      if (fmt === undefined) return json({ error: "invalid_config" }, 400, origin);
      const row = await db.upsertEventConfig(env.DB, id, {
        registration_open: b.registration_open ? 1 : 0, entry_fee_cents: asInt(b.entry_fee_cents), ctp_fee_cents: asInt(b.ctp_fee_cents),
        ace_fee_cents: asInt(b.ace_fee_cents), divisions: divs, play_format: fmt, notes: asStr(b.notes, 2000),
      });
      return json({ config: row }, 200, origin);
    }
    // registrations roster: GET /admin/events/:id/registrations ; PATCH .../:rid
    if (seg[3] === "registrations" && id != null) {
      if (method === "GET" && seg[4] == null) return json({ registrations: await db.listRegistrations(env.DB, id) }, 200, origin);
      if (method === "PATCH" && seg[4] != null) {
        const rid = asInt(seg[4]);
        if (rid == null) return json({ error: "not_found" }, 404, origin);
        const b = (await readJson(request)) ?? {};
        const row = await db.adminUpdateRegistration(env.DB, rid, {
          division: asStr(b.division, 60), team: asStr(b.team, 40), starting_hole: asInt(b.starting_hole),
          checked_in: b.checked_in == null ? null : (b.checked_in ? 1 : 0), paid_entry: b.paid_entry == null ? null : (b.paid_entry ? 1 : 0),
        });
        return row ? json({ registration: row }, 200, origin) : json({ error: "not_found" }, 404, origin);
      }
    }
    // CTPs: POST /admin/events/:id/ctps ; PATCH .../ctps/:cid (winner) ; DELETE .../ctps/:cid
    if (seg[3] === "ctps" && id != null) {
      if (method === "POST" && seg[4] == null) {
        const b = await readJson(request);
        const hole = b && asInt(b.hole);
        if (!b || hole == null) return json({ error: "invalid_ctp" }, 400, origin);
        const row = await db.createCtp(env.DB, { event_id: id, hole, division: asStr(b.division, 60), prize: asStr(b.prize, 200) });
        return json({ ctp: row }, 201, origin);
      }
      const cid = seg[4] != null ? asInt(seg[4]) : null;
      if (method === "PATCH" && cid != null) {
        const b = (await readJson(request)) ?? {};
        const row = await db.setCtpWinner(env.DB, cid, id, asStr(b.winner_member_id, 64), asStr(b.winner_name, 100));
        return row ? json({ ctp: row }, 200, origin) : json({ error: "not_found" }, 404, origin);
      }
      if (method === "DELETE" && cid != null) { await db.deleteCtp(env.DB, id, cid); return json({ ok: true }, 200, origin); }
    }
    // Ace pot: PUT /admin/events/:id/ace-pot (carryover + resolve)
    if (seg[3] === "ace-pot" && id != null && method === "PUT") {
      const b = (await readJson(request)) ?? {};
      const status = b.status == null ? "active" : (inSet(["active", "paid_out", "carried"], b.status) ? (b.status as string) : undefined);
      if (status === undefined) return json({ error: "invalid_ace_pot" }, 400, origin);
      const row = await db.upsertAcePot(env.DB, id, {
        carryover_in_cents: asInt(b.carryover_in_cents), status, winner_member_id: asStr(b.winner_member_id, 64),
        winner_name: asStr(b.winner_name, 100), payout_cents: asInt(b.payout_cents), resolved_at: status === "active" ? null : new Date().toISOString(),
      });
      return json({ ace_pot: row }, 200, origin);
    }
    // Assign starting holes (shotgun) / teams — random (default) or keep order
    if ((seg[3] === "assign-starting-holes" || seg[3] === "assign-teams" || seg[3] === "assign-cards") && id != null && method === "POST") {
      const b = (await readJson(request)) ?? {};
      const regs = (await db.listRegistrations(env.DB, id)) as { id: number }[];
      let order = regs.map((r) => r.id);
      if (b.shuffle !== false) order = shuffle(order); // random by default
      if (seg[3] === "assign-cards") {
        const assigned = assignCards(order.map(String), asInt(b.size) || 4);
        await Promise.all(order.map((rid, i) => db.adminUpdateRegistration(env.DB, rid, { card_label: assigned[i]!.card })));
      } else if (seg[3] === "assign-starting-holes") {
        const ev = (await db.getEvent(env.DB, id)) as { layout_id?: number | null } | null;
        let holes = (await db.getLayoutHoles(env.DB, ev?.layout_id)).map((h) => h.hole);
        if (!holes.length) holes = Array.from({ length: asInt(b.holeCount) || 18 }, (_, i) => i + 1);
        const assigned = assignShotgun(order.map(String), holes, asInt(b.groupSize) || 4);
        await Promise.all(order.map((rid, i) => db.adminUpdateRegistration(env.DB, rid, { starting_hole: assigned[i]!.hole })));
      } else {
        const opts = asInt(b.size) ? { size: asInt(b.size)! } : { count: asInt(b.count) || 2 };
        const assigned = assignTeams(order.map(String), opts);
        await Promise.all(order.map((rid, i) => db.adminUpdateRegistration(env.DB, rid, { team: assigned[i]!.team })));
      }
      return json({ registrations: await db.listRegistrations(env.DB, id) }, 200, origin);
    }
    if (method === "POST" && seg.length === 2) {
      const b = await readJson(request);
      const v = b && validEventInput(b);
      if (!v) return json({ error: "invalid_event" }, 400, origin);
      const row = await db.createEvent(env.DB, { ...v, created_by: adminId });
      return json({ event: row }, 201, origin);
    }
    if (method === "PATCH" && id != null) {
      const b = (await readJson(request)) ?? {};
      if (b.status != null && !inSet(EVENT_STATUSES, b.status)) return json({ error: "invalid_event" }, 400, origin);
      if (b.format != null && b.format !== "" && !inSet(EVENT_FORMATS, b.format)) return json({ error: "invalid_event" }, 400, origin);
      const row = await db.updateEvent(env.DB, id, {
        name: asStr(b.name, 200), status: asStr(b.status), format: asStr(b.format),
        date: asStr(b.date, 40), course_id: b.course_id == null ? null : asInt(b.course_id),
        layout_id: b.layout_id == null ? null : asInt(b.layout_id), league_id: b.league_id == null ? null : asInt(b.league_id),
        notes: asStr(b.notes, 5000),
      });
      return row ? json({ event: row }, 200, origin) : json({ error: "not_found" }, 404, origin);
    }
    if (method === "DELETE" && id != null) { await db.deleteEvent(env.DB, id); return json({ ok: true }, 200, origin); }
  }

  if (sub === "leagues") {
    if (method === "POST") {
      const b = await readJson(request);
      const name = b && asStr(b.name, 120);
      if (!b || !name) return json({ error: "invalid_league" }, 400, origin);
      const row = await db.createLeague(env.DB, { name, season: asStr(b.season, 40), format: asStr(b.format, 20), description: asStr(b.description, 2000), created_by: adminId });
      return json({ league: row }, 201, origin);
    }
    if (method === "PATCH" && id != null) {
      const b = (await readJson(request)) ?? {};
      const row = await db.updateLeague(env.DB, id, { name: asStr(b.name, 120), season: asStr(b.season, 40), format: asStr(b.format, 20), description: asStr(b.description, 2000) });
      return row ? json({ league: row }, 200, origin) : json({ error: "not_found" }, 404, origin);
    }
    if (method === "DELETE" && id != null) { await db.deleteLeague(env.DB, id); return json({ ok: true }, 200, origin); }
  }

  if (sub === "fundraisers") {
    const fr = (b: Record<string, unknown>) => {
      const paypal = b.paypal_url == null ? null : asStr(b.paypal_url, 1000);
      if (b.paypal_url != null && paypal && !/^https:\/\//.test(paypal)) return null; // https only
      const status = b.status == null ? null : (b.status === "active" || b.status === "closed" ? (b.status as string) : undefined);
      if (status === undefined) return null;
      return {
        title: asStr(b.title, 200), body_md: asStr(b.body_md, 20000), goal_cents: b.goal_cents == null ? null : asInt(b.goal_cents),
        raised_cents: b.raised_cents == null ? null : asInt(b.raised_cents), paypal_url: paypal, status,
        starts_at: asStr(b.starts_at, 40), ends_at: asStr(b.ends_at, 40),
      };
    };
    if (method === "POST") {
      const b = await readJson(request);
      const v = b && fr(b);
      if (!v || !v.title) return json({ error: "invalid_fundraiser" }, 400, origin);
      const row = await db.createFundraiser(env.DB, { ...v, title: v.title, status: v.status ?? "active", created_by: adminId });
      return json({ fundraiser: row }, 201, origin);
    }
    if (method === "PATCH" && id != null) {
      const b = (await readJson(request)) ?? {};
      const v = fr(b);
      if (!v) return json({ error: "invalid_fundraiser" }, 400, origin);
      const row = await db.updateFundraiser(env.DB, id, v);
      return row ? json({ fundraiser: row }, 200, origin) : json({ error: "not_found" }, 404, origin);
    }
    if (method === "DELETE" && id != null) { await db.deleteFundraiser(env.DB, id); return json({ ok: true }, 200, origin); }
  }

  if (sub === "meetings") {
    if (method === "POST") {
      const b = await readJson(request);
      const date = b && asStr(b.date, 40), title = b && asStr(b.title, 200);
      if (!b || !date || !title) return json({ error: "invalid_meeting" }, 400, origin);
      const row = await db.createMeeting(env.DB, { date, title, minutes_md: asStr(b.minutes_md, 50000), action_items: jsonStringArray(b.action_items, 100), attendees: jsonStringArray(b.attendees, 100), created_by: adminId });
      return json({ meeting: row }, 201, origin);
    }
    if (method === "PATCH" && id != null) {
      const b = (await readJson(request)) ?? {};
      const row = await db.updateMeeting(env.DB, id, { date: asStr(b.date, 40), title: asStr(b.title, 200), minutes_md: asStr(b.minutes_md, 50000), action_items: b.action_items === undefined ? null : jsonStringArray(b.action_items, 100), attendees: b.attendees === undefined ? null : jsonStringArray(b.attendees, 100) });
      return row ? json({ meeting: row }, 200, origin) : json({ error: "not_found" }, 404, origin);
    }
    if (method === "DELETE" && id != null) { await db.deleteMeeting(env.DB, id); return json({ ok: true }, 200, origin); }
  }

  if (sub === "import" && method === "POST") {
    const kind = seg[2];
    const b = (await readJson(request)) ?? {};
    try {
      if (kind === "dgs") {
        const url = asStr(b.feedUrl, 500) ?? DEFAULT_DGS_FEED;
        const text = await safeFetch(url, ["raw.githubusercontent.com", "discgolfscene.com"]);
        let feed: unknown;
        try { feed = JSON.parse(text); } catch { return json({ error: "import_parse_failed" }, 422, origin); }
        return json({ source: "dgs", candidates: normalizeDgs(feed) }, 200, origin);
      }
      if (kind === "csv") {
        let csvText = typeof b.csv === "string" ? b.csv : null;
        if (csvText && csvText.length > 500_000) return json({ error: "csv_too_large" }, 413, origin);
        if (!csvText && typeof b.url === "string") csvText = await safeFetch(b.url, ["docs.google.com"]);
        if (!csvText) return json({ error: "invalid_request" }, 400, origin);
        return json({ source: "csv", candidates: normalizeCsvEvents(parseCsvRows(csvText)) }, 200, origin);
      }
      if (kind === "udisc") {
        const url = asStr(b.url, 500);
        if (!url) return json({ error: "invalid_request" }, 400, origin);
        const html = await safeFetch(url, ["udisc.com"]);
        // Best-effort layout (pars + tee/target coords + position pool); falls back to name-only.
        return json({ source: "udisc", candidate: parseUdiscLayout(html, url) }, 200, origin);
      }
      return json({ error: "not_found" }, 404, origin);
    } catch (e) {
      if (e instanceof ImportError) return json({ error: "import_failed", reason: e.message }, 400, origin);
      throw e;
    }
  }

  if (sub === "layouts") {
    if (method === "POST") {
      const b = await readJson(request);
      const courseId = b && asInt(b.course_id);
      const clean = b && Array.isArray(b.holes) ? sanitizeHoles(b.holes) : null;
      if (!b || courseId == null || !clean || clean.length === 0) return json({ error: "invalid_layout" }, 400, origin);
      const { holes, total_par } = enrichHoles(clean); // compute distances (geo/par/manual) + total par
      const row = await db.createLayout(env.DB, { course_id: courseId, name: asStr(b.name, 60) ?? "Main", holes, total_par });
      return json({ layout: row }, 201, origin);
    }
    if (method === "PATCH" && id != null) {
      const b = (await readJson(request)) ?? {};
      let holes: LayoutHole[] | undefined;
      let total_par: number | undefined;
      if (Array.isArray(b.holes)) {
        const clean = sanitizeHoles(b.holes);
        if (!clean || clean.length === 0) return json({ error: "invalid_layout" }, 400, origin);
        ({ holes, total_par } = enrichHoles(clean));
      }
      const row = await db.updateLayout(env.DB, id, { name: asStr(b.name, 60), holes, total_par });
      return row ? json({ layout: row }, 200, origin) : json({ error: "not_found" }, 404, origin);
    }
    if (method === "DELETE" && id != null) { await db.deleteLayout(env.DB, id); return json({ ok: true }, 200, origin); }
  }

  return json({ error: "not_found" }, 404, origin);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = allowedOrigin(env, request);
    const { pathname } = new URL(request.url);
    const method = request.method.toUpperCase();

    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (!secretOk(env)) return json({ error: "server_misconfigured" }, 500, origin);

    try {
    if (pathname === "/login" && method === "POST") return handleLogin(request, env, origin);
    if (pathname === "/me" && method === "GET") return handleMe(request, env, origin);
    if (pathname === "/my-results" && method === "GET") return handleMyResults(request, env, origin);
    if (pathname === "/my-rounds" && method === "GET") return handleMyRounds(request, env, origin);
    if (pathname === "/board" || pathname.startsWith("/board/")) return handleBoard(request, env, origin);
    if (pathname === "/my-registrations" && method === "GET") return handleMyRegistrations(request, env, origin);
    if (pathname === "/set-pin" && method === "POST") return handleSetPin(request, env, origin);
    if (pathname === "/profile" && method === "POST") return handleProfile(request, env, origin);
    if (pathname === "/assistant" && method === "POST") return handleAssistant(request, env, origin);

    // --- passkeys / WebAuthn ---
    if (pathname === "/webauthn/register/options" && method === "POST") {
      const claims = await requireAuth(request, env);
      if (!claims) return json({ error: "unauthorized" }, 401, origin);
      const { status, data } = await registrationOptions(env, claims.sub);
      return json(data, status, origin);
    }
    if (pathname === "/webauthn/register/verify" && method === "POST") {
      const claims = await requireAuth(request, env);
      if (!claims) return json({ error: "unauthorized" }, 401, origin);
      const body = await readJson(request);
      if (!body) return json({ error: "invalid_request" }, 400, origin);
      const { status, data } = await registrationVerify(env, claims.sub, body as unknown as RegistrationResponseJSON);
      return json(data, status, origin);
    }
    if (pathname === "/webauthn/auth/options" && method === "POST") {
      const { status, data } = await authenticationOptions(env);
      return json(data, status, origin);
    }
    if (pathname === "/webauthn/auth/verify" && method === "POST") {
      const body = await readJson(request);
      if (!body) return json({ error: "invalid_request" }, 400, origin);
      const signToken = (claims: { sub: string; mustChangePin: boolean }) =>
        signSession(claims, env.JWT_SECRET, ttl(env));
      const { status, data } = await authenticationVerify(
        env,
        body as { flowId?: unknown; response?: AuthenticationResponseJSON },
        signToken,
      );
      return json(data, status, origin);
    }

    // --- club operations (events / courses / leagues / layouts) ---
    const club = await clubApi(request, env, origin, pathname, method);
    if (club) return club;

    return json({ error: "not_found" }, 404, origin);
    } catch (e) {
      // Any unhandled error (e.g. a D1 outage) -> a clean, CORS-bearing 500 so the browser sees the real
      // failure instead of a CORS/network error, and the cause is logged.
      console.error("worker_error", method, pathname, String(e instanceof Error ? e.stack : e));
      return json({ error: "server_error" }, 500, origin);
    }
  },
};
