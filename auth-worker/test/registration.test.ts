import { describe, it, expect } from "vitest";
import worker from "../src/index.js";
import { signSession } from "../src/jwt.js";
import { retryableD1LossDb } from "./d1-test-utils.js";

const SECRET = "x".repeat(40);
const members = {
  "member:m_jane": JSON.stringify({ memberId: "m_jane", name: "Jane", isAdmin: false, pinHash: "x", mustChangePin: false }),
  "member:m_admin": JSON.stringify({ memberId: "m_admin", name: "Admin", isAdmin: true, pinHash: "x", mustChangePin: false }),
};
function kv(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => void m.set(k, v), delete: async (k: string) => void m.delete(k) };
}
// SQL-aware mock parameterized by the event config + event status it returns.
function mockDb(cfg: Record<string, unknown> | null, status = "scheduled") {
  return { prepare: (sql: string) => {
    let binds: unknown[] = [];
    return ({
    bind(...values: unknown[]) { binds = values; return this; },
    all: async () => {
      // /my-registrations now joins the event onto each registration row.
      if (/FROM registrations r/i.test(sql) && /event_name/i.test(sql)) {
        return {
          results: [
            { id: 1, event_id: 5, member_id: "m_jane", division: "MA1", checked_in: 0, paid_entry: 0,
              event_name: "Saturday Doubles", event_date: "2026-07-04", event_status: "scheduled",
              event_type: "league_round", course_name: "River Park North", layout_name: "Blue" },
          ],
          success: true,
        };
      }
      return { results: [], success: true };
    },
    first: async () => {
      if (/SELECT status FROM events/i.test(sql)) return { status }; // getEventStatus
      if (/INSERT INTO event_config/i.test(sql) || /FROM event_config/i.test(sql)) return cfg;
      if (/FROM registrations WHERE id/i.test(sql)) return { id: 1, member_id: "m_jane" };
      if (/INSERT INTO registrations/i.test(sql)) return { id: 1, division: binds[3] ?? null, team: binds[4] ?? null };
      if (/UPDATE registrations SET checked_in/i.test(sql)) return { id: 1, checked_in: 1 };
      if (/UPDATE registrations/i.test(sql)) return { id: 1 };
      return null; // getMyRegistration -> not registered
    },
    run: async () => ({ results: [], success: true }),
  }); } };
}
const env = (cfg: Record<string, unknown> | null, status = "scheduled", db: unknown = mockDb(cfg, status)) => ({ ROSTER: kv(members), RATELIMIT: kv(), DB: db, JWT_SECRET: SECRET, ALLOWED_ORIGINS: "http://localhost:8080", LIVE: undefined } as unknown as Parameters<typeof worker.fetch>[1]);
const tok = (sub: string) => signSession({ sub, mustChangePin: false }, SECRET, 900);
async function call(path: string, method: string, token: string | undefined, body: unknown, cfg: Record<string, unknown> | null, status = "scheduled", db?: unknown) {
  const h: Record<string, string> = { Origin: "http://localhost:8080" };
  if (token) h.authorization = "Bearer " + token;
  if (body) h["content-type"] = "application/json";
  return worker.fetch(new Request("https://w" + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined }), env(cfg, status, db));
}
const OPEN = { registration_open: 1, divisions: '["MA1","MA40"]' };
const CLOSED = { registration_open: 0, divisions: null };

describe("Track G — event registration", () => {
  it("a guest registration needs a name (400), then succeeds (201) with a returned guest token", async () => {
    expect((await call("/events/5/register", "POST", undefined, { division: "MA1" }, OPEN)).status).toBe(400); // no name
    const res = await call("/events/5/register", "POST", undefined, { division: "MA1", name: "Pat Guest", email: "pat@example.com" }, OPEN);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { guestToken?: string };
    expect(typeof body.guestToken).toBe("string");
    expect((body.guestToken || "").length).toBeGreaterThan(8);
  });
  it("a guest can check in and withdraw with their token; members do not need one", async () => {
    expect((await call("/events/5/checkin", "POST", undefined, { guestToken: "abc123" }, OPEN)).status).toBe(200);
    expect((await call("/events/5/register?gt=abc123", "DELETE", undefined, null, OPEN)).status).toBe(200);
    expect((await call("/events/5/checkin", "POST", undefined, {}, OPEN)).status).toBe(401); // no member, no token
  });
  it("paying entry online still requires a member (guests pay at the event)", async () => {
    expect((await call("/events/5/pay/create-order", "POST", undefined, {}, OPEN)).status).toBe(401);
  });
  it("rejects registration when closed (403)", async () => {
    expect((await call("/events/5/register", "POST", await tok("m_jane"), {}, CLOSED)).status).toBe(403);
  });
  it("lets a member register when open (201)", async () => {
    expect((await call("/events/5/register", "POST", await tok("m_jane"), { division: "MA1" }, OPEN)).status).toBe(201);
  });
  it("stores a doubles pair label in the existing team field", async () => {
    const res = await call("/events/5/register", "POST", await tok("m_jane"), { division: "MA1", team: "Pair Alpha" }, OPEN);
    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({ registration: { team: "Pair Alpha" } });
  });
  it("rejects a division not in the event config (400)", async () => {
    expect((await call("/events/5/register", "POST", await tok("m_jane"), { division: "NOPE" }, OPEN)).status).toBe(400);
  });
  it("rejects registration for a cancelled/finalized event even if registration_open lingers (403)", async () => {
    expect((await call("/events/5/register", "POST", await tok("m_jane"), { division: "MA1" }, OPEN, "cancelled")).status).toBe(403);
    expect((await call("/events/5/register", "POST", await tok("m_jane"), { division: "MA1" }, OPEN, "final")).status).toBe(403);
  });
  it("lets a member check in (200)", async () => {
    expect((await call("/events/5/checkin", "POST", await tok("m_jane"), {}, OPEN)).status).toBe(200);
  });
  it("blocks self-withdraw once the event is live or final, but allows it while scheduled", async () => {
    expect((await call("/events/5/register", "DELETE", await tok("m_jane"), null, OPEN, "live")).status).toBe(409);
    expect((await call("/events/5/register", "DELETE", await tok("m_jane"), null, OPEN, "final")).status).toBe(409);
    expect((await call("/events/5/register", "DELETE", await tok("m_jane"), null, OPEN, "scheduled")).status).toBe(200);
  });
  it("GET /my-registrations is authed (401 without token, 200 with)", async () => {
    expect((await call("/my-registrations", "GET", undefined, undefined, OPEN)).status).toBe(401);
    expect((await call("/my-registrations", "GET", await tok("m_jane"), undefined, OPEN)).status).toBe(200);
  });
  it("GET /my-registrations carries joined event details for the dashboard", async () => {
    const res = await call("/my-registrations", "GET", await tok("m_jane"), undefined, OPEN);
    const body = (await res.json()) as { registrations: Array<Record<string, unknown>> };
    expect(body.registrations[0]).toMatchObject({ event_id: 5, event_name: "Saturday Doubles", event_status: "scheduled", course_name: "River Park North" });
  });
  it("GET /my-registrations returns an empty list when the dashboard D1 read is transiently unavailable", async () => {
    const res = await call("/my-registrations", "GET", await tok("m_jane"), undefined, OPEN, "scheduled", retryableD1LossDb());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ registrations: [] });
  });
  it("GET /registration/open returns an empty list when the public D1 read is transiently unavailable", async () => {
    const res = await call("/registration/open", "GET", undefined, undefined, OPEN, "scheduled", retryableD1LossDb());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ events: [] });
  });
  it("admin can set event config + read the roster; non-admin cannot", async () => {
    expect((await call("/admin/events/5/config", "PUT", await tok("m_jane"), { registration_open: true }, OPEN)).status).toBe(403);
    expect((await call("/admin/events/5/config", "PUT", await tok("m_admin"), { registration_open: true, divisions: ["MA1"], entry_fee_cents: 1000 }, OPEN)).status).toBe(200);
    expect((await call("/admin/events/5/registrations", "GET", await tok("m_admin"), undefined, OPEN)).status).toBe(200);
    expect((await call("/admin/events/5/registrations/1", "PATCH", await tok("m_admin"), { checked_in: true, starting_hole: 7 }, OPEN)).status).toBe(200);
  });
});
