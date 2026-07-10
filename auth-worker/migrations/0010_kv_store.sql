-- D1-backed KV fallback store (stopgap while this account's Workers KV data plane is degraded).
-- Namespaced key/value with optional TTL; used by the D1KV adapter (src/d1kv.ts) to serve the
-- ROSTER (member records, WebAuthn credentials) and RATELIMIT (lockouts, rate counters, WebAuthn
-- challenges) bindings on D1. Harmless to apply even when KV is in use — the table just sits empty.
CREATE TABLE IF NOT EXISTS kv_store (
  ns         TEXT    NOT NULL,
  key        TEXT    NOT NULL,
  value      TEXT    NOT NULL,
  expires_at INTEGER,            -- epoch ms; NULL = no expiry
  PRIMARY KEY (ns, key)
);
