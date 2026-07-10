import { describe, expect, it } from "vitest";
import worker from "../src/index.js";
import type { D1Like, D1ResultLike, D1StatementLike } from "../src/db.js";
import { signSession } from "../src/jwt.js";
import { retryableD1LossDb } from "./d1-test-utils.js";

const SECRET = "x".repeat(40);
const PLAYER_SEP = "\u001f";
const members = {
  "member:m_owner": JSON.stringify({ memberId: "m_owner", name: "Owner", isAdmin: false, pinHash: "x", mustChangePin: false }),
  "member:m_jane": JSON.stringify({ memberId: "m_jane", name: "Jane", isAdmin: false, pinHash: "x", mustChangePin: false }),
  "member:m_admin": JSON.stringify({ memberId: "m_admin", name: "Admin", isAdmin: true, pinHash: "x", mustChangePin: false }),
};

type RequestState = {
  id: number;
  course_id: number;
  layout_id: number;
  created_by: string;
  created_by_name: string;
  starts_at: string;
  notes: string | null;
  status: "open" | "closed" | "cancelled";
  round_code: string | null;
  created_at: string;
  updated_at: string;
};
type CommitmentState = { request_id: number; member_id: string; member_name: string };
type State = { nextId: number; requests: RequestState[]; commitments: CommitmentState[] };

function future(): string {
  return new Date(Date.now() + 60 * 60 * 1000).toISOString();
}

function kv(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return {
    get: async (k: string) => m.get(k) ?? null,
    put: async (k: string, v: string) => void m.set(k, v),
    delete: async (k: string) => void m.delete(k),
  };
}

function seedState(): State {
  return {
    nextId: 2,
    requests: [
      {
        id: 1,
        course_id: 1,
        layout_id: 10,
        created_by: "m_owner",
        created_by_name: "Owner",
        starts_at: future(),
        notes: "Glow round",
        status: "open",
        round_code: null,
        created_at: "2026-06-30T12:00:00.000Z",
        updated_at: "2026-06-30T12:00:00.000Z",
      },
    ],
    commitments: [{ request_id: 1, member_id: "m_owner", member_name: "Owner" }],
  };
}

function requestRow(state: State, request: RequestState, viewer: string): Record<string, unknown> {
  const players = state.commitments.filter((c) => c.request_id === request.id);
  return {
    ...request,
    course_name: "West Meadowbrook",
    course_location: "Greenville, NC",
    layout_name: "Long tees",
    player_count: players.length,
    player_names: players.map((p) => p.member_name).join(PLAYER_SEP),
    committed: players.some((p) => p.member_id === viewer) ? 1 : 0,
  };
}

function selectRequests(state: State, vals: unknown[]): Record<string, unknown>[] {
  const viewer = String(vals[0] ?? "");
  const maybeId = typeof vals[1] === "number" ? vals[1] : null;
  return state.requests
    .filter((r) => (maybeId == null ? r.status === "open" : r.id === maybeId))
    .map((r) => requestRow(state, r, viewer));
}

class Statement implements D1StatementLike {
  private vals: unknown[] = [];

  constructor(private readonly state: State, private readonly sql: string) {}

  bind(...vals: unknown[]): D1StatementLike {
    this.vals = vals;
    return this;
  }

  async all<T = Record<string, unknown>>(): Promise<D1ResultLike<T>> {
    if (/FROM casual_round_requests r/i.test(this.sql)) return { results: selectRequests(this.state, this.vals) as T[], success: true };
    return { results: [], success: true };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    if (/SELECT \* FROM courses WHERE id = \?/i.test(this.sql)) {
      return this.vals[0] === 1 ? ({ id: 1, name: "West Meadowbrook" } as T) : null;
    }
    if (/SELECT \* FROM course_layouts WHERE id = \?/i.test(this.sql)) {
      return this.vals[0] === 10 ? ({ id: 10, course_id: 1, name: "Long tees" } as T) : null;
    }
    if (/INSERT INTO casual_round_requests/i.test(this.sql)) {
      const id = this.state.nextId++;
      const now = new Date().toISOString();
      this.state.requests.push({
        id,
        course_id: Number(this.vals[0]),
        layout_id: Number(this.vals[1]),
        created_by: String(this.vals[2]),
        created_by_name: String(this.vals[3]),
        starts_at: String(this.vals[4]),
        notes: typeof this.vals[5] === "string" ? this.vals[5] : null,
        status: "open",
        round_code: null,
        created_at: now,
        updated_at: now,
      });
      return { id } as T;
    }
    if (/FROM casual_round_requests r/i.test(this.sql)) {
      return (selectRequests(this.state, this.vals)[0] as T | undefined) ?? null;
    }
    return null;
  }

  async run(): Promise<D1ResultLike> {
    if (/INSERT INTO casual_round_commitments/i.test(this.sql)) {
      const requestId = Number(this.vals[0]);
      const memberId = String(this.vals[1]);
      const name = String(this.vals[2]);
      const existing = this.state.commitments.find((c) => c.request_id === requestId && c.member_id === memberId);
      if (existing) existing.member_name = name;
      else this.state.commitments.push({ request_id: requestId, member_id: memberId, member_name: name });
    }
    if (/DELETE FROM casual_round_commitments/i.test(this.sql)) {
      const requestId = Number(this.vals[0]);
      const memberId = String(this.vals[1]);
      this.state.commitments = this.state.commitments.filter((c) => c.request_id !== requestId || c.member_id !== memberId);
    }
    if (/UPDATE casual_round_requests SET status = 'closed'/i.test(this.sql)) {
      const requestId = Number(this.vals[0]);
      const found = this.state.requests.find((r) => r.id === requestId);
      if (found) found.status = "closed";
    }
    return { results: [], success: true };
  }
}

function mockDb(state: State): D1Like {
  return { prepare: (sql: string) => new Statement(state, sql) };
}

function makeEnv(state = seedState(), db: D1Like = mockDb(state)) {
  return {
    ROSTER: kv(members),
    RATELIMIT: kv(),
    DB: db,
    JWT_SECRET: SECRET,
    ALLOWED_ORIGINS: "http://localhost:8080",
    LIVE: undefined,
  } as unknown as Parameters<typeof worker.fetch>[1];
}

const tok = (sub: string) => signSession({ sub, mustChangePin: false }, SECRET, 900);

async function call(path: string, method = "GET", token?: string, body?: unknown, state = seedState()) {
  const headers: Record<string, string> = { Origin: "http://localhost:8080" };
  if (token) headers.authorization = "Bearer " + token;
  if (body) headers["content-type"] = "application/json";
  return worker.fetch(new Request("https://w" + path, { method, headers, body: body ? JSON.stringify(body) : undefined }), makeEnv(state));
}

describe("casual round requests", () => {
  it("lists open requests publicly", async () => {
    const res = await call("/casual-rounds");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { requests: { course_name: string; player_count: number }[] };
    expect(body.requests).toHaveLength(1);
    expect(body.requests[0]).toMatchObject({ course_name: "West Meadowbrook", player_count: 1 });
  });

  it("returns an empty request list when the public D1 read is transiently unavailable", async () => {
    const res = await worker.fetch(new Request("https://w/casual-rounds", { headers: { Origin: "http://localhost:8080" } }), makeEnv(seedState(), retryableD1LossDb()));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ requests: [] });
  });

  it("requires a member to post a request", async () => {
    const res = await call("/casual-rounds", "POST", undefined, { course_id: 1, layout_id: 10, starts_at: future() });
    expect(res.status).toBe(401);
  });

  it("creates a request and commits the posting member", async () => {
    const state = seedState();
    const res = await call("/casual-rounds", "POST", await tok("m_jane"), { course_id: 1, layout_id: 10, starts_at: future(), notes: "After work" }, state);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { request: { created_by_name: string; committed: boolean; players: string[] } };
    expect(body.request).toMatchObject({ created_by_name: "Jane", committed: true });
    expect(body.request.players).toEqual(["Jane"]);
  });

  it("lets members join and leave a request", async () => {
    const state = seedState();
    const token = await tok("m_jane");
    const joined = await call("/casual-rounds/1/join", "POST", token, {}, state);
    expect(joined.status).toBe(200);
    expect((await joined.json()) as Record<string, unknown>).toMatchObject({ request: { committed: true, player_count: 2 } });

    const left = await call("/casual-rounds/1/join", "DELETE", token, undefined, state);
    expect(left.status).toBe(200);
    expect((await left.json()) as Record<string, unknown>).toMatchObject({ request: { committed: false, player_count: 1 } });
  });

  it("only the poster or an admin can close a request", async () => {
    const state = seedState();
    expect((await call("/casual-rounds/1", "DELETE", await tok("m_jane"), undefined, state)).status).toBe(403);
    expect((await call("/casual-rounds/1", "DELETE", await tok("m_owner"), undefined, state)).status).toBe(200);
    const body = (await (await call("/casual-rounds", "GET", undefined, undefined, state)).json()) as { requests: unknown[] };
    expect(body.requests).toHaveLength(0);
  });
});
