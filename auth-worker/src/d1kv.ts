// D1-backed implementation of the small KV surface (`KVLike`/`KVListLike`) that roster.ts and
// ratelimit.ts depend on. This is a STOPGAP: it lets the member roster, login lockouts, rate
// counters and WebAuthn challenges run on D1 (which is healthy on this account) while Workers KV
// is degraded. When KV recovers, re-add the `[[kv_namespaces]]` bindings and this adapter is
// bypassed automatically (see withKvFallback in index.ts).
//
// Storage: one `kv_store` table, namespaced by `ns` ("roster" | "ratelimit"), with an optional
// `expires_at` (epoch ms) replicating KV's expirationTtl. Expiry is lazy (filtered on read), which
// is sufficient because the only TTL'd keys are tiny, self-replacing rate-limit counters.

import type { KVListLike } from "./roster.js";

type Row = { value: string; expires_at: number | null };

export class D1KV implements KVListLike {
  constructor(private db: D1Database, private ns: string) {}

  async get(key: string): Promise<string | null> {
    const row = await this.db
      .prepare("SELECT value, expires_at FROM kv_store WHERE ns = ?1 AND key = ?2")
      .bind(this.ns, key)
      .first<Row>();
    if (!row) return null;
    if (row.expires_at != null && row.expires_at <= Date.now()) {
      await this.delete(key);
      return null;
    }
    return row.value;
  }

  async put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void> {
    const expiresAt = opts?.expirationTtl ? Date.now() + opts.expirationTtl * 1000 : null;
    await this.db
      .prepare(
        "INSERT INTO kv_store (ns, key, value, expires_at) VALUES (?1, ?2, ?3, ?4) " +
          "ON CONFLICT(ns, key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at",
      )
      .bind(this.ns, key, value, expiresAt)
      .run();
  }

  async delete(key: string): Promise<void> {
    await this.db.prepare("DELETE FROM kv_store WHERE ns = ?1 AND key = ?2").bind(this.ns, key).run();
  }

  async list(
    opts?: { prefix?: string; cursor?: string; limit?: number },
  ): Promise<{ keys: { name: string }[]; list_complete: boolean; cursor?: string }> {
    // Escape LIKE metacharacters in the prefix so e.g. "m_" matches literally, then anchor with "%".
    const prefix = opts?.prefix ?? "";
    const pattern = prefix.replace(/[\\%_]/g, (c) => "\\" + c) + "%";
    const res = await this.db
      .prepare(
        "SELECT key FROM kv_store WHERE ns = ?1 AND key LIKE ?2 ESCAPE '\\' " +
          "AND (expires_at IS NULL OR expires_at > ?3) ORDER BY key",
      )
      .bind(this.ns, pattern, Date.now())
      .all<{ key: string }>();
    return { keys: (res.results ?? []).map((r) => ({ name: r.key })), list_complete: true };
  }
}
