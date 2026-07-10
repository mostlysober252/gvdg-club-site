CREATE TABLE event_courses (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id    INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  course_id   INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  layout_id   INTEGER REFERENCES course_layouts(id) ON DELETE SET NULL,
  label       TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_event_courses_event ON event_courses(event_id, sort_order, id);
CREATE INDEX idx_event_courses_course ON event_courses(course_id);
CREATE INDEX idx_event_courses_layout ON event_courses(layout_id);

INSERT INTO event_courses (event_id, course_id, layout_id, sort_order)
SELECT id, course_id, layout_id, 0
  FROM events
 WHERE course_id IS NOT NULL;
