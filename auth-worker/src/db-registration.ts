import type { D1Like } from "./db-types.js";

export interface RegistrationInput {
  event_id: number;
  member_id: string;
  name: string;
  division?: string | null;
  team?: string | null;
  addons?: string | null;
  email?: string | null;
}

export async function getMyRegistration(db: D1Like, eventId: number, memberId: string) {
  return db.prepare("SELECT * FROM registrations WHERE event_id = ? AND member_id = ?").bind(eventId, memberId).first();
}

// A member's registrations joined with the event they're for, so the dashboard can show EVERY event a
// player signed up for — not just the ones still open for registration. Event columns are aliased
// (event_name/event_date/…) so they never collide with the registration's own name/division/etc.
export async function listMyRegistrations(db: D1Like, memberId: string) {
  return (
    await db
      .prepare(
        `SELECT r.*,
                e.name AS event_name, e.date AS event_date, e.status AS event_status,
                c.name AS course_name, l.name AS layout_name
         FROM registrations r
         LEFT JOIN events e ON e.id = r.event_id
         LEFT JOIN courses c ON c.id = e.course_id
         LEFT JOIN course_layouts l ON l.id = e.layout_id
         WHERE r.member_id = ?
         ORDER BY COALESCE(e.date, '') DESC, r.event_id DESC`,
      )
      .bind(memberId)
      .all()
  ).results;
}

export async function listRegistrations(db: D1Like, eventId: number) {
  return (await db.prepare("SELECT * FROM registrations WHERE event_id = ? ORDER BY division, name").bind(eventId).all()).results;
}

export async function registerForEvent(db: D1Like, r: RegistrationInput) {
  return db
    .prepare(
      `INSERT INTO registrations (event_id, member_id, name, division, team, addons, email) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(event_id, member_id) DO UPDATE SET name=excluded.name, division=excluded.division, team=excluded.team, addons=excluded.addons, email=COALESCE(excluded.email, registrations.email)
       RETURNING *`,
    )
    .bind(r.event_id, r.member_id, r.name, r.division ?? null, r.team ?? null, r.addons ?? null, r.email ?? null)
    .first();
}

export async function withdrawRegistration(db: D1Like, eventId: number, memberId: string) {
  await db.prepare("DELETE FROM registrations WHERE event_id = ? AND member_id = ?").bind(eventId, memberId).run();
}

export async function setCheckedIn(db: D1Like, eventId: number, memberId: string, val: boolean) {
  return db.prepare("UPDATE registrations SET checked_in = ? WHERE event_id = ? AND member_id = ? RETURNING *").bind(val ? 1 : 0, eventId, memberId).first();
}

export async function getRegistration(db: D1Like, id: number) {
  return db.prepare("SELECT * FROM registrations WHERE id = ?").bind(id).first();
}

export async function markRegistrationPaid(db: D1Like, id: number, paymentRef: string, amountCents: number) {
  return db
    .prepare("UPDATE registrations SET paid_entry = 1, payment_ref = ?, amount_paid_cents = ? WHERE id = ? AND paid_entry = 0 RETURNING *")
    .bind(paymentRef, amountCents, id)
    .first();
}

export async function reserveCapture(db: D1Like, id: number, paymentRef: string): Promise<boolean> {
  const row = await db
    .prepare("UPDATE registrations SET payment_ref = ? WHERE id = ? AND paid_entry = 0 AND (payment_ref IS NULL OR payment_ref = ?) RETURNING id")
    .bind(paymentRef, id, paymentRef)
    .first();
  return row != null;
}

export async function releaseCapture(db: D1Like, id: number, paymentRef: string): Promise<void> {
  await db.prepare("UPDATE registrations SET payment_ref = NULL WHERE id = ? AND paid_entry = 0 AND payment_ref = ?").bind(id, paymentRef).run();
}

export async function adminUpdateRegistration(
  db: D1Like,
  id: number,
  p: { division?: string | null; team?: string | null; starting_hole?: number | null; checked_in?: number | null; paid_entry?: number | null },
) {
  return db
    .prepare(
      `UPDATE registrations SET division=COALESCE(?,division), team=COALESCE(?,team), starting_hole=COALESCE(?,starting_hole),
        checked_in=COALESCE(?,checked_in), paid_entry=COALESCE(?,paid_entry) WHERE id=? RETURNING *`,
    )
    .bind(p.division ?? null, p.team ?? null, p.starting_hole ?? null, p.checked_in ?? null, p.paid_entry ?? null, id)
    .first();
}
