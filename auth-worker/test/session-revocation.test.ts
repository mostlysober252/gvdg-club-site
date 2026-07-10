// Regression coverage for stateless session revocation via the pinVer claim.
// Before this fix, a token minted before an admin PIN reset / member PIN change stayed valid for the
// full session TTL — an admin resetting a *compromised* account could not actually lock the attacker
// out. requireAuth now rejects any token whose pinVer is behind the member record's pinVer.
import { describe, it, expect, beforeEach } from "vitest";
import worker from "../src/index.js";
import { putMember, resetMemberPin, setPin, getMember } from "../src/roster.js";
import { hashPin } from "../src/crypto.js";
import { signSession, verifySession } from "../src/jwt.js";
import type { KVLike } from "../src/ratelimit.js";
import type { Env } from "../src/index.js";

const ORIGIN = "https://www.greenvillediscgolf.com";
const SECRET = "unit-test-secret-at-least-32-bytes-long!!";
const PIN = "4821";

function makeKV(): KVLike {
  const m = new Map<string, string>();
  return {
    get: async (k) => (m.has(k) ? m.get(k)! : null),
    put: async (k, v) => void m.set(k, v),
    delete: async (k) => void m.delete(k),
  };
}
function makeDB() {
  const stmt = { bind: () => stmt, all: async () => ({ results: [], success: true }), first: async () => null, run: async () => ({ results: [], success: true }) };
  return { prepare: () => stmt };
}

let env: Env;
beforeEach(async () => {
  env = {
    ROSTER: makeKV() as unknown as Env["ROSTER"],
    RATELIMIT: makeKV() as unknown as Env["RATELIMIT"],
    DB: makeDB() as unknown as Env["DB"],
    JWT_SECRET: SECRET,
    ALLOWED_ORIGINS: `${ORIGIN},https://greenvillediscgolf.com`,
    SESSION_TTL_SEC: "900",
    LIVE: undefined as unknown as Env["LIVE"],
    PHOTOS: undefined as unknown as Env["PHOTOS"],
  } as unknown as Env;
  await putMember(env.ROSTER as KVLike, {
    memberId: "m_jane", name: "Jane Doe", pdgaNo: "12345", udisc: "JaneD",
    pinHash: await hashPin(PIN), mustChangePin: false,
  });
});

function get(path: string, token: string): Request {
  return new Request(`https://auth.example${path}`, { headers: { Origin: ORIGIN, Authorization: `Bearer ${token}` } });
}
async function login(): Promise<string> {
  const res = await worker.fetch(
    new Request(`https://auth.example/login`, {
      method: "POST",
      headers: { Origin: ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: "12345", pin: PIN }),
    }),
    env,
  );
  return (await res.json() as { token: string }).token;
}

describe("session revocation (pinVer)", () => {
  it("a pre-reset token is accepted on a gated route, then rejected after an admin PIN reset", async () => {
    const token = await login();
    // Baseline: the fresh token is honored on a member-gated route (not 401).
    const before = await worker.fetch(get("/my-registrations", token), env);
    expect(before.status).not.toBe(401);

    // Admin resets the member's PIN -> pinVer bumps -> every older token is revoked.
    const reset = await resetMemberPin(env.ROSTER as KVLike, "12345", await hashPin("0000"));
    expect(reset).not.toBeNull();

    const after = await worker.fetch(get("/my-registrations", token), env);
    expect(after.status).toBe(401);
  });

  it("a token minted after the reset (with the new pinVer) is accepted again", async () => {
    await resetMemberPin(env.ROSTER as KVLike, "12345", await hashPin("0000"));
    const m = await getMember(env.ROSTER as KVLike, "m_jane");
    const fresh = await signSession({ sub: "m_jane", mustChangePin: false, pinVer: m?.pinVer ?? 0 }, SECRET, 900);
    const res = await worker.fetch(get("/my-registrations", fresh), env);
    expect(res.status).not.toBe(401);
  });

  it("setPin bumps and returns the new pinVer; resetMemberPin also bumps it", async () => {
    const v1 = await setPin(env.ROSTER as KVLike, "m_jane", await hashPin("1111"));
    expect(v1).toBe(1);
    const after = await getMember(env.ROSTER as KVLike, "m_jane");
    expect(after?.pinVer).toBe(1);
    await resetMemberPin(env.ROSTER as KVLike, "12345", await hashPin("2222"));
    const after2 = await getMember(env.ROSTER as KVLike, "m_jane");
    expect(after2?.pinVer).toBe(2);
  });

  it("pinVer survives the JWT round-trip and defaults to 0 when absent", async () => {
    const withVer = await signSession({ sub: "m_x", mustChangePin: false, pinVer: 7 }, SECRET, 900);
    expect((await verifySession(withVer, SECRET))?.pinVer).toBe(7);
    const noVer = await signSession({ sub: "m_x", mustChangePin: false }, SECRET, 900);
    expect((await verifySession(noVer, SECRET))?.pinVer).toBe(0);
  });
});
