import type { D1Like } from "./db-types.js";

export interface DataArchiveEndpoint {
  readonly id: number;
  readonly label: string;
  readonly endpoint_url: string;
  readonly auth_header: string | null;
  readonly auth_prefix: string | null;
  readonly auth_token: string | null;
  readonly is_active: number;
  readonly created_by: string | null;
  readonly created_at: string;
  readonly updated_at: string | null;
}

export interface DataArchiveEndpointCreate {
  readonly label: string;
  readonly endpoint_url: string;
  readonly auth_header?: string | null;
  readonly auth_prefix?: string | null;
  readonly auth_token?: string | null;
  readonly is_active?: number | null;
  readonly created_by?: string | null;
}

export interface DataArchiveEndpointPatch {
  readonly label?: string | null;
  readonly endpoint_url?: string | null;
  readonly auth_header?: string | null;
  readonly auth_prefix?: string | null;
  readonly auth_token?: string | null;
  readonly is_active?: number | null;
}

export async function listDataArchiveEndpoints(db: D1Like): Promise<DataArchiveEndpoint[]> {
  return (await db.prepare("SELECT * FROM data_archive_endpoints ORDER BY is_active DESC, id DESC").all<DataArchiveEndpoint>()).results;
}

export async function getDataArchiveEndpoint(db: D1Like, id: number): Promise<DataArchiveEndpoint | null> {
  return db.prepare("SELECT * FROM data_archive_endpoints WHERE id = ?").bind(id).first<DataArchiveEndpoint>();
}

export async function getActiveDataArchiveEndpoint(db: D1Like): Promise<DataArchiveEndpoint | null> {
  return db.prepare("SELECT * FROM data_archive_endpoints WHERE is_active = 1 LIMIT 1").first<DataArchiveEndpoint>();
}

export async function createDataArchiveEndpoint(db: D1Like, input: DataArchiveEndpointCreate): Promise<DataArchiveEndpoint> {
  const row = await db
    .prepare(
      "INSERT INTO data_archive_endpoints (label, endpoint_url, auth_header, auth_prefix, auth_token, is_active, created_by) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *",
    )
    .bind(
      input.label,
      input.endpoint_url,
      input.auth_header ?? null,
      input.auth_prefix ?? null,
      input.auth_token ?? null,
      input.is_active ? 1 : 0,
      input.created_by ?? null,
    )
    .first<DataArchiveEndpoint>();
  if (!row) throw new Error("data_archive_endpoint_insert_failed");
  return row;
}

export async function updateDataArchiveEndpoint(
  db: D1Like,
  id: number,
  input: DataArchiveEndpointPatch,
): Promise<DataArchiveEndpoint | null> {
  const sets: string[] = ["updated_at = datetime('now')"];
  const binds: unknown[] = [];

  if (input.label !== undefined) {
    sets.push("label = ?");
    binds.push(input.label);
  }
  if (input.endpoint_url !== undefined) {
    sets.push("endpoint_url = ?");
    binds.push(input.endpoint_url);
  }
  if (input.auth_header !== undefined) {
    sets.push("auth_header = ?");
    binds.push(input.auth_header);
  }
  if (input.auth_prefix !== undefined) {
    sets.push("auth_prefix = ?");
    binds.push(input.auth_prefix);
  }
  if (input.auth_token !== undefined) {
    sets.push("auth_token = ?");
    binds.push(input.auth_token);
  }
  if (input.is_active !== undefined) {
    sets.push("is_active = ?");
    binds.push(input.is_active ? 1 : 0);
  }

  const row = await db.prepare(`UPDATE data_archive_endpoints SET ${sets.join(", ")} WHERE id = ? RETURNING *`).bind(...binds, id).first<DataArchiveEndpoint>();
  return row;
}

export async function deleteDataArchiveEndpoint(db: D1Like, id: number): Promise<DataArchiveEndpoint | null> {
  const row = await getDataArchiveEndpoint(db, id);
  if (!row) return null;
  await db.prepare("DELETE FROM data_archive_endpoints WHERE id = ?").bind(id).run();
  return row;
}

export async function activateDataArchiveEndpoint(db: D1Like, id: number): Promise<DataArchiveEndpoint | null> {
  await db.prepare("UPDATE data_archive_endpoints SET is_active = CASE WHEN id = ? THEN 1 ELSE 0 END, updated_at = datetime('now')").bind(id).run();
  return getDataArchiveEndpoint(db, id);
}
