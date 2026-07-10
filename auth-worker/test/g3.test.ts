import { describe, it, expect } from "vitest";
import worker from "../src/index.js";
import { signSession } from "../src/jwt.js";
import { jsonObject, objectField } from "./json.js";

const SECRET = "x".repeat(40);
const members = {
  "member:m_jane": JSON.stringify({ memberId: "m_jane", name: "Jane", isAdmin: false, pinHash: "x", mustChangePin: false }),
  "member:m_admin": JSON.stringify({ memberId: "m_admin", name: "Admin", isAdmin: true, pinHash: "x", mustChangePin: false }),
};
function kv(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => void m.set(k, v), delete: async (k: string) => void m.delete(k) };
}
const db = { prepare: (sql: string) => ({
  bind() { return this; },
  all: async () => {
    if (/FROM registrations/i.test(sql)) return { results: [{ id: 1, name: "A" }, { id: 2, name: "B" }], success: true };
    if (/FROM ctps/i.test(sql)) return { results: [{ id: 1, hole: 7, prize: "disc" }], success: true };
    if (/FROM wallet_transactions WHERE event_id/i.test(sql)) return { results: [{ id: 2, event_id: 5, source: "event_payout", amount_cents: 1200 }], success: true };
    return { results: [], success: true };
  },
  first: async () => {
    if (/COUNT\(\*\) AS n/i.test(sql)) return { n: 2 };
    if (/SELECT COALESCE\(SUM\(amount_cents\)/i.test(sql)) return { balance_cents: 1200 };
    if (/INSERT INTO ctps/i.test(sql)) return { id: 1, hole: 7 };
    if (/UPDATE ctps/i.test(sql)) return { id: 1, hole: 7, winner_member_id: "m_jane", winner_name: "Jane" };
    if (/INSERT INTO wallet_transactions/i.test(sql)) return { id: 2, member_id: "m_jane", amount_cents: 1200, source: "event_payout", event_id: 5 };
    if (/ace_pots/i.test(sql)) return { event_id: 5, carryover_in_cents: 1000, status: "active" };
    if (/FROM event_config/i.test(sql)) return { ace_fee_cents: 300 };
    if (/FROM events WHERE id/i.test(sql)) return { id: 5, layout_id: null };
    if (/UPDATE events/i.test(sql)) return { id: 5, type: "fundraiser", name: "Edited event", status: "scheduled", format: null, date: null, course_id: null, league_id: null, notes: null };
    if (/UPDATE registrations/i.test(sql)) return { id: 1 };
    return null;
  },
  run: async () => ({ results: [], success: true }),
}) };
const env = () => ({ ROSTER: kv(members), RATELIMIT: kv(), DB: db, JWT_SECRET: SECRET, ALLOWED_ORIGINS: "http://localhost:8080", LIVE: undefined } as unknown as Parameters<typeof worker.fetch>[1]);
const tok = (sub: string) => signSession({ sub, mustChangePin: false }, SECRET, 900);
async function call(path: string, method = "GET", token?: string, body?: unknown) {
  const h: Record<string, string> = { Origin: "http://localhost:8080" };
  if (token) h.authorization = "Bearer " + token;
  if (body) h["content-type"] = "application/json";
  return worker.fetch(new Request("https://w" + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined }), env());
}

describe("Track G G3 — CTPs, ace pots, assignment", () => {
  it("admin adds a CTP (needs a hole); non-admin is blocked", async () => {
    expect((await call("/admin/events/5/ctps", "POST", await tok("m_jane"), { hole: 7 })).status).toBe(403);
    expect((await call("/admin/events/5/ctps", "POST", await tok("m_admin"), { hole: 7, prize: "Disc", division: "MA1" })).status).toBe(201);
    expect((await call("/admin/events/5/ctps", "POST", await tok("m_admin"), { prize: "no hole" })).status).toBe(400);
  });
  it("CTPs are public; admin sets a winner", async () => {
    expect((await call("/events/5/ctps")).status).toBe(200);
    expect((await call("/admin/events/5/ctps/1", "PATCH", await tok("m_admin"), { winner_name: "A", winner_member_id: "m_a" })).status).toBe(200);
  });
  it("admin awards store credit for a CTP without hitting a not-found route", async () => {
    const res = await call("/admin/events/5/ctps/1/store-credit", "POST", await tok("m_admin"), { member_id: "m_jane", amount_cents: 1200, winner_name: "Jane" });
    expect(res.status).toBe(201);
    const body = await jsonObject(res);
    expect(objectField(body, "ctp").winner_member_id).toBe("m_jane");
    expect(objectField(body, "transaction").source).toBe("event_payout");
    expect(body.balance_cents).toBe(1200);
  });
  it("ace pot: admin sets carryover; public total = carryover + paid contributors * fee", async () => {
    expect((await call("/admin/events/5/ace-pot", "PUT", await tok("m_admin"), { carryover_in_cents: 1000 })).status).toBe(200);
    const pot = objectField(await jsonObject(await call("/events/5/ace-pot")), "ace_pot");
    expect(pot.total_cents).toBe(1600); // 1000 + 2 contributors * 300
    expect(pot.contributors).toBe(2);
  });
  it("admin assigns shotgun starting holes + teams", async () => {
    expect((await call("/admin/events/5/assign-starting-holes", "POST", await tok("m_admin"), { groupSize: 4, holeCount: 18 })).status).toBe(200);
    expect((await call("/admin/events/5/assign-teams", "POST", await tok("m_admin"), { size: 2 })).status).toBe(200);
    expect((await call("/admin/events/5/assign-teams", "POST", await tok("m_jane"), { size: 2 })).status).toBe(403);
  });
  it("admin edits an event type and can clear optional fields", async () => {
    const edited = await call("/admin/events/5", "PATCH", await tok("m_admin"), { type: "fundraiser", name: "Edited event", format: null, date: null, course_id: null, league_id: null, notes: null });
    expect(edited.status).toBe(200);
    const event = objectField(await jsonObject(edited), "event");
    expect(event.type).toBe("fundraiser");
    expect((await call("/admin/events/5", "PATCH", await tok("m_admin"), { type: "side_quest" })).status).toBe(400);
  });
});
