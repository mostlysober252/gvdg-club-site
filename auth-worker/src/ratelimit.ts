// Login rate-limiting + lockout — the PRIMARY defense for a low-entropy 4-digit PIN.
// Backed by Workers KV; keyed per identifier (and the caller should also key per client IP).
// `now` is injected so the policy is pure and deterministically testable.

/** Minimal subset of the Workers KV API we depend on. */
export interface KVLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

export const MAX_ATTEMPTS = 5;
export const LOCKOUT_SEC = 900; // 15 minutes

export interface LockoutStatus {
  locked: boolean;
  retryAfterSec: number;
  attemptsRemaining: number;
}

interface Record {
  count: number;
  lockedUntil: number; // epoch ms; 0 = not locked
}

function parse(raw: string | null): Record {
  if (!raw) return { count: 0, lockedUntil: 0 };
  try {
    const r = JSON.parse(raw) as Partial<Record>;
    return { count: Number(r.count) || 0, lockedUntil: Number(r.lockedUntil) || 0 };
  } catch {
    return { count: 0, lockedUntil: 0 };
  }
}

function statusOf(r: Record, nowMs: number): LockoutStatus {
  if (r.lockedUntil > nowMs) {
    return { locked: true, retryAfterSec: Math.ceil((r.lockedUntil - nowMs) / 1000), attemptsRemaining: 0 };
  }
  return { locked: false, retryAfterSec: 0, attemptsRemaining: Math.max(0, MAX_ATTEMPTS - r.count) };
}

/** Read the current lockout status without mutating anything. */
export async function checkLockout(kv: KVLike, key: string, nowMs: number): Promise<LockoutStatus> {
  return statusOf(parse(await kv.get(rk(key))), nowMs);
}

/** Record a failed attempt; locks the identifier once MAX_ATTEMPTS is reached. */
export async function recordFailure(kv: KVLike, key: string, nowMs: number): Promise<LockoutStatus> {
  const r = parse(await kv.get(rk(key)));

  // Already locked and still within the window — don't extend, just report.
  if (r.lockedUntil > nowMs) return statusOf(r, nowMs);

  r.count += 1;
  if (r.count >= MAX_ATTEMPTS) {
    r.lockedUntil = nowMs + LOCKOUT_SEC * 1000;
    r.count = 0; // reset the counter; the lock now governs access
  }
  await kv.put(rk(key), JSON.stringify(r), { expirationTtl: LOCKOUT_SEC });
  return statusOf(r, nowMs);
}

/** Clear all recorded attempts (call on a successful login). */
export async function clearAttempts(kv: KVLike, key: string): Promise<void> {
  await kv.delete(rk(key));
}

function rk(key: string): string {
  return `ratelimit:${key}`;
}
