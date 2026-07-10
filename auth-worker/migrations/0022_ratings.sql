-- PDGA-style rating engine storage (see rating-engine.ts / rating-store.ts / ratings-recompute.ts).
-- round_ratings: one row per rated player-round (competition or casual), written at finalize.
-- player_ratings: the aggregated per-member/stream rating. layout_ssa: per-layout SSA baseline.
-- wind_gust_mph + weather_adjustment come from the live weather captured on the round (meta.weather).

CREATE TABLE IF NOT EXISTS round_ratings (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id          TEXT NOT NULL,
  player_name        TEXT NOT NULL,
  stream             TEXT NOT NULL CHECK (stream IN ('competition', 'casual')),
  event_id           INTEGER REFERENCES events(id) ON DELETE CASCADE,
  casual_round_code  TEXT,
  course_id          INTEGER REFERENCES courses(id),
  layout_id          INTEGER REFERENCES course_layouts(id),
  round_date         TEXT NOT NULL,
  total              INTEGER NOT NULL,
  to_par             INTEGER,
  round_rating       INTEGER,
  ssa                REAL,
  ppt                REAL,
  propagator_count   INTEGER NOT NULL DEFAULT 0,
  rating_method      TEXT NOT NULL CHECK (rating_method IN ('stable', 'provisional', 'layout', 'unrated')),
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  wind_gust_mph      REAL,
  weather_adjustment REAL NOT NULL DEFAULT 0,
  CHECK (event_id IS NOT NULL OR casual_round_code IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_round_ratings_event_member
  ON round_ratings(event_id, member_id) WHERE event_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_round_ratings_casual_member
  ON round_ratings(casual_round_code, member_id) WHERE casual_round_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_round_ratings_member_stream_date
  ON round_ratings(member_id, stream, round_date DESC);
CREATE INDEX IF NOT EXISTS idx_round_ratings_layout_stream
  ON round_ratings(layout_id, stream);

CREATE TABLE IF NOT EXISTS player_ratings (
  member_id       TEXT NOT NULL,
  stream          TEXT NOT NULL CHECK (stream IN ('competition', 'casual')),
  rating          INTEGER,
  rated_rounds    INTEGER NOT NULL DEFAULT 0,
  weighted_rounds INTEGER NOT NULL DEFAULT 0,
  updated_at      TEXT NOT NULL,
  PRIMARY KEY (member_id, stream)
);
CREATE INDEX IF NOT EXISTS idx_player_ratings_stream_rating
  ON player_ratings(stream, rating DESC);

CREATE TABLE IF NOT EXISTS layout_ssa (
  layout_id        INTEGER PRIMARY KEY REFERENCES course_layouts(id) ON DELETE CASCADE,
  ssa              REAL NOT NULL,
  ppt              REAL NOT NULL,
  propagator_count INTEGER NOT NULL DEFAULT 0,
  source_event_id  INTEGER REFERENCES events(id),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
