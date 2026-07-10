import type { D1Like } from "./db.js";
import { aggregatePlayerRating, type RatingMethod, type RatingStream } from "./rating-engine.js";

export type RatingAnchorLookup = {
  readonly memberId: string | null;
  readonly pdgaNo?: string | null;
};

export type LayoutRatingBaseline = {
  readonly ssa: number;
  readonly ppt: number;
  readonly propagatorCount: number;
};

export type RoundRatingInput = {
  readonly memberId: string;
  readonly playerName: string;
  readonly stream: RatingStream;
  readonly eventId: number | null;
  readonly casualRoundCode: string | null;
  readonly courseId: number | null;
  readonly layoutId: number | null;
  readonly roundDate: string;
  readonly total: number;
  readonly toPar: number | null;
  readonly roundRating: number | null;
  readonly ssa: number | null;
  readonly ppt: number | null;
  readonly windGustMph: number | null;
  readonly weatherAdjustment: number;
  readonly propagatorCount: number;
  readonly ratingMethod: RatingMethod;
};

type PdgaCacheRow = {
  readonly data: string;
};

type PlayerRatingRow = {
  readonly rating: number | null;
};

type StoredRoundRatingRow = {
  readonly id: number;
  readonly round_rating: number | null;
  readonly round_date: string;
};

type LayoutSsaRow = {
  readonly ssa: number | null;
  readonly ppt: number | null;
  readonly propagator_count: number | null;
};

export async function findRatingAnchor(db: D1Like, lookup: RatingAnchorLookup): Promise<number | null> {
  const official = lookup.pdgaNo ? await cachedOfficialRating(db, lookup.pdgaNo) : null;
  if (official != null) return official;
  if (!lookup.memberId) return null;
  const local = await db
    .prepare("SELECT rating FROM player_ratings WHERE member_id = ? AND stream = 'competition'")
    .bind(lookup.memberId)
    .first<PlayerRatingRow>();
  return integerRating(local?.rating);
}

export async function clearRoundRatingsForEvent(db: D1Like, eventId: number): Promise<void> {
  await db.prepare("DELETE FROM round_ratings WHERE event_id = ?").bind(eventId).run();
}

export async function clearRoundRatingsForCasualRound(db: D1Like, roundCode: string): Promise<void> {
  await db.prepare("DELETE FROM round_ratings WHERE casual_round_code = ?").bind(roundCode).run();
}

export async function createRoundRating(db: D1Like, row: RoundRatingInput): Promise<void> {
  await db
    .prepare(
      `INSERT INTO round_ratings (
         member_id, player_name, stream, event_id, casual_round_code, course_id, layout_id,
         round_date, total, to_par, round_rating, ssa, ppt, wind_gust_mph, weather_adjustment,
         propagator_count, rating_method
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      row.memberId,
      row.playerName,
      row.stream,
      row.eventId,
      row.casualRoundCode,
      row.courseId,
      row.layoutId,
      row.roundDate,
      row.total,
      row.toPar,
      row.roundRating,
      row.ssa,
      row.ppt,
      row.windGustMph,
      row.weatherAdjustment,
      row.propagatorCount,
      row.ratingMethod,
    )
    .run();
}

export async function getLayoutRatingBaseline(db: D1Like, layoutId: number | null): Promise<LayoutRatingBaseline | null> {
  if (layoutId == null) return null;
  const row = await db
    .prepare("SELECT ssa, ppt, propagator_count FROM layout_ssa WHERE layout_id = ?")
    .bind(layoutId)
    .first<LayoutSsaRow>();
  const ssa = finiteNumber(row?.ssa);
  const ppt = finiteNumber(row?.ppt);
  if (ssa == null || ppt == null) return null;
  return { ssa, ppt, propagatorCount: Math.max(0, Math.round(finiteNumber(row?.propagator_count) ?? 0)) };
}

export async function upsertLayoutRatingBaseline(
  db: D1Like,
  input: { readonly layoutId: number; readonly eventId: number; readonly baseline: LayoutRatingBaseline },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO layout_ssa (layout_id, ssa, ppt, propagator_count, source_event_id, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(layout_id) DO UPDATE SET
         ssa = excluded.ssa,
         ppt = excluded.ppt,
         propagator_count = excluded.propagator_count,
         source_event_id = excluded.source_event_id,
         updated_at = excluded.updated_at`,
    )
    .bind(input.layoutId, input.baseline.ssa, input.baseline.ppt, input.baseline.propagatorCount, input.eventId)
    .run();
}

export async function upsertPlayerRatingFromRounds(
  db: D1Like,
  input: { readonly memberId: string; readonly stream: RatingStream; readonly now: string },
): Promise<void> {
  const rows = await db
    .prepare(
      `SELECT id, round_rating, round_date
       FROM round_ratings
       WHERE member_id = ? AND stream = ? AND round_rating IS NOT NULL
       ORDER BY round_date DESC, id DESC`,
    )
    .bind(input.memberId, input.stream)
    .all<StoredRoundRatingRow>();
  const summary = aggregatePlayerRating({
    now: input.now,
    rounds: rows.results.map((row) => ({ roundDate: row.round_date, roundRating: integerRating(row.round_rating) })),
  });
  await db
    .prepare(
      `INSERT INTO player_ratings (member_id, stream, rating, rated_rounds, weighted_rounds, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(member_id, stream) DO UPDATE SET
         rating = excluded.rating,
         rated_rounds = excluded.rated_rounds,
         weighted_rounds = excluded.weighted_rounds,
         updated_at = excluded.updated_at`,
    )
    .bind(input.memberId, input.stream, summary.rating, summary.ratedRounds, summary.weightedRounds, input.now)
    .run();
}

async function cachedOfficialRating(db: D1Like, pdgaNo: string): Promise<number | null> {
  const pdga = pdgaNo.replace(/\D/g, "");
  if (!pdga) return null;
  const row = await db.prepare("SELECT data FROM pdga_cache WHERE pdga = ?").bind(pdga).first<PdgaCacheRow>();
  if (!row?.data) return null;
  try {
    const parsed: unknown = JSON.parse(row.data);
    if (!isRecord(parsed)) return null;
    return integerRating(parsed["official_rating"]);
  } catch (error) {
    if (error instanceof Error) return null;
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function integerRating(value: unknown): number | null {
  const num = finiteNumber(value);
  return num == null ? null : Math.round(num);
}
