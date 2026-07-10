-- Track G G1: per-event registration config + member registrations (check-in; payments land in G2).
CREATE TABLE event_config (
  event_id          INTEGER PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  registration_open INTEGER NOT NULL DEFAULT 0,   -- 0/1
  entry_fee_cents   INTEGER,
  ctp_fee_cents     INTEGER,                       -- optional CTP pot add-on
  ace_fee_cents     INTEGER,                       -- optional ace pot add-on
  divisions         TEXT,                          -- JSON array of division names
  play_format       TEXT,                          -- singles | doubles | teams
  notes             TEXT
);
CREATE TABLE registrations (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id          INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  member_id         TEXT NOT NULL,
  name              TEXT NOT NULL,                 -- denormalized display name
  division          TEXT,
  team              TEXT,
  starting_hole     INTEGER,                       -- assigned by admin (shotgun); G3
  checked_in        INTEGER NOT NULL DEFAULT 0,
  paid_entry        INTEGER NOT NULL DEFAULT 0,    -- set on PayPal capture (G2)
  addons            TEXT,                          -- JSON {ctp:bool, ace:bool}
  payment_ref       TEXT,                          -- PayPal order id (G2)
  amount_paid_cents INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_reg_unique ON registrations(event_id, member_id);
CREATE INDEX idx_reg_event ON registrations(event_id);
