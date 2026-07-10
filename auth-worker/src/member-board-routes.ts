import type { Env } from "./env.js";
import * as db from "./db.js";
import { requireAuth } from "./authz.js";
import { json, readJson } from "./http.js";
import { kvRateLimited } from "./kv-rate-limit.js";
import { asInt } from "./input.js";
import { getMember } from "./roster.js";
import { readD1OrFallback } from "./d1-retry.js";

const BOARD_LIMIT = 15;

/** Distinct board authors' profile photos (from KV), keyed by member_id, so the UI can render avatars.
 *  Only authors who have set a photo are included; deduped across posts+replies and fetched in parallel. */
async function boardAuthorPhotos(env: Env, posts: Record<string, unknown>[]): Promise<Record<string, string>> {
  const ids = new Set<string>();
  const collect = (p: Record<string, unknown>) => {
    if (p && typeof p.member_id === "string") ids.add(p.member_id);
  };
  for (const p of posts) {
    collect(p);
    for (const r of (p.replies as Record<string, unknown>[]) ?? []) collect(r);
  }
  const out: Record<string, string> = {};
  await Promise.all(
    [...ids].map(async (id) => {
      const m = await getMember(env.ROSTER, id);
      if (m?.photo) out[id] = m.photo;
    }),
  );
  return out;
}

export async function handleBoard(request: Request, env: Env, origin: string | null): Promise<Response> {
  const claims = await requireAuth(request, env);
  if (!claims) return json({ error: "unauthorized" }, 401, origin);
  const seg = new URL(request.url).pathname.split("/").filter(Boolean);
  const method = request.method.toUpperCase();

  if (method === "GET" && seg.length === 1) {
    const posts = await readD1OrFallback(() => db.getBoardFeed(env.DB, 50), () => []);
    return json({ posts, authors: await boardAuthorPhotos(env, posts) }, 200, origin);
  }
  if (method === "POST" && seg.length === 1) {
    if (await kvRateLimited(env, "board:" + claims.sub, BOARD_LIMIT, 60)) return json({ error: "rate_limited" }, 429, origin);
    const bodyData = (await readJson(request)) ?? {};
    const body = typeof bodyData.body === "string" ? bodyData.body.trim() : "";
    if (!body) return json({ error: "empty_post" }, 400, origin);
    if (body.length > 4000) return json({ error: "post_too_long" }, 413, origin);
    const parentId = bodyData.parent_id == null ? null : asInt(bodyData.parent_id);
    if (parentId != null) {
      const parent = (await db.getBoardPost(env.DB, parentId)) as { parent_id?: number | null } | null;
      if (!parent || parent.parent_id != null) return json({ error: "bad_parent" }, 400, origin);
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
    if (post.member_id !== claims.sub && member?.isAdmin !== true) return json({ error: "forbidden" }, 403, origin);
    await db.deleteBoardPost(env.DB, id);
    return json({ ok: true }, 200, origin);
  }
  return json({ error: "not_found" }, 404, origin);
}
