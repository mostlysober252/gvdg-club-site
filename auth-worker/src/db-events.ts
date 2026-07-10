import type { D1Like } from "./db-types.js";

export interface EventCourseInput {
  course_id: number;
  layout_id?: number | null;
  label?: string | null;
  sort_order?: number | null;
}

export interface EventCourseRow extends EventCourseInput {
  id?: number;
  event_id?: number;
  course_name?: string | null;
  course_location?: string | null;
  course_udisc_url?: string | null;
  course_udisc_course_id?: string | null;
  layout_name?: string | null;
  total_par?: number | null;
}

export type EventPatch = {
  type?: string | null; name?: string | null; status?: string | null; format?: string | null; date?: string | null;
  course_id?: number | null; layout_id?: number | null; league_id?: number | null; notes?: string | null;
  starts_at?: string | null; registration_deadline?: string | null; checkin_deadline?: string | null;
  event_courses?: EventCourseInput[];
};

export interface EventInput {
  type: string;
  name: string;
  status?: string;
  format?: string | null;
  date?: string | null;
  course_id?: number | null;
  layout_id?: number | null;
  league_id?: number | null;
  source?: string;
  external_url?: string | null;
  notes?: string | null;
  created_by?: string | null;
  starts_at?: string | null;
  registration_deadline?: string | null;
  checkin_deadline?: string | null;
  event_courses?: EventCourseInput[];
}

type EventRow = Record<string, unknown>;

function missingEventCoursesTable(error: unknown): boolean {
  return /no such table: event_courses/i.test(String(error));
}

function primaryCourse(rows: EventCourseInput[] | undefined): EventCourseInput | null {
  return rows && rows.length ? rows[0]! : null;
}

function primaryCourseId(input: EventInput | EventPatch): number | null | undefined {
  if (input.event_courses !== undefined) return primaryCourse(input.event_courses)?.course_id ?? null;
  return input.course_id;
}

function primaryLayoutId(input: EventInput | EventPatch): number | null | undefined {
  if (input.event_courses !== undefined) return primaryCourse(input.event_courses)?.layout_id ?? null;
  return input.layout_id;
}

function fallbackEventCourses(row: EventRow): EventCourseRow[] {
  const courseId = row.course_id == null ? null : Number(row.course_id);
  if (courseId == null || !Number.isSafeInteger(courseId)) return [];
  const layoutId = row.layout_id == null ? null : Number(row.layout_id);
  return [{
    course_id: courseId,
    layout_id: Number.isSafeInteger(layoutId) ? layoutId : null,
    sort_order: 0,
  }];
}

function eventIdFromRow(row: EventRow): number | null {
  const id = row.id == null ? null : Number(row.id);
  return id != null && Number.isSafeInteger(id) ? id : null;
}

async function eventCoursesByEventId(db: D1Like, eventIds: number[]): Promise<Map<number, EventCourseRow[]>> {
  const uniqueIds = [...new Set(eventIds.filter(Number.isSafeInteger))];
  const out = new Map<number, EventCourseRow[]>();
  if (!uniqueIds.length) return out;
  const placeholders = uniqueIds.map(() => "?").join(",");
  try {
    const rows = (await db
      .prepare(
        `SELECT ec.id, ec.event_id, ec.course_id, ec.layout_id, ec.label, ec.sort_order,
                c.name AS course_name, c.location AS course_location, c.udisc_url AS course_udisc_url,
                c.udisc_course_id AS course_udisc_course_id, l.name AS layout_name, l.total_par
           FROM event_courses ec
           LEFT JOIN courses c ON c.id = ec.course_id
           LEFT JOIN course_layouts l ON l.id = ec.layout_id
          WHERE ec.event_id IN (${placeholders})
          ORDER BY ec.event_id, ec.sort_order, ec.id`,
      )
      .bind(...uniqueIds)
      .all<EventCourseRow>()).results;
    for (const row of rows) {
      const eventId = row.event_id == null ? null : Number(row.event_id);
      if (eventId == null || !Number.isSafeInteger(eventId)) continue;
      const list = out.get(eventId) ?? [];
      list.push(row);
      out.set(eventId, list);
    }
  } catch (error) {
    if (!missingEventCoursesTable(error)) throw error;
  }
  return out;
}

async function attachEventCourses(db: D1Like, rows: EventRow[]): Promise<EventRow[]> {
  const byEvent = await eventCoursesByEventId(db, rows.map(eventIdFromRow).filter((id): id is number => id != null));
  return rows.map((row) => {
    const id = eventIdFromRow(row);
    return { ...row, event_courses: id == null ? fallbackEventCourses(row) : (byEvent.get(id) ?? fallbackEventCourses(row)) };
  });
}

async function attachEventCoursesToRow<T extends EventRow>(db: D1Like, row: T | null): Promise<(T & { event_courses: EventCourseRow[] }) | null> {
  if (!row) return null;
  return (await attachEventCourses(db, [row]))[0] as T & { event_courses: EventCourseRow[] };
}

async function replaceEventCourses(db: D1Like, eventId: number, courses: EventCourseInput[]): Promise<void> {
  try {
    await db.prepare("DELETE FROM event_courses WHERE event_id = ?").bind(eventId).run();
    for (const [index, course] of courses.entries()) {
      await db
        .prepare("INSERT INTO event_courses (event_id, course_id, layout_id, label, sort_order) VALUES (?, ?, ?, ?, ?)")
        .bind(eventId, course.course_id, course.layout_id ?? null, course.label ?? null, course.sort_order ?? index)
        .run();
    }
  } catch (error) {
    if (!missingEventCoursesTable(error)) throw error;
  }
}

async function syncPrimaryEventCourse(db: D1Like, eventId: number, event: EventRow): Promise<void> {
  const courseId = event.course_id == null ? null : Number(event.course_id);
  try {
    if (!Number.isSafeInteger(courseId)) {
      await db.prepare("DELETE FROM event_courses WHERE event_id = ?").bind(eventId).run();
      return;
    }
    const layoutId = event.layout_id == null ? null : Number(event.layout_id);
    const primary = await db
      .prepare("SELECT id FROM event_courses WHERE event_id = ? ORDER BY sort_order, id LIMIT 1")
      .bind(eventId)
      .first<{ id: number }>();
    if (primary?.id != null) {
      await db
        .prepare("UPDATE event_courses SET course_id = ?, layout_id = ?, label = NULL, sort_order = 0 WHERE id = ?")
        .bind(courseId, Number.isSafeInteger(layoutId) ? layoutId : null, primary.id)
        .run();
      return;
    }
    await db
      .prepare("INSERT INTO event_courses (event_id, course_id, layout_id, label, sort_order) VALUES (?, ?, ?, NULL, 0)")
      .bind(eventId, courseId, Number.isSafeInteger(layoutId) ? layoutId : null)
      .run();
  } catch (error) {
    if (!missingEventCoursesTable(error)) throw error;
  }
}

export async function listEvents(
  db: D1Like,
  opts: { status?: string; type?: string; limit?: number | null; offset?: number | null } = {},
) {
  let sql = "SELECT e.*, c.play_format, c.live_scoring_config FROM events e LEFT JOIN event_config c ON c.event_id = e.id";
  const where: string[] = [];
  const binds: unknown[] = [];
  if (opts.status) { where.push("e.status = ?"); binds.push(opts.status); }
  if (opts.type) { where.push("e.type = ?"); binds.push(opts.type); }
  if (where.length) sql += " WHERE " + where.join(" AND ");
  sql += " ORDER BY e.date DESC, e.id DESC";
  if (Number.isInteger(opts.limit) && opts.limit != null) {
    sql += " LIMIT ?";
    binds.push(opts.limit);
    const offset = Number.isInteger(opts.offset) && (opts.offset ?? 0) > 0 ? opts.offset : 0;
    if (offset != null && offset > 0) { sql += " OFFSET ?"; binds.push(offset); }
  }
  const rows = (await db.prepare(sql).bind(...binds).all()).results;
  return attachEventCourses(db, rows);
}

export async function getEvent(db: D1Like, id: number) {
  const event = await db.prepare("SELECT * FROM events WHERE id = ?").bind(id).first();
  if (!event) return null;
  const players = (await db.prepare("SELECT * FROM event_players WHERE event_id = ? ORDER BY name").bind(id).all()).results;
  return attachEventCoursesToRow(db, { ...event, players });
}

export async function createEvent(db: D1Like, e: EventInput) {
  const courseId = primaryCourseId(e);
  const layoutId = primaryLayoutId(e);
  const event = await db
    .prepare(
      `INSERT INTO events (type, name, status, format, date, course_id, layout_id, league_id, source, external_url, notes, created_by, starts_at, registration_deadline, checkin_deadline)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    )
    .bind(
      e.type, e.name, e.status ?? "scheduled", e.format ?? null, e.date ?? null,
      courseId ?? null, layoutId ?? null, e.league_id ?? null,
      e.source ?? "manual", e.external_url ?? null, e.notes ?? null, e.created_by ?? null,
      e.starts_at ?? null, e.registration_deadline ?? null, e.checkin_deadline ?? null,
    )
    .first();
  const eventId = event ? eventIdFromRow(event) : null;
  if (event && eventId != null) {
    const courses = e.event_courses !== undefined ? e.event_courses : fallbackEventCourses(event);
    await replaceEventCourses(db, eventId, courses);
  }
  return attachEventCoursesToRow(db, event);
}

export async function updateEvent(db: D1Like, id: number, e: EventPatch) {
  const courseId = primaryCourseId(e);
  const layoutId = primaryLayoutId(e);
  const event = await db
    .prepare(
      `UPDATE events SET type=CASE WHEN ? THEN ? ELSE type END,
        name=CASE WHEN ? THEN ? ELSE name END,
        status=CASE WHEN ? THEN ? ELSE status END,
        format=CASE WHEN ? THEN ? ELSE format END,
        date=CASE WHEN ? THEN ? ELSE date END,
        course_id=CASE WHEN ? THEN ? ELSE course_id END,
        layout_id=CASE WHEN ? THEN ? ELSE layout_id END,
        league_id=CASE WHEN ? THEN ? ELSE league_id END,
        notes=CASE WHEN ? THEN ? ELSE notes END,
        starts_at=CASE WHEN ? THEN ? ELSE starts_at END,
        registration_deadline=CASE WHEN ? THEN ? ELSE registration_deadline END,
        checkin_deadline=CASE WHEN ? THEN ? ELSE checkin_deadline END,
        updated_at=datetime('now') WHERE id=? RETURNING *`,
    )
    .bind(
      e.type !== undefined ? 1 : 0, e.type ?? null,
      e.name !== undefined ? 1 : 0, e.name ?? null,
      e.status !== undefined ? 1 : 0, e.status ?? null,
      e.format !== undefined ? 1 : 0, e.format ?? null,
      e.date !== undefined ? 1 : 0, e.date ?? null,
      courseId !== undefined ? 1 : 0, courseId ?? null,
      layoutId !== undefined ? 1 : 0, layoutId ?? null,
      e.league_id !== undefined ? 1 : 0, e.league_id ?? null,
      e.notes !== undefined ? 1 : 0, e.notes ?? null,
      e.starts_at !== undefined ? 1 : 0, e.starts_at ?? null,
      e.registration_deadline !== undefined ? 1 : 0, e.registration_deadline ?? null,
      e.checkin_deadline !== undefined ? 1 : 0, e.checkin_deadline ?? null,
      id,
    )
    .first();
  if (event) {
    if (e.event_courses !== undefined) await replaceEventCourses(db, id, e.event_courses);
    else if (e.course_id !== undefined || e.layout_id !== undefined) await syncPrimaryEventCourse(db, id, event);
  }
  return attachEventCoursesToRow(db, event);
}

export async function deleteEvent(db: D1Like, id: number) {
  await db.prepare("DELETE FROM events WHERE id = ?").bind(id).run();
}

export async function addEventPlayer(
  db: D1Like,
  p: { event_id: number; member_id?: string | null; name: string; pdga_no?: string | null; division?: string | null; team?: string | null },
) {
  return db
    .prepare("INSERT INTO event_players (event_id, member_id, name, pdga_no, division, team) VALUES (?, ?, ?, ?, ?, ?) RETURNING *")
    .bind(p.event_id, p.member_id ?? null, p.name, p.pdga_no ?? null, p.division ?? null, p.team ?? null)
    .first();
}

export async function removeEventPlayer(db: D1Like, eventId: number, playerId: number) {
  await db.prepare("DELETE FROM event_players WHERE id = ? AND event_id = ?").bind(playerId, eventId).run();
}

export interface EventConfigPatch {
  registration_open?: number | null;
  entry_fee_cents?: number | null;
  ctp_fee_cents?: number | null;
  ace_fee_cents?: number | null;
  divisions?: string | null;
  play_format?: string | null;
  live_scoring_config?: string | null;
  notes?: string | null;
}

export async function getEventConfig(db: D1Like, eventId: number) {
  return db.prepare("SELECT * FROM event_config WHERE event_id = ?").bind(eventId).first();
}

export async function upsertEventConfig(db: D1Like, eventId: number, c: EventConfigPatch) {
  return db
    .prepare(
      `INSERT INTO event_config (event_id, registration_open, entry_fee_cents, ctp_fee_cents, ace_fee_cents, divisions, play_format, notes, live_scoring_config)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(event_id) DO UPDATE SET registration_open=excluded.registration_open, entry_fee_cents=excluded.entry_fee_cents,
         ctp_fee_cents=excluded.ctp_fee_cents, ace_fee_cents=excluded.ace_fee_cents, divisions=excluded.divisions,
         play_format=excluded.play_format, notes=excluded.notes, live_scoring_config=excluded.live_scoring_config RETURNING *`,
    )
    .bind(eventId, c.registration_open ?? 0, c.entry_fee_cents ?? null, c.ctp_fee_cents ?? null, c.ace_fee_cents ?? null, c.divisions ?? null, c.play_format ?? null, c.notes ?? null, c.live_scoring_config ?? null)
    .first();
}

export async function listOpenRegistrationEvents(db: D1Like) {
  return (
    await db
      .prepare(
        `SELECT e.id, e.name, e.status, e.date, e.type, e.format AS event_format, e.course_id, e.layout_id,
           co.name AS course_name, l.name AS layout_name, l.total_par,
           c.entry_fee_cents, c.ctp_fee_cents, c.ace_fee_cents, c.divisions, c.play_format, c.live_scoring_config
         FROM events e JOIN event_config c ON c.event_id = e.id
         LEFT JOIN courses co ON co.id = e.course_id
         LEFT JOIN course_layouts l ON l.id = e.layout_id
         WHERE c.registration_open = 1 AND e.status IN ('scheduled','live')
         ORDER BY CASE WHEN e.status = 'live' THEN 0 ELSE 1 END, e.date, e.id`,
      )
      .all()
  ).results;
}

export async function getEventStatus(db: D1Like, id: number): Promise<string | null> {
  const r = (await db.prepare("SELECT status FROM events WHERE id = ?").bind(id).first()) as { status?: string } | null;
  return r?.status ?? null;
}

// Lightweight schedule/cutoff fetch for the registration + check-in gates.
export async function getEventSchedule(db: D1Like, id: number) {
  return db.prepare("SELECT status, starts_at, registration_deadline, checkin_deadline FROM events WHERE id = ?").bind(id).first();
}

export async function listMemberLiveEvents(db: D1Like, memberId: string) {
  return (
    await db
      .prepare(
        `WITH member_events AS (
           SELECT event_id, division FROM registrations WHERE member_id = ?
           UNION ALL
           SELECT event_id, division FROM event_players WHERE member_id = ?
         )
         SELECT e.id, e.name, e.type, e.date, e.status, e.course_id, e.layout_id,
                c.name AS course_name, l.name AS layout_name, MAX(member_events.division) AS division
         FROM member_events
         JOIN events e ON e.id = member_events.event_id
         LEFT JOIN courses c ON c.id = e.course_id
         LEFT JOIN course_layouts l ON l.id = e.layout_id
         WHERE e.status = 'live'
         GROUP BY e.id
         ORDER BY e.date DESC, e.id DESC`,
      )
      .bind(memberId, memberId)
      .all()
  ).results;
}
