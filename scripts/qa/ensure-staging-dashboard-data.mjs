import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_API_URL = "https://auth.gvdgclub.com";
const QA_PDGA_CANDIDATES = ["90000001", "90000002", "90000003"];

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");

function env(name) {
  return (process.env[name] || "").trim();
}

function loadDeployEnv() {
  const file = path.join(repoRoot, ".gvdg-deploy.env");
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

function cleanUrl(value, fallback) {
  return (value || fallback).replace(/\/+$/, "");
}

function headers(token) {
  const out = { Accept: "application/json" };
  if (token) out.Authorization = "Bearer " + token;
  return out;
}

async function requestJson(apiBase, pathName, options = {}) {
  const requestHeaders = headers(options.token);
  const init = {
    method: options.method || "GET",
    headers: requestHeaders,
    signal: AbortSignal.timeout(options.timeoutMs || 20_000),
  };
  if (options.body !== undefined) {
    requestHeaders["Content-Type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }
  const response = await fetch(apiBase + pathName, init);
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const err = new Error(data?.error || text || `HTTP ${response.status}`);
    err.status = response.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function qaToken(apiBase) {
  const token = env("GVDG_STAGING_QA_TOKEN");
  if (token) return token;
  const identifier = env("GVDG_STAGING_QA_IDENTIFIER");
  const pin = env("GVDG_STAGING_QA_PIN");
  if (!identifier || !pin) {
    throw new Error("Set GVDG_STAGING_QA_TOKEN, or GVDG_STAGING_QA_IDENTIFIER plus GVDG_STAGING_QA_PIN.");
  }
  const data = await requestJson(apiBase, "/login", { method: "POST", body: { identifier, pin } });
  if (!data?.token) throw new Error("Login succeeded without a token.");
  return data.token;
}

function statsFor(pdga) {
  return {
    pdga,
    name: "GVDG QA Dashboard",
    official_rating: 935,
    rating_date: "2026-07-01",
    live_rating: 941,
    peak_rating: 958,
    events_count: 3,
    events: [
      {
        tournament: "GVDG QA Summer Check",
        date: "Jul 4 2026",
        epoch: 1783123200,
        division: "MA2",
        rounds: [
          { rating: 943, score: 54, round: "1" },
          { rating: 951, score: 52, round: "2" },
        ],
      },
      {
        tournament: "GVDG QA Spring Check",
        date: "Apr 18 2026",
        epoch: 1776470400,
        division: "MA2",
        rounds: [{ rating: 929, score: 57, round: "1" }],
      },
    ],
  };
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function seedPdgaCache(pdga) {
  const stats = statsFor(pdga);
  const sql = [
    "INSERT INTO pdga_cache (pdga, data, fetched_at)",
    `VALUES (${sqlString(pdga)}, ${sqlString(JSON.stringify(stats))}, ${Date.now()})`,
    "ON CONFLICT(pdga) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at",
  ].join(" ");

  const result = spawnSync("npx", ["wrangler", "d1", "execute", "DB", "--env", "gvdgclub", "--remote", "--command", sql], {
    cwd: path.join(repoRoot, "auth-worker"),
    encoding: "utf8",
  });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim().split(/\r?\n/).slice(-4).join("\n");
    throw new Error(`Could not seed staging pdga_cache for QA data.\n${detail}`);
  }
}

async function setQaPdga(apiBase, token, preferred) {
  const candidates = preferred ? [preferred] : QA_PDGA_CANDIDATES;
  for (const pdga of candidates) {
    seedPdgaCache(pdga);
    try {
      await requestJson(apiBase, "/profile", { method: "POST", token, body: { pdgaNo: pdga } });
      return pdga;
    } catch (error) {
      if (error?.status !== 409) throw error;
    }
  }
  throw new Error("Every QA PDGA candidate is already linked to another member.");
}

async function hasLiveRating(apiBase, pdga) {
  try {
    const stats = await requestJson(apiBase, `/pdga-stats?pdga=${encodeURIComponent(pdga)}`);
    return stats?.live_rating != null;
  } catch {
    return false;
  }
}

async function main() {
  loadDeployEnv();
  const apiBase = cleanUrl(env("GVDG_STAGING_API_URL"), DEFAULT_API_URL);
  const token = await qaToken(apiBase);
  const member = await requestJson(apiBase, "/me", { token });
  const preferred = env("GVDG_STAGING_QA_PDGA");
  let pdga = "";
  if (preferred) {
    pdga = await setQaPdga(apiBase, token, preferred);
  } else if (member?.pdgaNo && QA_PDGA_CANDIDATES.includes(member.pdgaNo)) {
    pdga = member.pdgaNo;
    seedPdgaCache(pdga);
  } else if (member?.pdgaNo && await hasLiveRating(apiBase, member.pdgaNo)) {
    pdga = member.pdgaNo;
  } else {
    pdga = await setQaPdga(apiBase, token);
  }
  const stats = await requestJson(apiBase, `/pdga-stats?pdga=${encodeURIComponent(pdga)}`);
  if (stats?.live_rating == null) throw new Error("Seeded QA PDGA data did not return a live rating.");
  console.log("staging dashboard QA data ready");
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
