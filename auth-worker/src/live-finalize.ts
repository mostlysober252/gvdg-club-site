import * as db from "./db.js";
import { scorecardConsensusIssues } from "./live-consensus.js";
import type { LiveScoringConfig } from "./live-format.js";
import { finalizeStandings, type FinalLiveStanding, type PlayerState } from "./scoring.js";
import { finalizeRoundStandings, healthyTargets, invalidScoreTargetsResponse, resolvedHoles, roundConfig, scoringState } from "./live-state.js";
import { j, metadataJson, type LiveEnv, type LiveMeta, type ScoringState } from "./live-types.js";
import { roundRatingForScoreWithWeather, solveSsa, type Propagator, type RatingMethod, type RatingStream } from "./rating-engine.js";
import { clearRoundRatingsForCasualRound, clearRoundRatingsForEvent, createRoundRating, findRatingAnchor, getLayoutRatingBaseline, upsertLayoutRatingBaseline, upsertPlayerRatingFromRounds } from "./rating-store.js";
import { ratingWeatherFromJson } from "./weather.js";

export type FinalizeLiveEventInput = {
  readonly meta: LiveMeta | null;
  readonly players: PlayerState[];
  readonly env: LiveEnv;
  readonly authMember: string | null;
  readonly authAdmin: boolean;
  readonly force: boolean;
  readonly persist: () => Promise<void>;
  readonly broadcast: () => void;
};

export async function finalizeLiveEvent(input: FinalizeLiveEventInput): Promise<Response> {
  const meta = input.meta;
  if (!meta) return j({ error: "not_started" }, 409);
  if (meta.casual && !input.authAdmin && !(input.authMember && input.players.some((player) => player.memberId === input.authMember && !player.removed))) {
    return j({ error: "not_on_card" }, 403);
  }
  if (meta.status === "final") {
    const scoring = scoringState(meta, input.players);
    const holes = resolvedHoles(meta);
    return j({ status: "final", standings: finalizeMixedStandings(holes, input.players, scoring) });
  }
  const holes = resolvedHoles(meta);
  const scoring = scoringState(meta, input.players);
  let standings: FinalLiveStanding[];
  let forced: boolean;
  if (scoring.globalError) {
    // The WHOLE round is unscorable (a corrupt round config). An admin may force past it onto per-player
    // STROKE standings for the whole field; everyone else gets the error so it can be repaired first.
    if (!(input.authAdmin && input.force)) return invalidScoreTargetsResponse(scoring.globalError);
    standings = finalizeStandings(holes, input.players);
    forced = true;
  } else if (scoring.cardErrors.length) {
    // One or more broken cards — e.g. a doubles/matchplay pair left with ONE active player after a partner
    // was removed. Non-admins / un-forced calls get the error so the card can be repaired (rejoin/withdraw).
    // An admin force finalizes HEALTHY cards in their REAL format and the broken card(s) as UNRANKED stroke
    // rows — so healthy standings are preserved instead of the whole field degrading to stroke.
    if (!(input.authAdmin && input.force)) {
      return j({ error: "invalid_score_targets", code: scoring.error?.code, message: scoring.error?.message, cardErrors: scoring.cardErrors }, 400);
    }
    standings = finalizeMixedStandings(holes, input.players, scoring);
    forced = true;
  } else {
    const issues = scorecardConsensusIssues(input.players, holes, scoring.targets, { casual: !!meta.casual, config: scoring.config });
    const incomplete = issues.conflicts.length > 0 || issues.missing.length > 0;
    if (incomplete && !(input.authAdmin && input.force)) {
      return j({ error: "scorecard_incomplete", conflicts: issues.conflicts, missing: issues.missing }, 409);
    }
    forced = incomplete;
    standings = finalizeRoundStandings({ holes, players: input.players, config: scoring.config, targets: scoring.targets });
  }
  meta.status = "final";
  if (meta.casual || !meta.eventId) {
    if (meta.casual && meta.roundCode) {
      try {
        await persistCasualResults(input.env, meta, input.players, standings);
      } catch (error) {
        meta.status = "live";
        throw error;
      }
    }
    await input.persist();
    input.broadcast();
    await persistRatingsBestEffort(input.env, meta, standings); // ratings never gate the finalize
    return j({ status: "final", standings, forced });
  }
  try {
    // Atomic: clear + all result rows in ONE D1 transaction, so a mid-write failure can't leave a partial
    // leaderboard (some players persisted, others not). Ratings below stay best-effort and never gate this.
    await db.runBatch(input.env.DB, [
      db.clearResultsStmt(input.env.DB, meta.eventId),
      ...standings.map((standing) =>
        db.createResultStmt(input.env.DB, {
          event_id: meta.eventId,
          member_id: standing.memberId,
          name: standing.name,
          place: standing.place,
          total: standing.total,
          to_par: standing.toPar,
          breakdown: JSON.stringify(standing.breakdown),
          scorecard: standing.holes.length ? JSON.stringify(standing.holes) : null,
          scoring_group: metadataJson(standing.scoringGroup),
          match_result: metadataJson(standing.matchResult),
        }),
      ),
    ]);
    await db.updateEvent(input.env.DB, meta.eventId, { status: "final" });
  } catch (error) {
    meta.status = "live";
    throw error;
  }
  await input.persist();
  input.broadcast();
  await persistRatingsBestEffort(input.env, meta, standings); // ratings never gate the finalize
  return j({ status: "final", standings, forced });
}

/** Finalize a round that may mix healthy and broken cards. Healthy cards finalize in their REAL format
 *  (matchplay match_result / doubles teams); a broken card's players finalize as per-player STROKE rows
 *  written place=null (UNRANKED) — so they never collide on place with a healthy winner and, being unranked
 *  with no match_result, earn zero league place-points (computeLeagueStandings.placePoints). A whole-round
 *  globalError still finalizes the entire field as stroke (the pre-existing force fallback). */
function finalizeMixedStandings(holes: { hole: number; par: number }[], players: PlayerState[], scoring: ScoringState): FinalLiveStanding[] {
  if (scoring.globalError) return finalizeStandings(holes, players);
  if (scoring.cardErrors.length === 0) {
    return finalizeRoundStandings({ holes, players, config: scoring.config, targets: scoring.targets });
  }
  const healthy = healthyTargets(scoring);
  const healthyRows = finalizeRoundStandings({ holes, players, config: scoring.config, targets: healthy });
  // The broken pass is everyone the healthy pass did NOT cover — derived from the same targets, so every
  // non-removed player lands in EXACTLY one pass (no drop, no double-count even if a pair spans cards).
  const covered = new Set<number>();
  for (const target of healthy) for (const index of target.playerIndexes) covered.add(index);
  const brokenPlayers = players.filter((p, index) => !p.removed && !covered.has(index));
  const brokenRows = finalizeStandings(holes, brokenPlayers).map((row) => ({ ...row, place: null }));
  return [...healthyRows, ...brokenRows];
}

async function persistCasualResults(env: LiveEnv, meta: LiveMeta, players: PlayerState[], standings: FinalLiveStanding[]): Promise<void> {
  const holes = resolvedHoles(meta).map((hole) => ({ hole: hole.hole, par: hole.par, distance_ft: hole.distance_ft }));
  const config = roundConfig(meta);
  if (!meta.roundCode) throw new Error("casual_round_code_missing");
  await db.clearCasualRound(env.DB, meta.roundCode);
  const round = await db.createCasualRound(env.DB, {
    round_code: meta.roundCode,
    course_id: meta.courseId ?? null,
    layout_id: meta.layoutId ?? null,
    course_name: meta.courseName ?? null,
    layout_name: meta.layoutName ?? null,
    holes: JSON.stringify(holes),
    scoring_config: JSON.stringify(config),
    created_by: meta.createdBy ?? null,
    started_at: meta.startedAt || null,
  });
  const roundId = casualRoundId(round);
  if (roundId == null) throw new Error("casual_round_insert_failed");
  // The round row must be inserted first (its id keys the results), then all result rows land atomically.
  await db.runBatch(
    env.DB,
    standings.map((standing) =>
      db.createCasualResultStmt(env.DB, {
        casual_round_id: roundId,
        member_id: standing.memberId,
        name: standing.name,
        division: standing.division,
        place: standing.place,
        total: standing.total,
        to_par: standing.toPar,
        breakdown: JSON.stringify(standing.breakdown),
        scorecard: standing.holes.length ? JSON.stringify(standing.holes) : null,
        scoring_group: metadataJson(standing.scoringGroup),
        match_result: metadataJson(standing.matchResult),
      }),
    ),
  );
}

function casualRoundId(value: unknown): number | null {
  if (typeof value !== "object" || value === null || !("id" in value)) return null;
  const id = value.id;
  return typeof id === "number" ? id : null;
}

/** Write round_ratings for a just-finalized round. BEST-EFFORT: any failure is logged, never thrown, so
 *  a rating glitch can never block or roll back a finalize (results are authoritative). NOTE: the daily
 *  ratings cron only RE-SOLVES existing round_ratings rows (it does not create them), so if this write
 *  fails the round stays unrated until finalize is run again (an admin force-finalize re-attempts it). */
async function persistRatingsBestEffort(env: LiveEnv, meta: LiveMeta, standings: FinalLiveStanding[]): Promise<void> {
  try {
    await persistRoundRatings(env, meta, standings);
  } catch (error) {
    console.error(JSON.stringify({ message: "round_ratings_persist_failed", eventId: meta.eventId, roundCode: meta.roundCode ?? null, error: error instanceof Error ? error.message : String(error) }));
  }
}

/** PDGA-style round ratings are computed from an individual's own STROKE total, so only a singles stroke
 *  round earns them. Matchplay has no stroke rating; doubles partners share one team total (so a rating
 *  would enter a team score as each member's individual round). Both are excluded. */
export function roundEarnsRatings(config: LiveScoringConfig): boolean {
  return config.scoringStyle === "stroke" && config.groupFormat === "singles";
}

async function persistRoundRatings(env: LiveEnv, meta: LiveMeta, standings: FinalLiveStanding[]): Promise<void> {
  if (!roundEarnsRatings(roundConfig(meta))) return; // matchplay / doubles rounds are never rated
  const stream: RatingStream = meta.casual ? "casual" : "competition";
  if (stream === "casual" && !meta.roundCode) return; // no durable key → nothing to attach ratings to
  const now = new Date().toISOString();
  const roundDate = meta.startedAt || now;
  const ranked = standings.filter((s) => s.place != null && s.memberId); // only completed, ranked, member rounds
  const ratingWeather = ratingWeatherFromJson(meta.weather ? JSON.stringify(meta.weather) : null);

  // Rating context: casual reads the per-layout SSA baseline; competition solves SSA from finishers' anchors.
  let context: { ssa: number; ppt: number; propagatorCount: number; ratingMethod: RatingMethod } | null = null;
  if (stream === "casual") {
    const baseline = await getLayoutRatingBaseline(env.DB, meta.layoutId ?? null);
    context = baseline ? { ssa: baseline.ssa, ppt: baseline.ppt, propagatorCount: baseline.propagatorCount, ratingMethod: "layout" } : null;
  } else {
    // Look up every finisher's anchor concurrently (local player_ratings; the cron later upgrades with PDGA).
    const anchors = await Promise.all(ranked.map((s) => findRatingAnchor(env.DB, { memberId: s.memberId })));
    const propagators: Propagator[] = [];
    ranked.forEach((s, i) => { if (anchors[i] != null) propagators.push({ score: s.total, rating: anchors[i] as number }); });
    const solved = solveSsa(propagators);
    context = solved ? { ssa: solved.ssa, ppt: solved.ppt, propagatorCount: solved.propagatorCount, ratingMethod: solved.status } : null;
  }

  // Idempotent replace: clear this round's prior ratings before rewriting (finalize can run again after a force).
  if (stream === "competition") await clearRoundRatingsForEvent(env.DB, meta.eventId);
  else if (meta.roundCode) await clearRoundRatingsForCasualRound(env.DB, meta.roundCode);

  await Promise.all(ranked.map((s) => {
    const rr = context ? roundRatingForScoreWithWeather({ score: s.total, ssa: context.ssa, ppt: context.ppt, weather: context.ratingMethod === "layout" ? ratingWeather : null }) : null;
    return createRoundRating(env.DB, {
      memberId: s.memberId as string,
      playerName: s.name,
      stream,
      eventId: stream === "competition" ? meta.eventId : null,
      casualRoundCode: stream === "casual" ? (meta.roundCode ?? null) : null,
      courseId: meta.courseId ?? null,
      layoutId: meta.layoutId ?? null,
      roundDate,
      total: s.total,
      toPar: s.toPar,
      roundRating: rr ? rr.roundRating : null,
      ssa: context ? context.ssa : null,
      ppt: context ? context.ppt : null,
      windGustMph: ratingWeather.windGustMph,
      weatherAdjustment: rr ? rr.weatherAdjustment : 0,
      propagatorCount: context ? context.propagatorCount : 0,
      ratingMethod: context ? context.ratingMethod : "unrated",
    });
  }));

  // Competition rounds refresh the per-layout SSA baseline that casual rounds lean on.
  if (stream === "competition" && context && meta.layoutId != null) {
    await upsertLayoutRatingBaseline(env.DB, { layoutId: meta.layoutId, eventId: meta.eventId, baseline: { ssa: context.ssa, ppt: context.ppt, propagatorCount: context.propagatorCount } });
  }

  // Roll each rated member's aggregate player_ratings row forward.
  const members = [...new Set(ranked.map((s) => s.memberId as string))];
  await Promise.all(members.map((memberId) => upsertPlayerRatingFromRounds(env.DB, { memberId, stream, now })));
}
