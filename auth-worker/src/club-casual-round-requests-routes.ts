import type { Env } from "./env.js";
import * as db from "./db.js";
import * as casual from "./casual-round-requests.js";
import { requireAuth } from "./authz.js";
import { getMember } from "./roster.js";
import { json, readJson } from "./http.js";
import { kvRateLimited } from "./kv-rate-limit.js";
import { asInt, asStr } from "./input.js";
import { readD1OrFallback } from "./d1-retry.js";

const CREATE_LIMIT = 8;
const JOIN_LIMIT = 60;
const MAX_LOOKAHEAD_DAYS = 120;

function parseStartsAt(raw: unknown): string | null {
  const s = asStr(raw, 80);
  if (!s) return null;
  const ms = Date.parse(s);
  if (!Number.isFinite(ms)) return null;
  const min = Date.now() - 6 * 60 * 60 * 1000;
  const max = Date.now() + MAX_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000;
  if (ms < min || ms > max) return null;
  return new Date(ms).toISOString();
}

function memberName(member: { name?: string } | null): string {
  return member?.name || "Member";
}

export async function handleCasualRoundRequests(
  request: Request,
  env: Env,
  origin: string | null,
  method: string,
  seg: string[],
): Promise<Response | null> {
  if (seg[0] !== "casual-rounds") return null;

  if (method === "GET" && seg.length === 1) {
    const claims = await requireAuth(request, env);
    const requests = await readD1OrFallback(
      () => casual.listCasualRoundRequests(env.DB, claims?.sub ?? null),
      () => [],
    );
    return json({ requests }, 200, origin);
  }

  const claims = await requireAuth(request, env);
  if (!claims) return json({ error: "unauthorized" }, 401, origin);
  const member = await getMember(env.ROSTER, claims.sub);

  if (method === "POST" && seg.length === 1) {
    if (await kvRateLimited(env, "casual-request:" + claims.sub, CREATE_LIMIT, 60)) return json({ error: "rate_limited" }, 429, origin);
    const body = (await readJson(request)) ?? {};
    const courseId = asInt(body.course_id);
    const layoutId = asInt(body.layout_id);
    const startsAt = parseStartsAt(body.starts_at ?? body.startsAt);
    if (courseId == null || layoutId == null || !startsAt) return json({ error: "invalid_request" }, 400, origin);

    const [course, layout] = await Promise.all([
      db.getCourse(env.DB, courseId) as Promise<{ id?: number } | null>,
      db.getLayout(env.DB, layoutId) as Promise<{ id?: number; course_id?: number | string } | null>,
    ]);
    if (!course) return json({ error: "bad_course" }, 400, origin);
    if (!layout || Number(layout.course_id) !== courseId) return json({ error: "bad_layout" }, 400, origin);

    const name = memberName(member);
    const id = await casual.createCasualRoundRequest(env.DB, {
      course_id: courseId,
      layout_id: layoutId,
      created_by: claims.sub,
      created_by_name: name,
      starts_at: startsAt,
      notes: asStr(body.notes, 800),
    });
    if (id == null) return json({ error: "create_failed" }, 502, origin);
    await casual.joinCasualRoundRequest(env.DB, id, claims.sub, name);
    return json({ request: await casual.getCasualRoundRequest(env.DB, id, claims.sub) }, 201, origin);
  }

  const id = asInt(seg[1]);
  if (id == null) return json({ error: "not_found" }, 404, origin);
  const existing = await casual.getCasualRoundRequest(env.DB, id, claims.sub);
  if (!existing) return json({ error: "not_found" }, 404, origin);

  if (method === "POST" && seg.length === 3 && seg[2] === "join") {
    if (existing.status !== "open") return json({ error: "closed" }, 409, origin);
    if (await kvRateLimited(env, "casual-join:" + claims.sub, JOIN_LIMIT, 60)) return json({ error: "rate_limited" }, 429, origin);
    await casual.joinCasualRoundRequest(env.DB, id, claims.sub, memberName(member));
    return json({ request: await casual.getCasualRoundRequest(env.DB, id, claims.sub) }, 200, origin);
  }

  if (method === "DELETE" && seg.length === 3 && seg[2] === "join") {
    await casual.leaveCasualRoundRequest(env.DB, id, claims.sub);
    return json({ request: await casual.getCasualRoundRequest(env.DB, id, claims.sub) }, 200, origin);
  }

  if (method === "DELETE" && seg.length === 2) {
    if (existing.created_by !== claims.sub && member?.isAdmin !== true) return json({ error: "forbidden" }, 403, origin);
    await casual.closeCasualRoundRequest(env.DB, id);
    return json({ ok: true }, 200, origin);
  }

  return json({ error: "not_found" }, 404, origin);
}
