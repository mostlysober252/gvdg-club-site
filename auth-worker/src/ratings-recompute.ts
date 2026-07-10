import type { Env } from "./env.js";
import { fetchPdgaStats, type PdgaStats } from "./pdga.js";
import { upsertLayoutRatingBaseline, upsertPlayerRatingFromRounds } from "./rating-store.js";
import { listMembers, type AdminMember } from "./roster.js";
import type { RatingStream } from "./rating-engine.js";
import { recomputeRatingRows, type RecomputedLayoutBaseline, type RecomputedRoundRating, type StoredRoundRating } from "./ratings-recompute-core.js";

export type RatingsRecomputeResult = {
  readonly pdgaRefreshed: number;
  readonly roundRows: number;
  readonly playerRows: number;
  readonly layoutBaselines: number;
};

type StoredRoundRow = {
  readonly id: number;
  readonly member_id: string;
  readonly stream: string;
  readonly event_id: number | null;
  readonly casual_round_code: string | null;
  readonly layout_id: number | null;
  readonly round_date: string;
  readonly total: number;
  readonly to_par: number | null;
  readonly wind_gust_mph: number | null;
};

type LayoutBaselineRow = {
  readonly layout_id: number;
  readonly ssa: number;
  readonly ppt: number;
  readonly propagator_count: number;
};

type PdgaCacheRow = {
  readonly data: string | null;
};

type PlayerStreamKey = {
  readonly memberId: string;
  readonly stream: RatingStream;
};

const PDGA_REFRESH_MS = 20 * 60 * 60 * 1000;

export async function runRatingsRecompute(env: Env, doFetch: typeof fetch = fetch): Promise<RatingsRecomputeResult> {
  const members = await listMembers(env.ROSTER);
  const pdgaRefreshed = await refreshPdgaCache(env.DB, members, Date.now(), doFetch);
  const rows = await loadRoundRows(env.DB);
  const officialAnchors = await loadOfficialAnchors(env.DB, members);
  const layoutBaselines = await loadLayoutBaselines(env.DB);
  const now = new Date().toISOString();
  const recomputed = recomputeRatingRows({ rows, officialAnchors, layoutBaselines, now });
  await Promise.all(recomputed.rows.map((row) => updateRoundRating(env.DB, row)));
  await Promise.all(
    recomputed.layoutBaselines.map((row) =>
      upsertLayoutRatingBaseline(env.DB, { layoutId: row.layoutId, eventId: row.eventId, baseline: row }),
    ),
  );
  const playerKeys = memberStreamKeys(recomputed.rows);
  await Promise.all(playerKeys.map((key) => upsertPlayerRatingFromRounds(env.DB, { memberId: key.memberId, stream: key.stream, now })));
  return { pdgaRefreshed, roundRows: recomputed.rows.length, playerRows: playerKeys.length, layoutBaselines: recomputed.layoutBaselines.length };
}

async function refreshPdgaCache(db: D1Database, members: readonly AdminMember[], now: number, doFetch: typeof fetch): Promise<number> {
  let refreshed = 0;
  for (const member of members) {
    const pdga = digits(member.pdgaNo);
    if (!pdga) continue;
    const row = await db.prepare("SELECT fetched_at FROM pdga_cache WHERE pdga = ?").bind(pdga).first<{ readonly fetched_at: number | null }>();
    if (row?.fetched_at != null && now - Number(row.fetched_at) < PDGA_REFRESH_MS) continue;
    const stats = await freshPdgaStats(pdga, doFetch);
    if (!stats || (stats.official_rating == null && stats.events.length === 0)) continue;
    await db
      .prepare(
        "INSERT INTO pdga_cache (pdga, data, fetched_at) VALUES (?, ?, ?) " +
          "ON CONFLICT(pdga) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at",
      )
      .bind(pdga, JSON.stringify(stats), now)
      .run();
    refreshed++;
  }
  return refreshed;
}

async function freshPdgaStats(pdga: string, doFetch: typeof fetch): Promise<PdgaStats | null> {
  try {
    return await fetchPdgaStats(pdga, doFetch);
  } catch (error) {
    if (error instanceof Error) return null;
    throw error;
  }
}

async function loadRoundRows(db: D1Database): Promise<StoredRoundRating[]> {
  const rows = await db
    .prepare(
      `SELECT rr.id, rr.member_id, rr.stream, rr.event_id, rr.casual_round_code, rr.layout_id,
              rr.round_date, rr.total, rr.to_par, rr.wind_gust_mph
       FROM round_ratings rr
       ORDER BY rr.round_date, rr.id`,
    )
    .all<StoredRoundRow>();
  return rows.results.map((row) => ({
    id: row.id,
    memberId: row.member_id,
    stream: row.stream === "casual" ? "casual" : "competition",
    eventId: row.event_id,
    casualRoundCode: row.casual_round_code,
    layoutId: row.layout_id,
    roundDate: row.round_date,
    total: row.total,
    toPar: row.to_par,
    windGustMph: finiteNumber(row.wind_gust_mph),
  }));
}

async function loadLayoutBaselines(db: D1Database): Promise<Map<number, Omit<RecomputedLayoutBaseline, "layoutId" | "eventId">>> {
  const rows = await db.prepare("SELECT layout_id, ssa, ppt, propagator_count FROM layout_ssa").all<LayoutBaselineRow>();
  return new Map(rows.results.map((row) => [row.layout_id, { ssa: row.ssa, ppt: row.ppt, propagatorCount: row.propagator_count }]));
}

async function loadOfficialAnchors(db: D1Database, members: readonly AdminMember[]): Promise<Map<string, number>> {
  const anchors = new Map<string, number>();
  for (const member of members) {
    const pdga = digits(member.pdgaNo);
    if (!pdga) continue;
    const row = await db.prepare("SELECT data FROM pdga_cache WHERE pdga = ?").bind(pdga).first<PdgaCacheRow>();
    const rating = officialRating(row?.data);
    if (rating != null && rating >= 700) anchors.set(member.memberId, rating);
  }
  return anchors;
}

function memberStreamKeys(rows: readonly RecomputedRoundRating[]): readonly PlayerStreamKey[] {
  const keys = new Map<string, PlayerStreamKey>();
  for (const row of rows) keys.set(`${row.memberId}|${row.stream}`, { memberId: row.memberId, stream: row.stream });
  return [...keys.values()];
}

async function updateRoundRating(db: D1Database, row: RecomputedRoundRating): Promise<void> {
  await db
    .prepare(
      `UPDATE round_ratings
       SET round_rating = ?, ssa = ?, ppt = ?, wind_gust_mph = ?, weather_adjustment = ?,
           propagator_count = ?, rating_method = ?
       WHERE id = ?`,
    )
    .bind(row.roundRating, row.ssa, row.ppt, row.windGustMph, row.weatherAdjustment, row.propagatorCount, row.ratingMethod, row.id)
    .run();
  // Only mirror a real rating onto the displayed results row. A re-solve that comes back unrated
  // (roundRating null) must NOT wipe a rating that was previously stored + shown — leave it as-is.
  if (row.stream === "competition" && row.eventId != null && row.roundRating != null) {
    await db.prepare("UPDATE results SET rating = ? WHERE event_id = ? AND member_id = ?").bind(row.roundRating, row.eventId, row.memberId).run();
  }
}

function digits(value: string | null | undefined): string | null {
  const pdga = value?.replace(/\D/g, "") ?? "";
  return pdga || null;
}

function officialRating(data: string | null | undefined): number | null {
  if (!data) return null;
  try {
    const parsed: unknown = JSON.parse(data);
    if (!isRecord(parsed)) return null;
    const rating = parsed["official_rating"];
    return typeof rating === "number" && Number.isFinite(rating) ? Math.round(rating) : null;
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}
