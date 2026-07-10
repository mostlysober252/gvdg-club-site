import type { D1Like, D1StatementLike } from "./db-types.js";

/** Run statements as ONE atomic D1 transaction when the binding supports batch() (real D1 does); otherwise
 *  fall back to sequential execution (the d1kv fallback and test stubs don't implement batch). Used to make
 *  a finalize write all-or-nothing so a mid-write failure can't leave a partial leaderboard. */
export async function runBatch(db: D1Like, statements: D1StatementLike[]): Promise<void> {
  if (statements.length === 0) return;
  if (typeof db.batch === "function") {
    await db.batch(statements);
    return;
  }
  for (const s of statements) await s.run();
}

export interface ResultInput {
  event_id: number;
  member_id?: string | null;
  name: string;
  place?: number | null;
  total?: number | null;
  to_par?: number | null;
  rating?: number | null;
  breakdown?: string | null;
  scorecard?: string | null;
  scoring_group?: string | null;
  match_result?: string | null;
}

export async function createResult(db: D1Like, r: ResultInput) {
  return db
    .prepare(
      "INSERT INTO results (event_id, member_id, name, place, total, to_par, rating, breakdown, scorecard, scoring_group, match_result) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *",
    )
    .bind(r.event_id, r.member_id ?? null, r.name, r.place ?? null, r.total ?? null, r.to_par ?? null, r.rating ?? null, r.breakdown ?? null, r.scorecard ?? null, r.scoring_group ?? null, r.match_result ?? null)
    .first();
}

export async function clearResults(db: D1Like, eventId: number) {
  await clearResultsStmt(db, eventId).run();
}

// Statement builders (no RETURNING, not executed) so a finalize can write clear + all inserts in one
// atomic db.batch() — see runBatch.
export function clearResultsStmt(db: D1Like, eventId: number): D1StatementLike {
  return db.prepare("DELETE FROM results WHERE event_id = ?").bind(eventId);
}

export function createResultStmt(db: D1Like, r: ResultInput): D1StatementLike {
  return db
    .prepare("INSERT INTO results (event_id, member_id, name, place, total, to_par, rating, breakdown, scorecard, scoring_group, match_result) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(r.event_id, r.member_id ?? null, r.name, r.place ?? null, r.total ?? null, r.to_par ?? null, r.rating ?? null, r.breakdown ?? null, r.scorecard ?? null, r.scoring_group ?? null, r.match_result ?? null);
}

export async function listResults(db: D1Like, eventId: number) {
  return (await db.prepare("SELECT * FROM results WHERE event_id = ? ORDER BY place, total").bind(eventId).all()).results;
}

export async function listMemberResults(db: D1Like, memberId: string, opts: { limit?: number | null; offset?: number | null } = {}) {
  const binds: unknown[] = [memberId];
  const limit = Number.isInteger(opts.limit) && opts.limit != null ? opts.limit : null;
  const rawOffset = opts.offset;
  const offset = typeof rawOffset === "number" && Number.isInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0;
  let sql =
    `SELECT r.*, e.name AS event_name, e.date AS event_date, e.type AS event_type,
                c.udisc_course_id AS udisc_course_id, c.udisc_url AS udisc_url
         FROM results r JOIN events e ON e.id = r.event_id
         LEFT JOIN courses c ON c.id = e.course_id
         WHERE r.member_id = ?
         ORDER BY COALESCE(e.date, r.created_at) DESC, r.created_at DESC, r.id DESC`;
  if (limit != null) {
    sql += " LIMIT ?";
    binds.push(limit);
    if (offset > 0) {
      sql += " OFFSET ?";
      binds.push(offset);
    }
  }
  return (
    await db
      .prepare(sql)
      .bind(...binds)
      .all()
  ).results;
}

export interface CasualRoundInput {
  round_code: string;
  course_id?: number | null;
  layout_id?: number | null;
  course_name?: string | null;
  layout_name?: string | null;
  holes?: string | null;
  scoring_config?: string | null;
  created_by?: string | null;
  started_at?: string | null;
}

export async function clearCasualRound(db: D1Like, roundCode: string) {
  await db.prepare("DELETE FROM casual_rounds WHERE round_code = ?").bind(roundCode).run();
}

export async function createCasualRound(db: D1Like, r: CasualRoundInput) {
  return db
    .prepare(
      "INSERT INTO casual_rounds (round_code, course_id, layout_id, course_name, layout_name, holes, created_by, started_at, scoring_config) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *",
    )
    .bind(r.round_code, r.course_id ?? null, r.layout_id ?? null, r.course_name ?? null, r.layout_name ?? null, r.holes ?? null, r.created_by ?? null, r.started_at ?? null, r.scoring_config ?? null)
    .first();
}

export interface CasualResultInput {
  casual_round_id: number;
  member_id?: string | null;
  name: string;
  division?: string | null;
  place?: number | null;
  total?: number | null;
  to_par?: number | null;
  breakdown?: string | null;
  scorecard?: string | null;
  scoring_group?: string | null;
  match_result?: string | null;
}

export async function createCasualResult(db: D1Like, r: CasualResultInput) {
  return db
    .prepare(
      "INSERT INTO casual_results (casual_round_id, member_id, name, division, place, total, to_par, breakdown, scorecard, scoring_group, match_result) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *",
    )
    .bind(r.casual_round_id, r.member_id ?? null, r.name, r.division ?? null, r.place ?? null, r.total ?? null, r.to_par ?? null, r.breakdown ?? null, r.scorecard ?? null, r.scoring_group ?? null, r.match_result ?? null)
    .first();
}

export function createCasualResultStmt(db: D1Like, r: CasualResultInput): D1StatementLike {
  return db
    .prepare(
      "INSERT INTO casual_results (casual_round_id, member_id, name, division, place, total, to_par, breakdown, scorecard, scoring_group, match_result) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(r.casual_round_id, r.member_id ?? null, r.name, r.division ?? null, r.place ?? null, r.total ?? null, r.to_par ?? null, r.breakdown ?? null, r.scorecard ?? null, r.scoring_group ?? null, r.match_result ?? null);
}

export async function listCasualRoundResults(db: D1Like, roundCode: string) {
  const round = (await db.prepare("SELECT * FROM casual_rounds WHERE round_code = ? ORDER BY id DESC LIMIT 1").bind(roundCode).first()) as { id?: number } | null;
  if (!round?.id) return null;
  const results = (await db.prepare("SELECT * FROM casual_results WHERE casual_round_id = ? ORDER BY place IS NULL, place, total").bind(round.id).all()).results;
  return { round, results };
}

export async function listMemberCasualResults(db: D1Like, memberId: string, opts: { limit?: number | null; offset?: number | null } = {}) {
  const binds: unknown[] = [memberId];
  const limit = Number.isInteger(opts.limit) && opts.limit != null ? opts.limit : null;
  const rawOffset = opts.offset;
  const offset = typeof rawOffset === "number" && Number.isInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0;
  let sql =
    `SELECT cr.*, r.round_code, r.course_name, r.layout_name, r.layout_id, r.finalized_at, r.holes AS round_holes,
                c.udisc_course_id AS udisc_course_id
         FROM casual_results cr JOIN casual_rounds r ON r.id = cr.casual_round_id
         LEFT JOIN courses c ON c.id = r.course_id
         WHERE cr.member_id = ?
         ORDER BY r.finalized_at DESC, cr.created_at DESC, cr.id DESC`;
  if (limit != null) {
    sql += " LIMIT ?";
    binds.push(limit);
    if (offset > 0) {
      sql += " OFFSET ?";
      binds.push(offset);
    }
  }
  return (
    await db
      .prepare(sql)
      .bind(...binds)
      .all()
  ).results;
}
