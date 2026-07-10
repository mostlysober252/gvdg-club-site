import { describe, it, expect, beforeEach } from "vitest";
import worker from "../src/index.js";
import { putMember } from "../src/roster.js";
import { hashPin } from "../src/crypto.js";
import type { KVLike } from "../src/ratelimit.js";
import type { Env } from "../src/index.js";

const ORIGIN = "https://www.greenvillediscgolf.com";
const PIN = "4821";

function makeKV(): KVLike {
  const m = new Map<string, string>();
  return {
    get: async (k) => (m.has(k) ? m.get(k)! : null),
    put: async (k, v) => void m.set(k, v),
    delete: async (k) => void m.delete(k),
  };
}

// These auth tests don't touch D1; a no-op stub satisfies the binding.
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
    JWT_SECRET: "unit-test-secret-at-least-32-bytes-long!!",
    ALLOWED_ORIGINS: `${ORIGIN},https://greenvillediscgolf.com`,
    SESSION_TTL_SEC: "900",
    LIVE: undefined as unknown as Env["LIVE"], // login tests never hit live routes
    PHOTOS: undefined as unknown as Env["PHOTOS"], // login tests never upload photos
  } as unknown as Env;
  await putMember(env.ROSTER as KVLike, {
    memberId: "m_jane",
    name: "Jane Doe",
    pdgaNo: "12345",
    udisc: "JaneD",
    pinHash: await hashPin(PIN),
    mustChangePin: true,
  });
});

function post(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`https://auth.example${path}`, {
    method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("POST /login", () => {
  it("returns a token + mustChangePin for correct PIN (by PDGA#)", async () => {
    const res = await worker.fetch(post("/login", { identifier: "12345", pin: PIN }), env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(typeof json.token).toBe("string");
    expect(json.mustChangePin).toBe(true);
    expect(json.name).toBe("Jane Doe");
    expect(json.pdgaNo).toBe("12345");
    expect(json.isAdmin).toBe(false);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
  });

  it("logs in by UDisc username too", async () => {
    const res = await worker.fetch(post("/login", { identifier: "janed", pin: PIN }), env);
    expect(res.status).toBe(200);
  });

  it("rejects a wrong PIN with a generic 401", async () => {
    const res = await worker.fetch(post("/login", { identifier: "12345", pin: "0000" }), env);
    expect(res.status).toBe(401);
  });

  it("does not reveal whether an identifier exists (unknown user → same 401)", async () => {
    const res = await worker.fetch(post("/login", { identifier: "99999", pin: "0000" }), env);
    expect(res.status).toBe(401);
  });

  it("locks the account (423) after too many failures, even with the correct PIN", async () => {
    for (let i = 0; i < 5; i++) {
      await worker.fetch(post("/login", { identifier: "12345", pin: "0000" }), env);
    }
    const res = await worker.fetch(post("/login", { identifier: "12345", pin: PIN }), env);
    expect(res.status).toBe(423);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("counts PDGA# punctuation variants against ONE lockout bucket (no key-splitting bypass)", async () => {
    // All of these normalize to PDGA 12345 and resolve to the same member; the lockout must not reset
    // just because the raw identifier string differs.
    for (const v of ["1-2345", "1.2345", "12-345", "123.45", "1234-5"]) {
      await worker.fetch(post("/login", { identifier: v, pin: "0000" }), env);
    }
    const res = await worker.fetch(post("/login", { identifier: "12345", pin: PIN }), env);
    expect(res.status).toBe(423);
  });

  it("rejects a malformed body with 400", async () => {
    const req = new Request("https://auth.example/login", {
      method: "POST",
      headers: { Origin: ORIGIN, "Content-Type": "application/json" },
      body: "{not json",
    });
    expect((await worker.fetch(req, env)).status).toBe(400);
  });

  it("rejects an oversized login body before credential verification", async () => {
    const res = await worker.fetch(post("/login", { identifier: "12345", pin: PIN, padding: "x".repeat(5000) }), env);
    expect(res.status).toBe(413);
  });

  it("rate-limits repeated login failures from one client IP even across different identifiers", async () => {
    let status = 401;
    for (let i = 0; i < 25; i++) {
      const res = await worker.fetch(
        post("/login", { identifier: `unknown-${i}`, pin: "0000" }, { "CF-Connecting-IP": "203.0.113.10" }),
        env,
      );
      status = res.status;
      if (status === 429) break;
    }
    expect(status).toBe(429);
  });
});

describe("GET /me", () => {
  it("returns claims for a valid bearer token", async () => {
    const login = await worker.fetch(post("/login", { identifier: "12345", pin: PIN }), env);
    const { token } = (await login.json()) as any;
    const res = await worker.fetch(
      new Request("https://auth.example/me", { headers: { Origin: ORIGIN, Authorization: `Bearer ${token}` } }),
      env,
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.sub).toBe("m_jane");
    expect(json.mustChangePin).toBe(true);
    expect(json.pdgaNo).toBe("12345");
    expect(json.name).toBe("Jane Doe");
    expect(json.isAdmin).toBe(false);
  });

  it("401s without a token", async () => {
    const res = await worker.fetch(new Request("https://auth.example/me", { headers: { Origin: ORIGIN } }), env);
    expect(res.status).toBe(401);
  });
});

describe("POST /set-pin", () => {
  async function loginToken(pin: string): Promise<string> {
    const res = await worker.fetch(post("/login", { identifier: "12345", pin }), env);
    return ((await res.json()) as any).token;
  }

  it("changes the PIN, clears mustChangePin, and the new PIN works while the old fails", async () => {
    const token = await loginToken(PIN);
    const res = await worker.fetch(post("/set-pin", { newPin: "7777" }, { Authorization: `Bearer ${token}` }), env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.mustChangePin).toBe(false);

    expect((await worker.fetch(post("/login", { identifier: "12345", pin: "7777" }), env)).status).toBe(200);
    expect((await worker.fetch(post("/login", { identifier: "12345", pin: PIN }), env)).status).toBe(401);
  });

  it("rejects an invalid PIN format with 400", async () => {
    const token = await loginToken(PIN);
    for (const bad of ["12", "abcd", "12345", ""]) {
      const res = await worker.fetch(post("/set-pin", { newPin: bad }, { Authorization: `Bearer ${token}` }), env);
      expect(res.status, `pin=${bad}`).toBe(400);
    }
  });

  it("401s without a token", async () => {
    expect((await worker.fetch(post("/set-pin", { newPin: "7777" }), env)).status).toBe(401);
  });

  // Once a member is established (mustChangePin cleared), changing the PIN must re-prove the current
  // PIN, so a transiently-stolen session token can't be turned into a permanent account takeover.
  describe("established member re-auth", () => {
    async function establishedToken(): Promise<string> {
      const login = await worker.fetch(post("/login", { identifier: "12345", pin: PIN }), env);
      const loginToken = ((await login.json()) as any).token; // mustChangePin: true
      const sp = await worker.fetch(post("/set-pin", { newPin: "9999" }, { Authorization: `Bearer ${loginToken}` }), env);
      return ((await sp.json()) as any).token; // mustChangePin: false; current PIN is now 9999
    }

    it("rejects a non-forced change without the correct current PIN, and accepts it with", async () => {
      const t = await establishedToken();
      const auth = { Authorization: `Bearer ${t}` };
      expect((await worker.fetch(post("/set-pin", { newPin: "1111" }, auth), env)).status).toBe(401);
      expect((await worker.fetch(post("/set-pin", { newPin: "1111", currentPin: "0000" }, auth), env)).status).toBe(401);
      // PIN is unchanged so far
      expect((await worker.fetch(post("/login", { identifier: "12345", pin: "9999" }), env)).status).toBe(200);
      // Correct current PIN succeeds and rotates the PIN
      expect((await worker.fetch(post("/set-pin", { newPin: "1111", currentPin: "9999" }, auth), env)).status).toBe(200);
      expect((await worker.fetch(post("/login", { identifier: "12345", pin: "1111" }), env)).status).toBe(200);
    });
  });
});

describe("misconfiguration (fail closed)", () => {
  it("returns 500 — not a weakly-signed token — when JWT_SECRET is missing/short", async () => {
    const badEnv = { ...env, JWT_SECRET: "" };
    const res = await worker.fetch(post("/login", { identifier: "12345", pin: PIN }), badEnv);
    expect(res.status).toBe(500);
  });
});

describe("POST /profile", () => {
  async function token(): Promise<string> {
    // Mirror the real flow: members must change their default PIN (via /set-pin) before protected routes
    // like /profile — so a usable profile token is the fresh one returned by set-pin (mustChangePin:false).
    const res = await worker.fetch(post("/login", { identifier: "12345", pin: PIN }), env);
    const loginToken = ((await res.json()) as any).token;
    const sp = await worker.fetch(post("/set-pin", { newPin: "9999" }, { Authorization: `Bearer ${loginToken}` }), env);
    return ((await sp.json()) as any).token;
  }
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  it("401s without a token", async () => {
    expect((await worker.fetch(post("/profile", { udisc: "x" }), env)).status).toBe(401);
  });

  it("rejects a still-must-change-PIN token on protected routes (server-side gate, not just UI)", async () => {
    const res = await worker.fetch(post("/login", { identifier: "12345", pin: PIN }), env);
    const loginToken = ((await res.json()) as { token: string }).token; // mustChangePin: true
    expect((await worker.fetch(post("/profile", { udisc: "x" }, { Authorization: `Bearer ${loginToken}` }), env)).status).toBe(401);
  });

  it("updates UDisc + photo and /me reflects it", async () => {
    const t = await token();
    const res = await worker.fetch(
      post("/profile", { udisc: "JaneThrows", photo: "data:image/png;base64,iVBORw0KGgo=" }, auth(t)),
      env,
    );
    expect(res.status).toBe(200);
    const me = await worker.fetch(
      new Request("https://auth.example/me", { headers: { Origin: ORIGIN, Authorization: `Bearer ${t}` } }),
      env,
    );
    const mj = (await me.json()) as any;
    expect(mj.udisc).toBe("JaneThrows");
    expect(mj.photo).toBe("data:image/png;base64,iVBORw0KGgo=");
  });

  it("rejects a non-numeric PDGA # (400)", async () => {
    const t = await token();
    expect((await worker.fetch(post("/profile", { pdgaNo: "ABC12" }, auth(t)), env)).status).toBe(400);
  });

  it("rejects a non-image / oversized photo (400)", async () => {
    const t = await token();
    expect((await worker.fetch(post("/profile", { photo: "data:text/html;base64,PHNjcmlwdD4=" }, auth(t)), env)).status).toBe(400);
    const huge = "data:image/png;base64," + "A".repeat(300000);
    expect((await worker.fetch(post("/profile", { photo: huge }, auth(t)), env)).status).toBe(400);
  });

  it("409s when claiming a PDGA # owned by another member", async () => {
    await putMember(env.ROSTER as KVLike, {
      memberId: "m_other",
      name: "Other",
      pdgaNo: "77777",
      pinHash: await hashPin("0000"),
      mustChangePin: false,
    });
    const t = await token();
    expect((await worker.fetch(post("/profile", { pdgaNo: "77777" }, auth(t)), env)).status).toBe(409);
  });
});

describe("admin role", () => {
  it("reports isAdmin true for an admin member (login + /me)", async () => {
    await putMember(env.ROSTER as KVLike, {
      memberId: "m_admin", name: "Admin Person", udisc: "adminuser",
      pinHash: await hashPin("4821"), mustChangePin: false, isAdmin: true,
    });
    const login = await worker.fetch(post("/login", { identifier: "adminuser", pin: "4821" }), env);
    expect(login.status).toBe(200);
    const lj = (await login.json()) as any;
    expect(lj.isAdmin).toBe(true);
    const me = await worker.fetch(
      new Request("https://auth.example/me", { headers: { Origin: ORIGIN, Authorization: `Bearer ${lj.token}` } }),
      env,
    );
    expect(((await me.json()) as any).isAdmin).toBe(true);
  });
});

describe("CORS", () => {
  it("answers preflight from an allowed origin with the ACAO header", async () => {
    const res = await worker.fetch(
      new Request("https://auth.example/login", { method: "OPTIONS", headers: { Origin: ORIGIN } }),
      env,
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
  });

  it("does not send ACAO for a disallowed origin", async () => {
    const res = await worker.fetch(
      new Request("https://auth.example/login", { method: "OPTIONS", headers: { Origin: "https://evil.example" } }),
      env,
    );
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});
