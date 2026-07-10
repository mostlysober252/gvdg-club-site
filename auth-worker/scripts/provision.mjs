// GVDG roster provisioning tool (slice B2).
//
// Turns a plain roster JSON file into the two artifacts an admin needs to onboard members:
//   1. kv-bulk.json    -> `wrangler kv bulk put kv-bulk.json --binding ROSTER`
//                         (member records + login indexes; values hold ONLY the PIN hash)
//   2. default-pins.csv -> the cleartext one-time PINs to hand to each member. SENSITIVE.
//
// Reproduces src/crypto.ts hashPin() exactly (PBKDF2-HMAC-SHA256, 100k iters, 16-byte salt,
// b64url, format `pbkdf2$sha256$<iters>$<salt>$<hash>`) so a provisioned member can log in
// against the real Worker and verifyPin() accepts the generated default PIN. NOTE: the iteration
// count MUST stay <=100_000 — workerd (the deployed runtime) hard-caps PBKDF2 at 100k and throws
// above it, so a higher count hashes fine here in Node but can never be verified live.
//
// WebCrypto + Node stdlib only — no dependencies. Runs on Node 22 (same crypto.subtle as the
// Workers runtime). The CLI is guarded so this file can also be imported as a pure module
// (used by test/provision.test.ts).
//
// Usage:
//   node scripts/provision.mjs --roster roster.sample.json --out-dir ./out
//   node scripts/provision.mjs --reset 12345 --roster roster.sample.json --out-dir ./out
//
// See PROVISIONING.md.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// --- format constants: MUST match src/crypto.ts (and stay <=100_000 for the workerd PBKDF2 cap) ---
const ITERATIONS = 100_000;
const SALT_BYTES = 16;
const HASH_BITS = 256;

// --- base64url, mirroring src/crypto.ts toB64url ---
function toB64url(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// --- key/normalization helpers: MUST match src/roster.ts ---
function normPdga(s) {
  return String(s).replace(/\D/g, "");
}
function normUdisc(s) {
  return String(s).trim().toLowerCase();
}

/**
 * Derive a stable memberId from identity fields.
 * Prefers PDGA# (numeric, canonical); falls back to a UDisc-derived id.
 * Stable across re-runs so re-provisioning / --reset overwrites the same KV record.
 */
export function deriveMemberId(member) {
  const pdga = member.pdgaNo ? normPdga(member.pdgaNo) : "";
  if (pdga) return `m_${pdga}`;
  const udisc = member.udisc ? normUdisc(member.udisc) : "";
  if (udisc) return `m_u_${udisc}`;
  throw new Error("member needs at least one of pdgaNo / udisc");
}

/**
 * Cryptographically-random 4-digit PIN, uniform over 0000-9999, returned zero-padded.
 *
 * Rejection sampling avoids modulo bias: a byte is 0-255, and 256 is NOT a multiple of 100,
 * so `byte % 100` would over-represent 0-55. We instead draw a fresh random byte and reject
 * any value in [200, 255] (the ragged tail), keeping only [0, 199], which IS an exact 2x of
 * the 100 buckets — so `accepted % 100` is perfectly uniform. We do this for each of the two
 * decimal digit-pairs (tens-of-thousands handled by concatenating two 2-digit draws => 0-99
 * twice), giving a uniform 0000-9999.
 */
export function generatePin() {
  const pair = () => {
    const buf = new Uint8Array(1);
    // Largest multiple of 100 that fits in a byte's range [0,256) is 200; reject [200,255].
    const LIMIT = 200;
    for (;;) {
      crypto.getRandomValues(buf);
      if (buf[0] < LIMIT) return buf[0] % 100; // uniform 0-99
    }
  };
  const hi = pair(); // 0-99
  const lo = pair(); // 0-99
  return String(hi).padStart(2, "0") + String(lo).padStart(2, "0");
}

/** Hash a PIN into `pbkdf2$sha256$<iters>$<saltB64url>$<hashB64url>` (matches src/crypto.ts). */
export async function hashPin(pin) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS },
    key,
    HASH_BITS,
  );
  return `pbkdf2$sha256$${ITERATIONS}$${toB64url(salt)}$${toB64url(new Uint8Array(bits))}`;
}

/**
 * Build the KV bulk entries for one member: the `member:<id>` record plus its login indexes.
 * Returns { memberId, pin, entries }. `pin` is the cleartext default PIN (for the CSV only).
 * KV values NEVER contain the plaintext PIN — only the hash inside the member record.
 */
export async function buildEntries(member) {
  if (!member || (!member.pdgaNo && !member.udisc)) {
    throw new Error("each roster entry requires at least one of pdgaNo / udisc");
  }
  const memberId = deriveMemberId(member);
  const pin = generatePin();
  const pinHash = await hashPin(pin);

  const record = {
    memberId,
    name: member.name ?? "",
    ...(member.pdgaNo ? { pdgaNo: String(member.pdgaNo) } : {}),
    ...(member.udisc ? { udisc: String(member.udisc) } : {}),
    ...(member.admin === true ? { isAdmin: true } : {}),
    pinHash,
    mustChangePin: true,
  };

  const entries = [{ key: `member:${memberId}`, value: JSON.stringify(record) }];
  if (member.pdgaNo) entries.push({ key: `idx:pdga:${normPdga(member.pdgaNo)}`, value: memberId });
  if (member.udisc) entries.push({ key: `idx:udisc:${normUdisc(member.udisc)}`, value: memberId });

  return { memberId, pin, member: record, entries };
}

/** One CSV row for a provisioned member. Escapes per RFC4180 (quote, double inner quotes). */
function csvRow(memberId, member, pin) {
  const cell = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [memberId, member.name, member.pdgaNo ?? "", member.udisc ?? "", pin].map(cell).join(",");
}

const CSV_HEADER = "memberId,name,pdga,udisc,defaultPIN";

/** Validate + normalize the parsed roster JSON into an array of member-input objects. */
function parseRoster(raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    throw new Error(`roster file is not valid JSON: ${e.message}`);
  }
  if (!Array.isArray(data)) throw new Error("roster file must be a JSON array of members");
  data.forEach((m, i) => {
    if (!m || typeof m !== "object") throw new Error(`roster[${i}] is not an object`);
    if (!m.pdgaNo && !m.udisc) {
      throw new Error(`roster[${i}] (${m.name ?? "unnamed"}) needs at least one of pdgaNo / udisc`);
    }
  });
  return data;
}

// --------------------------------------------------------------------------
// CLI
// --------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { roster: null, outDir: "./out", reset: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--roster") out.roster = argv[++i];
    else if (a === "--out-dir") out.outDir = argv[++i];
    else if (a === "--reset") out.reset = argv[++i];
    else if (a === "--help" || a === "-h") out.help = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return out;
}

const USAGE = `gvdg roster provisioning (slice B2)

  node scripts/provision.mjs --roster <file.json> [--out-dir <dir>]
  node scripts/provision.mjs --reset <pdga#|udisc> --roster <file.json> [--out-dir <dir>]

Outputs (in --out-dir, default ./out):
  kv-bulk.json     wrangler kv bulk put kv-bulk.json --binding ROSTER
  default-pins.csv cleartext one-time PINs to distribute  *** SENSITIVE ***

--reset finds one member in the roster by PDGA# or UDisc username, regenerates ONLY
that member's default PIN, and writes a single-member kv-bulk.json + one-row CSV.`;

function findMember(roster, identifier) {
  const digits = normPdga(identifier);
  const uname = normUdisc(identifier);
  return (
    roster.find((m) => m.pdgaNo && normPdga(m.pdgaNo) === digits && digits !== "") ||
    roster.find((m) => m.udisc && normUdisc(m.udisc) === uname) ||
    null
  );
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.help || !args.roster) {
    console.log(USAGE);
    if (!args.roster) process.exitCode = 1;
    return;
  }

  const raw = await readFile(path.resolve(args.roster), "utf8");
  const roster = parseRoster(raw);

  let members = roster;
  if (args.reset != null) {
    const target = findMember(roster, args.reset);
    if (!target) {
      throw new Error(`--reset: no roster member matches "${args.reset}" (by PDGA# or UDisc)`);
    }
    members = [target];
  }

  const kvEntries = [];
  const csvRows = [CSV_HEADER];
  for (const m of members) {
    const { memberId, pin, member, entries } = await buildEntries(m);
    kvEntries.push(...entries);
    csvRows.push(csvRow(memberId, member, pin));
  }

  const outDir = path.resolve(args.outDir);
  await mkdir(outDir, { recursive: true });
  const kvPath = path.join(outDir, "kv-bulk.json");
  const csvPath = path.join(outDir, "default-pins.csv");
  await writeFile(kvPath, JSON.stringify(kvEntries, null, 2) + "\n");
  await writeFile(csvPath, csvRows.join("\n") + "\n");

  const mode = args.reset != null ? `reset (1 member: ${members[0].name ?? args.reset})` : "full roster";
  console.log(`provisioned ${members.length} member(s) [${mode}]`);
  console.log(`  KV bulk file: ${kvPath}  (${kvEntries.length} entries)`);
  console.log(`    load with:  wrangler kv bulk put ${kvPath} --binding ROSTER`);
  console.log(`  default PINs: ${csvPath}`);
  console.log("");
  console.log("  *** SENSITIVE: default-pins.csv contains cleartext PINs. Distribute over a");
  console.log("      secure channel, never commit it, and delete it once PINs are handed out.");
  console.log("      kv-bulk.json holds only PIN HASHES (never cleartext) but keep it private too.");
}

// import.meta.main is set when run directly (Node 22.x flag-free on recent releases); fall back
// to argv comparison so the CLI also fires under older runners while staying inert on import.
const isMain =
  import.meta.main === true ||
  (typeof process !== "undefined" &&
    process.argv[1] &&
    import.meta.url === new URL(`file://${process.argv[1]}`).href);

if (isMain) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`provision: ${err.message}`);
    process.exit(1);
  });
}
