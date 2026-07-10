// Self-organizing CASUAL rounds (no admin event): a member starts a round on a course layout and gets a
// short code; cardmates join with the code, anyone on the round can add guests, and everyone on it keeps
// score on one shared card. Reuses the LiveEventDO (keyed "round:<code>") and its scoring/leaderboard.
// Round control + scoring require a member (the DO binds writes to the Worker-injected identity); the
// snapshot + WebSocket are public reads. Casual finalize does not write D1 event results.

import type { Env } from "./env.js";
import * as db from "./db.js";
import { requireAuth } from "./authz.js";
import { getMember } from "./roster.js";
import { json, readJson } from "./http.js";
import { kvRateLimited } from "./kv-rate-limit.js";
import { asInt, asStr } from "./input.js";
import { isLiveFormatError, normalizeLiveScoringConfig, type LiveScoringConfig } from "./live-format.js";
import { weatherLocationForCourse } from "./weather.js";

const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // unambiguous (no 0/O/1/I/L)
function genCode(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
}
function roundStub(env: Env, code: string): DurableObjectStub {
  return env.LIVE.get(env.LIVE.idFromName("round:" + code));
}
async function proxy(stub: DurableObjectStub, path: string, init: RequestInit | undefined, origin: string | null): Promise<Response> {
  const r = await stub.fetch("https://do" + path, init);
  return json(await r.json().catch(() => ({})), r.status, origin);
}

export async function handleCasualRounds(
  request: Request,
  env: Env,
  origin: string | null,
  method: string,
  seg: string[],
): Promise<Response | null> {
  if (seg[0] !== "rounds") return null;

  // POST /rounds — a member starts a casual round on a layout; returns the share code.
  if (method === "POST" && seg.length === 1) {
    const claims = await requireAuth(request, env);
    if (!claims) return json({ error: "unauthorized" }, 401, origin);
    if (await kvRateLimited(env, "round-create:" + claims.sub, 10, 60)) return json({ error: "rate_limited" }, 429, origin);
    const b = (await readJson(request)) ?? {};
    const layoutId = asInt(b.layout_id);
    if (layoutId == null) return json({ error: "invalid_request" }, 400, origin);
    let liveScoringConfig: LiveScoringConfig;
    try {
      liveScoringConfig = normalizeLiveScoringConfig(b.liveScoringConfig ?? b.live_scoring_config);
    } catch (error) {
      if (isLiveFormatError(error)) return json({ error: "invalid_live_scoring_config" }, 400, origin);
      throw error;
    }
    const holes = await db.getLayoutHoles(env.DB, layoutId);
    if (!holes.length) return json({ error: "no_layout_holes" }, 400, origin);
    const layout = (await db.getLayout(env.DB, layoutId)) as { name?: string | null; course_id?: number | null } | null;
    const course = layout?.course_id != null ? ((await db.getCourse(env.DB, layout.course_id)) as { name?: string | null; udisc_course_id?: string | null; lat?: number | null; lng?: number | null } | null) : null;
    const weatherLocation = weatherLocationForCourse(course, layout); // null unless the course has coords
    const member = await getMember(env.ROSTER, claims.sub);
    const code = genCode();
    const pairLabel = asStr(b.pairLabel, 40) ?? asStr(b.pair_label, 40) ?? asStr(b.team, 40);
    const initialPlayer = { memberId: claims.sub, name: member?.name ?? "Player", ...(pairLabel ? { team: pairLabel } : {}) };
    const r = await roundStub(env, code).fetch("https://do/start", {
      method: "POST",
      body: JSON.stringify({ casual: true, roundCode: code, courseId: layout?.course_id ?? null, layoutId, createdBy: claims.sub, courseName: course?.name ?? null, layoutName: layout?.name ?? null, udiscCourseId: course?.udisc_course_id ?? null, weatherLocation, holes, players: [initialPlayer], liveScoringConfig, startedAt: new Date().toISOString() }),
    });
    if (r.status !== 200) return json({ error: "start_failed" }, 502, origin);
    return json({ code }, 201, origin);
  }

  const code = (seg[1] || "").toUpperCase();
  if (!/^[A-Z0-9]{4,12}$/.test(code)) return json({ error: "not_found" }, 404, origin);
  const stub = roundStub(env, code);
  const sub = seg[2];

  // Public reads: snapshot + WebSocket (memberIds redacted, identified by index).
  if (method === "GET" && sub === "live" && !seg[3]) return proxy(stub, "/snapshot", undefined, origin);
  if (sub === "live" && seg[3] === "ws") return stub.fetch(request);

  // Public read: durable finalized results (survives the DO's eviction; casual finalize persists to D1).
  // Redact internal ids (member_id / created_by) the same way the live snapshot does — names are enough for
  // a public leaderboard, and we never expose member ids to an unauthenticated reader who has the code.
  if (method === "GET" && sub === "results") {
    const data = await db.listCasualRoundResults(env.DB, code);
    if (!data) return json({ error: "not_found" }, 404, origin);
    const { created_by: _cb, ...round } = data.round as Record<string, unknown>;
    const results = (data.results as Record<string, unknown>[]).map(({ member_id: _m, ...rest }) => rest);
    return json({ round, results }, 200, origin);
  }

  // Everything else needs a member (the DO binds the write to this identity, never the body).
  const claims = await requireAuth(request, env);
  if (!claims) return json({ error: "unauthorized" }, 401, origin);
  const hdr = { "X-Auth-Member": claims.sub };

  if (method === "POST" && sub === "cancel") {
    const member = await getMember(env.ROSTER, claims.sub);
    if (member?.isAdmin !== true) return json({ error: "forbidden" }, 403, origin);
    return proxy(stub, "/cancel", { method: "POST", headers: { ...hdr, "X-Auth-Admin": "true" } }, origin);
  }
  if (method === "POST" && sub === "join") {
    if (await kvRateLimited(env, "round-join:" + claims.sub, 60, 60)) return json({ error: "rate_limited" }, 429, origin);
    const member = await getMember(env.ROSTER, claims.sub);
    return proxy(stub, "/join", { method: "POST", headers: hdr, body: JSON.stringify({ name: member?.name ?? "Player" }) }, origin);
  }
  if (method === "POST" && sub === "guest") {
    if (await kvRateLimited(env, "round-guest:" + claims.sub, 30, 60)) return json({ error: "rate_limited" }, 429, origin); // cap walk-on spam → DO/snapshot bloat
    const b = (await readJson(request)) ?? {};
    // In doubles the guest needs a pair label (each doubles player must have a team); accept it at add-time.
    const team = asStr(b.pairLabel, 40) ?? asStr(b.pair_label, 40) ?? asStr(b.team, 40);
    return proxy(stub, "/guest", { method: "POST", headers: hdr, body: JSON.stringify({ name: b.name, team }) }, origin);
  }
  if (method === "POST" && sub === "remove") {
    // Drop a player from the round (accidental join, left early, or no-show). The DO authorizes from the
    // injected member identity (admin or same-card); index+name target the player (name guards a stale index).
    if (await kvRateLimited(env, "round-remove:" + claims.sub, 30, 60)) return json({ error: "rate_limited" }, 429, origin);
    const b = (await readJson(request)) ?? {};
    return proxy(stub, "/remove", { method: "POST", headers: hdr, body: JSON.stringify({ index: b.index, name: b.name }) }, origin);
  }
  if (method === "POST" && sub === "pairs") {
    if (await kvRateLimited(env, "round-pairs:" + claims.sub, 60, 60)) return json({ error: "rate_limited" }, 429, origin);
    const member = await getMember(env.ROSTER, claims.sub);
    const b = (await readJson(request)) ?? {};
    return proxy(stub, "/pairs", {
      method: "POST",
      headers: { ...hdr, "X-Auth-Admin": String(member?.isAdmin === true) },
      body: JSON.stringify({ assignments: b.assignments, pairs: b.pairs }),
    }, origin);
  }
  if (method === "POST" && sub === "finalize") {
    // Any member on the card may finalize when the whole card agrees. The force override (finalize past a
    // not-fully-agreed board) is admin-only, so only look up admin status when force is actually requested.
    const b = (await readJson(request)) ?? {};
    const force = b.force === true || new URL(request.url).searchParams.get("force") === "1";
    let admin = false;
    if (force) { const m = await getMember(env.ROSTER, claims.sub); admin = m?.isAdmin === true; }
    return proxy(stub, "/finalize", { method: "POST", headers: { ...hdr, "X-Auth-Admin": String(admin) }, body: JSON.stringify({ force }) }, origin);
  }
  if (sub === "live" && method === "GET" && seg[3] === "mine") {
    const r = await stub.fetch("https://do/mine", { headers: hdr });
    return json(await r.json().catch(() => ({})), r.status, origin);
  }
  if (sub === "live" && method === "POST" && seg[3] === "score") {
    if (await kvRateLimited(env, "live:" + claims.sub, 180, 60)) return json({ error: "rate_limited" }, 429, origin);
    const b = (await readJson(request)) ?? {};
    const r = await stub.fetch("https://do/score", { method: "POST", headers: { ...hdr, "X-Auth-Admin": "false" }, body: JSON.stringify(b) });
    return json(await r.json().catch(() => ({})), r.status, origin);
  }
  return json({ error: "not_found" }, 404, origin);
}
