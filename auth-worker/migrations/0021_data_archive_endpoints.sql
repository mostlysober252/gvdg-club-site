-- Storage targets for optional archived score data exports.
-- Keeps one endpoint configurable as default while allowing multiple candidates.
CREATE TABLE data_archive_endpoints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  endpoint_url TEXT NOT NULL,
  auth_header TEXT,
  auth_prefix TEXT,
  auth_token TEXT,
  is_active INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE INDEX idx_data_archive_endpoints_active ON data_archive_endpoints(is_active);
