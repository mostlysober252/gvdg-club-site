import type { Env } from "./env.js";
import * as db from "./db.js";
import { json, readJson } from "./http.js";
import { asInt, asNum, asStr, cleanPosition, isUniqueViolation } from "./input.js";

const INVALID = Symbol("invalid");
/** UDisc's internal numeric course id (for the create-scorecard applink). Returns null when absent
 *  (POST: none; PATCH: leave unchanged), the digit string when valid, or INVALID to reject the request. */
function udiscCourseId(raw: unknown): string | null | typeof INVALID {
  if (raw == null) return null;
  if (typeof raw !== "string") return INVALID;
  const v = raw.trim();
  if (!v) return null;
  return /^\d{1,20}$/.test(v) ? v : INVALID;
}

export async function handleAdminCourses(
  request: Request,
  env: Env,
  origin: string | null,
  method: string,
  seg: string[],
  adminId: string,
  id: number | null,
): Promise<Response | null> {
  if (seg[3] === "positions" && id != null) {
    if (method === "GET") return json({ positions: await db.listPositions(env.DB, id) }, 200, origin);
    if (method === "POST") {
      const b = await readJson(request);
      const kind = b && asStr(b.kind, 10);
      const pos = b && cleanPosition(b);
      if (!b || (kind !== "tee" && kind !== "target") || !pos) return json({ error: "invalid_position" }, 400, origin);
      const row = await db.createPosition(env.DB, { course_id: id, kind, label: pos.label, lat: pos.lat, lng: pos.lng });
      return json({ position: row }, 201, origin);
    }
    if (method === "PUT") {
      const b = (await readJson(request)) ?? {};
      const raw = Array.isArray(b.positions) ? b.positions : [];
      const positions: db.PositionInput[] = [];
      for (const r of raw) {
        const o = r as Record<string, unknown>;
        const kind = asStr(o?.kind, 10);
        const pos = cleanPosition(o);
        if ((kind === "tee" || kind === "target") && pos) positions.push({ course_id: id, kind, label: pos.label, lat: pos.lat, lng: pos.lng });
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
    const courseId = udiscCourseId(b.udisc_course_id);
    if (courseId === INVALID) return json({ error: "invalid_course" }, 400, origin);
    try {
      const row = await db.createCourse(env.DB, { name, location: asStr(b.location, 200), udisc_url: udisc, udisc_course_id: courseId, lat: asNum(b.lat), lng: asNum(b.lng), created_by: adminId });
      return json({ course: row }, 201, origin);
    } catch (e) {
      if (isUniqueViolation(e)) return json({ error: "course_exists" }, 409, origin);
      throw e;
    }
  }
  if (method === "PATCH" && id != null) {
    const b = (await readJson(request)) ?? {};
    const courseId = udiscCourseId(b.udisc_course_id);
    if (courseId === INVALID) return json({ error: "invalid_course" }, 400, origin);
    try {
      const row = await db.updateCourse(env.DB, id, { name: asStr(b.name, 200), location: asStr(b.location, 200), udisc_url: asStr(b.udisc_url, 1000), udisc_course_id: courseId, lat: asNum(b.lat), lng: asNum(b.lng) });
      return row ? json({ course: row }, 200, origin) : json({ error: "not_found" }, 404, origin);
    } catch (e) {
      if (isUniqueViolation(e)) return json({ error: "course_exists" }, 409, origin);
      throw e;
    }
  }
  if (method === "DELETE" && id != null) {
    await db.deleteCourse(env.DB, id);
    return json({ ok: true }, 200, origin);
  }
  return null;
}
