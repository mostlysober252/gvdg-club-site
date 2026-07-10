CREATE TABLE casual_round_requests (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id       INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  layout_id       INTEGER NOT NULL REFERENCES course_layouts(id) ON DELETE CASCADE,
  created_by      TEXT NOT NULL,
  created_by_name TEXT NOT NULL,
  starts_at       TEXT NOT NULL,
  notes           TEXT,
  status          TEXT NOT NULL DEFAULT 'open',
  round_code      TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE casual_round_commitments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id  INTEGER NOT NULL REFERENCES casual_round_requests(id) ON DELETE CASCADE,
  member_id   TEXT NOT NULL,
  member_name TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_casual_commitment_unique ON casual_round_commitments(request_id, member_id);
CREATE INDEX idx_casual_requests_open ON casual_round_requests(status, starts_at, id);
CREATE INDEX idx_casual_commitments_request ON casual_round_commitments(request_id, id);
