import type { Env } from "./env.js";
import * as db from "./db.js";
import { decodeDataUrl, teeSignKey } from "./photos.js";
import { extractTeeSign } from "./vision.js";
import { requireMember } from "./authz.js";
import { corsHeaders, json, readJson } from "./http.js";
import { kvRateLimited } from "./kv-rate-limit.js";
import { asInt } from "./input.js";

const TEE_SIGN_UPLOAD_BODY_BYTES = 4_300_000;

export async function handleTeeSignUpload(request: Request, env: Env, origin: string | null, ctx?: ExecutionContext): Promise<Response> {
  const who = await requireMember(request, env, origin);
  if (who instanceof Response) return who;
  if (!env.PHOTOS) return json({ error: "storage_unavailable" }, 503, origin);
  if (await kvRateLimited(env, "teesign:" + who.sub, 10, 60)) return json({ error: "rate_limited" }, 429, origin);
  const body = await readJson(request, TEE_SIGN_UPLOAD_BODY_BYTES);
  const courseId = asInt(body?.courseId);
  const hole = asInt(body?.hole);
  if (courseId == null || hole == null || hole < 1 || hole > 99) return json({ error: "invalid_request" }, 400, origin);
  const img = decodeDataUrl(body?.image);
  if (!img) return json({ error: "invalid_image" }, 400, origin);
  if (!(await db.getCourse(env.DB, courseId))) return json({ error: "invalid_course" }, 400, origin);
  const key = teeSignKey(courseId, hole, img.ext, crypto.randomUUID());
  await env.PHOTOS.put(key, img.bytes, { httpMetadata: { contentType: img.contentType } });
  let row;
  try {
    row = await db.insertTeeSign(env.DB, {
      course_id: courseId,
      hole_number: hole,
      r2_key: key,
      content_type: img.contentType,
      bytes: img.bytes.length,
      uploaded_by: who.sub,
    });
  } catch (e) {
    await env.PHOTOS.delete(key).catch(() => {});
    throw e;
  }
  const signId = (row as { id: number }).id;
  const p = (async () => {
    try {
      const v = await extractTeeSign(env, img.bytes, img.contentType);
      await db.setTeeSignExtraction(env.DB, signId, JSON.stringify({ hole: v.hole, layouts: v.layouts }), v.source ?? null);
    } catch (e) {
      console.error(JSON.stringify({ message: "vision_extract_failed", signId, error: e instanceof Error ? e.message : String(e) }));
    }
  })();
  if (ctx?.waitUntil) ctx.waitUntil(p); else void p;
  return json({ teeSign: row }, 201, origin);
}

export async function handleMyTeeSigns(request: Request, env: Env, origin: string | null): Promise<Response> {
  const who = await requireMember(request, env, origin);
  if (who instanceof Response) return who;
  return json({ teeSigns: await db.listMyTeeSigns(env.DB, who.sub) }, 200, origin);
}

export async function handleTeeSignImage(request: Request, env: Env, origin: string | null, id: number | null): Promise<Response> {
  if (id == null) return json({ error: "not_found" }, 404, origin);
  const sign = await db.getTeeSign(env.DB, id);
  if (!sign) return json({ error: "not_found" }, 404, origin);
  // A rejected sign is excluded from every member-facing list; never serve its blob either (id-enumeration IDOR).
  if (sign.status === "rejected") return json({ error: "not_found" }, 404, origin);
  if (sign.status !== "official") {
    const who = await requireMember(request, env, origin);
    if (who instanceof Response) return who;
  }
  const obj = await env.PHOTOS.get(sign.r2_key);
  if (!obj) return json({ error: "not_found" }, 404, origin);
  return new Response(obj.body, {
    status: 200,
    headers: {
      "Content-Type": sign.content_type,
      "Cache-Control": sign.status === "official" ? "public, max-age=86400" : "private, no-store",
      "X-Content-Type-Options": "nosniff",
      ...corsHeaders(origin),
    },
  });
}
