import { describe, expect, it } from "vitest";
import {
  createCasualResult,
  createCasualRound,
  createResult,
  getEventConfig,
  listEvents,
  listCasualRoundResults,
  listResults,
  upsertEventConfig,
  type D1Like,
  type D1ResultLike,
} from "../src/db.js";
import worker from "../src/index.js";
import { signSession } from "../src/jwt.js";

const SECRET = "x".repeat(40);
const ORIGIN = "http://localhost:8080";
const MEMBERS = {
  "member:m_admin": JSON.stringify({ memberId: "m_admin", name: "Admin", isAdmin: true, pinHash: "x", mustChangePin: false }),
  "member:m_jane": JSON.stringify({ memberId: "m_jane", name: "Jane", isAdmin: false, pinHash: "x", mustChangePin: false }),
};

function kv(initial: Record<string, string> = {}) {
  const rows = new Map(Object.entries(initial));
  return {
    get: async (key: string) => rows.get(key) ?? null,
    put: async (key: string, value: string) => void rows.set(key, value),
    delete: async (key: string) => void rows.delete(key),
  };
}

function db(
  state: {
    layoutBinds?: unknown[];
    eventBinds?: unknown[];
    eventCourseBinds?: unknown[][];
    eventCourseDeletes?: unknown[][];
    playerBinds?: unknown[];
    eventConfigBinds?: unknown[];
    removedPlayer?: number;
    openRegistrationSql?: string;
    existingEvent?: Record<string, unknown>;
    existingEventConfig?: Record<string, unknown> | null;
  } = {},
) {
  return {
    prepare: (sql: string) => {
      let binds: unknown[] = [];
      return {
        bind(...values: unknown[]) {
          binds = values;
          return this;
        },
        all: async () => {
          if (/FROM event_players/i.test(sql)) {
            return { results: [], success: true };
          }
          if (/FROM event_courses ec/i.test(sql)) {
            return { results: [], success: true };
          }
          if (/FROM events e JOIN event_config c/i.test(sql)) {
            state.openRegistrationSql = sql;
            return {
              results: [{
                id: 5,
                name: "Summer Flex",
                status: "live",
                date: "2026-07-12",
                type: "tournament",
                event_format: "stroke",
                course_id: 7,
                layout_id: 44,
                course_name: "West Meadowbrook",
                layout_name: "Gold",
                total_par: 54,
                entry_fee_cents: 1000,
                ctp_fee_cents: null,
                ace_fee_cents: null,
                divisions: "[]",
                play_format: "singles",
              }],
              success: true,
            };
          }
          return { results: [], success: true };
        },
        first: async () => {
          if (/SELECT \* FROM events WHERE id = \?/i.test(sql)) {
            return state.existingEvent ?? { id: binds[0], format: "stroke" };
          }
          if (/SELECT \* FROM event_config WHERE event_id = \?/i.test(sql)) {
            return state.existingEventConfig ?? null;
          }
          if (/INSERT INTO course_layouts/i.test(sql)) {
            state.layoutBinds = binds;
            return { id: 44, course_id: binds[0], name: binds[1], holes: binds[2], total_par: binds[3] };
          }
          if (/INSERT INTO events/i.test(sql)) {
            state.eventBinds = binds;
            return { id: 12, type: binds[0], name: binds[1], course_id: binds[5], layout_id: binds[6], created_by: binds[11] };
          }
          if (/INSERT INTO event_players/i.test(sql)) {
            state.playerBinds = binds;
            return { id: 88, event_id: binds[0], member_id: binds[1], name: binds[2], pdga_no: binds[3], division: binds[4], team: binds[5] };
          }
          if (/INSERT INTO event_config/i.test(sql)) {
            state.eventConfigBinds = binds;
            return { event_id: binds[0], play_format: binds[6], live_scoring_config: binds[8] };
          }
          return null;
        },
        run: async () => {
          if (/DELETE FROM event_players/i.test(sql)) state.removedPlayer = Number(binds[0]);
          if (/DELETE FROM event_courses/i.test(sql)) {
            state.eventCourseDeletes = [...(state.eventCourseDeletes ?? []), binds];
          }
          if (/INSERT INTO event_courses/i.test(sql)) {
            state.eventCourseBinds = [...(state.eventCourseBinds ?? []), binds];
          }
          return { results: [], success: true };
        },
      };
    },
  };
}

function env(state: Parameters<typeof db>[0] = {}): Parameters<typeof worker.fetch>[1] {
  return Object.assign(Object.create(null), {
    ROSTER: kv(MEMBERS),
    RATELIMIT: kv(),
    DB: db(state),
    JWT_SECRET: SECRET,
    ALLOWED_ORIGINS: ORIGIN,
    LIVE: undefined,
  });
}

type MetadataState = {
  eventConfig: Record<string, unknown>;
  results: Record<string, unknown>[];
  casualRound: Record<string, unknown> | null;
  casualResults: Record<string, unknown>[];
  listEventsSql?: string;
  listEventsBinds?: unknown[];
};

function metadataDb(state: MetadataState): D1Like {
  return {
    prepare: (sql: string) => {
      let binds: unknown[] = [];
      return {
        bind(...values: unknown[]) {
          binds = values;
          return this;
        },
        all: async <T = Record<string, unknown>>(): Promise<D1ResultLike<T>> => {
          if (/FROM events e/i.test(sql)) {
            state.listEventsSql = sql;
            state.listEventsBinds = binds;
            return {
              results: [
                {
                  id: 12,
                  name: "Saved Doubles",
                  status: "scheduled",
                  format: "stroke",
                  date: "2026-08-01",
                  play_format: "doubles",
                  live_scoring_config: JSON.stringify({ groupFormat: "doubles", scoringStyle: "matchplay" }),
                },
              ] as T[],
              success: true,
            };
          }
          if (/FROM events\b/i.test(sql)) {
            state.listEventsSql = sql;
            state.listEventsBinds = binds;
            return {
              results: [
                {
                  id: 12,
                  name: "Saved Doubles",
                  status: "scheduled",
                  format: "stroke",
                  date: "2026-08-01",
                },
              ] as T[],
              success: true,
            };
          }
          if (/FROM results/i.test(sql)) return { results: state.results as T[], success: true };
          if (/FROM casual_results/i.test(sql)) return { results: state.casualResults as T[], success: true };
          return { results: [], success: true };
        },
        first: async <T = Record<string, unknown>>(): Promise<T | null> => {
          if (/SELECT \* FROM event_config/i.test(sql)) return state.eventConfig as T;
          if (/INSERT INTO event_config/i.test(sql)) {
            state.eventConfig.live_scoring_config = binds[8] ?? null;
            return state.eventConfig as T;
          }
          if (/INSERT INTO results/i.test(sql)) {
            const row = { event_id: binds[0], member_id: binds[1], name: binds[2], scoring_group: binds[9], match_result: binds[10] };
            state.results.push(row);
            return row as T;
          }
          if (/INSERT INTO casual_rounds/i.test(sql)) {
            const row = { id: 31, round_code: binds[0], scoring_config: binds[8] };
            state.casualRound = row;
            return row as T;
          }
          if (/SELECT \* FROM casual_rounds/i.test(sql)) return state.casualRound as T | null;
          if (/INSERT INTO casual_results/i.test(sql)) {
            const row = { casual_round_id: binds[0], member_id: binds[1], name: binds[2], scoring_group: binds[9], match_result: binds[10] };
            state.casualResults.push(row);
            return row as T;
          }
          return null;
        },
        run: async () => ({ results: [], success: true }),
      };
    },
  };
}

async function token(sub: string) {
  return signSession({ sub, mustChangePin: false }, SECRET, 900);
}

async function call(path: string, method = "GET", body?: unknown, jwt?: string, state: Parameters<typeof db>[0] = {}) {
  const headers: Record<string, string> = { Origin: ORIGIN };
  if (jwt) headers.authorization = "Bearer " + jwt;
  if (body) headers["content-type"] = "application/json";
  return worker.fetch(new Request("https://w" + path, { method, headers, body: body ? JSON.stringify(body) : undefined }), env(state));
}

describe("admin event management", () => {
  it("creates an event and a basic layout in the same request", async () => {
    const state: Parameters<typeof db>[0] = {};
    const res = await call("/admin/events", "POST", {
      type: "tournament",
      name: "Summer Flex",
      course_id: 7,
      layout: { name: "Gold", hole_count: 18, default_par: 3 },
    }, await token("m_admin"), state);

    expect(res.status).toBe(201);
    const body = (await res.json()) as { event: { layout_id: number; created_by: string }; layout: { id: number } };
    expect(body.layout.id).toBe(44);
    expect(body.event).toMatchObject({ layout_id: 44, created_by: "m_admin" });
    expect(state.eventBinds?.[6]).toBe(44);
    expect(state.layoutBinds?.[0]).toBe(7);
    expect(state.layoutBinds?.[1]).toBe("Gold");
    expect(state.layoutBinds?.[3]).toBe(54);
    expect(state.eventCourseBinds).toEqual([[12, 7, 44, null, 0]]);
    const holes = JSON.parse(String(state.layoutBinds?.[2])) as { hole: number; par: number }[];
    expect(holes).toHaveLength(18);
    expect(holes.every((h) => h.par === 3)).toBe(true);
  });

  it("creates an event with multiple ordered course and layout assignments", async () => {
    const state: Parameters<typeof db>[0] = {};
    const res = await call("/admin/events", "POST", {
      type: "tournament",
      name: "Cross County Open",
      course_id: 7,
      layout_id: 44,
      event_courses: [
        { course_id: 7, layout_id: 44 },
        { course_id: 8, layout_id: 45 },
      ],
    }, await token("m_admin"), state);

    expect(res.status).toBe(201);
    expect(state.eventBinds?.[5]).toBe(7);
    expect(state.eventBinds?.[6]).toBe(44);
    expect(state.eventCourseDeletes).toEqual([[12]]);
    expect(state.eventCourseBinds).toEqual([
      [12, 7, 44, null, 0],
      [12, 8, 45, null, 1],
    ]);
  });

  it("lets admins add and remove manual event players", async () => {
    const state: Parameters<typeof db>[0] = {};
    const jwt = await token("m_admin");
    const add = await call("/admin/events/9/players", "POST", { name: "Walk On", pdga_no: "12345", division: "MA1", team: "A" }, jwt, state);
    expect(add.status).toBe(201);
    expect(state.playerBinds).toEqual([9, null, "Walk On", "12345", "MA1", "A"]);

    const remove = await call("/admin/events/9/players/88", "DELETE", undefined, jwt, state);
    expect(remove.status).toBe(200);
    expect(state.removedPlayer).toBe(88);
  });

  it("includes course and layout details for open registration events", async () => {
    const state: Parameters<typeof db>[0] = {};
    const res = await call("/registration/open", "GET", undefined, undefined, state);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: { course_name?: string; layout_name?: string; status?: string; total_par?: number }[] };
    expect(body.events[0]).toMatchObject({ course_name: "West Meadowbrook", layout_name: "Gold", status: "live", total_par: 54 });
    expect(state.openRegistrationSql).toMatch(/e\.status IN \('scheduled','live'\)/);
    expect(state.openRegistrationSql).toMatch(/ORDER BY CASE WHEN e\.status = 'live' THEN 0 ELSE 1 END, e\.date, e\.id/);
  });

  it("persists normalized live scoring config when admin saves event config", async () => {
    const state: Parameters<typeof db>[0] = {};
    const res = await call("/admin/events/12/config", "PUT", {
      registration_open: true,
      play_format: "doubles",
      liveScoringConfig: { groupFormat: "doubles", scoringStyle: "matchplay" },
    }, await token("m_admin"), state);

    expect(res.status).toBe(200);
    expect(state.eventConfigBinds?.[6]).toBe("doubles");
    expect(JSON.parse(String(state.eventConfigBinds?.[8]))).toEqual({ groupFormat: "doubles", scoringStyle: "matchplay" });
  });

  it("preserves legacy matchplay when admin saves config without explicit live scoring config", async () => {
    const state: Parameters<typeof db>[0] = {
      existingEvent: { id: 12, format: "matchplay" },
      existingEventConfig: { event_id: 12, play_format: "singles", live_scoring_config: null },
    };
    const res = await call("/admin/events/12/config", "PUT", {
      registration_open: true,
      play_format: "singles",
    }, await token("m_admin"), state);

    expect(res.status).toBe(200);
    expect(JSON.parse(String(state.eventConfigBinds?.[8]))).toEqual({ groupFormat: "singles", scoringStyle: "matchplay" });
  });

  it("rejects unsupported live scoring config values before writing event config", async () => {
    const state: Parameters<typeof db>[0] = {};
    const adminJwt = await token("m_admin");
    const badGroup = await call("/admin/events/12/config", "PUT", {
      play_format: "doubles",
      liveScoringConfig: { groupFormat: "team", scoringStyle: "stroke" },
    }, adminJwt, state);
    const badStyle = await call("/admin/events/12/config", "PUT", {
      play_format: "singles",
      liveScoringConfig: { groupFormat: "singles", scoringStyle: "custom" },
    }, adminJwt, state);
    const badPlayFormat = await call("/admin/events/12/config", "PUT", {
      play_format: "teams",
    }, adminJwt, state);

    expect(badGroup.status).toBe(400);
    expect(badStyle.status).toBe(400);
    expect(badPlayFormat.status).toBe(400);
    expect(state.eventConfigBinds).toBeUndefined();
  });
});

describe("live scoring metadata DB helpers", () => {
  it("includes saved live scoring config and play format in public event rows", async () => {
    const state: MetadataState = {
      eventConfig: { event_id: 12, play_format: "doubles", live_scoring_config: null },
      results: [],
      casualRound: null,
      casualResults: [],
    };

    const events = await listEvents(metadataDb(state), { status: "scheduled", type: "tournament", limit: 10, offset: 5 });

    expect(events).toEqual([
      {
        id: 12,
        name: "Saved Doubles",
        status: "scheduled",
        format: "stroke",
        date: "2026-08-01",
        play_format: "doubles",
        live_scoring_config: JSON.stringify({ groupFormat: "doubles", scoringStyle: "matchplay" }),
        event_courses: [],
      },
    ]);
    expect(state.listEventsSql).toMatch(/LEFT JOIN event_config/i);
    expect(state.listEventsSql).toMatch(/ORDER BY e\.date DESC, e\.id DESC/i);
    expect(state.listEventsBinds).toEqual(["scheduled", "tournament", 10, 5]);
  });

  it("reads legacy event config rows when live scoring config is null", async () => {
    const state: MetadataState = {
      eventConfig: { event_id: 12, play_format: "singles", live_scoring_config: null },
      results: [],
      casualRound: null,
      casualResults: [],
    };

    const config = await getEventConfig(metadataDb(state), 12);

    expect(config).toMatchObject({ event_id: 12, play_format: "singles", live_scoring_config: null });
  });

  it("round-trips live scoring metadata through event, result, and casual helpers", async () => {
    const state: MetadataState = {
      eventConfig: { event_id: 12, play_format: "doubles", live_scoring_config: null },
      results: [],
      casualRound: null,
      casualResults: [],
    };
    const database = metadataDb(state);
    const scoringConfig = JSON.stringify({ groupFormat: "doubles", scoringStyle: "matchplay" });
    const scoringGroup = JSON.stringify({ targetId: "pair:a", label: "Pair A", members: ["m_jane", "m_sam"] });
    const matchResult = JSON.stringify({ status: "won", holesUp: 2, holesRemaining: 1 });

    await upsertEventConfig(database, 12, {
      registration_open: 1,
      play_format: "doubles",
      live_scoring_config: scoringConfig,
    });
    await createResult(database, {
      event_id: 12,
      member_id: "m_jane",
      name: "Jane",
      scoring_group: scoringGroup,
      match_result: matchResult,
    });
    const round = await createCasualRound(database, {
      round_code: "ABCD",
      scoring_config: scoringConfig,
    });
    await createCasualResult(database, {
      casual_round_id: Number(round?.id),
      member_id: "m_jane",
      name: "Jane",
      scoring_group: scoringGroup,
      match_result: matchResult,
    });

    await expect(getEventConfig(database, 12)).resolves.toMatchObject({ live_scoring_config: scoringConfig });
    await expect(listResults(database, 12)).resolves.toMatchObject([{ scoring_group: scoringGroup, match_result: matchResult }]);
    await expect(listCasualRoundResults(database, "ABCD")).resolves.toMatchObject({
      round: { scoring_config: scoringConfig },
      results: [{ scoring_group: scoringGroup, match_result: matchResult }],
    });
  });
});
