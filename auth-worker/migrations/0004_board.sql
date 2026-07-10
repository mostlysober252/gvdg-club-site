-- Members message board: a flat feed of top-level posts with threaded replies (parent_id).
-- Members-only (read + post require a valid member JWT). Bodies are markdown, rendered XSS-safe.
CREATE TABLE board_posts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id   INTEGER REFERENCES board_posts(id) ON DELETE CASCADE, -- NULL = top-level post; set = reply
  member_id   TEXT NOT NULL,     -- author (KV memberId)
  author_name TEXT NOT NULL,     -- denormalized display name
  body        TEXT NOT NULL,     -- markdown
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_board_parent ON board_posts(parent_id, id);
