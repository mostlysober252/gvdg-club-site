import { describe, it, expect } from "vitest";
import worker from "../src/index.js";
import { signSession } from "../src/jwt.js";

const SECRET = "x".repeat(40);
const ADMIN = JSON.stringify({ memberId: "m_admin", name: "Admin", isAdmin: true, pinHash: "x", mustChangePin: false });
function kv(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => void m.set(k, v), delete: async (k: string) => void m.delete(k) };
}
const db = { prepare: () => ({ bind() { return this; }, all: async () => ({ results: [{ id: 1, title: "Test" }], success: true }), first: async () => ({ id: 1, title: "Test" }), run: async () => ({ results: [], success: true }) }) };
const env = () => ({ ROSTER: kv({ "member:m_admin": ADMIN }), RATELIMIT: kv(), DB: db, JWT_SECRET: SECRET, ALLOWED_ORIGINS: "http://localhost:8080", LIVE: undefined } as unknown as Parameters<typeof worker.fetch>[1]);
const tok = () => signSession({ sub: "m_admin", mustChangePin: false }, SECRET, 900);
async function req(path: string, method = "GET", body?: unknown, token?: string) {
  const h: Record<string, string> = { Origin: "http://localhost:8080" };
  if (token) h.authorization = "Bearer " + token;
  if (body) h["content-type"] = "application/json";
  return worker.fetch(new Request("https://w" + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined }), env());
}

describe("Phase 4 fundraisers + meetings routes", () => {
  it("GET /fundraisers and /meetings are public", async () => {
    expect((await req("/fundraisers")).status).toBe(200);
    expect((await req("/meetings")).status).toBe(200);
  });
  it("POST /admin/fundraisers requires admin + a title", async () => {
    expect((await req("/admin/fundraisers", "POST", { title: "Disc drive" })).status).toBe(401); // no token
    expect((await req("/admin/fundraisers", "POST", { title: "Disc drive" }, await tok())).status).toBe(201);
    expect((await req("/admin/fundraisers", "POST", { body_md: "no title" }, await tok())).status).toBe(400);
    expect((await req("/admin/fundraisers", "POST", { title: "x", status: "bogus" }, await tok())).status).toBe(400);
  });
  it("POST /admin/meetings requires date + title", async () => {
    expect((await req("/admin/meetings", "POST", { date: "2026-07-01", title: "July mtg", action_items: ["buy discs"] }, await tok())).status).toBe(201);
    expect((await req("/admin/meetings", "POST", { title: "no date" }, await tok())).status).toBe(400);
  });
  it("rejects a non-https paypal_url on a fundraiser", async () => {
    expect((await req("/admin/fundraisers", "POST", { title: "x", paypal_url: "http://evil" }, await tok())).status).toBe(400);
  });
});
