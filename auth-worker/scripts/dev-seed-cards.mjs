// DEV ONLY — emit a KV bulk-put file with members for live-verifying card scoring.
// Reproduces src/crypto.ts hashPin exactly. PIN for everyone = 1111, mustChangePin:false.
//   node scripts/dev-seed-cards.mjs > seed.cards.json
//   npx wrangler kv bulk put seed.cards.json --binding=ROSTER --local
const ITERATIONS = 120_000;
const toB64url = (bytes) => { let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
async function hashPin(pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS }, key, 256);
  return `pbkdf2$sha256$${ITERATIONS}$${toB64url(salt)}$${toB64url(new Uint8Array(bits))}`;
}
const people = [
  { memberId: "m_admin", name: "Admin Ann", pdgaNo: "10001", udisc: "adminann", isAdmin: true },
  { memberId: "m_alice", name: "Alice Park", pdgaNo: "10100", udisc: "alice" },
  { memberId: "m_bob", name: "Bob Rivera", pdgaNo: "10200", udisc: "bob" },
  { memberId: "m_carol", name: "Carol Diaz", pdgaNo: "10300", udisc: "carol" }, // NOT registered (forbidden-path test)
];
const entries = [];
for (const p of people) {
  const member = { memberId: p.memberId, name: p.name, pdgaNo: p.pdgaNo, udisc: p.udisc, pinHash: await hashPin("1111"), mustChangePin: false, ...(p.isAdmin ? { isAdmin: true } : {}) };
  entries.push({ key: `member:${p.memberId}`, value: JSON.stringify(member) });
  entries.push({ key: `idx:pdga:${p.pdgaNo}`, value: p.memberId });
  entries.push({ key: `idx:udisc:${p.udisc}`, value: p.memberId });
}
console.log(JSON.stringify(entries, null, 2));
