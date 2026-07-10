import type { D1Like } from "./db-types.js";

export async function listCtps(db: D1Like, eventId: number) {
  return (await db.prepare("SELECT * FROM ctps WHERE event_id = ? ORDER BY hole").bind(eventId).all()).results;
}

export async function createCtp(db: D1Like, c: { event_id: number; hole: number; division?: string | null; prize?: string | null }) {
  return db
    .prepare("INSERT INTO ctps (event_id, hole, division, prize) VALUES (?, ?, ?, ?) RETURNING *")
    .bind(c.event_id, c.hole, c.division ?? null, c.prize ?? null)
    .first();
}

export async function setCtpWinner(db: D1Like, id: number, eventId: number, winnerMemberId: string | null, winnerName: string | null) {
  return db
    .prepare("UPDATE ctps SET winner_member_id = ?, winner_name = ? WHERE id = ? AND event_id = ? RETURNING *")
    .bind(winnerMemberId, winnerName, id, eventId)
    .first();
}

export async function deleteCtp(db: D1Like, eventId: number, id: number) {
  await db.prepare("DELETE FROM ctps WHERE id = ? AND event_id = ?").bind(id, eventId).run();
}

export async function getAcePot(db: D1Like, eventId: number) {
  return db.prepare("SELECT * FROM ace_pots WHERE event_id = ?").bind(eventId).first();
}

export async function upsertAcePot(db: D1Like, eventId: number, p: { carryover_in_cents?: number | null; status?: string | null; winner_member_id?: string | null; winner_name?: string | null; payout_cents?: number | null; resolved_at?: string | null }) {
  return db
    .prepare(
      `INSERT INTO ace_pots (event_id, carryover_in_cents, status, winner_member_id, winner_name, payout_cents, resolved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(event_id) DO UPDATE SET carryover_in_cents=excluded.carryover_in_cents, status=excluded.status,
         winner_member_id=excluded.winner_member_id, winner_name=excluded.winner_name, payout_cents=excluded.payout_cents,
         resolved_at=excluded.resolved_at RETURNING *`,
    )
    .bind(eventId, p.carryover_in_cents ?? 0, p.status ?? "active", p.winner_member_id ?? null, p.winner_name ?? null, p.payout_cents ?? null, p.resolved_at ?? null)
    .first();
}

export async function aceContributors(db: D1Like, eventId: number): Promise<number> {
  const r = await db.prepare("SELECT COUNT(*) AS n FROM registrations WHERE event_id = ? AND paid_entry = 1 AND addons LIKE '%\"ace\":true%'").bind(eventId).first();
  return Number((r as { n?: number } | null)?.n || 0);
}
