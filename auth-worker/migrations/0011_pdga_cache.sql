-- Cache of scraped pdga.com player ratings (see src/pdga.ts / GET /pdga-stats). One row per PDGA#,
-- refreshed at most ~once a day so pdga.com is hit sparingly. `data` is the full JSON stats blob.
CREATE TABLE IF NOT EXISTS pdga_cache (
  pdga       TEXT    NOT NULL PRIMARY KEY,
  data       TEXT    NOT NULL,
  fetched_at INTEGER NOT NULL
);
