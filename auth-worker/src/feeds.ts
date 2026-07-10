// The club maintains its real schedule in two published Google Sheets (same source the homepage reads):
//   TOURNAMENT_FEED — PDGA/club tournaments (Date, Name, Location, Tier, URL)
//   EVENT_FEED      — club happenings (date, title, description, url, active): a MIX of league rounds
//                     (e.g. "GVDG Doubles League") and club business (e.g. "Club Meeting").
// This module fetches + parses them in the Worker (cached in D1) and splits them into the club's two
// categories so Crotts can talk about them correctly:
//   "events"      = disc golf tournaments + league rounds
//   "club events" = fundraisers, meetings, minutes
// Anything that doesn't look like club business is treated as a competitive event (the common case).

import type { Env } from "./env.js";
import * as db from "./db.js";
import { json } from "./http.js";
import { D1KV } from "./d1kv.js";

const TOURNAMENT_FEED =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vRz6V6BAwII4eoqITz4MW5zmM_3mYJqrtqtZl9xB87lAZgDT1E0Do1r2cp2aa1tvEKWevnPhb2zQu4s/pub?gid=0&single=true&output=csv";
const EVENT_FEED =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vTLTq17Bwgy6uW_9pG7dQODTmahv7vjxo9Y5EShHaeQYo9xPB2m7Nf5de8EcZvKgcrTbBLb97msMg4Q/pub?output=csv";

const CACHE_TTL_SEC = 3600; // refresh the sheets at most ~hourly
const UA = "Mozilla/5.0 (compatible; GVDGClubBot/1.0; +https://gvdgclub.com)";

// Club-business keywords -> "club events"; everything else in the event feed is a league/competitive event.
const CLUB_RE = /\b(meeting|minutes|agenda|fundrais|donat|social|banquet|cleanup|clean-up|volunteer|board|election|membership drive|potluck|holiday party)\b/i;

export interface FeedItem {
  name: string;
  date: string | null; // human display string as published
  epoch: number; // ms for sort/upcoming filtering; 0 = unknown/TBD
  detail?: string; // location/tier or description
  url?: string;
}
export interface ClubFeeds {
  events: FeedItem[]; // tournaments + league rounds
  clubEvents: FeedItem[]; // fundraisers, meetings, minutes
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else { q = false; }
      } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { out.push(cur.trim()); cur = ""; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};

/** Parse the handful of date shapes these sheets use ("May 24, 2026", "6/29", "6/29/2026", "2026-06-29")
 *  into an epoch (ms). A bare M/D with no year rolls forward if it's more than ~60 days in the past. */
function parseFeedDate(raw: string, now: number): number {
  const s = (raw || "").trim();
  if (!s || /^tbd$/i.test(s)) return 0;
  let m = s.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s*(\d{4})?/); // Month D[, YYYY]
  if (m) {
    const mi = MONTHS[m[1]!.slice(0, 3).toLowerCase()];
    if (mi !== undefined) return Date.UTC(m[3] ? +m[3] : new Date(now).getUTCFullYear(), mi, +m[2]!);
  }
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); // YYYY-MM-DD
  if (m) return Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!);
  m = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/); // M/D[/YY[YY]]
  if (m) {
    let y = m[3] ? +m[3] : new Date(now).getUTCFullYear();
    if (y < 100) y += y < 50 ? 2000 : 1900;
    let t = Date.UTC(y, +m[1]! - 1, +m[2]!);
    if (!m[3] && t < now - 60 * 86400000) t = Date.UTC(y + 1, +m[1]! - 1, +m[2]!); // roll forward
    return t;
  }
  const d = Date.parse(s);
  return Number.isNaN(d) ? 0 : d;
}

export function parseTournaments(csv: string, now: number): FeedItem[] {
  const lines = csv.trim().split(/\r?\n/);
  const out: FeedItem[] = [];
  for (let i = 1; i < lines.length; i++) {
    const v = parseCsvLine(lines[i]!);
    if (!v[1]) continue;
    const detail = [v[2], v[3]].filter(Boolean).join(" · ");
    out.push({ name: v[1], date: v[0] || null, epoch: parseFeedDate(v[0] || "", now), detail: detail || undefined, url: v[4] || undefined });
  }
  return out;
}

export function parseEvents(csv: string, now: number): { events: FeedItem[]; clubEvents: FeedItem[] } {
  const lines = csv.trim().split(/\r?\n/);
  const events: FeedItem[] = [];
  const clubEvents: FeedItem[] = [];
  if (lines.length < 2) return { events, clubEvents };
  const headers = parseCsvLine(lines[0]!).map((h) => h.toLowerCase());
  const col = (row: string[], name: string) => row[headers.indexOf(name)] ?? "";
  for (let i = 1; i < lines.length; i++) {
    const v = parseCsvLine(lines[i]!);
    const title = col(v, "title").trim();
    const date = col(v, "date").trim();
    if (!title || !date || col(v, "active").toUpperCase() === "FALSE") continue;
    const desc = col(v, "description").trim();
    const item: FeedItem = { name: title, date: date || null, epoch: parseFeedDate(date, now), detail: desc || undefined, url: col(v, "url") || undefined };
    (CLUB_RE.test(title + " " + desc) ? clubEvents : events).push(item);
  }
  return { events, clubEvents };
}

async function fetchText(url: string): Promise<string> {
  const r = await fetch(url, { headers: { "user-agent": UA, accept: "text/csv,text/plain" }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error("feed_" + r.status);
  return r.text();
}

/** Fetch + parse + split both sheets, cached in D1 (kv_store ns "feedcache", ~hourly). Returns empty
 *  lists on total failure; partial failure keeps whatever parsed. `now` is injected for testability. */
export async function fetchClubFeeds(env: Env, now: number = Date.now()): Promise<ClubFeeds> {
  const cache = new D1KV(env.DB, "feedcache");
  try {
    const hit = await cache.get("v1");
    if (hit) return JSON.parse(hit) as ClubFeeds;
  } catch { /* fall through to a fresh fetch */ }

  const [tourRes, evtRes] = await Promise.allSettled([fetchText(TOURNAMENT_FEED), fetchText(EVENT_FEED)]);
  const tournaments = tourRes.status === "fulfilled" ? parseTournaments(tourRes.value, now) : [];
  const evtSplit = evtRes.status === "fulfilled" ? parseEvents(evtRes.value, now) : { events: [], clubEvents: [] };

  const result: ClubFeeds = {
    events: [...tournaments, ...evtSplit.events],
    clubEvents: evtSplit.clubEvents,
  };
  if (result.events.length || result.clubEvents.length) {
    try { await cache.put("v1", JSON.stringify(result), { expirationTtl: CACHE_TTL_SEC }); } catch { /* best-effort */ }
  }
  return result;
}

/** Keep upcoming items (and very-recent ones), soonest first, capped. Items with unknown dates sort last
 *  but are still included so nothing silently disappears. */
export function upcoming(items: FeedItem[], now: number, limit: number): FeedItem[] {
  const cutoff = now - 3 * 86400000; // include the last few days as "recent"
  return items
    .filter((e) => e.epoch === 0 || e.epoch >= cutoff)
    .sort((a, b) => (a.epoch || Infinity) - (b.epoch || Infinity))
    .slice(0, limit);
}

function dateOf(e: Record<string, unknown>): string {
  return String(e.date ?? e.starts_at ?? "");
}

/** The club's full calendar split into the two categories, merging the Google Sheet feeds with the D1
 *  tables (events by type, plus meetings and active fundraisers). A wider window than upcoming() so the
 *  page can show recent meeting minutes too. Shared by Crotts and the /club-feed endpoint. */
export async function getClubCalendar(env: Env, now: number = Date.now()): Promise<ClubFeeds> {
  const [feeds, d1events, meetings, fundraisers] = await Promise.all([
    fetchClubFeeds(env, now).catch(() => ({ events: [], clubEvents: [] }) as ClubFeeds),
    db.listEvents(env.DB, {}).catch(() => [] as Record<string, unknown>[]),
    db.listMeetings(env.DB).catch(() => [] as Record<string, unknown>[]),
    db.listFundraisers(env.DB).catch(() => [] as Record<string, unknown>[]),
  ]);
  const item = (name: string, raw: string, detail?: string, url?: string): FeedItem => ({ name, date: raw || null, epoch: parseFeedDate(raw, now), detail, url });
  const evRows = d1events as Record<string, unknown>[];

  const events: FeedItem[] = [
    ...feeds.events,
    ...evRows.filter((e) => e.type === "tournament" || e.type === "league_round").map((e) => item(String(e.name ?? ""), dateOf(e), (e.notes as string) || undefined, (e.external_url as string) || undefined)),
  ];
  const clubEvents: FeedItem[] = [
    ...feeds.clubEvents,
    ...evRows.filter((e) => e.type === "fundraiser" || e.type === "meeting").map((e) => item(String(e.name ?? ""), dateOf(e), (e.notes as string) || undefined)),
    ...(meetings as Record<string, unknown>[]).map((m) => item(String(m.title ?? "Meeting"), dateOf(m), "Minutes posted")),
    // Active fundraisers are ongoing, not date-bound — stamp them "now" so they always count as current.
    ...(fundraisers as Record<string, unknown>[]).filter((f) => f.status === "active").map((f) => ({ name: String(f.title ?? "Fundraiser"), date: (f.starts_at as string) || null, epoch: now, detail: "Fundraiser", url: (f.paypal_url as string) || undefined } as FeedItem)),
  ];

  // Soonest first; include the last ~45 days so recent rounds/minutes still show. Unknown dates last.
  const recent = (xs: FeedItem[]) =>
    xs.filter((e) => e.epoch === 0 || e.epoch >= now - 45 * 86400000).sort((a, b) => (a.epoch || Infinity) - (b.epoch || Infinity)).slice(0, 25);
  return { events: recent(events), clubEvents: recent(clubEvents) };
}

/** GET /club-feed — the categorized club calendar (Events vs Club Events) for the events page. */
export async function handleClubFeed(env: Env, origin: string | null): Promise<Response> {
  try {
    const cal = await getClubCalendar(env);
    return json(cal, 200, origin, { "Cache-Control": "public, max-age=600" });
  } catch {
    return json({ events: [], clubEvents: [] }, 200, origin);
  }
}
