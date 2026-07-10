import { describe, expect, it } from "vitest";
import worker from "../src/index.js";
import { signSession } from "../src/jwt.js";
import { arrayField, jsonObject } from "./json.js";

const SECRET = "x".repeat(40);
const MEMBER = JSON.stringify({ memberId: "m_jane", name: "Jane", isAdmin: false, pinHash: "x", mustChangePin: false });
const LIVE_ROWS = [
  {
    id: 7,
    name: "Tuesday League",
    type: "league_round",
    date: "2026-07-07",
    status: "live",
    course_name: "West Meadowbrook",
    layout_name: "Longs",
    division: "MA1",
  },
];

function kv(initial: Record<string, string> = {}) {
  const rows = new Map(Object.entries(initial));
  return {
    get: async (key: string) => rows.get(key) ?? null,
    put: async (key: string, value: string) => void rows.set(key, value),
    delete: async (key: string) => void rows.delete(key),
  };
}

function db() {
  return {
    prepare: (sql: string) => {
      let bound: unknown[] = [];
      return {
        bind(...vals: unknown[]) {
          bound = vals;
          return this;
        },
        all: async () => {
          if (/WITH member_events/i.test(sql)) {
            expect(bound).toEqual(["m_jane", "m_jane"]);
            return { results: LIVE_ROWS, success: true };
          }
          return { results: [], success: true };
        },
        first: async () => null,
        run: async () => ({ results: [], success: true }),
      };
    },
  };
}

function env() {
  return {
    ROSTER: kv({ "member:m_jane": MEMBER }),
    RATELIMIT: kv(),
    DB: db(),
    JWT_SECRET: SECRET,
    ALLOWED_ORIGINS: "http://localhost:8080",
    LIVE: undefined,
  } as unknown as Parameters<typeof worker.fetch>[1];
}

async function get(path: string, token?: string) {
  const headers: Record<string, string> = { Origin: "http://localhost:8080" };
  if (token) headers.authorization = "Bearer " + token;
  return worker.fetch(new Request("https://w" + path, { headers }), env());
}

describe("member live rounds", () => {
  it("requires auth", async () => {
    expect((await get("/my-live-rounds")).status).toBe(401);
  });

  it("returns the member's active club rounds", async () => {
    const token = await signSession({ sub: "m_jane", mustChangePin: false }, SECRET, 900);
    const res = await get("/my-live-rounds", token);
    expect(res.status).toBe(200);
    const rounds = arrayField(await jsonObject(res), "rounds");
    expect(rounds[0]).toMatchObject({ id: 7, name: "Tuesday League", status: "live", layout_name: "Longs" });
  });
});
