import { describe, it, expect } from "vitest";
import worker from "../src/index.js";
import { signSession } from "../src/jwt.js";
import { jsonObject } from "./json.js";

// Regression: live testing showed POST /admin/courses with a duplicate name threw an unhandled 500
// (UNIQUE constraint failed: courses.name). It must return a clean 409 instead.
const SECRET = "x".repeat(40);
const ADMIN = JSON.stringify({ memberId: "m_admin", name: "Admin", isAdmin: true, pinHash: "x", mustChangePin: false });

function kv(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => void m.set(k, v), delete: async (k: string) => void m.delete(k) };
}
function prepared(onFirst: (sql: string) => unknown) {
  const make = (sql: string) => ({ bind() { return this; }, all: async () => ({ results: [], success: true }), first: async () => onFirst(sql), run: async () => ({ results: [], success: true }) });
  return { prepare: (sql: string) => make(sql) };
}
const dbDupName = prepared((sql) => { if (/INSERT INTO courses/i.test(sql)) throw new Error("D1_ERROR: UNIQUE constraint failed: courses.name: SQLITE_CONSTRAINT"); return null; });
const dbOk = prepared(() => ({ id: 1, name: "Fresh" }));

const makeEnv = (db: unknown) => ({ ROSTER: kv({ "member:m_admin": ADMIN }), RATELIMIT: kv(), DB: db, JWT_SECRET: SECRET, ALLOWED_ORIGINS: "http://localhost:8080", LIVE: undefined } as unknown as Parameters<typeof worker.fetch>[1]);
async function postCourse(name: string) {
  const token = await signSession({ sub: "m_admin", mustChangePin: false }, SECRET, 900);
  return new Request("https://w/admin/courses", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + token, Origin: "http://localhost:8080" }, body: JSON.stringify({ name }) });
}

describe("POST /admin/courses duplicate-name handling", () => {
  it("returns 409 course_exists (not a 500) on a UNIQUE name collision", async () => {
    const res = await worker.fetch(await postCourse("Dup"), makeEnv(dbDupName));
    expect(res.status).toBe(409);
    expect((await jsonObject(res)).error).toBe("course_exists");
  });
  it("creates a course normally (201) when the name is free", async () => {
    const res = await worker.fetch(await postCourse("Fresh"), makeEnv(dbOk));
    expect(res.status).toBe(201);
  });
});
