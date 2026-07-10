import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  purgeScoreTargetScorerVotes,
  recordScoreTargetVote,
  recordScoreVote,
  scoreConflicts,
  scoreTargetConsensusIssues,
} from "../src/live-consensus.js";
import worker from "../src/index.js";
import { signSession } from "../src/jwt.js";
import { LiveEventDO } from "../src/live.js";
import { scoreTargetsForPlayersSafe, type ScoreTarget } from "../src/live-format.js";
import { unionRosterPlayers } from "../src/club-live-routes.js";
import type { LiveSocket } from "../src/live-types.js";
import type { D1StatementLike } from "../src/db-types.js";
import type { PlayerState } from "../src/scoring.js";

type Stored = {
  readonly meta?: unknown;
  readonly players?: unknown;
};

class FakeSocket extends EventTarget {
  readonly sent: string[] = [];

  accept(): void {
    throw new Error("legacy_accept_used");
  }

  send(message: string): void {
    this.sent.push(message);
  }
}

class FakeState {
  readonly accepted: LiveSocket[] = [];
  alarmAt: number | null = null; // exposed so weather-alarm tests can trigger/inspect it
  readonly storage: {
    get<T = unknown>(key: string): Promise<T | undefined>;
    put(key: string, value: unknown): Promise<void>;
    getAlarm(): Promise<number | null>;
    setAlarm(scheduledTime: number): Promise<void>;
    deleteAlarm(): Promise<void>;
  };
  private readonly stored: Record<string, unknown>;

  constructor(stored: Stored = {}) {
    this.stored = { ...stored };
    this.storage = {
      get: async <T = unknown>(key: string) => this.stored[key] as T | undefined,
      put: async (key: string, value: unknown) => {
        this.stored[key] = value;
      },
      getAlarm: async () => this.alarmAt,
      setAlarm: async (scheduledTime: number) => {
        this.alarmAt = scheduledTime;
      },
      deleteAlarm: async () => {
        this.alarmAt = null;
      },
    };
  }

  getStored<T = unknown>(key: string): T | undefined {
    return this.stored[key] as T | undefined;
  }

  acceptWebSocket(socket: LiveSocket): void {
    this.accepted.push(socket);
  }

  getWebSockets(): LiveSocket[] {
    return this.accepted;
  }
}

const db = { prepare: () => ({ bind() { return this; }, all: async () => ({ results: [], success: true }), first: async () => null, run: async () => ({ results: [], success: true }) }) };
const SECRET = "x".repeat(40);
const ORIGIN = "http://localhost:8080";

function kv(initial: Record<string, string> = {}) {
  const rows = new Map(Object.entries(initial));
  return {
    get: async (key: string) => rows.get(key) ?? null,
    put: async (key: string, value: string) => void rows.set(key, value),
    delete: async (key: string) => void rows.delete(key),
    list: async () => ({ keys: [...rows.keys()].map((name) => ({ name })), list_complete: true }),
  };
}

type StartPayload = {
  readonly liveScoringConfig?: { readonly groupFormat: string; readonly scoringStyle: string };
  readonly players?: readonly {
    readonly memberId?: string | null;
    readonly name?: string;
    readonly division?: string | null;
    readonly startingHole?: number | null;
    readonly team?: string | null;
  }[];
};
type LiveRouteState = {
  readonly starts: StartPayload[];
  readonly cancellations?: { readonly isAdmin: boolean; readonly member: string | null }[];
  readonly pairUpdates?: { readonly body: unknown; readonly isAdmin: boolean; readonly member: string | null }[];
  readonly registrations?: readonly Record<string, unknown>[];
  readonly eventPlayers?: readonly Record<string, unknown>[];
  readonly eventConfig?: Record<string, unknown> | null;
  readonly eventFormat?: string | null;
  updatedStatus?: string | null;
};

type WorkerEnv = Parameters<typeof worker.fetch>[1];

function missingBinding<T>(name: string): T {
  return new Proxy({}, {
    get() {
      throw new Error(`unused binding accessed: ${name}`);
    },
  }) as T;
}

function liveRouteDb(state: LiveRouteState) {
  return {
    prepare: (sql: string) => {
      let binds: unknown[] = [];
      return {
        bind(...values: unknown[]) {
          binds = values;
          return this;
        },
        all: async () => {
          if (/FROM registrations/i.test(sql)) return { results: state.registrations ?? [], success: true };
          if (/FROM event_players/i.test(sql)) return { results: state.eventPlayers ?? [], success: true };
          return { results: [], success: true };
        },
        first: async () => {
          if (/SELECT \* FROM events/i.test(sql)) return { id: binds[0], layout_id: 44, format: state.eventFormat ?? null };
          if (/SELECT \* FROM course_layouts/i.test(sql)) {
            return { id: 44, course_id: 7, name: "Gold", holes: JSON.stringify([{ hole: 1, par: 3 }, { hole: 2, par: 4 }]) };
          }
          if (/SELECT \* FROM courses/i.test(sql)) return { id: 7, name: "West Meadowbrook" };
          if (/SELECT \* FROM event_config/i.test(sql)) return state.eventConfig ?? null;
          if (/UPDATE events/i.test(sql)) {
            state.updatedStatus = binds[5] as string | null;
            return { id: binds[22], status: state.updatedStatus };
          }
          return null;
        },
        run: async () => ({ results: [], success: true }),
      };
    },
  };
}

function liveNamespace(state: LiveRouteState) {
  const headerValue = (headers: HeadersInit | undefined, key: string): string | null => {
    if (headers instanceof Headers) return headers.get(key);
    if (Array.isArray(headers)) {
      const found = headers.find(([name]) => name.toLocaleLowerCase("en-US") === key.toLocaleLowerCase("en-US"));
      return found?.[1] ?? null;
    }
    return headers?.[key] ?? headers?.[key.toLocaleLowerCase("en-US")] ?? null;
  };
  const stub = {
    fetch: async (url: string, init?: RequestInit) => {
      const payload = init?.body ? (JSON.parse(String(init.body)) as StartPayload) : {};
      const action = new URL(url).pathname.split("/").filter(Boolean).pop();
      if (action === "cancel") {
        state.cancellations?.push({
          isAdmin: headerValue(init?.headers, "X-Auth-Admin") === "true",
          member: headerValue(init?.headers, "X-Auth-Member"),
        });
        return new Response(JSON.stringify({ status: "none" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (action === "pairs") {
        state.pairUpdates?.push({
          body: payload,
          isAdmin: headerValue(init?.headers, "X-Auth-Admin") === "true",
          member: headerValue(init?.headers, "X-Auth-Member"),
        });
        return new Response(JSON.stringify({ status: "live", cardId: "c0", cardmates: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      state.starts.push(payload);
      return new Response(JSON.stringify({ status: "live", players: payload.players ?? [], liveScoringConfig: payload.liveScoringConfig ?? null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
    connect: () => missingBinding<Socket>("DurableObjectStub.connect"),
  };
  const id = (name: string): DurableObjectId => ({
    name,
    toString: () => name,
    equals: (other: DurableObjectId) => other.toString() === name,
  });
  return {
    newUniqueId: () => id("new"),
    idFromName: (name: string) => id(name),
    idFromString: (name: string) => id(name),
    get: (objectId: DurableObjectId) => ({ ...stub, id: objectId }),
    getByName: (name: string) => ({ ...stub, id: id(name), name }),
    jurisdiction: () => liveNamespace(state),
  };
}

function d1Database(database: ReturnType<typeof liveRouteDb>): D1Database {
  return {
    prepare: (query: string) => new LiveRouteD1Statement(database.prepare(query)),
    batch: async <T = unknown>(statements: D1PreparedStatement[]) => Promise.all(statements.map((statement) => statement.run<T>())),
    exec: async () => ({ count: 0, duration: 0 }),
    withSession: () => missingBinding<D1DatabaseSession>("D1DatabaseSession"),
    dump: async () => new ArrayBuffer(0),
  };
}

function d1Meta(): D1Meta & Record<string, unknown> {
  return {
    duration: 0,
    size_after: 0,
    rows_read: 0,
    rows_written: 0,
    last_row_id: 0,
    changed_db: false,
    changes: 0,
  };
}

class LiveRouteD1Statement implements D1PreparedStatement {
  private readonly statement: ReturnType<ReturnType<typeof liveRouteDb>["prepare"]>;

  constructor(statement: ReturnType<ReturnType<typeof liveRouteDb>["prepare"]>) {
    this.statement = statement;
  }

  bind(...values: unknown[]): D1PreparedStatement {
    this.statement.bind(...values);
    return this;
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const result = await this.statement.all();
    return { success: true, results: [...result.results] as T[], meta: d1Meta() };
  }

  async first<T = unknown>(colName: string): Promise<T | null>;
  async first<T = Record<string, unknown>>(): Promise<T | null>;
  async first<T = Record<string, unknown>>(colName?: string): Promise<T | null> {
    const row = await this.statement.first();
    if (row == null) return null;
    if (colName) return row[colName] as T;
    return row as T;
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const result = await this.statement.run();
    return { success: true, results: [...result.results] as T[], meta: d1Meta() };
  }

  async raw<T = unknown[]>(options: { columnNames: true }): Promise<[string[], ...T[]]>;
  async raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>;
  async raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[] | [string[], ...T[]]> {
    if (options?.columnNames) return [[]] as [string[], ...T[]];
    return [] as T[];
  }
}

function liveRouteEnv(state: LiveRouteState) {
  return {
    ROSTER: kv({
      "member:m_admin": JSON.stringify({ memberId: "m_admin", name: "Admin", isAdmin: true, pinHash: "x", mustChangePin: false }),
      "member:m_jane": JSON.stringify({ memberId: "m_jane", name: "Jane", isAdmin: false, pinHash: "x", mustChangePin: false }),
    }),
    RATELIMIT: kv(),
    PHOTOS: missingBinding<R2Bucket>("PHOTOS"),
    DB: d1Database(liveRouteDb(state)),
    AI: missingBinding<Ai>("AI"),
    SESSION_TTL_SEC: "900",
    OPENROUTER_MODEL: "test",
    OPENROUTER_FALLBACK_MODEL: "test",
    ASSISTANT_MODEL: "test",
    PAYPAL_ENV: "sandbox",
    ORDER_NOTIFY_EMAIL: "",
    ORDER_NOTIFY_FROM: "",
    REGISTER_NOTIFY_FROM: "",
    EMAIL_REPLY_TO: "",
    RP_ID: "localhost",
    RP_NAME: "Test",
    EXPECTED_ORIGIN: ORIGIN,
    GEMINI_VISION_MODEL: "test",
    OPENROUTER_VISION_MODEL: "test",
    VISION_MODEL: "test",
    JWT_SECRET: SECRET,
    GEMINI_API_KEY: "test",
    OPENROUTER_API_KEY: "test",
    PAYPAL_CLIENT_ID: "test",
    PAYPAL_SECRET: "test",
    VISION_DEV_STUB: "1",
    ALLOWED_ORIGINS: ORIGIN,
    PAYPAL_API_BASE: "https://paypal.test",
    PIN_PEPPER: "",
    LIVE: liveNamespace(state),
    ASSISTANT_RL: missingBinding<RateLimit>("ASSISTANT_RL"),
  } satisfies WorkerEnv;
}

function must<T>(value: T | null | undefined): T {
  expect(value).toBeDefined();
  if (value == null) throw new Error("expected test value to be defined");
  return value;
}

function rowValue<T>(value: Record<string, unknown> | null): T | null {
  return value as T | null;
}

async function routeToken(sub: string) {
  return signSession({ sub, mustChangePin: false }, SECRET, 900);
}

async function liveRouteCall(path: string, method: string, body: unknown, state: LiveRouteState, sub = "m_admin") {
  return worker.fetch(new Request("https://w" + path, {
    method,
    headers: { Origin: ORIGIN, authorization: "Bearer " + await routeToken(sub), "content-type": "application/json" },
    body: JSON.stringify(body),
  }), liveRouteEnv(state));
}

type ConflictRow = {
  readonly cardId: string | null;
  readonly playerIndex: number;
  readonly playerName: string;
  readonly hole: number;
  readonly values: number[];
};
type SnapshotBody = {
  readonly players: { readonly index?: number; readonly name?: string; readonly scores: Record<string, number> }[];
  readonly conflicts: ConflictRow[];
  readonly roundConfig?: { readonly groupFormat: string; readonly scoringStyle: string };
  readonly scoreTargets?: {
    readonly id: string;
    readonly type: string;
    readonly label: string;
    readonly playerIndexes: readonly number[];
    readonly members: readonly string[];
  }[];
  readonly standings?: {
    readonly name: string;
    readonly targetId?: string;
    readonly targetType?: string;
    readonly total: number;
    readonly toPar: number;
    readonly members?: readonly string[];
    readonly match?: { readonly status: string; readonly outcome: string };
  }[];
};

function recordingDb(roundId = 7) {
  const inserts: { sql: string; args: unknown[] }[] = [];
  const database = {
    prepare(sql: string) {
      const entry: { sql: string; args: unknown[] } = { sql, args: [] };
      return {
        bind(...args: unknown[]) {
          entry.args = args;
          if (/INSERT INTO results|INSERT INTO casual_|DELETE FROM results|DELETE FROM casual_rounds/i.test(sql)) inserts.push(entry);
          return this;
        },
        run: async () => ({ results: [], success: true }),
        first: async <T = Record<string, unknown>>() => rowValue<T>(/INSERT INTO casual_rounds/i.test(sql) ? { id: roundId } : null),
        all: async () => ({ results: [], success: true }),
      };
    },
  };
  return { database, inserts };
}

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers(); // weather tests use fake timers; reset so they never leak into other tests
});

type WeatherSnapshot = {
  readonly weather: {
    readonly location: { readonly label: string | null };
    readonly current: { readonly observedAt: string; readonly rainIn: number | null; readonly windSpeedMph: number | null; readonly windGustMph: number | null } | null;
    readonly history: readonly { readonly observedAt: string; readonly windSpeedMph: number | null; readonly windGustMph: number | null }[];
    readonly error: string | null;
  } | null;
};

function openMeteoSample(observedAt: string, windSpeedMph: number, rainIn: number): Record<string, unknown> {
  return {
    current: {
      time: observedAt, temperature_2m: 82, apparent_temperature: 87, relative_humidity_2m: 72,
      precipitation: rainIn, rain: rainIn, showers: 0, snowfall: 0, weather_code: rainIn > 0 ? 61 : 1,
      cloud_cover: 44, wind_speed_10m: windSpeedMph, wind_direction_10m: 180, wind_gusts_10m: windSpeedMph + 6, is_day: 1,
    },
  };
}

function stubWeather(samples: readonly Record<string, unknown>[]): void {
  let nextIndex = 0;
  vi.stubGlobal("fetch", vi.fn(async () => {
    const sample = samples[nextIndex] ?? samples[samples.length - 1] ?? openMeteoSample("2026-07-01T08:00", 0, 0);
    nextIndex++;
    return new Response(JSON.stringify(sample));
  }));
}

describe("live route start payloads", () => {
  it("threads legacy doubles/matchplay config and registration teams into competition start payload", async () => {
    const state: LiveRouteState = {
      starts: [],
      eventFormat: "matchplay",
      eventConfig: { event_id: 9, play_format: "doubles", live_scoring_config: null },
      registrations: [
        { member_id: "m_a", name: "A", division: "MA1", starting_hole: 1, team: "Pair 1" },
        { member_id: "m_b", name: "B", division: "MA1", starting_hole: 1, team: "Pair 1" },
        { member_id: "m_c", name: "C", division: "MA1", starting_hole: 1, team: "Pair 2" },
        { member_id: "m_d", name: "D", division: "MA1", starting_hole: 1, team: "Pair 2" },
      ],
    };

    const res = await liveRouteCall("/events/9/live/start", "POST", {}, state);

    expect(res.status).toBe(200);
    expect(state.starts).toHaveLength(1);
    expect(state.starts[0]?.liveScoringConfig).toEqual({ groupFormat: "doubles", scoringStyle: "matchplay" });
    expect(state.starts[0]?.players).toEqual([
      { memberId: "m_a", name: "A", division: "MA1", startingHole: 1, team: "Pair 1" },
      { memberId: "m_b", name: "B", division: "MA1", startingHole: 1, team: "Pair 1" },
      { memberId: "m_c", name: "C", division: "MA1", startingHole: 1, team: "Pair 2" },
      { memberId: "m_d", name: "D", division: "MA1", startingHole: 1, team: "Pair 2" },
    ]);
    expect(state.updatedStatus).toBe("live");
  });

  it("unionRosterPlayers merges registered + manual, dedupes by member then name, registration wins", () => {
    const out = unionRosterPlayers(
      [{ member_id: "m1", name: "Reg One", division: "MA1", starting_hole: 3, team: "Red" }],
      [
        { member_id: "m1", name: "Dup Of Reg", division: "X", team: "Blue" }, // same member -> deduped, reg kept
        { member_id: null, name: "Walk On", division: "Rec", team: null }, // name-only walk-on
        { member_id: null, name: "walk on", team: null }, // duplicate walk-on name -> dropped
      ],
    );
    expect(out).toEqual([
      { memberId: "m1", name: "Reg One", division: "MA1", startingHole: 3, team: "Red" },
      { memberId: null, name: "Walk On", division: "Rec", startingHole: null, team: null },
    ]);
  });

  it("seeds the live round with BOTH registered players and manually-added walk-ons (no drop)", async () => {
    const state: LiveRouteState = {
      starts: [],
      registrations: [
        { member_id: "m_a", name: "Alice", division: "MA1", starting_hole: 1, team: null },
        { member_id: "m_b", name: "Bob", division: "MA1", starting_hole: 1, team: null },
      ],
      eventPlayers: [
        { member_id: null, name: "Walkon Wanda", division: "Rec", team: null }, // manual, name-only
        { member_id: "m_a", name: "Alice", division: "MA1", team: null }, // also manually added -> deduped
      ],
    };
    const res = await liveRouteCall("/events/9/live/start", "POST", {}, state);
    expect(res.status).toBe(200);
    expect((must(state.starts[0]).players ?? []).map((p) => p.name)).toEqual(["Alice", "Bob", "Walkon Wanda"]);
  });

  it("the legacy from:'players' flag no longer drops registrants — it still unions both sources", async () => {
    const state: LiveRouteState = {
      starts: [],
      registrations: [{ member_id: "m_a", name: "Alice", division: null, starting_hole: null, team: null }],
      eventPlayers: [{ member_id: null, name: "Walkon", division: null, team: null }],
    };
    const res = await liveRouteCall("/events/9/live/start", "POST", { from: "players" }, state);
    expect(res.status).toBe(200);
    expect((must(state.starts[0]).players ?? []).map((p) => p.name).sort()).toEqual(["Alice", "Walkon"]); // registrant NOT dropped
  });

  it("rejects invalid competition doubles starts before calling the Durable Object", async () => {
    const state: LiveRouteState = {
      starts: [],
      eventConfig: { event_id: 9, play_format: "doubles", live_scoring_config: JSON.stringify({ groupFormat: "doubles", scoringStyle: "stroke" }) },
      registrations: [
        { member_id: "m_a", name: "A", division: "MA1", starting_hole: 1, team: "Solo Pair" },
        { member_id: "m_b", name: "B", division: "MA1", starting_hole: 1, team: "Full Pair" },
        { member_id: "m_c", name: "C", division: "MA1", starting_hole: 1, team: "Full Pair" },
      ],
    };

    const res = await liveRouteCall("/events/9/live/start", "POST", {}, state);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "invalid_score_targets",
      code: "invalid_pair_size",
    });
    expect(state.starts).toEqual([]);
    expect(state.updatedStatus).toBeUndefined();
  });

  it("rejects invalid competition matchplay cards before marking the event live", async () => {
    const state: LiveRouteState = {
      starts: [],
      eventConfig: { event_id: 9, play_format: "singles", live_scoring_config: JSON.stringify({ groupFormat: "singles", scoringStyle: "matchplay" }) },
      registrations: [
        { member_id: "m_a", name: "A", division: "MA1", starting_hole: 1 },
        { member_id: "m_b", name: "B", division: "MA1", starting_hole: 1 },
        { member_id: "m_c", name: "C", division: "MA1", starting_hole: 1 },
      ],
    };

    const res = await liveRouteCall("/events/9/live/start", "POST", {}, state);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "invalid_score_targets",
      code: "invalid_matchplay_targets",
    });
    expect(state.starts).toEqual([]);
    expect(state.updatedStatus).toBeUndefined();
  });

  it("rejects malformed casual live scoring config before starting a Durable Object", async () => {
    const state: LiveRouteState = { starts: [] };

    const res = await liveRouteCall("/rounds", "POST", {
      layout_id: 44,
      liveScoringConfig: { groupFormat: "singles", scoringStyle: "custom" },
    }, state, "m_jane");

    expect(res.status).toBe(400);
    expect(state.starts).toEqual([]);
  });

  it("threads validated casual config and creator pair label into start payload", async () => {
    const state: LiveRouteState = { starts: [] };

    const res = await liveRouteCall("/rounds", "POST", {
      layout_id: 44,
      liveScoringConfig: { groupFormat: "doubles", scoringStyle: "stroke" },
      pairLabel: "Pair A",
    }, state, "m_jane");

    expect(res.status).toBe(201);
    expect(state.starts[0]?.liveScoringConfig).toEqual({ groupFormat: "doubles", scoringStyle: "stroke" });
    expect(state.starts[0]?.players).toEqual([{ memberId: "m_jane", name: "Jane", team: "Pair A" }]);
  });

  it("proxies authenticated casual pair updates with trusted identity headers", async () => {
    const state: LiveRouteState = { starts: [], pairUpdates: [] };

    const res = await liveRouteCall("/rounds/PAIR12/pairs", "POST", {
      pairs: [{ label: "Alpha", playerIndexes: [0, 1] }],
    }, state, "m_admin");

    expect(res.status).toBe(200);
    expect(state.pairUpdates).toEqual([
      {
        body: { assignments: undefined, pairs: [{ label: "Alpha", playerIndexes: [0, 1] }] },
        isAdmin: true,
        member: "m_admin",
      },
    ]);
  });

  it("lets only admins cancel a casual round through trusted Durable Object headers", async () => {
    const state: LiveRouteState = { starts: [], cancellations: [] };

    const denied = await liveRouteCall("/rounds/QA1234/cancel", "POST", {}, state, "m_jane");
    const allowed = await liveRouteCall("/rounds/QA1234/cancel", "POST", {}, state, "m_admin");

    expect(denied.status).toBe(403);
    expect(allowed.status).toBe(200);
    expect(state.cancellations).toEqual([{ isAdmin: true, member: "m_admin" }]);
  });
});

describe("live consensus score targets", () => {
  const holes = [{ hole: 1 }];
  const pairTarget = {
    type: "pair",
    id: "pair:blue",
    label: "Blue Pair",
    playerIndexes: [0, 1],
    memberIds: ["m0", "m1"],
  } satisfies ScoreTarget;

  const playerTarget = {
    type: "player",
    id: "player:0",
    label: "A",
    playerIndexes: [0],
    memberIds: ["m0"],
  } satisfies ScoreTarget;

  const players = (): PlayerState[] => [
    { memberId: "m0", name: "A", cardId: "c0", scores: {} },
    { memberId: "m1", name: "B", cardId: "c0", scores: {} },
  ];

  it("keeps legacy player conflict behavior unchanged when no score targets are supplied", () => {
    const card = players();

    recordScoreVote({ players: card, targetIndex: 1, scorerId: "player:0", hole: 1, strokes: 3 });
    recordScoreVote({ players: card, targetIndex: 1, scorerId: "player:1", hole: 1, strokes: 4 });

    expect(scoreConflicts(card, holes)).toEqual([{ cardId: "c0", playerIndex: 1, playerName: "B", hole: 1, values: [3, 4] }]);
    expect(card[1]?.scores).not.toHaveProperty("1");
  });

  it("mirrors an agreed pair target score to both active pair members", () => {
    const card = players();

    recordScoreTargetVote({ players: card, target: pairTarget, scorerId: "player:0", hole: 1, strokes: 3 });
    const conflict = recordScoreTargetVote({ players: card, target: pairTarget, scorerId: "player:1", hole: 1, strokes: 3 });

    expect(conflict).toBeNull();
    expect(card[0]?.scores).toMatchObject({ 1: 3 });
    expect(card[1]?.scores).toMatchObject({ 1: 3 });
    expect(scoreTargetConsensusIssues(card, holes, [pairTarget])).toEqual({ conflicts: [], missing: [] });
  });

  it("reports pair target conflicts once with the pair label", () => {
    const card = players();

    recordScoreTargetVote({ players: card, target: pairTarget, scorerId: "player:0", hole: 1, strokes: 3 });
    recordScoreTargetVote({ players: card, target: pairTarget, scorerId: "player:1", hole: 1, strokes: 4 });

    expect(scoreTargetConsensusIssues(card, holes, [pairTarget]).conflicts).toEqual([
      {
        cardId: "c0",
        playerIndex: 0,
        playerName: "Blue Pair",
        hole: 1,
        values: [3, 4],
        targetId: "pair:blue",
        targetType: "pair",
        playerIndexes: [0, 1],
      },
    ]);
    expect(card[0]?.scores).not.toHaveProperty("1");
    expect(card[1]?.scores).not.toHaveProperty("1");
  });

  it("competition: a team is confirmed by ONE of its registered members (not all)", () => {
    const card = players();
    recordScoreTargetVote({ players: card, target: pairTarget, scorerId: "player:0", hole: 1, strokes: 3 });
    // >=1 registered member of the pair confirmed the hole → the team is confirmed (its partner need not vote).
    expect(scoreTargetConsensusIssues(card, holes, [pairTarget]).missing).toEqual([]);
  });

  it("competition: a team with NO registered member cannot be confirmed", () => {
    const card: PlayerState[] = [
      { memberId: null, name: "Guest A", cardId: "c0", scores: {} },
      { memberId: "g_tok", name: "Guest B", cardId: "c0", scores: {} },
    ];
    const guestPair = { type: "pair", id: "pair:blue", label: "Blue Pair", playerIndexes: [0, 1], memberIds: [null, "g_tok"] } satisfies ScoreTarget;
    recordScoreTargetVote({ players: card, target: guestPair, scorerId: "player:0", hole: 1, strokes: 3 });
    // No registered (non-guest) player on the team → the hole stays missing; finalize needs a real confirmer.
    expect(scoreTargetConsensusIssues(card, holes, [guestPair]).missing).toHaveLength(1);
  });

  it("casual: a single logged-in member confirms the whole card (guests optional)", () => {
    const card: PlayerState[] = [
      { memberId: "m0", name: "A", cardId: "c0", scores: {} }, // the only logged-in member/scorekeeper
      { memberId: null, name: "Guest", cardId: "c0", scores: {} }, // walk-on guest
    ];
    recordScoreTargetVote({ players: card, target: pairTarget, scorerId: "player:0", hole: 1, strokes: 3 });
    // casual: the solo scorekeeper's vote is enough — no missing, so the round finalizes without a force.
    expect(scoreTargetConsensusIssues(card, holes, [pairTarget], { casual: true }).missing).toEqual([]);
  });

  it("purges a removed scorer's stale pair-target vote and restores the agreed pair score", () => {
    const card: PlayerState[] = [
      { memberId: "m0", name: "A", cardId: "c0", scores: {} },
      { memberId: "m1", name: "B", cardId: "c0", scores: {} },
      { memberId: "m2", name: "X", cardId: "c0", scores: {} },
    ];

    recordScoreTargetVote({ players: card, target: pairTarget, scorerId: "player:2", hole: 1, strokes: 5 });
    recordScoreTargetVote({ players: card, target: pairTarget, scorerId: "player:0", hole: 1, strokes: 3 });
    recordScoreTargetVote({ players: card, target: pairTarget, scorerId: "player:1", hole: 1, strokes: 3 });
    expect(scoreTargetConsensusIssues(card, holes, [pairTarget]).conflicts).toHaveLength(1);

    const removed = card[2];
    if (removed) removed.removed = true;
    purgeScoreTargetScorerVotes(card, 2, holes, [pairTarget]);

    expect(scoreTargetConsensusIssues(card, holes, [pairTarget])).toEqual({ conflicts: [], missing: [] });
    expect(card[0]?.scores).toMatchObject({ 1: 3 });
    expect(card[1]?.scores).toMatchObject({ 1: 3 });
  });

  it("keeps target-aware player scoring equivalent to legacy player scoring", () => {
    const card = players();

    recordScoreTargetVote({ players: card, target: playerTarget, scorerId: "player:0", hole: 1, strokes: 2 });

    expect(card[0]?.scores).toMatchObject({ 1: 2 });
    expect(scoreTargetConsensusIssues(card, holes, [playerTarget])).toEqual({ conflicts: [], missing: [{ cardId: "c0", playerIndex: 0, playerName: "A", hole: 1, missing: 1, required: 2 }] });
  });
});

describe("LiveEventDO WebSocket handling", () => {
  it("accepts sockets through Durable Object hibernation APIs and broadcasts snapshots", async () => {
    const state = new FakeState({
      meta: { eventId: 7, holes: [{ hole: 1, par: 3 }], status: "live", startedAt: "2026-06-26T00:00:00Z" },
      players: [{ memberId: "m_jane", name: "Jane", division: null, startingHole: null, scores: {} }],
    });
    const client = new FakeSocket();
    const server = new FakeSocket();
    vi.stubGlobal("Response", class {
      readonly status: number;

      constructor(_body: BodyInit | null = null, init?: ResponseInit) {
        this.status = init?.status ?? 200;
      }
    });
    vi.stubGlobal("WebSocketPair", function WebSocketPair() {
      return { 0: client, 1: server };
    });
    const live = new LiveEventDO(state, { DB: db });

    const upgrade = await live.fetch(new Request("https://do/ws"));
    expect(upgrade.status).toBe(101);
    expect(state.accepted).toEqual([server]);
    expect(server.sent[0]).toContain('"type":"snapshot"');

    const score = await live.fetch(new Request("https://do/score", { method: "POST", headers: { "X-Auth-Admin": "true" }, body: JSON.stringify({ index: 0, hole: 1, strokes: 3 }) }));
    expect(score.status).toBe(200);
    expect(server.sent.at(-1)).toContain('"scores":{"1":3}');
  });
});

describe("LiveEventDO card-scoped scoring", () => {
  const liveDO = () => new LiveEventDO(new FakeState({}), { DB: db });
  const start = (live: LiveEventDO, players: unknown[]) =>
    live.fetch(new Request("https://do/start", { method: "POST", body: JSON.stringify({ eventId: 1, holes: [{ hole: 1, par: 3 }, { hole: 2, par: 3 }], players }) }));
  const post = (live: LiveEventDO, headers: Record<string, string>, body: unknown) =>
    live.fetch(new Request("https://do/score", { method: "POST", headers, body: JSON.stringify(body) }));

  it("a cardmate may score within the card; a non-cardmate and a stranger are rejected (403)", async () => {
    const live = liveDO();
    await start(live, Array.from({ length: 8 }, (_, i) => ({ memberId: "m" + i, name: "P" + i }))); // buckets of 4 -> c0, c1
    expect((await post(live, { "X-Auth-Member": "m0" }, { index: 1, hole: 1, strokes: 3 })).status).toBe(200); // m0 scores m1 (both c0)
    expect((await post(live, { "X-Auth-Member": "m0" }, { index: 4, hole: 1, strokes: 3 })).status).toBe(403); // m0 (c0) scores m4 (c1)
    expect((await post(live, { "X-Auth-Member": "ghost" }, { index: 0, hole: 1, strokes: 3 })).status).toBe(403); // not on any card
  });

  it("an admin may score any card", async () => {
    const live = liveDO();
    await start(live, Array.from({ length: 8 }, (_, i) => ({ memberId: "m" + i, name: "P" + i })));
    expect((await post(live, { "X-Auth-Admin": "true" }, { index: 7, hole: 1, strokes: 4 })).status).toBe(200);
  });

  it("admin cancel resets the round to none; non-admin is forbidden", async () => {
    const live = liveDO();
    await start(live, [{ memberId: "m0", name: "A" }, { memberId: "m1", name: "B" }]);
    await post(live, { "X-Auth-Admin": "true" }, { index: 0, hole: 1, strokes: 3 });
    // non-admin cannot cancel
    expect((await live.fetch(new Request("https://do/cancel", { method: "POST", headers: { "X-Auth-Member": "m0" } }))).status).toBe(403);
    // admin cancel wipes the round
    const cancelled = await live.fetch(new Request("https://do/cancel", { method: "POST", headers: { "X-Auth-Admin": "true" } }));
    const snap = (await cancelled.json()) as { status: string; players: unknown[] };
    expect(snap.status).toBe("none");
    expect(snap.players).toEqual([]);
    // score submissions on the reset round are rejected (not_live)
    expect((await post(live, { "X-Auth-Admin": "true" }, { index: 0, hole: 1, strokes: 3 })).status).toBe(409);
  });

  it("adds a doubles guest with a pair label so they're pairable at add-time", async () => {
    const live = liveDO();
    await live.fetch(new Request("https://do/start", { method: "POST", body: JSON.stringify({
      casual: true, holes: [{ hole: 1, par: 3 }],
      liveScoringConfig: { groupFormat: "doubles", scoringStyle: "stroke" },
      players: [{ memberId: "m0", name: "A", team: "Red" }, { memberId: "m1", name: "B", team: "Red" }],
    }) }));
    const res = await live.fetch(new Request("https://do/guest", { method: "POST", headers: { "X-Auth-Member": "m0" }, body: JSON.stringify({ name: "C", team: "Blue" }) }));
    expect(res.status).toBe(200);
    const snap = (await (await live.fetch(new Request("https://do/"))).json()) as { players: { name: string; team: string | null }[] };
    expect(snap.players.find((p) => p.name === "C")?.team).toBe("Blue");
  });

  it("captures weather location at start, reads it via the alarm (off the start path, not on score)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T12:00:00.000Z"));
    stubWeather([openMeteoSample("2026-07-01T08:00", 6.5, 0), openMeteoSample("2026-07-01T08:15", 18.2, 0.2)]);
    const state = new FakeState({});
    const live = new LiveEventDO(state, { DB: db });
    const started = await live.fetch(new Request("https://do/start", { method: "POST", body: JSON.stringify({
      casual: true, courseName: "North Rec", startedAt: "2026-07-01T12:00:00.000Z", holes: [{ hole: 1, par: 3 }],
      players: [{ memberId: "m_a", name: "A" }], weatherLocation: { lat: 35.631092, lng: -77.319923, label: "North Rec - Greenville, NC" },
    }) }));
    // Start records the location + schedules an immediate alarm, but does NOT block on the weather fetch.
    const startBody = (await started.json()) as WeatherSnapshot;
    expect(startBody.weather?.location.label).toBe("North Rec - Greenville, NC");
    expect(startBody.weather?.current).toBeNull(); // no reading yet — the alarm takes the first one
    expect(state.alarmAt).not.toBeNull();

    // The first alarm takes the initial reading.
    await live.alarm();
    expect(((await (await live.fetch(new Request("https://do/"))).json()) as WeatherSnapshot).weather?.current).toMatchObject({ observedAt: "2026-07-01T08:00", windSpeedMph: 6.5, windGustMph: 12.5 });

    // A score is PURE: never fetches weather, so the reading stays at the last alarm value.
    vi.setSystemTime(new Date("2026-07-01T12:11:00.000Z"));
    const scored = await live.fetch(new Request("https://do/score", { method: "POST", headers: { "X-Auth-Admin": "true" }, body: JSON.stringify({ index: 0, scorerIndex: 0, hole: 1, strokes: 3 }) }));
    expect(((await scored.json()) as WeatherSnapshot).weather?.current?.observedAt).toBe("2026-07-01T08:00");

    // The next alarm refreshes weather, appends the changed sample, and reschedules while live.
    await live.alarm();
    const snap = (await (await live.fetch(new Request("https://do/"))).json()) as WeatherSnapshot;
    expect(snap.weather?.current).toMatchObject({ observedAt: "2026-07-01T08:15", rainIn: 0.2, windSpeedMph: 18.2, windGustMph: 24.2 });
    expect(snap.weather?.history.map((s) => s.windSpeedMph)).toEqual([6.5, 18.2]);
    expect(snap.weather?.error).toBeNull();
    expect(state.alarmAt).not.toBeNull(); // rescheduled while the round is live
  });

  it("the weather alarm clears itself once the round is no longer live", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T12:00:00.000Z"));
    stubWeather([openMeteoSample("2026-07-01T08:00", 6.5, 0)]);
    const state = new FakeState({});
    const live = new LiveEventDO(state, { DB: db });
    await live.fetch(new Request("https://do/start", { method: "POST", body: JSON.stringify({
      casual: true, courseName: "North Rec", startedAt: "2026-07-01T12:00:00.000Z", holes: [{ hole: 1, par: 3 }],
      players: [{ memberId: "m_a", name: "A" }], weatherLocation: { lat: 35.6, lng: -77.3, label: "North Rec" },
    }) }));
    expect(state.alarmAt).not.toBeNull();
    await live.fetch(new Request("https://do/cancel", { method: "POST", headers: { "X-Auth-Admin": "true" } }));
    expect(state.alarmAt).toBeNull(); // cancel stops the background refresh
  });

  it("backfills weather for a live round that started before weather tracking", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T12:00:00.000Z"));
    stubWeather([openMeteoSample("2026-07-01T08:00", 7.5, 0.1)]);
    const live = new LiveEventDO(new FakeState({
      meta: { eventId: 7, holes: [{ hole: 1, par: 3 }], status: "live", startedAt: "2026-07-01T11:30:00.000Z" },
      players: [{ memberId: "m_a", name: "A", division: null, startingHole: null, scores: {} }],
    }), { DB: db });
    const filled = await live.fetch(new Request("https://do/weather", { method: "POST", body: JSON.stringify({
      weatherLocation: { lat: 35.631092, lng: -77.319923, label: "North Rec - Greenville, NC" },
    }) }));
    const body = (await filled.json()) as WeatherSnapshot;
    expect(body.weather?.location.label).toBe("North Rec - Greenville, NC");
    expect(body.weather?.current).toMatchObject({ observedAt: "2026-07-01T08:00", rainIn: 0.1, windSpeedMph: 7.5, windGustMph: 13.5 });
    expect(body.weather?.history.map((s) => s.observedAt)).toEqual(["2026-07-01T08:00"]);
  });

  it("a failing weather fetch never crashes the alarm — the round stays live + usable", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T12:00:00.000Z"));
    // A timeout/abort can throw a NON-Error (a DOMException in workerd); an uncaught throw here would wedge
    // the whole Durable Object (score/cancel/finalize would then fail with "internal error").
    vi.stubGlobal("fetch", vi.fn(async () => { throw { name: "AbortError", message: "timed out" }; }));
    const state = new FakeState({});
    const live = new LiveEventDO(state, { DB: db });
    await live.fetch(new Request("https://do/start", { method: "POST", body: JSON.stringify({
      casual: true, startedAt: "2026-07-01T12:00:00.000Z", holes: [{ hole: 1, par: 3 }],
      players: [{ memberId: "m_a", name: "A" }], weatherLocation: { lat: 35.6, lng: -77.3, label: "North Rec" },
    }) }));
    await expect(live.alarm()).resolves.toBeUndefined(); // must NOT throw
    expect(state.alarmAt).not.toBeNull(); // rescheduled despite the fetch failure
    const snap = (await (await live.fetch(new Request("https://do/"))).json()) as { status: string; weather: { error: string | null } | null };
    expect(snap.status).toBe("live"); // DO is healthy; the round is still fully usable
    expect(snap.weather?.error).toBe("weather_unavailable"); // failure surfaced, not thrown
  });

  it("lets cardmates enter guest-token scorecards but not another member's scorecard", async () => {
    const live = liveDO();
    await start(live, [
      { memberId: "m0", name: "A" },
      { memberId: "g_guest", name: "Guest" },
      { memberId: "m1", name: "B" },
    ]);
    const mine = (await (await live.fetch(new Request("https://do/mine", { headers: { "X-Auth-Member": "m0" } }))).json()) as { cardmates: { name: string; canEnterScorecard: boolean }[] };
    expect(mine.cardmates.map((c) => [c.name, c.canEnterScorecard])).toEqual([["A", true], ["Guest", true], ["B", false]]);
    expect((await post(live, { "X-Auth-Member": "m0" }, { index: 0, scorerIndex: 1, hole: 1, strokes: 3 })).status).toBe(200);
    expect((await post(live, { "X-Auth-Member": "m0" }, { index: 0, scorerIndex: 2, hole: 1, strokes: 3 })).status).toBe(403);
  });

  it("redacts memberId from the public snapshot; /mine reveals only the caller's card", async () => {
    const live = liveDO();
    await start(live, ["A", "B", "C", "D", "E"].map((n, i) => ({ memberId: "m" + i, name: n })));
    const snap = (await (await live.fetch(new Request("https://do/"))).json()) as { players: Record<string, unknown>[] };
    expect(snap.players[0]).not.toHaveProperty("memberId");
    expect(snap.players[0]).toHaveProperty("cardId");
    const mine = (await (await live.fetch(new Request("https://do/mine", { headers: { "X-Auth-Member": "m4" } }))).json()) as { playerIndex: number; cardId: string; cardmates: { name: string }[] };
    expect(mine.playerIndex).toBe(4);
    expect(mine.cardId).toBe("c1");
    expect(mine.cardmates.map((c) => c.name)).toEqual(["E"]);
    const mine0 = (await (await live.fetch(new Request("https://do/mine", { headers: { "X-Auth-Member": "m0" } }))).json()) as { cardmates: { name: string }[] };
    expect(mine0.cardmates.map((c) => c.name)).toEqual(["A", "B", "C", "D"]);
  });

  it("keeps a player/hole conflicted until all cardmate scorecards match", async () => {
    const state = new FakeState({});
    const live = new LiveEventDO(state, { DB: db });
    await live.fetch(new Request("https://do/start", { method: "POST", body: JSON.stringify({ casual: true, holes: [{ hole: 1, par: 3 }], players: [{ memberId: "m0", name: "A" }, { memberId: "m1", name: "B" }] }) }));
    const sock = new FakeSocket();
    state.acceptWebSocket(sock);
    sock.sent.length = 0;
    const first = (await (await live.fetch(new Request("https://do/score", { method: "POST", headers: { "X-Auth-Member": "m0" }, body: JSON.stringify({ index: 1, hole: 1, strokes: 3 }) }))).json()) as SnapshotBody;
    expect(first.conflicts).toEqual([]);
    expect(first.players[1]?.scores).toMatchObject({ 1: 3 });

    const disagreed = (await (await live.fetch(new Request("https://do/score", { method: "POST", headers: { "X-Auth-Member": "m1" }, body: JSON.stringify({ index: 1, hole: 1, strokes: 4 }) }))).json()) as SnapshotBody;
    expect(disagreed.conflicts).toEqual([{ cardId: "c0", playerIndex: 1, playerName: "B", hole: 1, values: [3, 4] }]);
    expect(disagreed.players[1]?.scores).not.toHaveProperty("1");
    const mine = (await (await live.fetch(new Request("https://do/mine", { headers: { "X-Auth-Member": "m0" } }))).json()) as { conflicts: ConflictRow[] };
    expect(mine.conflicts).toEqual(disagreed.conflicts);
    const conflict = sock.sent.find((m) => m.includes('"type":"conflict"'));
    expect(conflict).toBeTruthy();
    expect(conflict).toContain('"values":[3,4]');

    const matched = (await (await live.fetch(new Request("https://do/score", { method: "POST", headers: { "X-Auth-Member": "m1" }, body: JSON.stringify({ index: 1, hole: 1, strokes: 3 }) }))).json()) as SnapshotBody;
    expect(matched.conflicts).toEqual([]);
    expect(matched.players[1]?.scores).toMatchObject({ 1: 3 });
  });

  it("blocks competition finalization when a non-member scorecard disagrees", async () => {
    let touchedDb = false;
    const trackDb = { prepare: () => ({ bind() { return this; }, all: async () => ({ results: [], success: true }), first: async () => null, run: async () => { touchedDb = true; return { results: [], success: true }; } }) };
    const live = new LiveEventDO(new FakeState({}), { DB: trackDb });
    await start(live, [{ memberId: "m0", name: "A" }, { memberId: null, name: "Walk-on" }]);
    await post(live, { "X-Auth-Member": "m0" }, { index: 0, scorerIndex: 0, hole: 1, strokes: 3 });
    const disagreed = (await (await post(live, { "X-Auth-Member": "m0" }, { index: 0, scorerIndex: 1, hole: 1, strokes: 4 })).json()) as SnapshotBody;
    expect(disagreed.conflicts).toEqual([{ cardId: "c0", playerIndex: 0, playerName: "A", hole: 1, values: [3, 4] }]);
    expect(disagreed.players[0]?.scores).not.toHaveProperty("1");

    const blocked = await live.fetch(new Request("https://do/finalize", { method: "POST" }));
    expect(blocked.status).toBe(409);
    const body = (await blocked.json()) as { error: string; conflicts: ConflictRow[]; missing: unknown[] };
    expect(body.error).toBe("scorecard_incomplete");
    expect(body.conflicts).toContainEqual({ cardId: "c0", playerIndex: 0, playerName: "A", hole: 1, values: [3, 4] });
    expect(touchedDb).toBe(false);
  });

  it("exposes per-scorer votes (scorecards) in snapshot + /mine so a scorer can see/edit their own vote in a conflict", async () => {
    const live = new LiveEventDO(new FakeState({}), { DB: db });
    await live.fetch(new Request("https://do/start", { method: "POST", body: JSON.stringify({ casual: true, holes: [{ hole: 1, par: 3 }], players: [{ memberId: "m0", name: "A" }, { memberId: "m1", name: "B" }] }) }));
    await live.fetch(new Request("https://do/score", { method: "POST", headers: { "X-Auth-Member": "m0" }, body: JSON.stringify({ index: 1, hole: 1, strokes: 3 }) }));
    await live.fetch(new Request("https://do/score", { method: "POST", headers: { "X-Auth-Member": "m1" }, body: JSON.stringify({ index: 1, hole: 1, strokes: 4 }) }));
    const snap = (await (await live.fetch(new Request("https://do/"))).json()) as { players: { index: number; scores: Record<string, number>; scorecards: Record<string, Record<string, number>> }[] };
    const target = must(snap.players.find((p) => p.index === 1));
    expect(target.scores).not.toHaveProperty("1"); // consensus blank during conflict…
    expect(target.scorecards["1"]).toEqual({ "player:0": 3, "player:1": 4 }); // …but each scorer's own vote is visible
    const mine = (await (await live.fetch(new Request("https://do/mine", { headers: { "X-Auth-Member": "m0" } }))).json()) as { cardmates: { index: number; scorecards: Record<string, Record<string, number>> }[] };
    expect(must(mine.cardmates.find((c) => c.index === 1)).scorecards["1"]).toEqual({ "player:0": 3, "player:1": 4 });
  });

  it("ignores a removed scorer's stale cross-vote so the conflict auto-resolves on removal (no deadlock)", async () => {
    const live = new LiveEventDO(new FakeState({}), { DB: db });
    await live.fetch(new Request("https://do/start", { method: "POST", body: JSON.stringify({ casual: true, holes: [{ hole: 1, par: 3 }], players: [{ memberId: "m0", name: "A" }, { memberId: "m1", name: "B" }, { memberId: "m2", name: "X" }] }) }));
    await live.fetch(new Request("https://do/score", { method: "POST", headers: { "X-Auth-Member": "m2" }, body: JSON.stringify({ index: 1, hole: 1, strokes: 5 }) })); // X votes 5 on B
    await live.fetch(new Request("https://do/score", { method: "POST", headers: { "X-Auth-Member": "m0" }, body: JSON.stringify({ index: 1, hole: 1, strokes: 3 }) })); // A votes 3 on B → conflict [3,5]
    expect(((await (await live.fetch(new Request("https://do/"))).json()) as SnapshotBody).conflicts.length).toBe(1);
    await live.fetch(new Request("https://do/remove", { method: "POST", headers: { "X-Auth-Member": "m0" }, body: JSON.stringify({ index: 2, name: "X" }) })); // X leaves
    const resolved = (await (await live.fetch(new Request("https://do/"))).json()) as { conflicts: ConflictRow[]; players: { index: number; scores: Record<string, number> }[] };
    expect(resolved.conflicts).toEqual([]); // X's stale 5-vote is purged → A's 3 stands
    expect(resolved.players.find((p) => p.index === 1)?.scores).toMatchObject({ 1: 3 });
  });

  it("preserves cardmates' scores when the sole scorekeeper is removed (no data loss); finalize then needs confirmation or an admin force", async () => {
    let touchedDb = false;
    const trackDb = { prepare: () => ({ bind() { return this; }, all: async () => ({ results: [], success: true }), first: async () => null, run: async () => { touchedDb = true; return { results: [], success: true }; } }) };
    const live = new LiveEventDO(new FakeState({}), { DB: trackDb });
    await live.fetch(new Request("https://do/start", { method: "POST", body: JSON.stringify({ casual: true, holes: [{ hole: 1, par: 3 }], players: [{ memberId: "m0", name: "A" }, { memberId: "m1", name: "B" }, { memberId: "m2", name: "C" }] }) }));
    // A is the sole scorekeeper — enters everyone's score on A's own card (scorerIndex defaults to A=0).
    await live.fetch(new Request("https://do/score", { method: "POST", headers: { "X-Auth-Member": "m0" }, body: JSON.stringify({ index: 1, hole: 1, strokes: 4 }) }));
    await live.fetch(new Request("https://do/score", { method: "POST", headers: { "X-Auth-Member": "m0" }, body: JSON.stringify({ index: 2, hole: 1, strokes: 5 }) }));
    await live.fetch(new Request("https://do/remove", { method: "POST", headers: { "X-Auth-Member": "m1" }, body: JSON.stringify({ index: 0, name: "A" }) })); // A leaves
    const snap = (await (await live.fetch(new Request("https://do/"))).json()) as { players: { name: string; scores: Record<string, number> }[] };
    expect(snap.players.find((p) => p.name === "B")?.scores).toMatchObject({ 1: 4 }); // survived A's departure — NO DATA LOSS
    expect(snap.players.find((p) => p.name === "C")?.scores).toMatchObject({ 1: 5 });
    // With the only scorekeeper gone, no remaining MEMBER has confirmed a score → the card isn't agreed.
    const blocked = await live.fetch(new Request("https://do/finalize", { method: "POST", headers: { "X-Auth-Member": "m1" } }));
    expect(blocked.status).toBe(409);
    expect(((await blocked.json()) as { error: string }).error).toBe("scorecard_incomplete");
    expect(touchedDb).toBe(false);
    // An admin may FORCE it through, locking the preserved scores as they stand (B & C ranked, not DNF-wiped).
    const forced = await live.fetch(new Request("https://do/finalize", { method: "POST", headers: { "X-Auth-Admin": "true" }, body: JSON.stringify({ force: true }) }));
    expect(forced.status).toBe(200);
    const fb = (await forced.json()) as { status: string; forced: boolean; standings: { name: string; place: number | null }[] };
    expect(fb.status).toBe("final");
    expect(fb.forced).toBe(true);
    expect(fb.standings.find((s) => s.name === "B")?.place).not.toBeNull();
  });

  it("seeds legacy scores under a single marker so a single-scorer correction doesn't phantom-conflict", async () => {
    const state = new FakeState({
      meta: { eventId: 0, casual: true, holes: [{ hole: 1, par: 3 }], status: "live", startedAt: "" },
      players: [
        { memberId: "m0", name: "A", scores: { 1: 4 } },
        { memberId: "m1", name: "B", scores: { 1: 4 } },
      ],
    });
    const live = new LiveEventDO(state, { DB: db });
    const seeded = (await (await live.fetch(new Request("https://do/"))).json()) as SnapshotBody;
    expect(seeded.conflicts).toEqual([]); // legacy migration must NOT fabricate a cardmate conflict
    expect(seeded.players[1]?.scores).toMatchObject({ 1: 4 }); // legacy score preserved on load
    const corrected = (await (await live.fetch(new Request("https://do/score", { method: "POST", headers: { "X-Auth-Member": "m0" }, body: JSON.stringify({ index: 1, hole: 1, strokes: 3 }) }))).json()) as SnapshotBody;
    expect(corrected.conflicts).toEqual([]); // A's correction supersedes the legacy marker — no phantom conflict
    expect(corrected.players[1]?.scores).toMatchObject({ 1: 3 });
  });

  it("snapshot carries a monotonic rev that bumps on each mutation (stale-snapshot guard)", async () => {
    const live = new LiveEventDO(new FakeState({}), { DB: db });
    await live.fetch(new Request("https://do/start", { method: "POST", body: JSON.stringify({ casual: true, holes: [{ hole: 1, par: 3 }], players: [{ memberId: "m0", name: "A" }] }) }));
    const a = (await (await live.fetch(new Request("https://do/"))).json()) as { rev: number };
    await live.fetch(new Request("https://do/score", { method: "POST", headers: { "X-Auth-Member": "m0" }, body: JSON.stringify({ index: 0, hole: 1, strokes: 3 }) }));
    const b = (await (await live.fetch(new Request("https://do/"))).json()) as { rev: number };
    expect(typeof a.rev).toBe("number");
    expect(b.rev).toBeGreaterThan(a.rev);
  });

  it("lets one scorer edit their own unopposed entry without creating a conflict", async () => {
    const state = new FakeState({});
    const live = new LiveEventDO(state, { DB: db });
    await live.fetch(new Request("https://do/start", { method: "POST", body: JSON.stringify({ casual: true, holes: [{ hole: 1, par: 3 }], players: [{ memberId: "m0", name: "A" }, { memberId: "m1", name: "B" }] }) }));
    const sock = new FakeSocket();
    state.acceptWebSocket(sock);
    sock.sent.length = 0;

    await live.fetch(new Request("https://do/score", { method: "POST", headers: { "X-Auth-Member": "m1" }, body: JSON.stringify({ index: 1, hole: 1, strokes: 4 }) }));
    const corrected = (await (await live.fetch(new Request("https://do/score", { method: "POST", headers: { "X-Auth-Member": "m1" }, body: JSON.stringify({ index: 1, hole: 1, strokes: 5 }) }))).json()) as SnapshotBody;
    expect(sock.sent.some((m) => m.includes('"type":"conflict"'))).toBe(false);
    expect(corrected.conflicts).toEqual([]);
    expect(corrected.players[1]?.scores).toMatchObject({ 1: 5 });
  });
});

describe("LiveEventDO casual rounds (self-organizing cards)", () => {
  const startCasual = (live: LiveEventDO, creator: string) =>
    live.fetch(new Request("https://do/start", { method: "POST", body: JSON.stringify({ casual: true, holes: [{ hole: 1, par: 3 }, { hole: 2, par: 3 }], players: [{ memberId: creator, name: "Creator" }] }) }));
  const act = (live: LiveEventDO, path: string, member: string, body: unknown) =>
    live.fetch(new Request("https://do/" + path, { method: "POST", headers: { "X-Auth-Member": member }, body: JSON.stringify(body) }));

  it("a member joins and lands on the single shared card", async () => {
    const live = new LiveEventDO(new FakeState({}), { DB: db });
    await startCasual(live, "m_a");
    const joined = await act(live, "join", "m_b", { name: "Bee" });
    expect(joined.status).toBe(200);
    const mine = (await joined.json()) as { cardId: string; cardmates: { name: string }[] };
    expect(mine.cardId).toBe("c0");
    expect(mine.cardmates.map((c) => c.name).sort()).toEqual(["Bee", "Creator"]);
  });

  it("anyone on the round may score any cardmate; a stranger cannot", async () => {
    const live = new LiveEventDO(new FakeState({}), { DB: db });
    await startCasual(live, "m_a");
    await act(live, "join", "m_b", { name: "Bee" });
    expect((await act(live, "score", "m_b", { index: 0, hole: 1, strokes: 3 })).status).toBe(200);
    expect((await act(live, "score", "stranger", { index: 0, hole: 1, strokes: 5 })).status).toBe(403);
  });

  it("a member removes a cardmate (accidental/no-show); they drop off the card", async () => {
    const live = new LiveEventDO(new FakeState({}), { DB: db });
    await startCasual(live, "m_a");
    await act(live, "join", "m_b", { name: "Bee" });
    await act(live, "guest", "m_a", { name: "Walk-on" }); // [Creator(0), Bee(1), Walk-on(2)]
    const rm = await act(live, "remove", "m_b", { index: 2, name: "Walk-on" });
    expect(rm.status).toBe(200);
    const snap = (await (await live.fetch(new Request("https://do/"))).json()) as { players: { name: string }[] };
    expect(snap.players.map((p) => p.name).sort()).toEqual(["Bee", "Creator"]);
  });

  it("a stranger (not on the round) cannot remove a player (403)", async () => {
    const live = new LiveEventDO(new FakeState({}), { DB: db });
    await startCasual(live, "m_a");
    await act(live, "join", "m_b", { name: "Bee" });
    expect((await act(live, "remove", "stranger", { index: 0, name: "Creator" })).status).toBe(403);
  });

  it("updates casual doubles pair labels before scoring and persists them in /mine", async () => {
    const live = new LiveEventDO(new FakeState({}), { DB: db });
    await live.fetch(new Request("https://do/start", {
      method: "POST",
      body: JSON.stringify({
        casual: true,
        holes: [{ hole: 1, par: 3 }],
        liveScoringConfig: { groupFormat: "doubles", scoringStyle: "stroke" },
        players: [
          { memberId: "m_a", name: "A", team: "Old" },
          { memberId: "m_b", name: "B", team: "Old" },
          { memberId: "m_c", name: "C", team: "Blue" },
          { memberId: "m_d", name: "D", team: "Blue" },
        ],
      }),
    }));

    const changed = await act(live, "pairs", "m_a", {
      pairs: [
        { label: "Alpha", playerIndexes: [0, 1] },
        { label: "Beta", playerIndexes: [2, 3] },
      ],
    });

    expect(changed.status).toBe(200);
    const mine = (await changed.json()) as { cardmates: { index: number; team?: string | null }[]; scoreTargets: { id: string; label: string }[] };
    expect(mine.cardmates.map((player) => [player.index, player.team])).toEqual([[0, "Alpha"], [1, "Alpha"], [2, "Beta"], [3, "Beta"]]);
    expect(mine.scoreTargets.map((target) => [target.id, target.label])).toEqual([["pair:alpha", "Alpha"], ["pair:beta", "Beta"]]);
  });

  it("rejects a casual doubles pair with three active players and leaves labels unchanged", async () => {
    const state = new FakeState({});
    const live = new LiveEventDO(state, { DB: db });
    await live.fetch(new Request("https://do/start", {
      method: "POST",
      body: JSON.stringify({
        casual: true,
        holes: [{ hole: 1, par: 3 }],
        liveScoringConfig: { groupFormat: "doubles", scoringStyle: "stroke" },
        players: [
          { memberId: "m_a", name: "A", team: "Alpha" },
          { memberId: "m_b", name: "B", team: "Alpha" },
          { memberId: "m_c", name: "C", team: "Beta" },
          { memberId: "m_d", name: "D", team: "Beta" },
        ],
      }),
    }));

    const rejected = await act(live, "pairs", "m_a", {
      pairs: [
        { label: "Alpha", playerIndexes: [0, 1, 2] },
        { label: "Beta", playerIndexes: [3] },
      ],
    });

    expect(rejected.status).toBe(400);
    await expect(rejected.json()).resolves.toMatchObject({ error: "invalid_pairs", code: "invalid_pair_size" });
    const players = state.getStored<PlayerState[]>("players") ?? [];
    expect(players.map((player) => player.team)).toEqual(["Alpha", "Alpha", "Beta", "Beta"]);
  });

  it("blocks pair changes after an affected player has a score", async () => {
    const live = new LiveEventDO(new FakeState({}), { DB: db });
    await live.fetch(new Request("https://do/start", {
      method: "POST",
      body: JSON.stringify({
        casual: true,
        holes: [{ hole: 1, par: 3 }],
        liveScoringConfig: { groupFormat: "doubles", scoringStyle: "stroke" },
        players: [
          { memberId: "m_a", name: "A", team: "Alpha" },
          { memberId: "m_b", name: "B", team: "Alpha" },
          { memberId: "m_c", name: "C", team: "Beta" },
          { memberId: "m_d", name: "D", team: "Beta" },
        ],
      }),
    }));
    expect((await act(live, "score", "m_a", { targetId: "pair:alpha", hole: 1, strokes: 3 })).status).toBe(200);

    const rejected = await act(live, "pairs", "m_a", {
      pairs: [
        { label: "Beta", playerIndexes: [0, 2] },
        { label: "Alpha", playerIndexes: [1, 3] },
      ],
    });

    expect(rejected.status).toBe(409);
    await expect(rejected.json()).resolves.toMatchObject({ error: "scores_exist" });
  });

  it("rejects pair changes from a member outside the casual card", async () => {
    const live = new LiveEventDO(new FakeState({}), { DB: db });
    await live.fetch(new Request("https://do/start", {
      method: "POST",
      body: JSON.stringify({
        casual: true,
        holes: [{ hole: 1, par: 3 }],
        liveScoringConfig: { groupFormat: "doubles", scoringStyle: "stroke" },
        players: [
          { memberId: "m_a", name: "A", team: "Alpha" },
          { memberId: "m_b", name: "B", team: "Alpha" },
        ],
      }),
    }));

    const rejected = await act(live, "pairs", "m_stranger", { pairs: [{ label: "Alpha", playerIndexes: [0, 1] }] });

    expect(rejected.status).toBe(403);
    await expect(rejected.json()).resolves.toMatchObject({ error: "not_on_card" });
  });

  it("a member can remove themselves (leave the round)", async () => {
    const live = new LiveEventDO(new FakeState({}), { DB: db });
    await startCasual(live, "m_a");
    await act(live, "join", "m_b", { name: "Bee" });
    const left = await act(live, "remove", "m_b", { index: 1, name: "Bee" });
    expect(left.status).toBe(200);
    expect(((await left.json()) as { cardId: string | null }).cardId).toBeNull(); // m_b is off the card
    const mineA = (await (await live.fetch(new Request("https://do/mine", { headers: { "X-Auth-Member": "m_a" } }))).json()) as { cardmates: { name: string }[] };
    expect(mineA.cardmates.map((c) => c.name)).toEqual(["Creator"]);
  });

  it("a stale/shifted index whose name no longer matches is rejected (409 player_moved)", async () => {
    const live = new LiveEventDO(new FakeState({}), { DB: db });
    await startCasual(live, "m_a");
    await act(live, "join", "m_b", { name: "Bee" });
    const r = await act(live, "remove", "m_a", { index: 1, name: "Ghost" }); // index 1 is "Bee", not "Ghost"
    expect(r.status).toBe(409);
    const snap = (await (await live.fetch(new Request("https://do/"))).json()) as { players: { name: string }[] };
    expect(snap.players.length).toBe(2); // nobody removed
  });

  it("an admin may remove any player", async () => {
    const live = new LiveEventDO(new FakeState({}), { DB: db });
    await startCasual(live, "m_a");
    await act(live, "join", "m_b", { name: "Bee" });
    const rm = await live.fetch(new Request("https://do/remove", { method: "POST", headers: { "X-Auth-Admin": "true" }, body: JSON.stringify({ index: 0, name: "Creator" }) }));
    expect(rm.status).toBe(200);
    const snap = (await (await live.fetch(new Request("https://do/"))).json()) as { players: { name: string }[] };
    expect(snap.players.map((p) => p.name)).toEqual(["Bee"]);
  });

  it("removal tombstones (no index shift): scoring an unchanged index still targets the right player", async () => {
    const live = new LiveEventDO(new FakeState({}), { DB: db });
    await startCasual(live, "m_a"); // Creator @ index 0
    await act(live, "join", "m_b", { name: "Bee" }); // Bee @ index 1
    await act(live, "guest", "m_a", { name: "Cat" }); // Cat @ index 2
    expect((await act(live, "remove", "m_a", { index: 1, name: "Bee" })).status).toBe(200);
    // index 2 must STILL be Cat (not shifted down to index 1) — score it and confirm it landed on Cat.
    expect((await act(live, "score", "m_a", { index: 2, hole: 1, strokes: 3 })).status).toBe(200);
    const snap = (await (await live.fetch(new Request("https://do/"))).json()) as { players: { index: number; name: string; scores: Record<string, number> }[] };
    const cat = snap.players.find((p) => p.index === 2);
    expect(cat?.name).toBe("Cat");
    expect(cat?.scores["1"]).toBe(3);
    expect(snap.players.some((p) => p.name === "Bee")).toBe(false); // Bee is gone from the card
  });

  it("a removed player can no longer be scored (404)", async () => {
    const live = new LiveEventDO(new FakeState({}), { DB: db });
    await startCasual(live, "m_a");
    await act(live, "join", "m_b", { name: "Bee" }); // index 1
    await act(live, "remove", "m_a", { index: 1, name: "Bee" });
    expect((await act(live, "score", "m_a", { index: 1, hole: 1, strokes: 4 })).status).toBe(404);
  });

  it("a removed member rejoining reactivates their slot with a fresh card", async () => {
    const live = new LiveEventDO(new FakeState({}), { DB: db });
    await startCasual(live, "m_a");
    await act(live, "join", "m_b", { name: "Bee" });
    await act(live, "score", "m_b", { index: 1, hole: 1, strokes: 2 }); // Bee has a score
    await act(live, "remove", "m_b", { index: 1, name: "Bee" }); // Bee leaves
    const rejoined = await act(live, "join", "m_b", { name: "Bee" });
    const mine = (await rejoined.json()) as { cardId: string | null; cardmates: { name: string; scores: Record<string, number> }[] };
    expect(mine.cardId).toBe("c0"); // back on the card
    const bee = mine.cardmates.find((c) => c.name === "Bee");
    expect(bee?.scores["1"]).toBeUndefined(); // fresh card, old score cleared
  });

  it("carries hole distance + course/layout name through to the snapshot and /mine", async () => {
    const live = new LiveEventDO(new FakeState({}), { DB: db });
    await live.fetch(new Request("https://do/start", { method: "POST", body: JSON.stringify({
      casual: true, courseName: "North Rec", layoutName: "Blue",
      holes: [{ hole: 1, par: 3, distance_ft: 250, tee_sign_id: 77 }, { hole: 2, par: 4, distance_ft: 410 }],
      players: [{ memberId: "m_a", name: "A" }],
    }) }));
    const snap = (await (await live.fetch(new Request("https://do/"))).json()) as { courseName: string; layoutName: string; holes: { hole: number; distance_ft: number | null; tee_sign_id: number | null }[] };
    expect(snap.courseName).toBe("North Rec");
    expect(snap.layoutName).toBe("Blue");
    expect(snap.holes.find((h) => h.hole === 1)?.distance_ft).toBe(250);
    expect(snap.holes.find((h) => h.hole === 1)?.tee_sign_id).toBe(77);
    const mine = (await (await live.fetch(new Request("https://do/mine", { headers: { "X-Auth-Member": "m_a" } }))).json()) as { courseName: string; layoutName: string; holes: { hole: number; distance_ft: number | null; tee_sign_id: number | null }[] };
    expect(mine.courseName).toBe("North Rec");
    expect(mine.layoutName).toBe("Blue");
    expect(mine.holes.find((h) => h.hole === 2)?.distance_ft).toBe(410);
    expect(mine.holes.find((h) => h.hole === 1)?.tee_sign_id).toBe(77);
  });

  it("a member adds a guest; a casual round with NO share code writes no D1 EVENT results", async () => {
    let touchedDb = false;
    const trackDb = { prepare: () => ({ bind() { return this; }, all: async () => ({ results: [], success: true }), first: async () => null, run: async () => { touchedDb = true; return { results: [], success: true }; } }) };
    const live = new LiveEventDO(new FakeState({}), { DB: trackDb });
    await startCasual(live, "m_a"); // startCasual passes no roundCode → no durable casual persistence either
    expect((await act(live, "guest", "m_a", { name: "Walk-on" })).status).toBe(200);
    for (const scorerIndex of [0, 1]) {
      await act(live, "score", "m_a", { index: 0, scorerIndex, hole: 1, strokes: 3 });
      await act(live, "score", "m_a", { index: 0, scorerIndex, hole: 2, strokes: 3 });
      await act(live, "score", "m_a", { index: 1, scorerIndex, hole: 1, strokes: 3 });
      await act(live, "score", "m_a", { index: 1, scorerIndex, hole: 2, strokes: 3 });
    }
    const fin = await act(live, "finalize", "m_a", {});
    expect(fin.status).toBe(200);
    expect(touchedDb).toBe(false); // never touches the event `results` path (durable casual persistence needs a roundCode — see next test)
  });

  it("a casual round WITH a share code persists a durable casual_rounds + casual_results record on finalize", async () => {
    const inserts: { sql: string; args: unknown[] }[] = [];
    const recDb = {
      prepare(sql: string) {
        const entry: { sql: string; args: unknown[] } = { sql, args: [] };
        return {
          bind(...args: unknown[]) { entry.args = args; if (/INSERT INTO casual_|DELETE FROM casual_rounds/i.test(sql)) inserts.push(entry); return this; },
          run: async () => ({ results: [], success: true }),
          first: async <T = Record<string, unknown>>() => rowValue<T>(/INSERT INTO casual_rounds/i.test(sql) ? { id: 7 } : null),
          all: async () => ({ results: [], success: true }),
        };
      },
    };
    const live = new LiveEventDO(new FakeState({}), { DB: recDb });
    await live.fetch(new Request("https://do/start", { method: "POST", body: JSON.stringify({ casual: true, roundCode: "AB23CD", courseId: 3, layoutId: 5, courseName: "North Rec", layoutName: "Blue", createdBy: "m_a", holes: [{ hole: 1, par: 3 }, { hole: 2, par: 4 }], players: [{ memberId: "m_a", name: "A" }] }) }));
    await live.fetch(new Request("https://do/score", { method: "POST", headers: { "X-Auth-Member": "m_a" }, body: JSON.stringify({ index: 0, hole: 1, strokes: 3 }) }));
    await live.fetch(new Request("https://do/score", { method: "POST", headers: { "X-Auth-Member": "m_a" }, body: JSON.stringify({ index: 0, hole: 2, strokes: 4 }) }));
    const fin = await live.fetch(new Request("https://do/finalize", { method: "POST", headers: { "X-Auth-Member": "m_a" } }));
    expect(fin.status).toBe(200);
    const delIdx = inserts.findIndex((i) => /DELETE FROM casual_rounds/i.test(i.sql));
    const roundIdx = inserts.findIndex((i) => /INSERT INTO casual_rounds/i.test(i.sql));
    const roundIns = inserts[roundIdx];
    const resIns = inserts.find((i) => /INSERT INTO casual_results/i.test(i.sql));
    // Idempotency guard: a DELETE-by-round_code runs BEFORE the header insert so a fault/retry replaces
    // (never duplicates) the round — the casual analogue of the competition path's clearResults.
    expect(delIdx).toBeGreaterThanOrEqual(0);
    expect(must(inserts[delIdx]).args).toContain("AB23CD");
    expect(roundIdx).toBeGreaterThan(delIdx);
    expect(roundIns).toBeTruthy();
    expect(must(roundIns).args).toContain("AB23CD"); // round_code = the durable key
    expect(must(roundIns).args).toContain(5); // layout_id — kept so the ratings engine can compute a per-layout SSA
    expect(resIns).toBeTruthy();
    expect(must(resIns).args[0]).toBe(7); // casual_round_id FK = the id returned by createCasualRound
    expect(must(resIns).args).toContain("A"); // player name persisted
  });

  it("flags score conflicts from guest scorecards too", async () => {
    const live = new LiveEventDO(new FakeState({}), { DB: db });
    await startCasual(live, "m_a");
    await act(live, "guest", "m_a", { name: "Walk-on" });
    await act(live, "score", "m_a", { index: 0, scorerIndex: 0, hole: 1, strokes: 3 });

    const disagreed = (await (await act(live, "score", "m_a", { index: 0, scorerIndex: 1, hole: 1, strokes: 4 })).json()) as SnapshotBody;
    expect(disagreed.conflicts).toEqual([{ cardId: "c0", playerIndex: 0, playerName: "Creator", hole: 1, values: [3, 4] }]);
    expect(disagreed.players[0]?.scores).not.toHaveProperty("1");

    const matched = (await (await act(live, "score", "m_a", { index: 0, scorerIndex: 1, hole: 1, strokes: 3 })).json()) as SnapshotBody;
    expect(matched.conflicts).toEqual([]);
    expect(matched.players[0]?.scores).toMatchObject({ 1: 3 });
  });

  it("finalizes when only a walk-on GUEST hasn't kept a card (guests are optional; the sole member scored everyone)", async () => {
    let touchedDb = false;
    const trackDb = { prepare: () => ({ bind() { return this; }, all: async () => ({ results: [], success: true }), first: async () => null, run: async () => { touchedDb = true; return { results: [], success: true }; } }) };
    const live = new LiveEventDO(new FakeState({}), { DB: trackDb });
    await startCasual(live, "m_a");
    await act(live, "guest", "m_a", { name: "Walk-on" }); // a walk-on guest is NOT a required scorer
    await act(live, "score", "m_a", { index: 0, scorerIndex: 0, hole: 1, strokes: 3 });
    await act(live, "score", "m_a", { index: 0, scorerIndex: 0, hole: 2, strokes: 3 });
    await act(live, "score", "m_a", { index: 1, scorerIndex: 0, hole: 1, strokes: 3 });
    await act(live, "score", "m_a", { index: 1, scorerIndex: 0, hole: 2, strokes: 3 });

    // The only MEMBER (m_a) confirmed every hole for both players; the guest's own card isn't required.
    const finalized = await act(live, "finalize", "m_a", {});
    expect(finalized.status).toBe(200);
    expect(((await finalized.json()) as { status: string }).status).toBe("final");
    expect(touchedDb).toBe(false); // casual → nothing written to D1
  });

  it("blocks finalize while a MEMBER cardmate hasn't confirmed (no conflict, purely unconfirmed), then finalizes once they match", async () => {
    const live = new LiveEventDO(new FakeState({}), { DB: db });
    await startCasual(live, "m_a");
    await act(live, "join", "m_b", { name: "Bee" });
    // m_a keeps the whole card; m_b (a member) hasn't entered anything.
    for (const hole of [1, 2]) { await act(live, "score", "m_a", { index: 0, hole, strokes: 3 }); await act(live, "score", "m_a", { index: 1, hole, strokes: 3 }); }
    const blocked = await act(live, "finalize", "m_a", {});
    expect(blocked.status).toBe(409);
    const b1 = (await blocked.json()) as { error: string; conflicts: unknown[]; missing: unknown[] };
    expect(b1.error).toBe("scorecard_incomplete");
    expect(b1.conflicts).toEqual([]); // nothing disagrees — it's purely unconfirmed
    expect(b1.missing.length).toBeGreaterThan(0);
    // m_b confirms matching scores on every hole for both players → complete.
    for (const hole of [1, 2]) { await act(live, "score", "m_b", { index: 0, hole, strokes: 3 }); await act(live, "score", "m_b", { index: 1, hole, strokes: 3 }); }
    const done = await act(live, "finalize", "m_a", {});
    expect(done.status).toBe(200);
    expect(((await done.json()) as { forced: boolean }).forced).toBe(false);
  });

  it("a non-admin cannot force past an incomplete board; only an admin can", async () => {
    const live = new LiveEventDO(new FakeState({}), { DB: db });
    await startCasual(live, "m_a");
    await act(live, "join", "m_b", { name: "Bee" });
    // Only m_a scores; member m_b never confirms → incomplete.
    for (const hole of [1, 2]) { await act(live, "score", "m_a", { index: 0, hole, strokes: 3 }); await act(live, "score", "m_a", { index: 1, hole, strokes: 3 }); }
    const nope = await act(live, "finalize", "m_a", { force: true }); // non-admin force is ignored
    expect(nope.status).toBe(409);
    expect(((await nope.json()) as { error: string }).error).toBe("scorecard_incomplete");
    const forced = await live.fetch(new Request("https://do/finalize", { method: "POST", headers: { "X-Auth-Member": "m_a", "X-Auth-Admin": "true" }, body: JSON.stringify({ force: true }) }));
    expect(forced.status).toBe(200);
    expect(((await forced.json()) as { forced: boolean }).forced).toBe(true);
  });

  it("exposes `missing` (unconfirmed member scores) in the snapshot and /mine", async () => {
    const live = new LiveEventDO(new FakeState({}), { DB: db });
    await startCasual(live, "m_a");
    await act(live, "join", "m_b", { name: "Bee" });
    await act(live, "score", "m_a", { index: 0, hole: 1, strokes: 3 }); // barely started → lots unconfirmed
    const snap = (await (await live.fetch(new Request("https://do/"))).json()) as { missing: { hole: number; playerName: string }[] };
    expect(Array.isArray(snap.missing)).toBe(true);
    expect(snap.missing.length).toBeGreaterThan(0);
    const mine = (await (await live.fetch(new Request("https://do/mine", { headers: { "X-Auth-Member": "m_a" } }))).json()) as { missing: readonly unknown[] };
    expect(Array.isArray(mine.missing)).toBe(true);
    expect(mine.missing.length).toBeGreaterThan(0);
  });

  it("rejects finalize until every player's card scores match exactly", async () => {
    let touchedDb = false;
    const trackDb = { prepare: () => ({ bind() { return this; }, all: async () => ({ results: [], success: true }), first: async () => null, run: async () => { touchedDb = true; return { results: [], success: true }; } }) };
    const live = new LiveEventDO(new FakeState({}), { DB: trackDb });
    await startCasual(live, "m_a");
    await act(live, "join", "m_b", { name: "Bee" });
    await act(live, "score", "m_a", { index: 0, hole: 1, strokes: 3 });
    await act(live, "score", "m_b", { index: 0, hole: 1, strokes: 4 });
    await act(live, "score", "m_a", { index: 1, hole: 1, strokes: 3 });
    await act(live, "score", "m_b", { index: 1, hole: 1, strokes: 3 });

    const blocked = await act(live, "finalize", "m_a", {});
    expect(blocked.status).toBe(409);
    const body = (await blocked.json()) as { error: string; conflicts: ConflictRow[]; missing: unknown[] };
    expect(body.error).toBe("scorecard_incomplete");
    expect(body.conflicts).toEqual([{ cardId: "c0", playerIndex: 0, playerName: "Creator", hole: 1, values: [3, 4] }]);
    expect(body.missing.length).toBeGreaterThan(0);
    expect(touchedDb).toBe(false);

    await act(live, "score", "m_b", { index: 0, hole: 1, strokes: 3 });
    await act(live, "score", "m_a", { index: 0, hole: 2, strokes: 3 });
    await act(live, "score", "m_b", { index: 0, hole: 2, strokes: 3 });
    await act(live, "score", "m_a", { index: 1, hole: 2, strokes: 3 });
    await act(live, "score", "m_b", { index: 1, hole: 2, strokes: 3 });

    const finalized = await act(live, "finalize", "m_a", {});
    expect(finalized.status).toBe(200);
    expect(touchedDb).toBe(false);
  });
});

describe("LiveEventDO config-aware score targets and final results", () => {
  const holes = [{ hole: 1, par: 3 }, { hole: 2, par: 3 }];
  const doublesConfig = { groupFormat: "doubles", scoringStyle: "stroke" };

  const startDoubles = (live: LiveEventDO) =>
    live.fetch(new Request("https://do/start", {
      method: "POST",
      body: JSON.stringify({
        eventId: 10,
        holes,
        liveScoringConfig: doublesConfig,
        players: [
          { memberId: "m_ann", name: "Ann", team: "Alpha" },
          { memberId: "m_bo", name: "Bo", team: "Alpha" },
          { memberId: "m_cy", name: "Cy", team: "Beta" },
          { memberId: "m_dee", name: "Dee", team: "Beta" },
        ],
      }),
    }));

  const adminScore = (live: LiveEventDO, body: unknown) =>
    live.fetch(new Request("https://do/score", {
      method: "POST",
      headers: { "X-Auth-Admin": "true" },
      body: JSON.stringify(body),
    }));

  it("stores normalized config and exposes roundConfig plus scoreTargets in snapshot and /mine", async () => {
    const state = new FakeState({});
    const live = new LiveEventDO(state, { DB: db });

    const started = await startDoubles(live);
    expect(started.status).toBe(200);
    const meta = state.getStored<{ roundConfig?: unknown }>("meta");
    expect(meta?.roundConfig).toEqual(doublesConfig);

    await adminScore(live, { targetId: "pair:alpha", scorerIndex: 0, hole: 1, strokes: 3 });
    const snap = (await (await adminScore(live, { index: 2, scorerIndex: 2, hole: 1, strokes: 4 })).json()) as SnapshotBody;

    expect(snap.roundConfig).toEqual(doublesConfig);
    expect(snap.scoreTargets).toEqual([
      { id: "pair:alpha", type: "pair", label: "Alpha", playerIndexes: [0, 1], members: ["Ann", "Bo"] },
      { id: "pair:beta", type: "pair", label: "Beta", playerIndexes: [2, 3], members: ["Cy", "Dee"] },
    ]);
    expect(snap.players.find((p) => p.index === 0)?.scores).toMatchObject({ 1: 3 });
    expect(snap.players.find((p) => p.index === 1)?.scores).toMatchObject({ 1: 3 });
    expect(snap.players.find((p) => p.index === 2)?.scores).toMatchObject({ 1: 4 });
    expect(snap.players.find((p) => p.index === 3)?.scores).toMatchObject({ 1: 4 });
    expect(snap.standings?.map((s) => ({ name: s.name, targetId: s.targetId, total: s.total, members: s.members }))).toEqual([
      { name: "Alpha", targetId: "pair:alpha", total: 3, members: ["Ann", "Bo"] },
      { name: "Beta", targetId: "pair:beta", total: 4, members: ["Cy", "Dee"] },
    ]);

    const mine = (await (await live.fetch(new Request("https://do/mine", { headers: { "X-Auth-Member": "m_ann" } }))).json()) as SnapshotBody & { readonly cardmates: readonly { readonly index: number }[] };
    expect(mine.roundConfig).toEqual(doublesConfig);
    expect(mine.scoreTargets).toEqual(snap.scoreTargets);
    expect(mine.cardmates.map((p) => p.index)).toEqual([0, 1, 2, 3]);
  });

  it("allows casual doubles rounds to start before all players are paired", async () => {
    const state = new FakeState({});
    const live = new LiveEventDO(state, { DB: db });

    const started = await live.fetch(new Request("https://do/start", {
      method: "POST",
      body: JSON.stringify({
        casual: true,
        roundCode: "PAIR12",
        holes: [{ hole: 1, par: 3 }],
        liveScoringConfig: doublesConfig,
        players: [{ memberId: "m_ann", name: "Ann" }],
      }),
    }));

    expect(started.status).toBe(200);
    // The public snapshot's global scoreTargetError stays null for a per-card issue (it must not broadcast
    // over /ws into every viewer's state); the unpaired card surfaces in the additive scoreTargetErrors array.
    await expect(started.json()).resolves.toMatchObject({
      status: "live",
      scoreTargetError: null,
      scoreTargetErrors: [{ cardId: "c0", code: "missing_pair_label" }],
    });
    expect(state.getStored("meta")).toMatchObject({ casual: true, roundCode: "PAIR12" });
  });

  it("returns a precise validation error when doubles finalize has an unpaired active player", async () => {
    const live = new LiveEventDO(new FakeState({}), { DB: db });
    await live.fetch(new Request("https://do/start", {
      method: "POST",
      body: JSON.stringify({
        casual: true,
        holes: [{ hole: 1, par: 3 }],
        liveScoringConfig: doublesConfig,
        players: [{ memberId: "m_solo", name: "Solo", team: "Solo Pair" }],
      }),
    }));

    const finalized = await live.fetch(new Request("https://do/finalize", { method: "POST", headers: { "X-Auth-Member": "m_solo" } }));
    expect(finalized.status).toBe(400);
    await expect(finalized.json()).resolves.toMatchObject({
      error: "invalid_score_targets",
      code: "invalid_pair_size",
      message: 'doubles scoring pair "Solo Pair" must have exactly two active players',
    });
  });

  it("persists doubles stroke results as one row per player with shared scoring group metadata", async () => {
    const { database, inserts } = recordingDb();
    const live = new LiveEventDO(new FakeState({}), { DB: database });
    await startDoubles(live);
    for (const scorerIndex of [0, 1, 2, 3]) {
      for (const hole of [1, 2]) {
        await adminScore(live, { targetId: "pair:alpha", scorerIndex, hole, strokes: 3 });
        await adminScore(live, { targetId: "pair:beta", scorerIndex, hole, strokes: 4 });
      }
    }

    const finalized = await live.fetch(new Request("https://do/finalize", { method: "POST", headers: { "X-Auth-Admin": "true" } }));
    expect(finalized.status).toBe(200);
    const resultRows = inserts.filter((i) => /INSERT INTO results/i.test(i.sql));
    expect(resultRows).toHaveLength(4);
    const alphaRows = resultRows.filter((i) => i.args[2] === "Ann" || i.args[2] === "Bo");
    expect(alphaRows.map((i) => i.args[3])).toEqual([1, 1]);
    expect(alphaRows.map((i) => JSON.parse(i.args[9] as string))).toEqual([
      { targetId: "pair:alpha", targetType: "pair", label: "Alpha", members: ["Ann", "Bo"] },
      { targetId: "pair:alpha", targetType: "pair", label: "Alpha", members: ["Ann", "Bo"] },
    ]);
    expect(alphaRows.map((i) => i.args[10])).toEqual([null, null]);
  });

  it("persists casual doubles result metadata and the round scoring config", async () => {
    const { database, inserts } = recordingDb(15);
    const live = new LiveEventDO(new FakeState({}), { DB: database });
    await live.fetch(new Request("https://do/start", {
      method: "POST",
      body: JSON.stringify({
        casual: true,
        roundCode: "PAIR12",
        holes,
        liveScoringConfig: doublesConfig,
        players: [
          { memberId: "m_ann", name: "Ann", team: "Alpha" },
          { memberId: "m_bo", name: "Bo", team: "Alpha" },
          { memberId: "m_cy", name: "Cy", team: "Beta" },
          { memberId: "m_dee", name: "Dee", team: "Beta" },
        ],
      }),
    }));
    for (const scorerIndex of [0, 1, 2, 3]) {
      for (const hole of [1, 2]) {
        await adminScore(live, { targetId: "pair:alpha", scorerIndex, hole, strokes: 3 });
        await adminScore(live, { targetId: "pair:beta", scorerIndex, hole, strokes: 4 });
      }
    }

    const finalized = await live.fetch(new Request("https://do/finalize", { method: "POST", headers: { "X-Auth-Member": "m_ann" } }));
    expect(finalized.status).toBe(200);
    const round = inserts.find((i) => /INSERT INTO casual_rounds/i.test(i.sql));
    expect(round?.args[8]).toBe(JSON.stringify(doublesConfig));
    const resultRows = inserts.filter((i) => /INSERT INTO casual_results/i.test(i.sql));
    expect(resultRows).toHaveLength(4);
    expect(JSON.parse(resultRows[0]?.args[9] as string)).toEqual({ targetId: "pair:alpha", targetType: "pair", label: "Alpha", members: ["Ann", "Bo"] });
  });

  it("persists matchplay winner place and full match_result metadata", async () => {
    const { database, inserts } = recordingDb();
    const live = new LiveEventDO(new FakeState({}), { DB: database });
    await live.fetch(new Request("https://do/start", {
      method: "POST",
      body: JSON.stringify({
        eventId: 11,
        holes,
        liveScoringConfig: { groupFormat: "singles", scoringStyle: "matchplay" },
        players: [
          { memberId: "m_winner", name: "Winner" },
          { memberId: "m_loser", name: "Loser" },
        ],
      }),
    }));
    for (const scorerIndex of [0, 1]) {
      for (const hole of [1, 2]) {
        await adminScore(live, { targetId: "player:0", scorerIndex, hole, strokes: 3 });
        await adminScore(live, { targetId: "player:1", scorerIndex, hole, strokes: 4 });
      }
    }

    const finalized = await live.fetch(new Request("https://do/finalize", { method: "POST", headers: { "X-Auth-Admin": "true" } }));
    expect(finalized.status).toBe(200);
    const resultRows = inserts.filter((i) => /INSERT INTO results/i.test(i.sql));
    expect(resultRows.map((i) => ({ name: i.args[2], place: i.args[3], match: JSON.parse(i.args[10] as string) }))).toEqual([
      { name: "Winner", place: 1, match: { status: "won 2&0", outcome: "won", holesWon: 2, holesLost: 0, holesTied: 0, lead: 2, holesRemaining: 0, opponent: "Loser", dormie: false } },
      { name: "Loser", place: 2, match: { status: "won 2&0", outcome: "lost", holesWon: 0, holesLost: 2, holesTied: 0, lead: -2, holesRemaining: 0, opponent: "Winner", dormie: false } },
    ]);
  });

  it("validates matchplay target counts per card instead of rejecting valid multi-card rounds", async () => {
    const { database, inserts } = recordingDb();
    const live = new LiveEventDO(new FakeState({}), { DB: database });
    await live.fetch(new Request("https://do/start", {
      method: "POST",
      body: JSON.stringify({
        eventId: 13,
        holes: [{ hole: 1, par: 3 }],
        liveScoringConfig: { groupFormat: "singles", scoringStyle: "matchplay" },
        players: [
          { memberId: "m_a", name: "A", startingHole: 1 },
          { memberId: "m_b", name: "B", startingHole: 1 },
          { memberId: "m_c", name: "C", startingHole: 2 },
          { memberId: "m_d", name: "D", startingHole: 2 },
        ],
      }),
    }));

    for (const scorerIndex of [0, 1]) {
      await adminScore(live, { targetId: "player:0", scorerIndex, hole: 1, strokes: 3 });
      await adminScore(live, { targetId: "player:1", scorerIndex, hole: 1, strokes: 4 });
    }
    for (const scorerIndex of [2, 3]) {
      await adminScore(live, { targetId: "player:2", scorerIndex, hole: 1, strokes: 5 });
      await adminScore(live, { targetId: "player:3", scorerIndex, hole: 1, strokes: 4 });
    }

    const snap = (await (await live.fetch(new Request("https://do/"))).json()) as SnapshotBody & { readonly scoreTargetError: null };
    expect(snap.scoreTargetError).toBeNull();
    expect(snap.standings?.map((standing) => [standing.name, standing.match?.outcome])).toEqual([
      ["A", "leading"],
      ["B", "trailing"],
      ["C", "trailing"],
      ["D", "leading"],
    ]);

    const finalized = await live.fetch(new Request("https://do/finalize", { method: "POST", headers: { "X-Auth-Admin": "true" } }));
    expect(finalized.status).toBe(200);
    const resultRows = inserts.filter((insert) => /INSERT INTO results/i.test(insert.sql));
    expect(resultRows.map((insert) => ({ name: insert.args[2], place: insert.args[3], outcome: JSON.parse(insert.args[10] as string).outcome }))).toEqual([
      { name: "A", place: 1, outcome: "won" },
      { name: "B", place: 2, outcome: "lost" },
      { name: "D", place: 1, outcome: "won" },
      { name: "C", place: 2, outcome: "lost" },
    ]);
  });

  it("keeps legacy no-config finalize rows with null metadata", async () => {
    const { database, inserts } = recordingDb();
    const live = new LiveEventDO(new FakeState({}), { DB: database });
    await live.fetch(new Request("https://do/start", {
      method: "POST",
      body: JSON.stringify({ eventId: 12, holes: [{ hole: 1, par: 3 }], players: [{ memberId: "m_legacy", name: "Legacy" }] }),
    }));
    await adminScore(live, { index: 0, scorerIndex: 0, hole: 1, strokes: 3 });

    const finalized = await live.fetch(new Request("https://do/finalize", { method: "POST", headers: { "X-Auth-Admin": "true" } }));
    expect(finalized.status).toBe(200);
    const result = inserts.find((i) => /INSERT INTO results/i.test(i.sql));
    expect(result?.args[2]).toBe("Legacy");
    expect(result?.args[9]).toBeNull();
    expect(result?.args[10]).toBeNull();
  });
});

describe("LiveEventDO per-card scoring isolation (P2-C)", () => {
  const holes = [{ hole: 1, par: 3 }, { hole: 2, par: 3 }];
  const doublesConfig = { groupFormat: "doubles", scoringStyle: "stroke" };
  const matchplayConfig = { groupFormat: "singles", scoringStyle: "matchplay" };

  const post = (live: LiveEventDO, headers: Record<string, string>, body: unknown) =>
    live.fetch(new Request("https://do/score", { method: "POST", headers, body: JSON.stringify(body) }));
  const memberScore = (live: LiveEventDO, member: string, body: unknown) => post(live, { "X-Auth-Member": member }, body);
  const removeByAdmin = (live: LiveEventDO, memberId: string) =>
    live.fetch(new Request("https://do/remove", { method: "POST", headers: { "X-Auth-Admin": "true" }, body: JSON.stringify({ memberId }) }));
  const snapshot = async (live: LiveEventDO) => (await (await live.fetch(new Request("https://do/"))).json()) as SnapshotBody & {
    readonly scoreTargetError: unknown;
    readonly scoreTargetErrors: readonly { readonly cardId: string | null; readonly code: string; readonly message: string }[];
  };
  const mine = async (live: LiveEventDO, member: string) =>
    (await (await live.fetch(new Request("https://do/mine", { headers: { "X-Auth-Member": member } }))).json()) as {
      readonly scoreTargetError: { readonly code: string; readonly message: string } | null;
    };
  const adminForceFinalize = (live: LiveEventDO) =>
    live.fetch(new Request("https://do/finalize", { method: "POST", headers: { "X-Auth-Admin": "true" }, body: JSON.stringify({ force: true }) }));

  const startTwoCardDoubles = (live: LiveEventDO) =>
    live.fetch(new Request("https://do/start", { method: "POST", body: JSON.stringify({
      eventId: 20, holes, liveScoringConfig: doublesConfig,
      players: [
        { memberId: "m_ann", name: "Ann", team: "Alpha", cardId: "cA" },
        { memberId: "m_bo", name: "Bo", team: "Alpha", cardId: "cA" },
        { memberId: "m_cy", name: "Cy", team: "Beta", cardId: "cB" },
        { memberId: "m_dee", name: "Dee", team: "Beta", cardId: "cB" },
      ],
    }) }));

  const startTwoCardMatchplay = (live: LiveEventDO) =>
    live.fetch(new Request("https://do/start", { method: "POST", body: JSON.stringify({
      eventId: 21, holes, liveScoringConfig: matchplayConfig,
      players: [
        { memberId: "m_a", name: "A", startingHole: 1 },
        { memberId: "m_b", name: "B", startingHole: 1 },
        { memberId: "m_c", name: "C", startingHole: 2 },
        { memberId: "m_d", name: "D", startingHole: 2 },
      ],
    }) }));

  it("keeps GLOBAL player indexes and reports per-pair errors after a tombstone (scoreTargetsForPlayersSafe)", () => {
    const players = [
      { memberId: "m_ann", name: "Ann", team: "Alpha" },
      { memberId: "m_bo", name: "Bo", team: "Alpha", removed: true }, // tombstoned partner
      { memberId: "m_cy", name: "Cy", team: "Beta" },
      { memberId: "m_dee", name: "Dee", team: "Beta" },
    ];
    const { targets, errors } = scoreTargetsForPlayersSafe(players, doublesConfig);
    // Beta survives with its GLOBAL indexes [2,3]; Alpha becomes a per-pair error carrying global index 0.
    expect(targets).toEqual([{ type: "pair", id: "pair:beta", label: "Beta", playerIndexes: [2, 3], memberIds: ["m_cy", "m_dee"] }]);
    expect(errors).toEqual([{ playerIndexes: [0], code: "invalid_pair_size", message: expect.any(String) }]);
  });

  it("isolates a broken doubles pair to its own card — the other card keeps scoring", async () => {
    const live = new LiveEventDO(new FakeState({}), { DB: db });
    await startTwoCardDoubles(live);
    await memberScore(live, "m_ann", { targetId: "pair:alpha", hole: 1, strokes: 3 });
    await memberScore(live, "m_cy", { targetId: "pair:beta", hole: 1, strokes: 4 });

    expect((await removeByAdmin(live, "m_bo")).status).toBe(200); // a partner leaves card cA -> pair Alpha broken

    // healthy card cB keeps scoring; broken card cA is blocked (its lone member can't score)
    expect((await memberScore(live, "m_cy", { targetId: "pair:beta", hole: 2, strokes: 4 })).status).toBe(200);
    const blocked = await memberScore(live, "m_ann", { index: 0, hole: 2, strokes: 3 });
    expect(blocked.status).toBe(400);
    await expect(blocked.json()).resolves.toMatchObject({ error: "invalid_score_targets", code: "invalid_pair_size" });

    const snap = await snapshot(live);
    expect(snap.scoreTargetError).toBeNull(); // a per-card break does NOT ride the public global field
    expect(snap.scoreTargetErrors).toEqual([{ cardId: "cA", playerIndexes: [0], code: "invalid_pair_size", message: expect.any(String) }]);
    expect(snap.standings?.map((s) => s.targetId)).toEqual(["pair:beta"]); // only the healthy card ranks

    expect((await mine(live, "m_cy")).scoreTargetError).toBeNull(); // healthy-card member: no false warning
    expect((await mine(live, "m_ann")).scoreTargetError?.code).toBe("invalid_pair_size"); // broken-card member: their error
  });

  it("isolates a broken pair to JUST that pair on a SHARED card (casual 2v2) — the other pair keeps scoring", async () => {
    const live = new LiveEventDO(new FakeState({}), { DB: db });
    // All four players on ONE physical card c0 — exactly how a casual 2v2 foursome is shaped, and the ONLY
    // HTTP-reachable mid-round break. Card-level isolation would wrongly wedge Beta too; pair-level must not.
    await live.fetch(new Request("https://do/start", { method: "POST", body: JSON.stringify({
      casual: true, roundCode: "SHARE1", holes, liveScoringConfig: doublesConfig,
      players: [
        { memberId: "m_ann", name: "Ann", team: "Alpha", cardId: "c0" },
        { memberId: "m_bo", name: "Bo", team: "Alpha", cardId: "c0" },
        { memberId: "m_cy", name: "Cy", team: "Beta", cardId: "c0" },
        { memberId: "m_dee", name: "Dee", team: "Beta", cardId: "c0" },
      ],
    }) }));
    await memberScore(live, "m_ann", { targetId: "pair:alpha", hole: 1, strokes: 3 });
    await memberScore(live, "m_cy", { targetId: "pair:beta", hole: 1, strokes: 4 });
    await removeByAdmin(live, "m_bo"); // pair Alpha breaks, but Beta shares the SAME card c0

    expect((await memberScore(live, "m_cy", { targetId: "pair:beta", hole: 2, strokes: 4 })).status).toBe(200); // Beta keeps scoring
    const blocked = await memberScore(live, "m_ann", { targetId: "pair:alpha", hole: 2, strokes: 3 });
    expect(blocked.status).toBe(400);
    await expect(blocked.json()).resolves.toMatchObject({ error: "invalid_score_targets", code: "invalid_pair_size" });

    const snap = await snapshot(live);
    expect(snap.scoreTargetErrors.map((e) => e.code)).toEqual(["invalid_pair_size"]);
    expect(snap.standings?.map((s) => s.targetId)).toEqual(["pair:beta"]); // Beta ranks despite sharing c0 with broken Alpha
    expect((await mine(live, "m_cy")).scoreTargetError).toBeNull(); // healthy Beta member: no false warning
    expect((await mine(live, "m_ann")).scoreTargetError?.code).toBe("invalid_pair_size"); // broken Alpha survivor: their error
  });

  it("does not double-count a player whose pair spans two physical cards at finalize", async () => {
    const { database, inserts } = recordingDb();
    const live = new LiveEventDO(new FakeState({}), { DB: database });
    // Alpha's partners sit on DIFFERENT physical cards (cX/cY); Beta breaks on cY. The old card-keyed logic
    // put A2 in BOTH the healthy pass (via Alpha's target) AND the broken pass (via its own cY cardId).
    await live.fetch(new Request("https://do/start", { method: "POST", body: JSON.stringify({
      eventId: 22, holes, liveScoringConfig: doublesConfig,
      players: [
        { memberId: "m_a1", name: "A1", team: "Alpha", cardId: "cX" },
        { memberId: "m_a2", name: "A2", team: "Alpha", cardId: "cY" },
        { memberId: "m_b1", name: "B1", team: "Beta", cardId: "cY" },
        { memberId: "m_b2", name: "B2", team: "Beta", cardId: "cY" },
      ],
    }) }));
    for (const hole of [1, 2]) {
      await post(live, { "X-Auth-Admin": "true" }, { targetId: "pair:alpha", scorerIndex: 0, hole, strokes: 3 });
      await post(live, { "X-Auth-Admin": "true" }, { targetId: "pair:beta", scorerIndex: 2, hole, strokes: 4 });
    }
    await removeByAdmin(live, "m_b2"); // Beta breaks (B1 orphaned)

    const finalized = await adminForceFinalize(live);
    expect(finalized.status).toBe(200);
    const rows = inserts.filter((i) => /INSERT INTO results/i.test(i.sql));
    expect(rows.filter((i) => i.args[2] === "A2")).toHaveLength(1); // A2 persisted EXACTLY once (no double-count)
    const place = Object.fromEntries(rows.map((i) => [i.args[2] as string, i.args[3]]));
    expect(place["A1"]).toBe(1); // Alpha ranked
    expect(place["A2"]).toBe(1);
    expect(place["B1"]).toBeNull(); // orphaned Beta survivor: unranked stroke row
  });

  it("force-finalizes healthy cards in real format and the broken card as UNRANKED stroke rows (doubles-stroke)", async () => {
    const { database, inserts } = recordingDb();
    const live = new LiveEventDO(new FakeState({}), { DB: database });
    await startTwoCardDoubles(live);
    for (const hole of [1, 2]) {
      for (const [member, target, strokes] of [["m_ann", "pair:alpha", 3], ["m_bo", "pair:alpha", 3], ["m_cy", "pair:beta", 4], ["m_dee", "pair:beta", 4]] as const) {
        await memberScore(live, member, { targetId: target, hole, strokes });
      }
    }
    await removeByAdmin(live, "m_bo"); // Alpha broken

    // a non-admin cannot finalize past the broken card
    const denied = await live.fetch(new Request("https://do/finalize", { method: "POST", headers: { "X-Auth-Member": "m_cy" }, body: "{}" }));
    expect(denied.status).toBe(400);
    await expect(denied.json()).resolves.toMatchObject({ error: "invalid_score_targets", code: "invalid_pair_size" });

    const finalized = await adminForceFinalize(live);
    expect(finalized.status).toBe(200);
    await expect(finalized.json()).resolves.toMatchObject({ status: "final", forced: true });

    const rows = inserts.filter((i) => /INSERT INTO results/i.test(i.sql));
    const byName = Object.fromEntries(rows.map((i) => [i.args[2] as string, { place: i.args[3], group: i.args[9], match: i.args[10] }]));
    expect(JSON.parse(must(byName["Cy"]).group as string)).toMatchObject({ targetId: "pair:beta", label: "Beta" }); // healthy: real doubles format
    expect([must(byName["Cy"]).place, must(byName["Dee"]).place]).toEqual([1, 1]);
    expect(must(byName["Ann"]).place).toBeNull(); // broken survivor: UNRANKED stroke (kills the double place=1 + league double-count)
    expect(must(byName["Ann"]).group).toBeNull();
    expect(must(byName["Ann"]).match).toBeNull();
    expect(byName["Bo"]).toBeUndefined(); // removed player is not persisted
  });

  it("isolates a broken matchplay card and finalizes the healthy match while stroke-falling-back the broken one", async () => {
    const { database, inserts } = recordingDb();
    const live = new LiveEventDO(new FakeState({}), { DB: database });
    await startTwoCardMatchplay(live);
    for (const hole of [1, 2]) {
      for (const [member, target, strokes] of [
        ["m_a", "player:0", 3], ["m_b", "player:0", 3], ["m_a", "player:1", 4], ["m_b", "player:1", 4],
        ["m_c", "player:2", 3], ["m_d", "player:2", 3], ["m_c", "player:3", 5], ["m_d", "player:3", 5],
      ] as const) {
        await memberScore(live, member, { targetId: target, hole, strokes });
      }
    }
    await removeByAdmin(live, "m_b"); // card h1 drops to one target -> invalid_matchplay_targets

    expect((await memberScore(live, "m_c", { targetId: "player:2", hole: 2, strokes: 3 })).status).toBe(200); // healthy card scores
    const blocked = await memberScore(live, "m_a", { targetId: "player:0", hole: 2, strokes: 3 });
    expect(blocked.status).toBe(400);
    await expect(blocked.json()).resolves.toMatchObject({ error: "invalid_score_targets", code: "invalid_matchplay_targets" });

    const snap = await snapshot(live);
    expect(snap.scoreTargetErrors).toEqual([{ cardId: "h1", playerIndexes: [0], code: "invalid_matchplay_targets", message: expect.any(String) }]);
    expect(snap.standings?.map((s) => s.name).sort()).toEqual(["C", "D"]); // only the healthy match ranks

    const finalized = await adminForceFinalize(live);
    expect(finalized.status).toBe(200);
    const rows = inserts.filter((i) => /INSERT INTO results/i.test(i.sql));
    const byName = Object.fromEntries(rows.map((i) => [i.args[2] as string, { place: i.args[3], match: i.args[10] }]));
    expect(JSON.parse(must(byName["C"]).match as string).outcome).toBe("won"); // healthy match keeps its match_result
    expect(must(byName["C"]).place).toBe(1);
    expect(must(byName["D"]).place).toBe(2);
    expect(must(byName["A"]).place).toBeNull(); // broken survivor: unranked stroke, no match_result
    expect(must(byName["A"]).match).toBeNull();
  });

  it("withdrawing the remaining partner repairs the card (error clears)", async () => {
    const live = new LiveEventDO(new FakeState({}), { DB: db });
    await startTwoCardDoubles(live);
    await removeByAdmin(live, "m_bo");
    expect((await snapshot(live)).scoreTargetErrors).toHaveLength(1);
    await removeByAdmin(live, "m_ann"); // Alpha now has 0 active players -> no target, no error
    expect((await snapshot(live)).scoreTargetErrors).toHaveLength(0);
    expect((await memberScore(live, "m_cy", { targetId: "pair:beta", hole: 1, strokes: 4 })).status).toBe(200);
  });

  it("rejoining a removed partner reforms the pair and clears the block (casual, no WS resync)", async () => {
    const live = new LiveEventDO(new FakeState({}), { DB: db });
    await live.fetch(new Request("https://do/start", { method: "POST", body: JSON.stringify({
      casual: true, roundCode: "REJOIN1", holes, liveScoringConfig: doublesConfig,
      players: [{ memberId: "m_ann", name: "Ann", team: "Alpha" }, { memberId: "m_bo", name: "Bo", team: "Alpha" }],
    }) }));
    await live.fetch(new Request("https://do/remove", { method: "POST", headers: { "X-Auth-Member": "m_bo" }, body: JSON.stringify({ memberId: "m_bo" }) }));
    expect((await snapshot(live)).scoreTargetErrors).toHaveLength(1);
    const rejoined = await live.fetch(new Request("https://do/join", { method: "POST", headers: { "X-Auth-Member": "m_bo" }, body: JSON.stringify({ name: "Bo" }) }));
    expect(rejoined.status).toBe(200);
    expect((await snapshot(live)).scoreTargetErrors).toHaveLength(0); // pair reformed (team label retained on the tombstoned slot)
    expect((await memberScore(live, "m_ann", { targetId: "pair:alpha", hole: 1, strokes: 3 })).status).toBe(200);
  });
});

describe("LiveEventDO finalize atomicity (db.batch)", () => {
  // A D1 stub that records batch() calls (and can be made to fail) so we can assert finalize writes results
  // in ONE atomic transaction rather than row-by-row.
  function batchDb(opts: { failBatch?: boolean } = {}) {
    const calls = { batches: [] as string[][], runs: 0 };
    const statementSql = (statement: D1StatementLike) => {
      if ("sql" in statement && typeof statement.sql === "string") return statement.sql;
      throw new Error("test D1 statement missing sql");
    };
    const database = {
      prepare(sql: string) {
        const s = {
          sql,
          bind() { return s; },
          run: async () => { calls.runs++; return { results: [], success: true }; },
          all: async () => ({ results: [], success: true }),
          first: async <T = Record<string, unknown>>() => rowValue<T>(/casual_rounds/.test(sql) ? { id: 7 } : null),
        };
        return s;
      },
      batch: async (statements: D1StatementLike[]) => {
        calls.batches.push(statements.map(statementSql));
        if (opts.failBatch) throw new Error("d1_batch_boom");
        await Promise.all(statements.map((st) => st.run()));
        return statements.map(() => ({ results: [], success: true }));
      },
    };
    return { database, calls };
  }
  const startStroke = (live: LiveEventDO) =>
    live.fetch(new Request("https://do/start", { method: "POST", body: JSON.stringify({ eventId: 30, holes: [{ hole: 1, par: 3 }], players: [{ memberId: "m0", name: "A" }, { memberId: "m1", name: "B" }] }) }));
  const adminScore = (live: LiveEventDO, index: number, strokes: number) =>
    live.fetch(new Request("https://do/score", { method: "POST", headers: { "X-Auth-Admin": "true" }, body: JSON.stringify({ index, scorerIndex: index, hole: 1, strokes }) }));

  it("writes event results as ONE atomic batch (clear + all inserts), not row-by-row", async () => {
    const { database, calls } = batchDb();
    const live = new LiveEventDO(new FakeState({}), { DB: database });
    await startStroke(live);
    await adminScore(live, 0, 3);
    await adminScore(live, 1, 4);
    const r = await live.fetch(new Request("https://do/finalize", { method: "POST", headers: { "X-Auth-Admin": "true" }, body: JSON.stringify({ force: true }) }));
    expect(r.status).toBe(200);
    expect(calls.batches).toHaveLength(1); // a single transaction
    const sqls = must(calls.batches[0]);
    expect(sqls.filter((s) => /DELETE FROM results/.test(s))).toHaveLength(1);
    expect(sqls.filter((s) => /INSERT INTO results/.test(s))).toHaveLength(2);
  });

  it("leaves the round LIVE and writes no partial results when the finalize batch fails", async () => {
    const { database, calls } = batchDb({ failBatch: true });
    const state = new FakeState({});
    const live = new LiveEventDO(state, { DB: database });
    await startStroke(live);
    await adminScore(live, 0, 3);
    await adminScore(live, 1, 4);
    await expect(live.fetch(new Request("https://do/finalize", { method: "POST", headers: { "X-Auth-Admin": "true" }, body: JSON.stringify({ force: true }) }))).rejects.toThrow();
    expect(calls.runs).toBe(0); // no individual result INSERT ran (the batch is all-or-nothing)
    expect(state.getStored<{ status: string }>("meta")?.status).toBe("live"); // not marked final; can be retried
  });
});

describe("LiveEventDO UDisc export bridge", () => {
  it("persists each player's per-hole scorecard to the result row on admin-event finalize", async () => {
    const inserts: { sql: string; args: unknown[] }[] = [];
    const recDb = {
      prepare(sql: string) {
        const entry: { sql: string; args: unknown[] } = { sql, args: [] };
        return {
          bind(...args: unknown[]) {
            entry.args = args;
            if (/INSERT INTO results/i.test(sql)) inserts.push(entry);
            return this;
          },
          run: async () => ({ results: [], success: true }),
          first: async () => null,
          all: async () => ({ results: [], success: true }),
        };
      },
    };
    const live = new LiveEventDO(new FakeState({}), { DB: recDb });
    await live.fetch(new Request("https://do/start", { method: "POST", body: JSON.stringify({ eventId: 9, holes: [{ hole: 1, par: 3 }, { hole: 2, par: 4 }], players: [{ memberId: "m_jane", name: "Jane" }] }) }));
    const score = (hole: number, strokes: number) =>
      live.fetch(new Request("https://do/score", { method: "POST", headers: { "X-Auth-Admin": "true" }, body: JSON.stringify({ index: 0, scorerIndex: 0, hole, strokes }) }));
    await score(1, 3);
    await score(2, 5);

    const fin = await live.fetch(new Request("https://do/finalize", { method: "POST", headers: { "X-Auth-Admin": "true" } }));
    expect(fin.status).toBe(200);
    expect(inserts).toHaveLength(1);
    const scorecard = must(inserts[0]).args[8]; // 9th bind column = scorecard JSON
    expect(JSON.parse(scorecard as string)).toEqual([
      { hole: 1, par: 3, strokes: 3 },
      { hole: 2, par: 4, strokes: 5 },
    ]);
  });

  it("carries the UDisc course id from start into the snapshot and /mine (casual export source)", async () => {
    const live = new LiveEventDO(new FakeState({}), { DB: db });
    await live.fetch(new Request("https://do/start", { method: "POST", body: JSON.stringify({ casual: true, udiscCourseId: "98765", holes: [{ hole: 1, par: 3 }], players: [{ memberId: "m_a", name: "A" }] }) }));
    const snap = (await (await live.fetch(new Request("https://do/"))).json()) as { udiscCourseId: string | null };
    expect(snap.udiscCourseId).toBe("98765");
    const mine = (await (await live.fetch(new Request("https://do/mine", { headers: { "X-Auth-Member": "m_a" } }))).json()) as { udiscCourseId: string | null };
    expect(mine.udiscCourseId).toBe("98765");
  });
});
