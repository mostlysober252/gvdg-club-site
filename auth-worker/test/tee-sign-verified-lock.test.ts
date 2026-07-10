import { describe, it, expect } from "vitest";
import worker from "../src/index.js";
import { signSession } from "../src/jwt.js";

// A verified hole is keyed by hole NUMBER, but the editor renumbers holes by position — so the PATCH
// path refuses a structural change (add/remove/renumber) on a layout that has any verified hole, which
// would otherwise misattribute verified par/distance to the wrong hole.

const SECRET = "x".repeat(40);
const members = { "member:m_admin": JSON.stringify({ memberId: "m_admin", name: "Admin", isAdmin: true, pinHash: "x", mustChangePin: false }) };
const kv = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => void m.set(k, v), delete: async (k: string) => void m.delete(k) };
};
const VERIFIED_LAYOUT = JSON.stringify([
  { hole: 1, par: 3 },
  { hole: 2, par: 4, verified: { par: 4, distance_ft: 420, tee_sign_key: "k" } },
  { hole: 3, par: 3 },
]);
function mockDb() {
  return { prepare: (sql: string) => ({
    bind() { return this; },
    all: async () => ({ results: [], success: true }),
    first: async () => {
      if (/SELECT \* FROM course_layouts WHERE id/i.test(sql)) return { id: 1, course_id: 3, name: "Long", holes: VERIFIED_LAYOUT, total_par: 10 };
      if (/UPDATE course_layouts/i.test(sql)) return { id: 1, course_id: 3, name: "Long", holes: VERIFIED_LAYOUT, total_par: 10 };
      return null;
    },
    run: async () => ({ success: true }),
  }) };
}
const env = () => ({ ROSTER: kv(members), RATELIMIT: kv(), DB: mockDb(), JWT_SECRET: SECRET, ALLOWED_ORIGINS: "http://localhost:8080" } as unknown as Parameters<typeof worker.fetch>[1]);
const tok = (sub: string) => signSession({ sub, mustChangePin: false }, SECRET, 900);
async function patch(holes: unknown[], token: string | Promise<string>) {
  const h: Record<string, string> = { Origin: "http://localhost:8080", "content-type": "application/json", authorization: "Bearer " + (await token) };
  return worker.fetch(new Request("https://w/admin/layouts/1", { method: "PATCH", headers: h, body: JSON.stringify({ holes }) }), env());
}

describe("verified layout is structurally locked (PATCH)", () => {
  it("409 when a structural change (removed hole) would misattribute verified data", async () => {
    const res = await patch([{ hole: 1, par: 3 }, { hole: 2, par: 4 }], tok("m_admin")); // dropped hole 3 → hole set differs
    expect(res.status).toBe(409);
    expect((await res.json() as { error: string }).error).toBe("verified_layout_locked");
  });
  it("200 when the hole set is unchanged (par-only edit keeps verified)", async () => {
    const res = await patch([{ hole: 1, par: 5 }, { hole: 2, par: 4 }, { hole: 3, par: 3 }], tok("m_admin"));
    expect(res.status).toBe(200);
  });
});
