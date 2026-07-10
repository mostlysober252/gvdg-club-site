-- Durable record of a finalized CASUAL round. The "round:<code>" Durable Object is ephemeral, so a
-- finished casual round (and its scores) would otherwise vanish when the DO is evicted. One header row
-- per finalized casual round + one result row per player. Keyed by round_code (ad-hoc casual rounds have
-- no casual_round_requests row, so we do NOT FK to that planning table). The holes snapshot + layout_id
-- let the ratings engine (Phase 3) compute a per-layout SSA even if the layout is edited afterward.
CREATE TABLE casual_rounds (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  round_code   TEXT NOT NULL,
  -- course_id / layout_id are best-effort metadata for the ratings engine (per-layout SSA). They are
  -- deliberately NOT foreign keys: a course/layout deleted mid-round must never block durable finalize,
  -- and the round is preserved even if its course later goes away (readers treat a stale id as "unknown").
  course_id    INTEGER,
  layout_id    INTEGER,
  course_name  TEXT,
  layout_name  TEXT,
  holes        TEXT,          -- JSON [{hole,par,distance_ft}] snapshot of the layout as played
  created_by   TEXT,          -- member id that started the round
  started_at   TEXT,
  finalized_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE casual_results (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  casual_round_id INTEGER NOT NULL REFERENCES casual_rounds(id) ON DELETE CASCADE,
  member_id       TEXT,          -- NULL / "g_<token>" for walk-on guests
  name            TEXT NOT NULL,
  division        TEXT,
  place           INTEGER,       -- NULL = DNF (didn't complete every hole)
  total           INTEGER,
  to_par          INTEGER,
  breakdown       TEXT,          -- JSON {aces,eagles,birdies,pars,bogeys,doubles_plus}
  scorecard       TEXT,          -- JSON [{hole,par,strokes}]
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- UNIQUE so a round_code maps to at most one durable round: combined with the delete-by-round_code before
-- insert in persistCasualResults(), a crash/error-recovery re-finalize can't accumulate duplicate rounds.
CREATE UNIQUE INDEX idx_casual_rounds_code ON casual_rounds(round_code);
CREATE INDEX idx_casual_results_round ON casual_results(casual_round_id);
CREATE INDEX idx_casual_results_member ON casual_results(member_id, id);
