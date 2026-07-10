import { describe, expect, it } from "vitest";
import worker from "../src/index.js";
import type { Env } from "../src/index.js";
import type { KVLike } from "../src/ratelimit.js";

const ORIGIN = "https://www.greenvillediscgolf.com";

function kv(): KVLike {
  const store = new Map<string, string>();
  return {
    get: async (key) => store.get(key) ?? null,
    put: async (key, value) => void store.set(key, value),
    delete: async (key) => void store.delete(key),
  };
}

function db(): Env["DB"] {
  const stmt = {
    bind: () => stmt,
    all: async () => ({ results: [], success: true }),
    first: async () => null,
    run: async () => ({ results: [], success: true }),
  };
  return { prepare: () => stmt } as unknown as Env["DB"];
}

function env(): Env {
  return {
    ROSTER: kv() as unknown as Env["ROSTER"],
    RATELIMIT: kv() as unknown as Env["RATELIMIT"],
    DB: db(),
    JWT_SECRET: "unit-test-secret-at-least-32-bytes-long!!",
    ALLOWED_ORIGINS: ORIGIN,
    RP_ID: "greenvillediscgolf.com",
    EXPECTED_ORIGIN: ORIGIN,
    LIVE: undefined as unknown as Env["LIVE"],
    PHOTOS: undefined as unknown as Env["PHOTOS"],
  } as unknown as Env;
}

function request(): Request {
  return new Request("https://auth.example/webauthn/auth/options", {
    method: "POST",
    headers: { Origin: ORIGIN, "CF-Connecting-IP": "203.0.113.20" },
  });
}

describe("POST /webauthn/auth/options", () => {
  it("rate-limits repeated challenge creation from one client IP", async () => {
    const testEnv = env();
    let status = 200;
    for (let i = 0; i < 25; i++) {
      status = (await worker.fetch(request(), testEnv)).status;
      if (status === 429) break;
    }
    expect(status).toBe(429);
  });
});
