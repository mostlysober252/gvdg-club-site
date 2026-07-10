import { aggregatePlayerRating, roundRatingForScoreWithWeather, solveSsa, type RatingMethod, type RatingStream } from "./rating-engine.js";

export type StoredRoundRating = {
  readonly id: number;
  readonly memberId: string;
  readonly stream: RatingStream;
  readonly eventId: number | null;
  readonly casualRoundCode: string | null;
  readonly layoutId: number | null;
  readonly roundDate: string;
  readonly total: number;
  readonly toPar: number | null;
  readonly windGustMph: number | null;
};

export type RecomputedRoundRating = StoredRoundRating & {
  readonly roundRating: number | null;
  readonly ssa: number | null;
  readonly ppt: number | null;
  readonly weatherAdjustment: number;
  readonly propagatorCount: number;
  readonly ratingMethod: RatingMethod;
};

export type RecomputedLayoutBaseline = {
  readonly layoutId: number;
  readonly eventId: number;
  readonly ssa: number;
  readonly ppt: number;
  readonly propagatorCount: number;
};

type GroupContext = {
  readonly ssa: number;
  readonly ppt: number;
  readonly propagatorCount: number;
  readonly ratingMethod: RatingMethod;
};

type GroupedRound = {
  readonly key: string;
  readonly stream: RatingStream;
  readonly eventId: number | null;
  readonly layoutId: number | null;
  readonly dateMs: number;
  readonly rows: readonly StoredRoundRating[];
};

const FIXED_POINT_PASSES = 6;

export function recomputeRatingRows(input: {
  readonly rows: readonly StoredRoundRating[];
  readonly officialAnchors: ReadonlyMap<string, number>;
  readonly layoutBaselines: ReadonlyMap<number, Omit<RecomputedLayoutBaseline, "layoutId" | "eventId">>;
  readonly now: string;
}): { readonly rows: readonly RecomputedRoundRating[]; readonly layoutBaselines: readonly RecomputedLayoutBaseline[] } {
  let computed: readonly RecomputedRoundRating[] = input.rows.map((row) => unrated(row));
  let streamRatings = aggregateStreams(computed, input.now);
  let baselines = new Map(input.layoutBaselines);
  let nextLayoutBaselines: readonly RecomputedLayoutBaseline[] = [];

  for (let pass = 0; pass < FIXED_POINT_PASSES; pass++) {
    const anchors = anchorsForPass(input.officialAnchors, streamRatings);
    const next = computeRoundGroups(input.rows, anchors, baselines);
    nextLayoutBaselines = next.layoutBaselines;
    let baselinesChanged = false;
    for (const baseline of nextLayoutBaselines) {
      baselinesChanged = baselinesChanged || !sameBaseline(baselines.get(baseline.layoutId), baseline);
      baselines.set(baseline.layoutId, baseline);
    }
    const nextStreamRatings = aggregateStreams(next.rows, input.now);
    if (!baselinesChanged && sameRatings(streamRatings, nextStreamRatings)) return next;
    computed = next.rows;
    streamRatings = nextStreamRatings;
  }

  return { rows: computed, layoutBaselines: nextLayoutBaselines };
}

function computeRoundGroups(
  rows: readonly StoredRoundRating[],
  anchors: ReadonlyMap<string, number>,
  layoutBaselines: ReadonlyMap<number, Omit<RecomputedLayoutBaseline, "layoutId" | "eventId">>,
): { readonly rows: readonly RecomputedRoundRating[]; readonly layoutBaselines: readonly RecomputedLayoutBaseline[] } {
  const out: RecomputedRoundRating[] = [];
  const baselines: RecomputedLayoutBaseline[] = [];
  for (const group of groupedRounds(rows)) {
    const baseline = group.stream === "casual" && group.layoutId != null ? layoutBaselines.get(group.layoutId) : null;
    const solved: GroupContext | null = baseline ? { ...baseline, ratingMethod: "layout" } : solveGroup(group, anchors);
    out.push(...group.rows.map((row) => rateRow(row, solved)));
    if (group.stream === "competition" && group.layoutId != null && group.eventId != null && solved && solved.ratingMethod !== "layout") {
      baselines.push({ layoutId: group.layoutId, eventId: group.eventId, ssa: solved.ssa, ppt: solved.ppt, propagatorCount: solved.propagatorCount });
    }
  }
  return { rows: out, layoutBaselines: baselines };
}

function groupedRounds(rows: readonly StoredRoundRating[]): readonly GroupedRound[] {
  const groups = new Map<string, StoredRoundRating[]>();
  for (const row of rows) {
    const key = row.stream === "competition" ? `event:${row.eventId ?? row.id}` : `casual:${row.casualRoundCode ?? row.id}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()]
    .flatMap(([key, groupRows]) => {
      const first = groupRows[0];
      return first ? [{ key, stream: first.stream, eventId: first.eventId, layoutId: first.layoutId, dateMs: Date.parse(first.roundDate), rows: groupRows }] : [];
    })
    .sort((a, b) => (Number.isFinite(a.dateMs) ? a.dateMs : 0) - (Number.isFinite(b.dateMs) ? b.dateMs : 0) || a.key.localeCompare(b.key));
}

function solveGroup(group: GroupedRound, anchors: ReadonlyMap<string, number>): GroupContext | null {
  const solved = solveSsa(group.rows.flatMap((row) => {
    const rating = anchors.get(anchorKey(row.memberId, row.stream)) ?? anchors.get(anchorKey(row.memberId, "competition")) ?? anchors.get(row.memberId);
    return rating == null ? [] : [{ score: row.total, rating }];
  }));
  return solved ? { ssa: solved.ssa, ppt: solved.ppt, propagatorCount: solved.propagatorCount, ratingMethod: solved.status } : null;
}

function rateRow(row: StoredRoundRating, context: GroupContext | null): RecomputedRoundRating {
  if (!context) return unrated(row);
  const rated = roundRatingForScoreWithWeather({
    score: row.total,
    ssa: context.ssa,
    ppt: context.ppt,
    weather: context.ratingMethod === "layout" ? { windGustMph: row.windGustMph } : null,
  });
  return {
    ...row,
    roundRating: rated.roundRating,
    ssa: rated.ssa,
    ppt: rated.ppt,
    weatherAdjustment: rated.weatherAdjustment,
    propagatorCount: context.propagatorCount,
    ratingMethod: context.ratingMethod,
  };
}

function aggregateStreams(rows: readonly RecomputedRoundRating[], now: string): Map<string, number> {
  const byKey = new Map<string, RecomputedRoundRating[]>();
  for (const row of rows) {
    const key = anchorKey(row.memberId, row.stream);
    byKey.set(key, [...(byKey.get(key) ?? []), row]);
  }
  const ratings = new Map<string, number>();
  for (const [key, playerRows] of byKey) {
    const summary = aggregatePlayerRating({ now, rounds: playerRows.map((row) => ({ roundDate: row.roundDate, roundRating: row.roundRating })) });
    if (summary.rating != null) ratings.set(key, summary.rating);
  }
  return ratings;
}

function anchorsForPass(officialAnchors: ReadonlyMap<string, number>, streamRatings: ReadonlyMap<string, number>): Map<string, number> {
  const anchors = new Map<string, number>();
  for (const [memberId, rating] of officialAnchors) anchors.set(memberId, rating);
  for (const [key, rating] of streamRatings) {
    const sep = key.indexOf("|");
    const memberId = sep >= 0 ? key.slice(0, sep) : key;
    if (!officialAnchors.has(memberId)) anchors.set(key, rating);
  }
  return anchors;
}

function sameRatings(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [key, value] of a) if (b.get(key) !== value) return false;
  return true;
}

function sameBaseline(a: Omit<RecomputedLayoutBaseline, "layoutId" | "eventId"> | undefined, b: RecomputedLayoutBaseline): boolean {
  return a?.ssa === b.ssa && a.ppt === b.ppt && a.propagatorCount === b.propagatorCount;
}

function unrated(row: StoredRoundRating): RecomputedRoundRating {
  return { ...row, roundRating: null, ssa: null, ppt: null, weatherAdjustment: 0, propagatorCount: 0, ratingMethod: "unrated" };
}

function anchorKey(memberId: string, stream: RatingStream): string {
  return `${memberId}|${stream}`;
}
