import type { Env } from "./env.js";
import * as db from "./db.js";
import { json, readJson } from "./http.js";
import { asInt, asStr } from "./input.js";
import { isPublicHttpsUrl } from "./imports/fetch.js";

interface ExportPayload {
  exportedAt: string;
  requestedBy: string;
  options: {
    from?: string | null;
    to?: string | null;
    includeEventPlayers: boolean;
    includeResults: boolean;
    includeCasualRounds: boolean;
    includeEventConfig: boolean;
  };
  counts: {
    events: number;
    eventPlayers: number;
    results: number;
    eventConfig: number;
    ctps: number;
    acePots: number;
    casualRounds: number;
    casualResults: number;
    courses: number;
    layouts: number;
    leagues: number;
  };
  tables: {
    events: unknown[];
    event_players: unknown[];
    results: unknown[];
    event_config: unknown[];
    ctps: unknown[];
    ace_pots: unknown[];
    casual_rounds: unknown[];
    casual_results: unknown[];
    courses: unknown[];
    course_layouts: unknown[];
    leagues: unknown[];
  };
}

type ExportDestination = Omit<db.DataArchiveEndpoint, "auth_token"> & { hasAuthToken: boolean };

const EXPORT_FETCH_TIMEOUT_MS = 30000;

function parseBoolean(raw: unknown): boolean | null {
  if (raw === true || raw === false) return raw;
  if (raw === 1 || raw === 0) return raw === 1;
  if (typeof raw === "string") {
    if (raw === "true" || raw === "1") return true;
    if (raw === "false" || raw === "0") return false;
  }
  return null;
}

function hasProperty(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function parseExportDate(raw: unknown): string | null {
  if (!raw) return null;
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  return v;
}

function uniqueIds(rows: Array<Record<string, unknown>>, key: string): number[] {
  const ids = new Set<number>();
  for (const row of rows) {
    const v = row[key];
    if (typeof v === "number" && Number.isInteger(v) && v > 0) ids.add(v);
  }
  return [...ids];
}

function safeBody(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

function scrubEndpoint(row: db.DataArchiveEndpoint): ExportDestination {
  return {
    id: row.id,
    label: row.label,
    endpoint_url: row.endpoint_url,
    auth_header: row.auth_header,
    auth_prefix: row.auth_prefix,
    is_active: row.is_active,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    hasAuthToken: !!row.auth_token,
  };
}

function toList(rows: Array<Record<string, unknown> | null>): unknown[] {
  return rows.filter((row): row is Record<string, unknown> => row != null);
}

async function listByIds(dbLike: db.D1Like, table: string, idField: string, ids: number[], orderBy: string): Promise<unknown[]> {
  if (!ids.length) return [];
  const sql = `SELECT * FROM ${table} WHERE ${idField} IN (${ids.map(() => "?").join(",")}) ORDER BY ${orderBy}`;
  return toList((await dbLike.prepare(sql).bind(...ids).all()).results);
}

async function queryEvents(dbLike: db.D1Like, from: string | null, to: string | null): Promise<unknown[]> {
  const clauses: string[] = [];
  const binds: unknown[] = [];
  if (from) {
    clauses.push("date >= ?");
    binds.push(from);
  }
  if (to) {
    clauses.push("date <= ?");
    binds.push(to);
  }
  const sql = "SELECT * FROM events" + (clauses.length ? " WHERE " + clauses.join(" AND ") : "") + " ORDER BY date DESC, id DESC";
  return toList((await dbLike.prepare(sql).bind(...binds).all()).results);
}

async function queryCasualRounds(dbLike: db.D1Like, from: string | null, to: string | null): Promise<unknown[]> {
  const clauses: string[] = [];
  const binds: unknown[] = [];
  if (from) {
    clauses.push("finalized_at >= ?");
    binds.push(from);
  }
  if (to) {
    clauses.push("finalized_at <= ?");
    binds.push(to);
  }
  const sql = "SELECT * FROM casual_rounds" + (clauses.length ? " WHERE " + clauses.join(" AND ") : "") + " ORDER BY finalized_at DESC, id DESC";
  return toList((await dbLike.prepare(sql).bind(...binds).all()).results);
}

async function buildExportSnapshot(
  dbLike: db.D1Like,
  from: string | null,
  to: string | null,
  includeEventPlayers: boolean,
  includeResults: boolean,
  includeCasualRounds: boolean,
  includeEventConfig: boolean,
): Promise<ExportPayload> {
  const events = (await queryEvents(dbLike, from, to)) as Array<Record<string, unknown>>;
  const eventIds = uniqueIds(events, "id");

  const results: unknown[] = includeResults ? await listByIds(dbLike, "results", "event_id", eventIds, "event_id, place IS NULL, place, total") : [];
  const eventPlayers: unknown[] = includeEventPlayers
    ? await listByIds(dbLike, "event_players", "event_id", eventIds, "event_id, id")
    : [];

  const eventConfig: unknown[] = includeEventConfig
    ? (await Promise.all(
        eventIds.map(async (id) => {
          const cfg = await dbLike.prepare("SELECT * FROM event_config WHERE event_id = ?").bind(id).all();
          return toList(cfg.results);
        }),
      )).flat()
    : [];

  const ctps: unknown[] = includeEventConfig
    ? (await Promise.all(
        eventIds.map(async (id) => {
          const cfg = await dbLike.prepare("SELECT * FROM ctps WHERE event_id = ? ORDER BY hole, id").bind(id).all();
          return toList(cfg.results);
        }),
      )).flat()
    : [];

  const acePots: unknown[] = includeEventConfig
    ? (await Promise.all(
        eventIds.map(async (id) => {
          const cfg = await dbLike.prepare("SELECT * FROM ace_pots WHERE event_id = ?").bind(id).all();
          return toList(cfg.results);
        }),
      )).flat()
    : [];

  const courseIds = uniqueIds((events as Array<Record<string, unknown>>), "course_id");
  const layoutIds = uniqueIds((events as Array<Record<string, unknown>>), "layout_id");
  const leagueIds = uniqueIds((events as Array<Record<string, unknown>>), "league_id");

  const courses = await listByIds(dbLike, "courses", "id", courseIds, "name COLLATE NOCASE");
  const layouts = await listByIds(dbLike, "course_layouts", "id", layoutIds, "id");
  const leagues = await listByIds(dbLike, "leagues", "id", leagueIds, "name COLLATE NOCASE");

  let casualRounds: unknown[] = [];
  let casualResults: unknown[] = [];
  if (includeCasualRounds) {
    casualRounds = await queryCasualRounds(dbLike, from, to);
    const casualRoundIds = uniqueIds((casualRounds as Array<Record<string, unknown>>), "id");
    casualResults = await listByIds(dbLike, "casual_results", "casual_round_id", casualRoundIds, "casual_round_id, place IS NULL, place, total");
  }

  const payload: ExportPayload = {
    exportedAt: new Date().toISOString(),
    requestedBy: "",
    options: {
      from: from || null,
      to: to || null,
      includeEventPlayers,
      includeResults,
      includeCasualRounds,
      includeEventConfig,
    },
    counts: {
      events: events.length,
      eventPlayers: eventPlayers.length,
      results: results.length,
      eventConfig: eventConfig.length,
      ctps: ctps.length,
      acePots: acePots.length,
      casualRounds: casualRounds.length,
      casualResults: casualResults.length,
      courses: courses.length,
      layouts: layouts.length,
      leagues: leagues.length,
    },
    tables: {
      events,
      event_players: eventPlayers,
      results,
      event_config: eventConfig,
      ctps,
      ace_pots: acePots,
      casual_rounds: casualRounds,
      casual_results: casualResults,
      courses,
      course_layouts: layouts,
      leagues,
    },
  };

  return payload;
}

async function postToEndpoint(endpoint: db.DataArchiveEndpoint, payload: ExportPayload) {
  // SSRF guard: the endpoint URL is admin-configured and arbitrary, so refuse anything that could target
  // the internal network (IP literals, localhost, internal hosts) or leak auth over http.
  if (!isPublicHttpsUrl(endpoint.endpoint_url)) {
    return { ok: false, status: 0, preview: "blocked: endpoint must be a public https URL (no IP literals, localhost, or internal hosts)" };
  }
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (endpoint.auth_header && endpoint.auth_token) {
    const token = endpoint.auth_prefix ? `${endpoint.auth_prefix} ${endpoint.auth_token}` : endpoint.auth_token;
    headers[endpoint.auth_header] = token;
  }

  const init: RequestInit = {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    redirect: "manual", // don't let a 3xx to an internal host bypass the guard above
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EXPORT_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint.endpoint_url, { ...init, signal: controller.signal });
    if (response.status >= 300 && response.status < 400) {
      return { ok: false, status: response.status, preview: "blocked: endpoint must not redirect (a redirect could bypass the SSRF guard)" };
    }
    const preview = (await response.text()).slice(0, 1200);
    return { ok: response.ok, status: response.status, preview };
  } finally {
    clearTimeout(timer);
  }
}

export async function handleAdminExport(
  request: Request,
  env: Env,
  origin: string | null,
  method: string,
  seg: string[],
  adminId: string,
): Promise<Response | null> {
  if (seg[2] === "endpoints") {
    const id = seg[3] != null ? asInt(seg[3]) : null;

    if (method === "GET" && seg.length === 3) {
      const rows = await db.listDataArchiveEndpoints(env.DB);
      return json({ destinations: rows.map(scrubEndpoint) }, 200, origin);
    }

    if (method === "POST" && seg.length === 3) {
      const body = safeBody(await readJson(request));
      const label = asStr(body.label, 120);
      const endpointUrl = asStr(body.endpoint_url, 1000);
      const active = hasProperty(body, "is_active") ? parseBoolean(body.is_active) : null;
      if (!label || !endpointUrl || !isPublicHttpsUrl(endpointUrl)) return json({ error: "invalid_destination" }, 400, origin);
      if (hasProperty(body, "is_active") && active == null) return json({ error: "invalid_destination" }, 400, origin);
      const authHeader = hasProperty(body, "auth_header")
        ? (body.auth_header == null ? null : asStr(body.auth_header, 80) ?? (body.auth_header === "" ? null : null))
        : null;
      const authPrefix = hasProperty(body, "auth_prefix")
        ? (body.auth_prefix == null ? null : asStr(body.auth_prefix, 40) ?? (body.auth_prefix === "" ? null : null))
        : null;
      if (hasProperty(body, "auth_header") && body.auth_header != null && authHeader == null) return json({ error: "invalid_destination" }, 400, origin);
      if (hasProperty(body, "auth_prefix") && body.auth_prefix != null && authPrefix == null) return json({ error: "invalid_destination" }, 400, origin);
      const created = await db.createDataArchiveEndpoint(env.DB, {
        label,
        endpoint_url: endpointUrl,
        auth_header: authHeader,
        auth_prefix: authPrefix,
        auth_token: hasProperty(body, "auth_token") ? asStr(body.auth_token, 4096) : undefined,
        is_active: active == null ? null : active ? 1 : 0,
        created_by: adminId,
      });
      if (created.is_active === 1) {
        const activeDestination = await db.activateDataArchiveEndpoint(env.DB, created.id);
        return json({ destination: scrubEndpoint(activeDestination || created) }, 201, origin);
      }
      return json({ destination: scrubEndpoint(created) }, 201, origin);
    }

    if (method === "PATCH" && id != null && seg.length === 4) {
      const body = safeBody(await readJson(request));
      let update: db.DataArchiveEndpointPatch = {};
      if (hasProperty(body, "label")) {
        const value = asStr(body.label, 120);
        if (value == null) return json({ error: "invalid_destination" }, 400, origin);
        update = { ...update, label: value };
      }
      if (hasProperty(body, "endpoint_url")) {
        const value = asStr(body.endpoint_url, 1000);
        if (!value || !isPublicHttpsUrl(value)) return json({ error: "invalid_destination" }, 400, origin);
        update = { ...update, endpoint_url: value };
      }
      if (hasProperty(body, "auth_header")) {
        if (body.auth_header == null) {
          update = { ...update, auth_header: null };
        } else {
          const value = asStr(body.auth_header, 80);
          if (value == null) return json({ error: "invalid_destination" }, 400, origin);
          update = { ...update, auth_header: value };
        }
      }
      if (hasProperty(body, "auth_prefix")) {
        if (body.auth_prefix == null) {
          update = { ...update, auth_prefix: null };
        } else {
          const value = asStr(body.auth_prefix, 40);
          if (value == null) return json({ error: "invalid_destination" }, 400, origin);
          update = { ...update, auth_prefix: value };
        }
      }
      if (hasProperty(body, "auth_token")) {
        if (body.auth_token == null) {
          update = { ...update, auth_token: null };
        } else if (typeof body.auth_token === "string") {
          const token = asStr(body.auth_token, 4096);
          if (token == null) return json({ error: "invalid_destination" }, 400, origin);
          update = { ...update, auth_token: token };
        } else {
          return json({ error: "invalid_destination" }, 400, origin);
        }
      }
      const active = hasProperty(body, "is_active") ? parseBoolean(body.is_active) : null;
      if (hasProperty(body, "is_active") && active == null) return json({ error: "invalid_destination" }, 400, origin);
      if (active != null) update = { ...update, is_active: active ? 1 : 0 };
      if (!Object.keys(update).length) return json({ error: "invalid_destination" }, 400, origin);
      const row = await db.updateDataArchiveEndpoint(env.DB, id, update);
      if (!row) return json({ error: "not_found" }, 404, origin);
      if (update.is_active === 1) {
        const activeDestination = await db.activateDataArchiveEndpoint(env.DB, id);
        return json({ destination: scrubEndpoint(activeDestination || row) }, 200, origin);
      }
      return json({ destination: scrubEndpoint(row) }, 200, origin);
    }

    if (method === "DELETE" && id != null && seg.length === 4) {
      const row = await db.deleteDataArchiveEndpoint(env.DB, id);
      return row ? json({ ok: true, destination: scrubEndpoint(row) }, 200, origin) : json({ error: "not_found" }, 404, origin);
    }

    if (method === "POST" && id != null && seg[4] === "activate" && seg.length === 5) {
      const row = await db.activateDataArchiveEndpoint(env.DB, id);
      return row ? json({ destination: scrubEndpoint(row) }, 200, origin) : json({ error: "not_found" }, 404, origin);
    }

    return null;
  }

  if (seg[2] === "" || method !== "POST" || seg.length !== 2) return null;

  if (method === "POST") {
    const body = safeBody(await readJson(request));
    if (hasProperty(body, "from") && body.from != null && parseExportDate(body.from) == null) return json({ error: "invalid_date" }, 400, origin);
    if (hasProperty(body, "to") && body.to != null && parseExportDate(body.to) == null) return json({ error: "invalid_date" }, 400, origin);
    const from = parseExportDate(body.from);
    const to = parseExportDate(body.to);
    if (from && to && to < from) return json({ error: "invalid_date_range" }, 400, origin);

    const includeEventPlayersRaw = hasProperty(body, "includeEventPlayers") ? parseBoolean(body.includeEventPlayers) : null;
    const includeResultsRaw = hasProperty(body, "includeResults") ? parseBoolean(body.includeResults) : null;
    const includeCasualRoundsRaw = hasProperty(body, "includeCasualRounds") ? parseBoolean(body.includeCasualRounds) : null;
    const includeEventConfigRaw = hasProperty(body, "includeEventConfig") ? parseBoolean(body.includeEventConfig) : null;
    const dryRunRaw = hasProperty(body, "dry_run") ? parseBoolean(body.dry_run) : null;
    const testRaw = hasProperty(body, "test") ? parseBoolean(body.test) : null;
    const endpointIdRaw = hasProperty(body, "endpoint_id") ? asInt(body.endpoint_id) : null;
    if ((hasProperty(body, "includeEventPlayers") && includeEventPlayersRaw == null) ||
      (hasProperty(body, "includeResults") && includeResultsRaw == null) ||
      (hasProperty(body, "includeCasualRounds") && includeCasualRoundsRaw == null) ||
      (hasProperty(body, "includeEventConfig") && includeEventConfigRaw == null) ||
      (hasProperty(body, "dry_run") && dryRunRaw == null) ||
      (hasProperty(body, "test") && testRaw == null) ||
      (hasProperty(body, "endpoint_id") && hasProperty(body, "endpoint_id") && endpointIdRaw == null)) {
      return json({ error: "invalid_option" }, 400, origin);
    }

    const includeEventPlayers = includeEventPlayersRaw !== false;
    const includeResults = includeResultsRaw !== false;
    const includeCasualRounds = includeCasualRoundsRaw !== false;
    const includeEventConfig = includeEventConfigRaw !== false;
    const dryRun = dryRunRaw === true;
    const test = testRaw === true;
    const explicitEndpointId = endpointIdRaw;

    let destination = explicitEndpointId == null ? await db.getActiveDataArchiveEndpoint(env.DB) : await db.getDataArchiveEndpoint(env.DB, explicitEndpointId);
    if (!destination && explicitEndpointId != null) return json({ error: "endpoint_not_found" }, 404, origin);

    if (test) {
      if (!destination) return json({ error: "endpoint_required" }, 400, origin);
      const payload: ExportPayload = {
        exportedAt: new Date().toISOString(),
        requestedBy: adminId,
        options: {
          from,
          to,
          includeEventPlayers,
          includeResults,
          includeCasualRounds,
          includeEventConfig,
        },
        counts: {
          events: 0,
          eventPlayers: 0,
          results: 0,
          eventConfig: 0,
          ctps: 0,
          acePots: 0,
          casualRounds: 0,
          casualResults: 0,
          courses: 0,
          layouts: 0,
          leagues: 0,
        },
        tables: {
          events: [],
          event_players: [],
          results: [],
          event_config: [],
          ctps: [],
          ace_pots: [],
          casual_rounds: [],
          casual_results: [],
          courses: [],
          course_layouts: [],
          leagues: [],
        },
      };
      payload.requestedBy = adminId;
      payload.tables.events = [
        {
          message: "Archive destination test ping",
          requestedBy: adminId,
          filters: { from, to, includeEventPlayers, includeResults, includeCasualRounds, includeEventConfig },
        },
      ];
      const result = await postToEndpoint(destination, payload);
      if (!result.ok) return json({ error: "destination_failed", destination: scrubEndpoint(destination), status: result.status, preview: result.preview }, 502, origin);
      return json({ ok: true, mode: "test", destination: scrubEndpoint(destination), status: result.status, preview: result.preview }, 200, origin);
    }

    const snapshot = await buildExportSnapshot(
      env.DB,
      from,
      to,
      includeEventPlayers,
      includeResults,
      includeCasualRounds,
      includeEventConfig,
    );
    snapshot.requestedBy = adminId;

    if (!destination) return json({ mode: "download", exportData: snapshot }, 200, origin);

    if (dryRun) return json({ mode: "download", exportData: snapshot }, 200, origin);

    const result = await postToEndpoint(destination, snapshot);
    if (!result.ok) {
      return json(
        { error: "destination_failed", destination: scrubEndpoint(destination), status: result.status, preview: result.preview },
        502,
        origin,
      );
    }

    return json(
      {
        mode: "sent",
        destination: scrubEndpoint(destination),
        status: result.status,
        counts: snapshot.counts,
        exportedAt: snapshot.exportedAt,
      },
      200,
      origin,
    );
  }

  return null;
}
