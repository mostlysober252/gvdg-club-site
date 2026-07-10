import type { D1Like } from "./db-types.js";

export async function listLeagues(db: D1Like) {
  return (await db.prepare("SELECT * FROM leagues ORDER BY season DESC, name").all()).results;
}

export async function createLeague(
  db: D1Like,
  l: { name: string; season?: string | null; format?: string | null; description?: string | null; created_by?: string | null },
) {
  return db
    .prepare("INSERT INTO leagues (name, season, format, description, created_by) VALUES (?, ?, ?, ?, ?) RETURNING *")
    .bind(l.name, l.season ?? null, l.format ?? null, l.description ?? null, l.created_by ?? null)
    .first();
}

export async function getLeague(db: D1Like, id: number) {
  return db.prepare("SELECT * FROM leagues WHERE id = ?").bind(id).first();
}

export async function updateLeague(
  db: D1Like,
  id: number,
  l: { name?: string | null; season?: string | null; format?: string | null; description?: string | null },
) {
  return db
    .prepare(
      "UPDATE leagues SET name=COALESCE(?,name), season=COALESCE(?,season), format=COALESCE(?,format), description=COALESCE(?,description) WHERE id=? RETURNING *",
    )
    .bind(l.name ?? null, l.season ?? null, l.format ?? null, l.description ?? null, id)
    .first();
}

export async function deleteLeague(db: D1Like, id: number) {
  await db.prepare("DELETE FROM leagues WHERE id = ?").bind(id).run();
}

export async function listLeagueEvents(db: D1Like, leagueId: number) {
  return (await db.prepare("SELECT * FROM events WHERE league_id = ? ORDER BY date DESC, id DESC").bind(leagueId).all()).results;
}

// Leagues that are "active": they have a currently-live round OR a finalized round within the last 60 days.
// Drives the club standings shown on member dashboards; auto-appears/disappears as play happens.
export async function listActiveLeagues(db: D1Like) {
  return (
    await db
      .prepare(
        `SELECT * FROM leagues WHERE id IN (
           SELECT DISTINCT league_id FROM events
           WHERE league_id IS NOT NULL
             AND (status = 'live' OR (status = 'final' AND COALESCE(date, substr(created_at, 1, 10)) >= date('now', '-60 days')))
         ) ORDER BY season DESC, name`,
      )
      .all()
  ).results;
}

// Events currently being scored live (any league or standalone) — for the inline live leaderboards on the dashboard.
export async function listLiveEvents(db: D1Like) {
  return (
    await db
      .prepare("SELECT id, type, name, status, format, date, course_id, layout_id, league_id FROM events WHERE status = 'live' ORDER BY date DESC, id DESC")
      .all()
  ).results;
}

export async function leagueResultRows(db: D1Like, leagueId: number) {
  return (
    await db
      .prepare(
        "SELECT r.event_id, r.member_id, r.name, r.place, r.to_par, r.match_result, r.scoring_group FROM results r JOIN events e ON e.id = r.event_id WHERE e.league_id = ? AND e.status = 'final'",
      )
      .bind(leagueId)
      .all()
  ).results;
}
