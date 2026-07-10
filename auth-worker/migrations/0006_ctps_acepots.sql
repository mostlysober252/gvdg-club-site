-- Track G G3: CTPs (closest-to-pin) and ace pots per event.
CREATE TABLE ctps (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id         INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  hole             INTEGER NOT NULL,
  division         TEXT,                 -- NULL = all divisions
  prize            TEXT,
  winner_member_id TEXT,
  winner_name      TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_ctps_event ON ctps(event_id);

CREATE TABLE ace_pots (
  event_id           INTEGER PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  carryover_in_cents INTEGER NOT NULL DEFAULT 0,   -- carried in from a prior event
  status             TEXT NOT NULL DEFAULT 'active', -- active | paid_out | carried
  winner_member_id   TEXT,
  winner_name        TEXT,
  payout_cents       INTEGER,
  resolved_at        TEXT
);
