import { describe, it, expect } from "vitest";
import worker from "../src/index.js";
import { signSession } from "../src/jwt.js";

const SECRET = "x".repeat(40);
const members = {
  "member:m_owner": JSON.stringify({ memberId: "m_owner", name: "Owner", isAdmin: false, pinHash: "x", mustChangePin: false }),
  "member:m_jane": JSON.stringify({ memberId: "m_jane", name: "Jane", isAdmin: false, pinHash: "x", mustChangePin: false }),
  "member:m_admin": JSON.stringify({ memberId: "m_admin", name: "Admin", isAdmin: true, pinHash: "x", mustChangePin: false }),
};
function kv(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => void m.set(k, v), delete: async (k: string) => void m.delete(k) };
}
// getBoardPost/createBoardPost both call first(); return a post owned by m_owner.
const db = { prepare: () => ({ bind() { return this; }, all: async () => ({ results: [], success: true }), first: async () => ({ id: 1, member_id: "m_owner", parent_id: null, body: "hi", author_name: "Owner" }), run: async () => ({ results: [], success: true }) }) };
const makeEnv = () => ({ ROSTER: kv(members), RATELIMIT: kv(), DB: db, JWT_SECRET: SECRET, ALLOWED_ORIGINS: "http://localhost:8080", LIVE: undefined } as unknown as Parameters<typeof worker.fetch>[1]);
const tok = (sub: string) => signSession({ sub, mustChangePin: false }, SECRET, 900);
async function call(path: string, method = "GET", token?: string, body?: unknown, env = makeEnv()) {
  const h: Record<string, string> = { Origin: "http://localhost:8080" };
  if (token) h.authorization = "Bearer " + token;
  if (body) h["content-type"] = "application/json";
  return worker.fetch(new Request("https://w" + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined }), env);
}

describe("Members message board", () => {
  it("is members-only: reads require auth", async () => {
    expect((await call("/board")).status).toBe(401);
    expect((await call("/board", "GET", await tok("m_jane"))).status).toBe(200);
  });
  it("lets a member post, rejects an empty body", async () => {
    expect((await call("/board", "POST", await tok("m_owner"), { body: "Hello club!" })).status).toBe(201);
    expect((await call("/board", "POST", await tok("m_owner"), { body: "   " })).status).toBe(400);
  });
  it("moderation: a non-owner non-admin cannot delete; owner and admin can", async () => {
    expect((await call("/board/1", "DELETE", await tok("m_jane"))).status).toBe(403);
    expect((await call("/board/1", "DELETE", await tok("m_owner"))).status).toBe(200);
    expect((await call("/board/1", "DELETE", await tok("m_admin"))).status).toBe(200);
  });
  it("rate-limits a flooding member with 429", async () => {
    const env = makeEnv();
    const token = await tok("m_owner");
    let last = 201;
    for (let i = 0; i < 17; i++) last = (await call("/board", "POST", token, { body: "spam " + i }, env)).status;
    expect(last).toBe(429);
  });
});
