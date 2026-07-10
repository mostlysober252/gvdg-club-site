-- Tee-sign capture (T1): crowdsourced per-hole photos + the par/distance an admin confirms from them.
-- The image bytes live in R2 (binding PHOTOS); this table is the capture/moderation ledger.
-- One row per uploaded photo; extracted_json holds the (later, AI-filled) per-layout suggestions.
CREATE TABLE tee_signs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id     INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  hole_number   INTEGER NOT NULL,
  r2_key        TEXT NOT NULL,
  content_type  TEXT NOT NULL,
  bytes         INTEGER NOT NULL,
  uploaded_by   TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  status        TEXT NOT NULL DEFAULT 'candidate',   -- candidate | official | rejected
  extracted_json TEXT,
  extract_source TEXT,
  reviewed_by   TEXT,
  reviewed_at   TEXT
);
CREATE INDEX idx_tee_signs_hole ON tee_signs(course_id, hole_number, status);
CREATE INDEX idx_tee_signs_status ON tee_signs(status);

-- Admin-assignable color on tees/targets (course_positions shipped in 0003). Rendered as swatches.
ALTER TABLE course_positions ADD COLUMN color TEXT;
