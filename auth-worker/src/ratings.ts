import type { D1Like } from "./db.js";

const GVDG_BASE_RATING = 900;
const POINTS_PER_THROW = 10;
const MIN_ROUND_RATING = 300;
const MAX_ROUND_RATING = 1200;

export type RatingKind = "competitive" | "casual";
export type RatingSource = "stored" | "estimated" | "unrated";

export interface RatingRound {
  readonly kind: RatingKind;
  readonly id: number | null;
  readonly label: string;
  readonly date: string | null;
  readonly course_name: string | null;
  readonly layout_name: string | null;
  readonly round_code: string | null;
  readonly place: number | null;
  readonly total: number | null;
  readonly to_par: number | null;
  readonly rating: number | null;
  readonly rating_source: RatingSource;
  readonly match_result: string | null;
  readonly scoring_group: string | null;
  readonly scorecard: string | null;
  readonly udisc_course_id: string | null;
}

export interface RatingGroup {
  readonly live_rating: number | null;
  readonly rated_rounds: number;
  readonly rounds_count: number;
  readonly rounds: readonly RatingRound[];
}

export interface MemberRatings {
  readonly competitive: RatingGroup;
  readonly casual: RatingGroup;
}

interface RatingValue {
  readonly rating: number | null;
  readonly source: RatingSource;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function intOrNull(value: unknown): number | null {
  const n = numberOrNull(value);
  return n == null ? null : Math.round(n);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function clampRating(rating: number): number {
  return Math.max(MIN_ROUND_RATING, Math.min(MAX_ROUND_RATING, rating));
}

export function estimateRoundRating(toPar: number | null): number | null {
  if (toPar == null) return null;
  return clampRating(Math.round(GVDG_BASE_RATING - toPar * POINTS_PER_THROW));
}

function ratingForRound(row: Record<string, unknown>): RatingValue {
  const place = intOrNull(row.place);
  const total = intOrNull(row.total);
  const toPar = intOrNull(row.to_par);
  if (place == null || total == null || toPar == null) return { rating: null, source: "unrated" };
  const stored = intOrNull(row.rating);
  if (stored != null) return { rating: stored, source: "stored" };
  const estimated = estimateRoundRating(toPar);
  return estimated == null ? { rating: null, source: "unrated" } : { rating: estimated, source: "estimated" };
}

function competitiveLabel(row: Record<string, unknown>): string {
  return stringOrNull(row.event_name) ?? "GVDG competitive round";
}

function casualLabel(row: Record<string, unknown>): string {
  const course = stringOrNull(row.course_name);
  const layout = stringOrNull(row.layout_name);
  if (course && layout) return course + " · " + layout;
  return course ?? layout ?? "Casual round";
}

function ratingRound(kind: RatingKind, row: Record<string, unknown>): RatingRound {
  // A matchplay round (identified by a stored match_result) has no stroke rating — surface the match
  // result instead and leave it unrated, so it never contributes to the member's live rating.
  const matchResult = stringOrNull(row.match_result);
  const rating: RatingValue = matchResult ? { rating: null, source: "unrated" } : ratingForRound(row);
  return {
    kind,
    id: intOrNull(row.id),
    label: kind === "competitive" ? competitiveLabel(row) : casualLabel(row),
    date: kind === "competitive" ? stringOrNull(row.event_date) : stringOrNull(row.finalized_at),
    course_name: stringOrNull(row.course_name),
    layout_name: stringOrNull(row.layout_name),
    round_code: stringOrNull(row.round_code),
    place: intOrNull(row.place),
    total: intOrNull(row.total),
    to_par: intOrNull(row.to_par),
    rating: rating.rating,
    rating_source: rating.source,
    match_result: matchResult,
    scoring_group: stringOrNull(row.scoring_group),
    scorecard: stringOrNull(row.scorecard),
    udisc_course_id: stringOrNull(row.udisc_course_id),
  };
}

export function summarizeRatingRows(kind: RatingKind, rows: readonly Record<string, unknown>[]): RatingGroup {
  const rounds = rows.map((row) => ratingRound(kind, row));
  const ratings = rounds.map((round) => round.rating).filter((rating): rating is number => rating != null);
  const liveRating = ratings.length ? Math.round(ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length) : null;
  return {
    live_rating: liveRating,
    rated_rounds: ratings.length,
    rounds_count: rounds.length,
    rounds,
  };
}

async function competitiveRows(
  db: D1Like,
  memberId: string,
  opts: { limit?: number | null; offset?: number | null } = {},
): Promise<readonly Record<string, unknown>[]> {
  const binds: unknown[] = [memberId];
  const limit = Number.isInteger(opts.limit) && opts.limit != null ? opts.limit : null;
  const rawOffset = opts.offset;
  const offset = typeof rawOffset === "number" && Number.isInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0;
  let sql =
    `SELECT r.id, r.event_id, r.member_id, r.name, r.place, r.total, r.to_par, r.rating, r.breakdown, r.scorecard,
            r.created_at, r.scoring_group, r.match_result, e.name AS event_name, e.date AS event_date,
            e.type AS event_type, c.name AS course_name, c.udisc_course_id AS udisc_course_id, l.name AS layout_name
     FROM results r
     JOIN events e ON e.id = r.event_id
     LEFT JOIN courses c ON c.id = e.course_id
     LEFT JOIN course_layouts l ON l.id = e.layout_id
     WHERE r.member_id = ?
     ORDER BY COALESCE(e.date, r.created_at) DESC, r.created_at DESC, r.id DESC`;
  if (limit != null) {
    sql += " LIMIT ?";
    binds.push(limit);
    if (offset > 0) {
      sql += " OFFSET ?";
      binds.push(offset);
    }
  }
  return (await db.prepare(sql).bind(...binds).all()).results;
}

async function casualRows(
  db: D1Like,
  memberId: string,
  opts: { limit?: number | null; offset?: number | null } = {},
): Promise<readonly Record<string, unknown>[]> {
  const binds: unknown[] = [memberId];
  const limit = Number.isInteger(opts.limit) && opts.limit != null ? opts.limit : null;
  const rawOffset = opts.offset;
  const offset = typeof rawOffset === "number" && Number.isInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0;
  let sql =
    `SELECT cr.*, r.round_code, r.course_name, r.layout_name, r.layout_id, r.finalized_at,
            c.udisc_course_id AS udisc_course_id
     FROM casual_results cr
     JOIN casual_rounds r ON r.id = cr.casual_round_id
     LEFT JOIN courses c ON c.id = r.course_id
     WHERE cr.member_id = ?
     ORDER BY r.finalized_at DESC, cr.created_at DESC, cr.id DESC`;
  if (limit != null) {
    sql += " LIMIT ?";
    binds.push(limit);
    if (offset > 0) {
      sql += " OFFSET ?";
      binds.push(offset);
    }
  }
  return (await db.prepare(sql).bind(...binds).all()).results;
}

export async function getMemberRatings(
  db: D1Like,
  memberId: string,
  opts: {
    competitiveLimit?: number | null;
    competitiveOffset?: number | null;
    casualLimit?: number | null;
    casualOffset?: number | null;
  } = {},
): Promise<MemberRatings> {
  const [competitive, casual] = await Promise.all([
    competitiveRows(db, memberId, { limit: opts.competitiveLimit ?? null, offset: opts.competitiveOffset ?? null }),
    casualRows(db, memberId, { limit: opts.casualLimit ?? null, offset: opts.casualOffset ?? null }),
  ]);
  return {
    competitive: summarizeRatingRows("competitive", competitive),
    casual: summarizeRatingRows("casual", casual),
  };
}
