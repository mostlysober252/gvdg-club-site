// PIN hashing for the GVDG member auth Worker.
//
// A PIN is only 4 digits (10^4 space), so the hash alone can always be brute-forced
// offline by anyone who steals the stored value. The REAL defenses are: (1) never leak
// the KV roster, and (2) strict server-side rate-limiting + lockout (see ratelimit.ts).
// PBKDF2 with a high iteration count is defense-in-depth, not the primary control.
//
// Uses only WebCrypto (crypto.subtle), which is identical in the Workers runtime and in
// Node 22 (test env) — no native deps, no hand-rolled crypto primitives.

// The Cloudflare Workers runtime (workerd) hard-caps PBKDF2 at 100k iterations — a higher count
// throws "iteration counts above 100000 are not supported" at runtime (Node has no such cap, so
// the test suite never caught it). 100k is the max the runtime allows. PBKDF2 here is only
// defense-in-depth for a 4-digit PIN (see header); the primary controls are rate-limiting + lockout
// and not leaking the roster, so the difference between 100k and 120k is immaterial.
const ITERATIONS = 100_000;
const SALT_BYTES = 16;
const HASH_BYTES = 32;

function toB64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function derive(password: Uint8Array, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    password as BufferSource,
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    key,
    HASH_BYTES * 8,
  );
  return new Uint8Array(bits);
}

/** HMAC-SHA256(pepper, pin) — the "pepper" is a server-held secret NOT stored in KV. Layering it under
 *  PBKDF2 means a leaked roster alone can't brute-force the 4-digit PIN space offline: the attacker also
 *  needs the pepper. Absent a pepper we fall back to un-peppered hashing (see hashPin), so this is
 *  strictly additive and safe to ship before the secret exists. */
async function pepperPin(pepper: string, pin: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pepper) as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(pin) as BufferSource);
  return new Uint8Array(sig);
}

// PBKDF2 password bytes for a PIN: HMAC-peppered when a pepper is configured, else the raw PIN.
async function pinPassword(pin: string, pepper?: string): Promise<Uint8Array> {
  return pepper ? await pepperPin(pepper, pin) : new TextEncoder().encode(pin);
}

/** Compare two byte arrays without short-circuiting on the first differing byte. */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/** Cryptographically-random 4-digit PIN (uniform 0000-9999), for admin-issued temporary PINs.
 *  Rejection sampling (drop a byte in [200,255]) avoids the modulo bias `byte % 100` would introduce. */
export function generatePin(): string {
  const pair = (): number => {
    const buf = new Uint8Array(1);
    for (;;) {
      crypto.getRandomValues(buf);
      if (buf[0]! < 200) return buf[0]! % 100; // [0,199] is an exact 2x of the 100 buckets -> uniform
    }
  };
  return String(pair()).padStart(2, "0") + String(pair()).padStart(2, "0");
}

/** Hash a PIN. With a pepper: `pbkdf2h$sha256$<iters>$<salt>$<hash>` (hash over HMAC(pepper,pin)).
 *  Without: the legacy `pbkdf2$…` form. The scheme marker lets verifyPin tell them apart. */
export async function hashPin(pin: string, pepper?: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(await pinPassword(pin, pepper), salt, ITERATIONS);
  const scheme = pepper ? "pbkdf2h" : "pbkdf2";
  return `${scheme}$sha256$${ITERATIONS}$${toB64url(salt)}$${toB64url(hash)}`;
}

/** Verify a PIN against a stored encoded hash. Returns false (never throws) on malformed input.
 *  Legacy `pbkdf2` hashes verify WITHOUT the pepper (so a pre-pepper roster keeps working); `pbkdf2h`
 *  hashes require the pepper (a peppered hash with no pepper configured is an operational error -> false,
 *  never a silent pass). This dual-verify is what makes rolling the pepper out non-breaking. */
export async function verifyPin(pin: string, stored: string, pepper?: string): Promise<boolean> {
  try {
    const parts = stored.split("$");
    if (parts.length !== 5) return false;
    const [scheme, algo, itersStr, saltStr, hashStr] = parts as [string, string, string, string, string];
    if (algo !== "sha256") return false;
    let password: Uint8Array;
    if (scheme === "pbkdf2") password = new TextEncoder().encode(pin);
    else if (scheme === "pbkdf2h") {
      if (!pepper) return false;
      password = await pepperPin(pepper, pin);
    } else return false;
    const iterations = Number(itersStr);
    if (!Number.isInteger(iterations) || iterations < 1) return false;
    const salt = fromB64url(saltStr);
    const expected = fromB64url(hashStr);
    const actual = await derive(password, salt, iterations);
    return constantTimeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** True when `stored` is a legacy (un-peppered) hash and a pepper IS configured — i.e. it should be
 *  transparently re-hashed to the peppered form on the member's next successful login. */
export function pinHashNeedsUpgrade(stored: string, pepperConfigured: boolean): boolean {
  return pepperConfigured && stored.startsWith("pbkdf2$");
}
