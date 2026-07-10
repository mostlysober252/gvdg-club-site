import type { D1Like } from "./db-types.js";
import { fallbackCourse, fallbackCourses, fallbackLayout, fallbackLayoutNames, fallbackLayouts } from "./course-catalog-fallback.js";
import { readD1OrFallback } from "./d1-retry.js";

export interface CourseInput {
  name: string;
  location?: string | null;
  udisc_url?: string | null;
  udisc_course_id?: string | null;
  lat?: number | null;
  lng?: number | null;
  created_by?: string | null;
}

export async function listCourses(db: D1Like) {
  return (await readD1OrFallback(
    () => db.prepare("SELECT * FROM courses ORDER BY is_default DESC, name").all(),
    () => ({ results: fallbackCourses(), success: true }),
  )).results;
}

export async function getCourse(db: D1Like, id: number) {
  return readD1OrFallback(
    () => db.prepare("SELECT * FROM courses WHERE id = ?").bind(id).first(),
    () => fallbackCourse(id),
  );
}

export async function createCourse(db: D1Like, c: CourseInput) {
  return db
    .prepare(
      "INSERT INTO courses (name, location, udisc_url, udisc_course_id, lat, lng, is_default, created_by) VALUES (?, ?, ?, ?, ?, ?, 0, ?) RETURNING *",
    )
    .bind(c.name, c.location ?? null, c.udisc_url ?? null, c.udisc_course_id ?? null, c.lat ?? null, c.lng ?? null, c.created_by ?? null)
    .first();
}

export type CoursePatch = { name?: string | null; location?: string | null; udisc_url?: string | null; udisc_course_id?: string | null; lat?: number | null; lng?: number | null };

export async function updateCourse(db: D1Like, id: number, c: CoursePatch) {
  return db
    .prepare(
      "UPDATE courses SET name=COALESCE(?,name), location=COALESCE(?,location), udisc_url=COALESCE(?,udisc_url), udisc_course_id=COALESCE(?,udisc_course_id), lat=COALESCE(?,lat), lng=COALESCE(?,lng) WHERE id=? RETURNING *",
    )
    .bind(c.name ?? null, c.location ?? null, c.udisc_url ?? null, c.udisc_course_id ?? null, c.lat ?? null, c.lng ?? null, id)
    .first();
}

export async function deleteCourse(db: D1Like, id: number) {
  await db.prepare("DELETE FROM courses WHERE id = ?").bind(id).run();
}

export async function listLayouts(db: D1Like, courseId: number) {
  return (await readD1OrFallback(
    () => db.prepare("SELECT * FROM course_layouts WHERE course_id = ? ORDER BY id").bind(courseId).all(),
    () => ({ results: fallbackLayouts(courseId), success: true }),
  )).results;
}

export async function createLayout(
  db: D1Like,
  l: { course_id: number; name?: string; holes: unknown; total_par?: number | null },
) {
  const holesJson = JSON.stringify(l.holes ?? []);
  return db
    .prepare("INSERT INTO course_layouts (course_id, name, holes, total_par) VALUES (?, ?, ?, ?) RETURNING *")
    .bind(l.course_id, l.name ?? "Main", holesJson, l.total_par ?? null)
    .first();
}

export async function getLayout(db: D1Like, id: number) {
  return readD1OrFallback(
    () => db.prepare("SELECT * FROM course_layouts WHERE id = ?").bind(id).first(),
    () => fallbackLayout(id),
  );
}

export interface ScorableHole {
  hole: number;
  par: number;
  distance_ft: number | null;
  tee_sign_id: number | null;
}

export async function getLayoutHoles(db: D1Like, layoutId: number | null | undefined): Promise<ScorableHole[]> {
  if (!layoutId) return [];
  const layout = (await getLayout(db, Number(layoutId))) as { holes?: string } | null;
  try {
    return JSON.parse(layout?.holes ?? "[]").map((h: { hole: number; par: number; distance_ft?: number | null; verified?: { tee_sign_id?: number | null } | null; tee_sign_id?: number | null }) => ({
      hole: Number(h.hole),
      par: Number(h.par),
      distance_ft: h.distance_ft == null ? null : Number(h.distance_ft),
      tee_sign_id: h.verified?.tee_sign_id ?? h.tee_sign_id ?? null,
    }));
  } catch {
    return [];
  }
}

export async function updateLayout(
  db: D1Like,
  id: number,
  l: { name?: string | null; holes?: unknown; total_par?: number | null },
) {
  const holesJson = l.holes === undefined ? null : JSON.stringify(l.holes ?? []);
  return db
    .prepare(
      "UPDATE course_layouts SET name=COALESCE(?,name), holes=COALESCE(?,holes), total_par=COALESCE(?,total_par) WHERE id=? RETURNING *",
    )
    .bind(l.name ?? null, holesJson, l.total_par ?? null, id)
    .first();
}

export async function deleteLayout(db: D1Like, id: number) {
  await db.prepare("DELETE FROM course_layouts WHERE id = ?").bind(id).run();
}

export const POSITION_KINDS = ["tee", "target"] as const;
export type PositionKind = (typeof POSITION_KINDS)[number];

export interface PositionInput {
  course_id: number;
  kind: PositionKind;
  label: string;
  lat?: number | null;
  lng?: number | null;
  color?: string | null;
}

export async function listPositions(db: D1Like, courseId: number, kind?: PositionKind) {
  let sql = "SELECT * FROM course_positions WHERE course_id = ?";
  const binds: unknown[] = [courseId];
  if (kind) { sql += " AND kind = ?"; binds.push(kind); }
  sql += " ORDER BY kind, id";
  return (await readD1OrFallback(
    () => db.prepare(sql).bind(...binds).all(),
    () => ({ results: [], success: true }),
  )).results;
}

export async function createPosition(db: D1Like, p: PositionInput) {
  return db
    .prepare("INSERT INTO course_positions (course_id, kind, label, lat, lng, color) VALUES (?, ?, ?, ?, ?, ?) RETURNING *")
    .bind(p.course_id, p.kind, p.label, p.lat ?? null, p.lng ?? null, p.color ?? null)
    .first();
}

export async function deletePosition(db: D1Like, courseId: number, id: number) {
  await db.prepare("DELETE FROM course_positions WHERE id = ? AND course_id = ?").bind(id, courseId).run();
}

export async function replacePositions(db: D1Like, courseId: number, positions: PositionInput[]) {
  await db.prepare("DELETE FROM course_positions WHERE course_id = ?").bind(courseId).run();
  for (const p of positions) {
    await db
      .prepare("INSERT INTO course_positions (course_id, kind, label, lat, lng) VALUES (?, ?, ?, ?, ?)")
      .bind(courseId, p.kind, p.label, p.lat ?? null, p.lng ?? null)
      .run();
  }
  return listPositions(db, courseId);
}

export function normalizeLayoutLabel(label: unknown): string {
  return String(label ?? "").toLowerCase().replace(/\b(tees?|layout|pads?)\b/g, "").replace(/\s+/g, " ").trim();
}

export function defaultLayoutName(label: unknown): string {
  const n = normalizeLayoutLabel(label);
  if (n === "long") return "Long";
  if (n === "short") return "Short";
  if (!n) return "Main";
  return n.charAt(0).toUpperCase() + n.slice(1);
}

export async function listLayoutNames(db: D1Like, courseId: number): Promise<{ id: number; name: string }[]> {
  return (await readD1OrFallback(
    () => db.prepare("SELECT id, name FROM course_layouts WHERE course_id = ?").bind(courseId).all<{ id: number; name: string }>(),
    () => ({ results: fallbackLayoutNames(courseId), success: true }),
  )).results;
}

export function matchLayoutIn(rows: { id: number; name: string }[], label: unknown): { id: number; name: string } | null {
  const want = normalizeLayoutLabel(label) || normalizeLayoutLabel(defaultLayoutName(label));
  for (const r of rows) if (normalizeLayoutLabel(r.name) === want) return { id: r.id, name: r.name };
  return null;
}

export async function matchLayout(db: D1Like, courseId: number, label: unknown): Promise<{ id: number; name: string } | null> {
  return matchLayoutIn(await listLayoutNames(db, courseId), label);
}

export async function ensureDefaultLayouts(db: D1Like, courseId: number) {
  for (const name of ["Long", "Short"]) {
    if (!(await matchLayout(db, courseId, name))) {
      await createLayout(db, { course_id: courseId, name, holes: [], total_par: null });
    }
  }
}
