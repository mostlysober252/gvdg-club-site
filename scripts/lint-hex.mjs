#!/usr/bin/env node
// Ratcheting hex-color lint. Raw hex belongs in tokens.css (the single source of truth); everywhere
// else it's drift waiting to happen. Hard-failing on the whole existing backlog would block every
// deploy, so instead we RATCHET: each page has a baseline count in hex-baseline.json and the lint fails
// only when a file EXCEEDS its baseline (i.e. NEW hardcoded hex was added). Clean hex out of a file and
// lower its baseline with `--update`; the number only ratchets down.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = join(ROOT, "hex-baseline.json");
const HEX = /#[0-9a-fA-F]{3,8}\b/g;

// Count raw hex inside <style>…</style> of each page (tokens.css is the sanctioned home for hex, skip it).
function countHex(html) {
  let n = 0;
  for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) n += (m[1].match(HEX) || []).length;
  return n;
}

const files = readdirSync(ROOT).filter((f) => f.endsWith(".html")).sort();
const counts = Object.fromEntries(files.map((f) => [f, countHex(readFileSync(join(ROOT, f), "utf8"))]));

if (process.argv.includes("--update")) {
  writeFileSync(BASELINE, JSON.stringify(counts, null, 2) + "\n");
  console.log("hex-lint: baseline updated ->", BASELINE);
  process.exit(0);
}

let baseline = {};
try { baseline = JSON.parse(readFileSync(BASELINE, "utf8")); } catch { /* first run: treat as all-zero */ }

const regressions = [];
for (const [f, n] of Object.entries(counts)) {
  const max = baseline[f] ?? 0;
  if (n > max) regressions.push(`  ${f}: ${n} raw hex in <style> (baseline ${max}) — move new colors into tokens.css`);
}
const total = Object.values(counts).reduce((a, b) => a + b, 0);
if (regressions.length) {
  console.error(`hex-lint FAILED — hardcoded hex increased (total debt ${total}):`);
  console.error(regressions.join("\n"));
  process.exit(1);
}
console.log(`hex-lint OK — no new hardcoded hex (existing debt ${total}, ratcheting down).`);
