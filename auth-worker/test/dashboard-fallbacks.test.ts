import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index.js";
import { signSession } from "../src/jwt.js";
import { retryableD1LossDb } from "./d1-test-utils.js";

const SECRET = "x".repeat(40);
const MEMBER = JSON.stringify({ memberId: "m_jane", name: "Jane", isAdmin: false, pinHash: "x", mustChangePin: false, pdgaNo: "90000001" });

function kv(initial: Record<string, string> = {}) {
  const rows = new Map(Object.entries(initial));
  return {
    get: async (key: string) => rows.get(key) ?? null,
    put: async (key: string, value: string) => void rows.set(key, value),
    delete: async (key: string) => void rows.delete(key),
  };
}

function env() {
  return {
    ROSTER: kv({ "member:m_jane": MEMBER }),
    RATELIMIT: kv(),
    DB: retryableD1LossDb(),
    JWT_SECRET: SECRET,
    ALLOWED_ORIGINS: "http://localhost:8080",
    LIVE: undefined,
  } as unknown as Parameters<typeof worker.fetch>[1];
}

async function token() {
  return signSession({ sub: "m_jane", mustChangePin: false }, SECRET, 900);
}

async function get(path: string, jwt?: string) {
  const headers: Record<string, string> = { Origin: "http://localhost:8080" };
  if (jwt) headers.authorization = "Bearer " + jwt;
  return worker.fetch(new Request("https://w" + path, { headers }), env());
}

describe("dashboard D1 fallback reads", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fails open for member dashboard list endpoints when D1 is transiently unavailable", async () => {
    const jwt = await token();

    await expect((await get("/my-results", jwt)).json()).resolves.toEqual({ results: [] });
    await expect((await get("/my-ratings?competitiveLimit=250&casualLimit=250", jwt)).json()).resolves.toEqual({
      competitive: { live_rating: null, rated_rounds: 0, rounds_count: 0, rounds: [] },
      casual: { live_rating: null, rated_rounds: 0, rounds_count: 0, rounds: [] },
    });
    await expect((await get("/my-live-rounds", jwt)).json()).resolves.toEqual({ rounds: [] });
    await expect((await get("/board", jwt)).json()).resolves.toEqual({ posts: [], authors: {} });
  });

  it("fails open for public dashboard support endpoints when D1 is transiently unavailable", async () => {
    await expect((await get("/meetings")).json()).resolves.toEqual({ meetings: [] });
    await expect((await get("/leagues/active")).json()).resolves.toEqual({ leagues: [], liveEvents: [] });
  });

  it("returns the seeded staging QA PDGA stats when D1 and pdga.com are unavailable", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("pdga unavailable"));

    const res = await get("/pdga-stats?pdga=90000001");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      pdga: "90000001",
      name: "GVDG QA Dashboard",
      official_rating: 935,
      live_rating: 941,
      peak_rating: 958,
      events_count: 3,
    });
  });
});
