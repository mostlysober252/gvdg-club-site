import type { Env } from "./env.js";
import * as db from "./db.js";
import { extractTeeSign } from "./vision.js";
import { json, readJson } from "./http.js";
import { kvRateLimited } from "./kv-rate-limit.js";
import { asInt, asStr } from "./input.js";

export async function handleAdminTeeSigns(
  request: Request,
  env: Env,
  origin: string | null,
  method: string,
  seg: string[],
  adminId: string,
  id: number | null,
): Promise<Response | null> {
  if (method === "GET" && id == null) {
    const status = new URL(request.url).searchParams.get("status") || "candidate";
    const teeSigns = (await db.listTeeSignsByStatus(env.DB, status)) as (Record<string, unknown> & { extracted_json?: string | null; course_id?: number; suggestedRows?: unknown[] })[];
    const layoutsByCourse = new Map<number, { id: number; name: string }[]>();
    for (const row of teeSigns) {
      let layouts: { label?: unknown; color?: unknown; par?: unknown; distance_ft?: unknown; tee?: unknown; target?: unknown }[] = [];
      try { layouts = (JSON.parse(row.extracted_json || "{}") as { layouts?: typeof layouts }).layouts || []; } catch { layouts = []; }
      const cid = Number(row.course_id);
      let courseLayouts = layoutsByCourse.get(cid);
      if (!courseLayouts) { courseLayouts = await db.listLayoutNames(env.DB, cid); layoutsByCourse.set(cid, courseLayouts); }
      row.suggestedRows = [];
      for (const l of layouts) {
        const matched = db.matchLayoutIn(courseLayouts, l.label);
        row.suggestedRows.push({
          label: l.label, color: l.color ?? null, par: l.par ?? null, distance_ft: l.distance_ft ?? null,
          tee: l.tee ?? null, target: l.target ?? null,
          layoutId: matched ? matched.id : null,
          suggestedLayoutName: matched ? matched.name : db.defaultLayoutName(l.label),
        });
      }
    }
    return json({ teeSigns }, 200, origin);
  }
  if (id != null && seg[3] === "extract" && method === "POST") {
    if (await kvRateLimited(env, "extract:" + adminId, 30, 60)) return json({ error: "rate_limited" }, 429, origin);
    const sign = await db.getTeeSign(env.DB, id);
    if (!sign) return json({ error: "not_found" }, 404, origin);
    const obj = await env.PHOTOS.get(sign.r2_key);
    if (!obj) return json({ error: "not_found" }, 404, origin);
    const bytes = new Uint8Array(await obj.arrayBuffer());
    const v = await extractTeeSign(env, bytes, sign.content_type);
    await db.setTeeSignExtraction(env.DB, id, JSON.stringify({ hole: v.hole, layouts: v.layouts }), v.source ?? null);
    return json({ ok: true, extracted: v }, 200, origin);
  }
  if (id != null && seg[3] === "approve" && method === "POST") {
    const b = (await readJson(request)) ?? {};
    const rawRows = Array.isArray(b.rows) ? b.rows : [];
    const rows: db.ApproveRow[] = [];
    for (const r of rawRows) {
      const o = r as Record<string, unknown>;
      const par = asInt(o.par);
      if (par == null || par < 1 || par > 15) continue;
      rows.push({
        layoutId: o.layoutId == null ? null : asInt(o.layoutId),
        newLayoutName: o.newLayoutName == null ? null : asStr(o.newLayoutName, 80),
        par,
        distance_ft: o.distance_ft == null ? null : asInt(o.distance_ft),
        tee: o.tee == null ? null : asStr(o.tee, 80),
        target: o.target == null ? null : asStr(o.target, 80),
        color: o.color == null ? null : asStr(o.color, 24),
      });
    }
    if (!rows.length) return json({ error: "no_valid_rows" }, 400, origin);
    const sign = await db.getTeeSign(env.DB, id);
    if (!sign) return json({ error: "not_found" }, 404, origin);
    const affected = await db.applyTeeSignRows(env.DB, sign.course_id, sign.hole_number, rows, sign.r2_key, id);
    const demotedKeys = await db.demoteOtherOfficial(env.DB, sign.course_id, sign.hole_number, id);
    await db.setTeeSignStatus(env.DB, id, "official", adminId);
    // The superseded officials are no longer referenced — reclaim their R2 blobs.
    for (const key of demotedKeys) await env.PHOTOS?.delete(key)?.catch(() => {});
    return json({ ok: true, affectedLayouts: affected }, 200, origin);
  }
  if (id != null && seg[3] === "reject" && method === "POST") {
    const sign = await db.getTeeSign(env.DB, id);
    if (!sign) return json({ error: "not_found" }, 404, origin);
    await db.setTeeSignStatus(env.DB, id, "rejected", adminId);
    // A rejected sign's image is never served again — reclaim its R2 blob instead of orphaning it.
    await env.PHOTOS?.delete(sign.r2_key)?.catch(() => {});
    return json({ ok: true }, 200, origin);
  }
  if (id != null && method === "DELETE") {
    const r2Key = await db.deleteTeeSign(env.DB, id);
    if (r2Key) await env.PHOTOS?.delete(r2Key)?.catch(() => {});
    return json({ ok: true }, 200, origin);
  }
  return null;
}
