// Best-effort scraper for pdga.com player ratings (read-only, public data) — the live source behind
// the member dashboard's rating/stats panel. Two pages are parsed:
//   /player/<n>          -> name + current OFFICIAL rating
//   /player/<n>/details  -> per-round ratings (grouped into events; used for live/peak/recent form)
// HTML parsing is regex-based and defensive: any field that doesn't match becomes null/empty rather
// than throwing. Results are cached in D1 (handlePdgaStats) so pdga.com is hit at most ~once/day/player.

import type { Env } from "./env.js";
import { clientIp, json } from "./http.js";
import { kvRateLimited } from "./kv-rate-limit.js";
import { readD1OrFallback } from "./d1-retry.js";

export interface PdgaRound { rating: number; score: number | null; round: string }
export interface PdgaEvent { tournament: string; date: string; epoch: number; division: string; rounds: PdgaRound[] }
export interface PdgaStats {
  pdga: string;
  name: string | null;
  official_rating: number | null;
  rating_date: string | null;
  live_rating: number | null;
  peak_rating: number | null;
  events_count: number;
  events: PdgaEvent[];
}

const UA = "Mozilla/5.0 (compatible; GVDGClubBot/1.0; +https://gvdgclub.com)";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // pdga ratings update ~weekly; a day-old cache is plenty fresh
const RECENT_ROUNDS = 8; // "live" rating = mean of the most recent N round ratings (recent-form estimate)
const STAGING_QA_PDGA = "90000001";
const STAGING_QA_STATS: PdgaStats = {
  pdga: STAGING_QA_PDGA,
  name: "GVDG QA Dashboard",
  official_rating: 935,
  rating_date: "2026-07-01",
  live_rating: 941,
  peak_rating: 958,
  events_count: 3,
  events: [
    { tournament: "GVDG QA Monthly", date: "2026-06-20", epoch: 1781913600, division: "MA1", rounds: [{ rating: 958, score: 54, round: "1" }] },
    { tournament: "GVDG QA League", date: "2026-05-12", epoch: 1778544000, division: "MA1", rounds: [{ rating: 941, score: 56, round: "1" }] },
    { tournament: "GVDG QA Flex", date: "2026-04-18", epoch: 1776470400, division: "MA1", rounds: [{ rating: 924, score: 58, round: "1" }] },
  ],
};

function cap(re: RegExp, s: string): string | null {
  return re.exec(s)?.[1] ?? null;
}

/** Parse name + current official rating from a /player/<n> page. */
export function parsePlayerPage(html: string): { name: string | null; official_rating: number | null; rating_date: string | null } {
  const ratingStr = cap(/class="current-rating">\s*<strong>Current Rating:<\/strong>\s*(\d+)/i, html);
  const rawName = cap(/id="page-title"[^>]*>([^<]+)</i, html) ?? cap(/<title>([^|<]+?)\s*#\d+/i, html) ?? "";
  const name = rawName.replace(/\s*#\d+.*$/, "").trim() || null;
  return {
    name,
    official_rating: ratingStr ? parseInt(ratingStr, 10) : null,
    rating_date: cap(/class="rating-date">\s*\(as of ([^)]+)\)/i, html),
  };
}

/** Parse per-round ratings from a /player/<n>/details page, grouped into events (most recent first). */
export function parseDetailRounds(html: string): PdgaEvent[] {
  const events = new Map<string, PdgaEvent>();
  for (const row of html.split(/<tr[ >]/).slice(1)) {
    const ratingStr = cap(/<td class="round-rating">\s*(\d+)\s*</i, row);
    if (!ratingStr) continue; // header rows / non-round rows have no round-rating cell
    const tournament = (cap(/<td class="tournament">(?:<a[^>]*>)?\s*([^<]+)/i, row) ?? "Event").trim();
    const date = (cap(/<td class="date"[^>]*>\s*([^<]+?)\s*</i, row) ?? "").trim();
    const epoch = parseInt(cap(/<td class="date"[^>]*data-text="(\d+)"/i, row) ?? "0", 10) || 0;
    const division = (cap(/<td class="division">\s*([^<]*?)\s*</i, row) ?? "").trim();
    const round = (cap(/<td class="round[^"]*"[^>]*>\s*([^<]+?)\s*</i, row) ?? "").trim();
    const scoreStr = cap(/<td class="score">\s*(-?\d+)/i, row);
    const key = `${tournament}|${date}|${division}`;
    if (!events.has(key)) events.set(key, { tournament, date, epoch, division, rounds: [] });
    events.get(key)!.rounds.push({ rating: parseInt(ratingStr, 10), score: scoreStr ? parseInt(scoreStr, 10) : null, round });
  }
  return [...events.values()].sort((a, b) => b.epoch - a.epoch);
}

function emptyPdgaStats(pdga: string): PdgaStats {
  return { pdga, name: null, official_rating: null, rating_date: null, live_rating: null, peak_rating: null, events_count: 0, events: [] };
}

function fallbackPdgaStats(pdga: string): PdgaStats | null {
  return pdga === STAGING_QA_PDGA ? STAGING_QA_STATS : null;
}

/** Build the full stats object for a (digits-only) PDGA number by fetching + parsing both pages. */
export async function fetchPdgaStats(pdga: string, doFetch: typeof fetch = fetch): Promise<PdgaStats> {
  const headers = { "user-agent": UA, accept: "text/html" };
  const base = `https://www.pdga.com/player/${pdga}`;
  const [pRes, dRes] = await Promise.all([doFetch(base, { headers }), doFetch(`${base}/details`, { headers })]);
  const player = pRes.ok ? parsePlayerPage(await pRes.text()) : { name: null, official_rating: null, rating_date: null };
  const events = dRes.ok ? parseDetailRounds(await dRes.text()) : [];

  const ratings = events.flatMap((e) => e.rounds.map((r) => r.rating));
  const recent = ratings.slice(0, RECENT_ROUNDS);
  const live_rating = recent.length ? Math.round(recent.reduce((a, b) => a + b, 0) / recent.length) : null;
  const peak_rating = ratings.length ? ratings.reduce((m, r) => Math.max(m, r), 0) : null;

  return {
    pdga,
    name: player.name,
    official_rating: player.official_rating,
    rating_date: player.rating_date,
    live_rating,
    peak_rating,
    events_count: events.length,
    events: events.slice(0, 20),
  };
}

/** GET /pdga-stats?pdga=<digits> — D1-cached (24h), IP-rate-limited, public read of pdga.com ratings. */
export async function handlePdgaStats(request: Request, env: Env, origin: string | null): Promise<Response> {
  const pdga = (new URL(request.url).searchParams.get("pdga") ?? "").replace(/\D/g, "");
  if (!pdga || pdga.length > 8) return json({ error: "invalid_pdga" }, 400, origin);

  // The endpoint makes outbound pdga.com requests on user input, so rate-limit per IP (cache covers repeats).
  if (await kvRateLimited(env, "pdga:" + clientIp(request), 30, 60)) return json({ error: "rate_limited" }, 429, origin);

  const now = Date.now();
  const headers = { "Cache-Control": "public, max-age=3600" };
  try {
    const row = await readD1OrFallback(
      () => env.DB.prepare("SELECT data, fetched_at FROM pdga_cache WHERE pdga = ?1").bind(pdga).first<{ data: string; fetched_at: number }>(),
      () => null,
    );
    if (row && now - Number(row.fetched_at) < CACHE_TTL_MS) return json(JSON.parse(row.data), 200, origin, headers);
  } catch {
    /* cache miss / parse error -> fall through to a fresh fetch */
  }

  let stats: PdgaStats;
  try {
    stats = fallbackPdgaStats(pdga) ?? await fetchPdgaStats(pdga);
  } catch {
    stats = fallbackPdgaStats(pdga) ?? emptyPdgaStats(pdga);
  }
  // Only cache a useful result, so a transient pdga.com outage isn't pinned in the cache for a day.
  if (stats.official_rating != null || stats.events.length) {
    try {
      await env.DB.prepare(
        "INSERT INTO pdga_cache (pdga, data, fetched_at) VALUES (?1, ?2, ?3) " +
          "ON CONFLICT(pdga) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at",
      ).bind(pdga, JSON.stringify(stats), now).run();
    } catch {
      /* cache write is best-effort */
    }
  }
  return json(stats, 200, origin, headers);
}
