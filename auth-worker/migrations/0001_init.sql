-- GVDG club operations schema (D1 / SQLite). Phase 1 (F1).
-- Identity/auth stays in KV; D1 references the KV memberId and denormalizes name/pdga at write time.

-- Courses available for events. The site's listed courses are seeded with is_default=1;
-- admins may add ANY course manually.
CREATE TABLE courses (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  location    TEXT,
  udisc_url   TEXT,
  lat         REAL,
  lng         REAL,
  is_default  INTEGER NOT NULL DEFAULT 0,
  created_by  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_courses_name ON courses(name);

-- A scorable layout for a course: per-hole pars (UDisc-style). holes = JSON [{"hole":1,"par":3,"distance":250}].
CREATE TABLE course_layouts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id   INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  name        TEXT NOT NULL DEFAULT 'Main',
  holes       TEXT NOT NULL DEFAULT '[]',
  total_par   INTEGER,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_layouts_course ON course_layouts(course_id);

CREATE TABLE leagues (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  season      TEXT,
  format      TEXT,                 -- stroke | matchplay | doubles
  description TEXT,
  created_by  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Unified events table covers tournaments, league rounds, fundraisers, and meetings.
CREATE TABLE events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  type         TEXT NOT NULL,        -- tournament | league_round | fundraiser | meeting
  name         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'scheduled',  -- scheduled | live | final | cancelled
  format       TEXT,                 -- stroke | matchplay | doubles
  date         TEXT,                 -- ISO date/datetime
  course_id    INTEGER REFERENCES courses(id),
  layout_id    INTEGER REFERENCES course_layouts(id),
  league_id    INTEGER REFERENCES leagues(id),
  source       TEXT NOT NULL DEFAULT 'manual',     -- manual | dgs | csv | udisc
  external_url TEXT,
  notes        TEXT,
  created_by   TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT
);
CREATE INDEX idx_events_status ON events(status);
CREATE INDEX idx_events_date   ON events(date);
CREATE INDEX idx_events_league ON events(league_id);

-- Who is registered/playing in an event.
CREATE TABLE event_players (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id    INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  member_id   TEXT,                 -- KV memberId; NULL for a guest
  name        TEXT NOT NULL,        -- denormalized display name
  pdga_no     TEXT,
  division    TEXT,
  team        TEXT,                 -- e.g. Red/Blue for matchplay/doubles
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_eventplayers_event  ON event_players(event_id);
CREATE INDEX idx_eventplayers_member ON event_players(member_id);

-- Final results: the historical club archive AND each player's profile history.
CREATE TABLE results (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id    INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  member_id   TEXT,
  name        TEXT NOT NULL,
  place       INTEGER,
  total       INTEGER,              -- total strokes (stroke play)
  to_par      INTEGER,
  rating      INTEGER,              -- optional round rating
  breakdown   TEXT,                 -- JSON {aces,eagles,birdies,pars,bogeys,doubles}
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_results_event  ON results(event_id);
CREATE INDEX idx_results_member ON results(member_id);

-- Club meetings + minutes.
CREATE TABLE meetings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  date         TEXT NOT NULL,
  title        TEXT NOT NULL,
  minutes_md   TEXT,                -- markdown; rendered XSS-safe on the client
  action_items TEXT,               -- JSON array
  attendees    TEXT,               -- JSON array
  created_by   TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_meetings_date ON meetings(date);

-- Fundraiser pages (paired with the PayPal donate flow).
CREATE TABLE fundraisers (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT NOT NULL,
  body_md      TEXT,
  goal_cents   INTEGER,
  raised_cents INTEGER NOT NULL DEFAULT 0,
  paypal_url   TEXT,
  status       TEXT NOT NULL DEFAULT 'active',  -- active | closed
  starts_at    TEXT,
  ends_at      TEXT,
  created_by   TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
