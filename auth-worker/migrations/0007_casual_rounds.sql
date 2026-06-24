-- Track N3: casual rounds (UDisc-style anytime play) + personal round history.
-- A casual round is a live "container" (multi-card scorecard) NOT tied to an admin event. Its `id`
-- is an unguessable uuid that doubles as the public CardCast share token AND the Durable Object key
-- (round:<id>); knowing it permits a read-only snapshot only — writes require card membership.
CREATE TABLE rounds (
  id          TEXT PRIMARY KEY,                          -- crypto uuid; share token + DO key suffix
  course_id   INTEGER REFERENCES courses(id) ON DELETE SET NULL,
  layout_id   INTEGER REFERENCES course_layouts(id) ON DELETE SET NULL,
  created_by  TEXT NOT NULL,                             -- memberId of the starter
  status      TEXT NOT NULL DEFAULT 'live',              -- 'live' | 'final'
  started_at  TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);
CREATE INDEX idx_rounds_creator ON rounds(created_by);

-- Finalized per-player rows for a casual round — mirrors `results` so the dashboard can merge event
-- history and casual history into one "My rounds" list.
CREATE TABLE round_results (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id    TEXT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  member_id   TEXT,
  name        TEXT NOT NULL,
  place       INTEGER,
  total       INTEGER,
  to_par      INTEGER,
  breakdown   TEXT,                                      -- JSON {aces,eagles,birdies,pars,bogeys,doubles_plus}
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_round_results_round  ON round_results(round_id);
CREATE INDEX idx_round_results_member ON round_results(member_id);
