-- Track L: per-course pool of tee pads and targets (baskets) the layout editor draws from.
-- SAFARI mode links ANY tee to ANY target; positions carry optional GPS coords so the editor
-- can compute a best-estimate (geodesic) distance for custom holes. Populated by the admin
-- manually or best-effort from a UDisc import.
CREATE TABLE course_positions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id  INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,            -- 'tee' | 'target'
  label      TEXT NOT NULL,            -- e.g. 'Hole 5 (Blue)', 'Basket 5 (Long)'
  lat        REAL,
  lng        REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_positions_course ON course_positions(course_id, kind);
