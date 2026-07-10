import type { D1Like } from "./db-types.js";
import { createLayout, getLayout, updateLayout } from "./db-courses.js";
import { enrichHoles, type LayoutHole } from "./layouts.js";

export interface TeeSignRow {
  id: number; course_id: number; hole_number: number; r2_key: string;
  content_type: string; bytes: number; uploaded_by: string; created_at: string;
  status: string; extracted_json: string | null; extract_source: string | null;
  reviewed_by: string | null; reviewed_at: string | null;
}

export async function insertTeeSign(db: D1Like, t: {
  course_id: number; hole_number: number; r2_key: string; content_type: string; bytes: number; uploaded_by: string;
}) {
  return db.prepare(
    "INSERT INTO tee_signs (course_id, hole_number, r2_key, content_type, bytes, uploaded_by, status) " +
    "VALUES (?, ?, ?, ?, ?, ?, 'candidate') RETURNING *",
  ).bind(t.course_id, t.hole_number, t.r2_key, t.content_type, t.bytes, t.uploaded_by).first();
}

export async function getTeeSign(db: D1Like, id: number) {
  return db.prepare("SELECT * FROM tee_signs WHERE id = ?").bind(id).first() as Promise<TeeSignRow | null>;
}

export async function listMyTeeSigns(db: D1Like, memberId: string) {
  return (await db.prepare(
    "SELECT * FROM tee_signs WHERE uploaded_by = ? ORDER BY created_at DESC",
  ).bind(memberId).all()).results;
}

export async function listTeeSignsByStatus(db: D1Like, status: string) {
  return (await db.prepare(
    "SELECT * FROM tee_signs WHERE status = ? ORDER BY course_id, hole_number, created_at",
  ).bind(status).all()).results;
}

export async function listTeeSignsByCourse(db: D1Like, courseId: number, statuses: string[]) {
  if (!statuses.length) return [];
  const placeholders = statuses.map(() => "?").join(",");
  return (await db.prepare(
    `SELECT id, hole_number, status FROM tee_signs WHERE course_id = ? AND status IN (${placeholders}) ORDER BY hole_number, created_at`,
  ).bind(courseId, ...statuses).all()).results;
}

export async function setTeeSignStatus(db: D1Like, id: number, status: string, reviewedBy: string) {
  return db.prepare(
    "UPDATE tee_signs SET status = ?, reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ? RETURNING *",
  ).bind(status, reviewedBy, id).first();
}

export async function deleteTeeSign(db: D1Like, id: number): Promise<string | null> {
  const row = await db.prepare("DELETE FROM tee_signs WHERE id = ? RETURNING r2_key").bind(id).first<{ r2_key: string }>();
  return row?.r2_key ?? null;
}

export interface ApproveRow {
  layoutId?: number | null;
  newLayoutName?: string | null;
  par: number;
  distance_ft?: number | null;
  tee?: string | null;
  target?: string | null;
  color?: string | null;
}

export async function applyTeeSignRows(
  db: D1Like, courseId: number, hole: number, rows: ApproveRow[], teeSignKey: string, teeSignId: number,
): Promise<number[]> {
  const affected: number[] = [];
  for (const row of rows) {
    let layoutId = row.layoutId ?? null;
    if (layoutId == null) {
      const name = (row.newLayoutName && String(row.newLayoutName).slice(0, 80)) || "Main";
      const created = (await createLayout(db, { course_id: courseId, name, holes: [], total_par: null })) as { id: number };
      layoutId = created.id;
    }
    const layout = (await getLayout(db, layoutId)) as { holes?: string } | null;
    const holes: LayoutHole[] = JSON.parse(layout?.holes ?? "[]");
    const idx = holes.findIndex((h) => Number(h.hole) === hole);
    const entry: LayoutHole & { tee_sign_key: string; tee_sign_id: number; color?: string | null } = {
      hole, par: row.par,
      verified: { par: row.par, distance_ft: row.distance_ft ?? null, tee_sign_key: teeSignKey, tee_sign_id: teeSignId },
      manual_distance: null,
      tee: row.tee ? { label: String(row.tee).slice(0, 80) } : null,
      target: row.target ? { label: String(row.target).slice(0, 80) } : null,
      color: row.color ?? null,
      tee_sign_key: teeSignKey,
      tee_sign_id: teeSignId,
    };
    if (idx >= 0) holes[idx] = { ...holes[idx], ...entry }; else holes.push(entry);
    holes.sort((a, b) => Number(a.hole) - Number(b.hole));
    const enriched = enrichHoles(holes);
    await updateLayout(db, layoutId, { holes: enriched.holes, total_par: enriched.total_par });
    affected.push(layoutId);
  }
  return affected;
}

export async function demoteOtherOfficial(db: D1Like, courseId: number, hole: number, keepId: number): Promise<string[]> {
  const res = await db.prepare(
    "UPDATE tee_signs SET status = 'rejected' WHERE course_id = ? AND hole_number = ? AND status = 'official' AND id != ? RETURNING r2_key",
  ).bind(courseId, hole, keepId).all<{ r2_key: string }>();
  return res.results.map((r) => r.r2_key);
}

export async function setTeeSignExtraction(db: D1Like, id: number, extractedJson: string, source: string | null) {
  await db.prepare("UPDATE tee_signs SET extracted_json = ?, extract_source = ? WHERE id = ?")
    .bind(extractedJson, source, id).run();
}
