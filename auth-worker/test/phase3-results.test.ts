import { describe, it, expect } from "vitest";
import worker from "../src/index.js";
import { signSession } from "../src/jwt.js";
import { arrayField, jsonObject } from "./json.js";

const SECRET = "x".repeat(40);
const MEMBER = JSON.stringify({ memberId: "m_jane", name: "Jane", isAdmin: false, pinHash: "x", mustChangePin: false });
const ROWS = [{ id: 1, event_id: 5, member_id: "m_jane", name: "Jane", place: 1, total: 54, to_par: -3, breakdown: '{"birdies":4}', event_name: "Fall Open", event_date: "2026-09-20" }];

function kv(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => void m.set(k, v), delete: async (k: string) => void m.delete(k) };
}
const db = { prepare: () => ({ bind() { return this; }, all: async () => ({ results: ROWS, success: true }), first: async () => null, run: async () => ({ results: [], success: true }) }) };
const env = () => ({ ROSTER: kv({ "member:m_jane": MEMBER }), RATELIMIT: kv(), DB: db, JWT_SECRET: SECRET, ALLOWED_ORIGINS: "http://localhost:8080", LIVE: undefined } as unknown as Parameters<typeof worker.fetch>[1]);
const get = async (path: string, token?: string) => {
  const h: Record<string, string> = { Origin: "http://localhost:8080" };
  if (token) h.authorization = "Bearer " + token;
  return worker.fetch(new Request("https://w" + path, { headers: h }), env());
};

describe("Phase 3 result routes", () => {
  it("GET /my-results requires auth (401 without a token)", async () => {
    expect((await get("/my-results")).status).toBe(401);
  });
  it("GET /my-results returns the member's event history", async () => {
    const token = await signSession({ sub: "m_jane", mustChangePin: false }, SECRET, 900);
    const res = await get("/my-results", token);
    expect(res.status).toBe(200);
    const j = await jsonObject(res);
    expect(arrayField(j, "results")[0]).toMatchObject({ event_name: "Fall Open", place: 1, to_par: -3 });
  });
  it("GET /events/:id/results is public (club archive)", async () => {
    const res = await get("/events/5/results");
    expect(res.status).toBe(200);
    expect(arrayField(await jsonObject(res), "results").length).toBe(1);
  });
});
