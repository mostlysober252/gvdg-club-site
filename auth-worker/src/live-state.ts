import { scorecardConsensusIssues } from "./live-consensus.js";
import { isLiveFormatError, normalizeLiveScoringConfig, scoreTargetsForPlayersSafe, validateCardTargetsForScoring, type LiveScoringConfig, type ScoreTarget } from "./live-format.js";
import { computeLiveStandings, finalizeLiveStandings, type FinalLiveStanding, type LiveStanding, type PlayerState } from "./scoring.js";
import { j, type CardScoringError, type LiveMeta, type PublicScoreTarget, type ResolvedHole, type ScoreBody, type ScoringState } from "./live-types.js";

export function canEnterScorecard(player: PlayerState, authMember: string | null): boolean {
  return !player.memberId || player.memberId === authMember || player.memberId.startsWith("g_");
}

export function resolvedHoles(meta: LiveMeta | null): ResolvedHole[] {
  const overrides = meta?.overrides ?? {};
  return (meta?.holes ?? []).map((hole) => {
    const override = overrides[String(hole.hole)];
    return {
      hole: hole.hole,
      par: override?.par ?? hole.par,
      distance_ft: override?.distance_ft ?? hole.distance_ft ?? null,
      tee_sign_id: hole.tee_sign_id ?? null,
      overridden: override != null,
    };
  });
}

export function roundConfig(meta: LiveMeta | null): LiveScoringConfig {
  return normalizeLiveScoringConfig(meta?.roundConfig);
}

/** Compute score targets for a round WITHOUT letting one broken pair wedge the field. A corrupt round
 *  config is the only whole-round failure (`globalError`). `brokenPlayers` are the indexes that can't be
 *  scored/ranked: for STROKE just the orphaned player(s) of a malformed pair (so a healthy pair keeps
 *  scoring even sharing a physical card, or a single-card casual round, with a broken one); for MATCHPLAY
 *  the whole card (a match needs both sides). `error` is a retained summary so existing consumers work. */
export function scoringState(meta: LiveMeta | null, players: readonly PlayerState[]): ScoringState {
  let config: LiveScoringConfig;
  try {
    config = roundConfig(meta);
  } catch (error) {
    if (isLiveFormatError(error)) {
      const globalError = { code: error.code, message: error.message };
      return { config: normalizeLiveScoringConfig(null), targets: [], cardErrors: [], brokenPlayers: [], globalError, error: globalError };
    }
    throw error;
  }
  const safe = scoreTargetsForPlayersSafe(players, config);
  const cardErrors: CardScoringError[] = [];
  const brokenPlayers = new Set<number>();
  if (config.scoringStyle === "matchplay") {
    // Card-level isolation: a match needs BOTH sides, so any pair error or wrong target-count on a card
    // breaks the whole card (the intact side is blocked too). Group errors by card.
    const byCard = new Map<string | null, CardScoringError>();
    for (const err of safe.errors) {
      const cardId = cardForIndexes(players, err.playerIndexes);
      if (!byCard.has(cardId)) byCard.set(cardId, { cardId, playerIndexes: cardPlayerIndexes(players, cardId), code: err.code, message: err.message });
    }
    for (const [cardId, cardTargets] of targetCardGroupsByCard(players, safe.targets)) {
      if (byCard.has(cardId)) continue;
      try {
        validateCardTargetsForScoring(cardTargets, config);
      } catch (error) {
        if (isLiveFormatError(error)) byCard.set(cardId, { cardId, playerIndexes: cardPlayerIndexes(players, cardId), code: error.code, message: error.message });
        else throw error;
      }
    }
    for (const err of byCard.values()) {
      cardErrors.push(err);
      for (const index of err.playerIndexes) brokenPlayers.add(index);
    }
  } else {
    // Stroke: pair-level isolation. Only the players who failed to form a valid pair are broken; every valid
    // pair stays scorable, so a broken Beta pair doesn't wedge a healthy Alpha pair on the same card.
    for (const err of safe.errors) {
      const active = err.playerIndexes.filter((index) => { const p = players[index]; return p != null && !p.removed; });
      if (active.length === 0) continue; // a 0-active label (whole team withdrew) is not "broken", just absent
      for (const index of active) brokenPlayers.add(index);
      cardErrors.push({ cardId: cardForIndexes(players, err.playerIndexes), playerIndexes: [...err.playerIndexes], code: err.code, message: err.message });
    }
  }
  const summary = cardErrors[0] ? { code: cardErrors[0].code, message: cardErrors[0].message } : null;
  return { config, targets: safe.targets, cardErrors, brokenPlayers: [...brokenPlayers], globalError: null, error: summary };
}

/** The subset of `scoring.targets` none of whose players are broken — used for standings/consensus so a
 *  broken pair/card is omitted while every healthy pair keeps its real format. Empty when the whole round
 *  is unscorable. For stroke this keeps every intact pair; for matchplay it drops a broken card's targets. */
export function healthyTargets(scoring: ScoringState): ScoreTarget[] {
  if (scoring.globalError) return [];
  if (scoring.brokenPlayers.length === 0) return [...scoring.targets];
  const broken = new Set(scoring.brokenPlayers);
  return scoring.targets.filter((target) => !target.playerIndexes.some((index) => broken.has(index)));
}

/** The card a target-computation error belongs to: the first active (non-removed) player among the error's
 *  indexes, by RAW cardId ?? null (never the "card:null" grouping sentinel). */
function cardForIndexes(players: readonly PlayerState[], indexes: readonly number[]): string | null {
  for (const index of indexes) {
    const player = players[index];
    if (player && !player.removed) return player.cardId ?? null;
  }
  const first = indexes.length > 0 ? players[indexes[0] as number] : undefined;
  return first?.cardId ?? null;
}

/** Global indexes of the non-removed players on a card (raw cardId ?? null) — the blast radius when a
 *  matchplay card is broken. */
function cardPlayerIndexes(players: readonly PlayerState[], cardId: string | null): number[] {
  const out: number[] = [];
  players.forEach((player, index) => { if (player && !player.removed && (player.cardId ?? null) === cardId) out.push(index); });
  return out;
}

export function invalidScoreTargetsResponse(error: { readonly code: string; readonly message: string }): Response {
  return j({ error: "invalid_score_targets", code: error.code, message: error.message }, 400);
}

export function publicScoreTargets(players: readonly PlayerState[], targets: readonly ScoreTarget[]): PublicScoreTarget[] {
  return targets.map((target) => ({
    id: target.id,
    type: target.type,
    label: target.label,
    playerIndexes: [...target.playerIndexes],
    members: target.playerIndexes.map((index) => players[index]?.name ?? "Player"),
  }));
}

export function scoreTargetForBody(body: ScoreBody, players: readonly PlayerState[], targets: readonly ScoreTarget[]): ScoreTarget | null {
  if (body.targetId) return targets.find((target) => target.id === body.targetId) ?? null;
  const player = findPlayer(body, players);
  if (!player || player.removed) return null;
  const playerIndex = players.indexOf(player);
  return targets.find((target) => target.playerIndexes.includes(playerIndex)) ?? null;
}

export function targetAnchor(players: readonly PlayerState[], target: ScoreTarget): { readonly index: number; readonly player: PlayerState } | null {
  for (const index of target.playerIndexes) {
    const player = players[index];
    if (player && !player.removed) return { index, player };
  }
  return null;
}

export function findPlayer(body: Pick<ScoreBody, "memberId" | "index" | "name">, players: readonly PlayerState[]): PlayerState | undefined {
  if (body.memberId) return players.find((player) => player.memberId === body.memberId);
  if (typeof body.index === "number") return players[body.index];
  if (body.name) return players.find((player) => player.name === body.name);
  return undefined;
}

export function scorecardIssues(meta: LiveMeta | null, players: PlayerState[], holes: { hole: number }[], scoring: ScoringState) {
  if (scoring.globalError) return { conflicts: [], missing: [] };
  return scorecardConsensusIssues(players, holes, healthyTargets(scoring), { casual: !!meta?.casual, config: scoring.config });
}

export function computeRoundStandings(input: {
  readonly holes: readonly { readonly hole: number; readonly par: number }[];
  readonly players: readonly PlayerState[];
  readonly config: LiveScoringConfig;
  readonly targets: readonly ScoreTarget[];
}): LiveStanding[] {
  if (input.config.scoringStyle === "stroke") return computeLiveStandings(input);
  return targetCardGroups(input.players, input.targets).flatMap((targets) => computeLiveStandings({ ...input, targets }));
}

export function finalizeRoundStandings(input: {
  readonly holes: readonly { readonly hole: number; readonly par: number }[];
  readonly players: readonly PlayerState[];
  readonly config: LiveScoringConfig;
  readonly targets: readonly ScoreTarget[];
}): FinalLiveStanding[] {
  if (input.config.scoringStyle === "stroke") return finalizeLiveStandings(input);
  return targetCardGroups(input.players, input.targets).flatMap((targets) => finalizeLiveStandings({ ...input, targets }));
}

function targetCardGroups(players: readonly PlayerState[], targets: readonly ScoreTarget[]): ScoreTarget[][] {
  return [...targetCardGroupsByCard(players, targets).values()];
}

/** Group targets by the card of their first active player, keyed by RAW cardId ?? null so the key domain
 *  matches cardErrors (a broken card is identified by the same null-able cardId everywhere). */
function targetCardGroupsByCard(players: readonly PlayerState[], targets: readonly ScoreTarget[]): Map<string | null, ScoreTarget[]> {
  const groups = new Map<string | null, ScoreTarget[]>();
  for (const target of targets) {
    const anchor = targetAnchor(players, target);
    if (!anchor) continue;
    const key = anchor.player.cardId ?? null;
    const group = groups.get(key) ?? [];
    group.push(target);
    groups.set(key, group);
  }
  return groups;
}
