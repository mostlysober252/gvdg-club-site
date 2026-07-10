import { describe, it, expect } from "vitest";
import {
  checkLockout,
  recordFailure,
  clearAttempts,
  MAX_ATTEMPTS,
  LOCKOUT_SEC,
  type KVLike,
} from "../src/ratelimit.js";

function makeKV(): KVLike {
  const m = new Map<string, string>();
  return {
    get: async (k) => (m.has(k) ? m.get(k)! : null),
    put: async (k, v) => void m.set(k, v),
    delete: async (k) => void m.delete(k),
  };
}

const T0 = 1_000_000_000_000; // fixed "now" in ms

describe("login rate-limiting / lockout", () => {
  it("a fresh identifier is not locked and has the full attempt budget", async () => {
    const kv = makeKV();
    const s = await checkLockout(kv, "pdga:12345", T0);
    expect(s.locked).toBe(false);
    expect(s.attemptsRemaining).toBe(MAX_ATTEMPTS);
  });

  it("locks out after MAX_ATTEMPTS consecutive failures", async () => {
    const kv = makeKV();
    let s;
    for (let i = 0; i < MAX_ATTEMPTS; i++) s = await recordFailure(kv, "pdga:12345", T0);
    expect(s!.locked).toBe(true);
    expect(s!.retryAfterSec).toBeGreaterThan(0);
    expect(s!.retryAfterSec).toBeLessThanOrEqual(LOCKOUT_SEC);
    // a subsequent check during the window is still locked
    expect((await checkLockout(kv, "pdga:12345", T0 + 1000)).locked).toBe(true);
  });

  it("clears the lockout once the window has elapsed", async () => {
    const kv = makeKV();
    for (let i = 0; i < MAX_ATTEMPTS; i++) await recordFailure(kv, "pdga:12345", T0);
    const after = T0 + LOCKOUT_SEC * 1000 + 1;
    expect((await checkLockout(kv, "pdga:12345", after)).locked).toBe(false);
  });

  it("a successful login clears the attempt counter", async () => {
    const kv = makeKV();
    await recordFailure(kv, "pdga:12345", T0);
    await recordFailure(kv, "pdga:12345", T0);
    await clearAttempts(kv, "pdga:12345");
    const s = await checkLockout(kv, "pdga:12345", T0);
    expect(s.locked).toBe(false);
    expect(s.attemptsRemaining).toBe(MAX_ATTEMPTS);
  });

  it("decrements the remaining-attempt budget on each failure", async () => {
    const kv = makeKV();
    const s1 = await recordFailure(kv, "pdga:12345", T0);
    expect(s1.attemptsRemaining).toBe(MAX_ATTEMPTS - 1);
    const s2 = await recordFailure(kv, "pdga:12345", T0);
    expect(s2.attemptsRemaining).toBe(MAX_ATTEMPTS - 2);
  });
});
