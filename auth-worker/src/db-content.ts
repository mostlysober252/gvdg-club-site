import type { D1Like } from "./db-types.js";

export interface BoardPostInput {
  parent_id?: number | null;
  member_id: string;
  author_name: string;
  body: string;
}

export async function getBoardFeed(db: D1Like, limit = 50): Promise<Record<string, unknown>[]> {
  const posts = (await db.prepare("SELECT * FROM board_posts WHERE parent_id IS NULL ORDER BY id DESC LIMIT ?").bind(limit).all()).results;
  const ids = posts.map((p) => p.id as number);
  let replies: Record<string, unknown>[] = [];
  if (ids.length) {
    const placeholders = ids.map(() => "?").join(",");
    replies = (await db.prepare(`SELECT * FROM board_posts WHERE parent_id IN (${placeholders}) ORDER BY id ASC`).bind(...ids).all()).results;
  }
  const byParent = new Map<number, Record<string, unknown>[]>();
  for (const r of replies) {
    const pid = r.parent_id as number;
    const parentReplies = byParent.get(pid);
    if (parentReplies) {
      parentReplies.push(r);
    } else {
      byParent.set(pid, [r]);
    }
  }
  return posts.map((p) => ({ ...p, replies: byParent.get(p.id as number) ?? [] }));
}

export async function getBoardPost(db: D1Like, id: number) {
  return db.prepare("SELECT * FROM board_posts WHERE id = ?").bind(id).first();
}

export async function createBoardPost(db: D1Like, p: BoardPostInput) {
  return db
    .prepare("INSERT INTO board_posts (parent_id, member_id, author_name, body) VALUES (?, ?, ?, ?) RETURNING *")
    .bind(p.parent_id ?? null, p.member_id, p.author_name, p.body)
    .first();
}

export async function deleteBoardPost(db: D1Like, id: number) {
  await db.prepare("DELETE FROM board_posts WHERE id = ?").bind(id).run();
}

export interface FundraiserInput {
  title: string;
  body_md?: string | null;
  goal_cents?: number | null;
  raised_cents?: number | null;
  paypal_url?: string | null;
  status?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  created_by?: string | null;
}

export async function listFundraisers(db: D1Like) {
  return (await db.prepare("SELECT * FROM fundraisers ORDER BY (status = 'active') DESC, id DESC").all()).results;
}

export async function getFundraiser(db: D1Like, id: number) {
  return db.prepare("SELECT * FROM fundraisers WHERE id = ?").bind(id).first();
}

export async function createFundraiser(db: D1Like, f: FundraiserInput) {
  return db
    .prepare(
      "INSERT INTO fundraisers (title, body_md, goal_cents, raised_cents, paypal_url, status, starts_at, ends_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *",
    )
    .bind(f.title, f.body_md ?? null, f.goal_cents ?? null, f.raised_cents ?? 0, f.paypal_url ?? null, f.status ?? "active", f.starts_at ?? null, f.ends_at ?? null, f.created_by ?? null)
    .first();
}

export type FundraiserPatch = { title?: string | null; body_md?: string | null; goal_cents?: number | null; raised_cents?: number | null; paypal_url?: string | null; status?: string | null; starts_at?: string | null; ends_at?: string | null };

export async function updateFundraiser(db: D1Like, id: number, f: FundraiserPatch) {
  return db
    .prepare(
      `UPDATE fundraisers SET title=COALESCE(?,title), body_md=COALESCE(?,body_md), goal_cents=COALESCE(?,goal_cents),
        raised_cents=COALESCE(?,raised_cents), paypal_url=COALESCE(?,paypal_url), status=COALESCE(?,status),
        starts_at=COALESCE(?,starts_at), ends_at=COALESCE(?,ends_at) WHERE id=? RETURNING *`,
    )
    .bind(f.title ?? null, f.body_md ?? null, f.goal_cents ?? null, f.raised_cents ?? null, f.paypal_url ?? null, f.status ?? null, f.starts_at ?? null, f.ends_at ?? null, id)
    .first();
}

export async function deleteFundraiser(db: D1Like, id: number) {
  await db.prepare("DELETE FROM fundraisers WHERE id = ?").bind(id).run();
}

export interface MeetingInput {
  date: string;
  title: string;
  minutes_md?: string | null;
  action_items?: string | null;
  attendees?: string | null;
  created_by?: string | null;
}

export async function listMeetings(db: D1Like) {
  return (await db.prepare("SELECT * FROM meetings ORDER BY date DESC, id DESC").all()).results;
}

export async function getMeeting(db: D1Like, id: number) {
  return db.prepare("SELECT * FROM meetings WHERE id = ?").bind(id).first();
}

export async function createMeeting(db: D1Like, m: MeetingInput) {
  return db
    .prepare("INSERT INTO meetings (date, title, minutes_md, action_items, attendees, created_by) VALUES (?, ?, ?, ?, ?, ?) RETURNING *")
    .bind(m.date, m.title, m.minutes_md ?? null, m.action_items ?? null, m.attendees ?? null, m.created_by ?? null)
    .first();
}

export type MeetingPatch = { date?: string | null; title?: string | null; minutes_md?: string | null; action_items?: string | null; attendees?: string | null };

export async function updateMeeting(db: D1Like, id: number, m: MeetingPatch) {
  return db
    .prepare(
      "UPDATE meetings SET date=COALESCE(?,date), title=COALESCE(?,title), minutes_md=COALESCE(?,minutes_md), action_items=COALESCE(?,action_items), attendees=COALESCE(?,attendees) WHERE id=? RETURNING *",
    )
    .bind(m.date ?? null, m.title ?? null, m.minutes_md ?? null, m.action_items ?? null, m.attendees ?? null, id)
    .first();
}

export async function deleteMeeting(db: D1Like, id: number) {
  await db.prepare("DELETE FROM meetings WHERE id = ?").bind(id).run();
}
