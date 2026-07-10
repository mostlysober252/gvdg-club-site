// DEV ONLY — generate a local-KV seed file for `wrangler kv bulk put`.
// Reproduces src/crypto.ts hashPin() exactly so a seeded member can log in against the
// real Worker. Usage:
//   node scripts/dev-seed.mjs 12345 JaneD 4821 "Jane Doe" > seed.local.json
//   npx wrangler kv bulk put seed.local.json --binding=ROSTER --local
// (The full, production roster-provisioning tool is slice B2.)

// Must match src/crypto.ts ITERATIONS exactly (100_000). workerd caps PBKDF2 at 100k and THROWS
// above it, so a 120k hash here produces members that CANNOT log in on the deployed Worker.
const ITERATIONS = 100_000;

function toB64url(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hashPin(pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS }, key, 256);
  return `pbkdf2$sha256$${ITERATIONS}$${toB64url(salt)}$${toB64url(new Uint8Array(bits))}`;
}

const [pdgaNo = "12345", udisc = "JaneD", pin = "4821", name = "Jane Doe"] = process.argv.slice(2);
const memberId = `m_${pdgaNo}`;
const pinHash = await hashPin(pin);
const member = { memberId, name, pdgaNo, udisc, pinHash, mustChangePin: true };

const entries = [
  { key: `member:${memberId}`, value: JSON.stringify(member) },
  { key: `idx:pdga:${pdgaNo.replace(/\D/g, "")}`, value: memberId },
  { key: `idx:udisc:${udisc.trim().toLowerCase()}`, value: memberId },
];
console.log(JSON.stringify(entries, null, 2));
