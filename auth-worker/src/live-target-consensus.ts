import { normalizeLiveScoringConfig, type LiveScoringConfig, type ScoreTarget } from "./live-format.js";
import type { ConsensusIssues, MissingScoreConsensus, ScoreConflict, ScoreHole } from "./live-consensus.js";
import type { PlayerState } from "./scoring.js";

export interface RecordScoreTargetVoteInput {
  players: PlayerState[];
  target: ScoreTarget;
  scorerId: string;
  hole: number;
  strokes: number;
}

type TargetAnchor = { index: number; player: PlayerState };
type TargetIssue = { target: ScoreTarget; anchor: TargetAnchor; hole: number };

export function recordScoreTargetVote(input: RecordScoreTargetVoteInput): ScoreConflict | null {
  if (input.target.type === "player") {
    return recordScoreVote({ players: input.players, targetIndex: input.target.playerIndexes[0], scorerId: input.scorerId, hole: input.hole, strokes: input.strokes });
  }
  const members = activeTargetPlayers(input.players, input.target);
  if (members.length === 0) return null;
  for (const member of members) {
    member.player.scores = member.player.scores ?? {};
    const scorecards = (member.player.scorecards ??= {});
    const votes = (scorecards[input.hole] ??= {});
    votes[input.scorerId] = input.strokes;
  }
  syncTargetConsensusScore(input.players, input.target, input.hole);
  return scoreTargetConflictFor(input.players, input.target, input.hole);
}

export function scoreTargetConflicts(players: PlayerState[], holes: ScoreHole[], targets: readonly ScoreTarget[]): ScoreConflict[] {
  const conflicts: ScoreConflict[] = [];
  for (const target of targets) {
    for (const hole of holes) {
      const conflict = scoreTargetConflictFor(players, target, hole.hole);
      if (conflict) conflicts.push(conflict);
    }
  }
  return conflicts;
}

export function scoreTargetConsensusIssues(
  players: PlayerState[],
  holes: ScoreHole[],
  targets: readonly ScoreTarget[],
  opts: { readonly casual?: boolean; readonly config?: LiveScoringConfig } = {},
): ConsensusIssues {
  const requiredHoles = requiredHolesByTarget(players, holes, targets, opts.config);
  const missing = opts.casual ? casualTargetMissing(players, holes, targets, requiredHoles) : competitionTargetMissing(players, holes, targets, requiredHoles);
  return { conflicts: scoreTargetConflicts(players, holes, targets), missing };
}

// Which holes each target must have a confirmed score on before the card can finalize. Stroke play (and any
// non-matchplay config) requires EVERY hole. Matchplay waives the dead holes AFTER a match is mathematically
// decided (a 3&2 win legitimately never plays 17-18), so scorers never have to enter phantom scores just to
// finalize — which is what corrupts the recorded margin. Conflict detection is unchanged (see scoreTargetConflicts).
function requiredHolesByTarget(players: PlayerState[], holes: ScoreHole[], targets: readonly ScoreTarget[], config?: LiveScoringConfig): Map<string, ScoreHole[]> {
  const byTarget = new Map<string, ScoreHole[]>();
  if (normalizeLiveScoringConfig(config).scoringStyle !== "matchplay") {
    for (const target of targets) byTarget.set(target.id, holes);
    return byTarget;
  }
  const byCard = new Map<string, ScoreTarget[]>();
  for (const target of targets) {
    const anchor = activeTargetPlayers(players, target)[0];
    const cardKey = anchor?.player.cardId ?? "card:null";
    const group = byCard.get(cardKey) ?? [];
    group.push(target);
    byCard.set(cardKey, group);
  }
  for (const group of byCard.values()) {
    const required = matchplayRequiredHoles(players, holes, group);
    for (const target of group) byTarget.set(target.id, required);
  }
  return byTarget;
}

// A matchplay card is DECIDED once one side's lead exceeds the holes remaining; holes after that are dead.
// Needs exactly two sides AND a fully-scored prefix to prove the clinch — otherwise every hole stays required
// (an undecided, all-square, or dormie match, or a gap in the prefix that leaves the running score unknown).
function matchplayRequiredHoles(players: PlayerState[], holes: ScoreHole[], cardTargets: readonly ScoreTarget[]): ScoreHole[] {
  const [sideA, sideB] = cardTargets;
  if (cardTargets.length !== 2 || !sideA || !sideB) return holes;
  const anchorA = activeTargetPlayers(players, sideA)[0];
  const anchorB = activeTargetPlayers(players, sideB)[0];
  if (!anchorA || !anchorB) return holes;
  let lead = 0;
  for (let i = 0; i < holes.length; i++) {
    const hole = holes[i]?.hole;
    const a = hole == null ? undefined : anchorA.player.scores?.[hole];
    const b = hole == null ? undefined : anchorB.player.scores?.[hole];
    if (typeof a !== "number" || typeof b !== "number") return holes; // gap → running score unknown → require all
    if (a < b) lead++;
    else if (b < a) lead--;
    if (Math.abs(lead) > holes.length - (i + 1)) return holes.slice(0, i + 1); // decided → later holes are dead
  }
  return holes;
}

// Casual: whoever is keeping the card can finalize. Every MEMBER on the card must have voted on each hole,
// which — when only one member is logged in and scoring (guests are optional, see requiredScorerIds) —
// collapses to that single scorekeeper. So a solo casual round finalizes once every hole is scored.
function casualTargetMissing(players: PlayerState[], holes: ScoreHole[], targets: readonly ScoreTarget[], requiredHoles: Map<string, ScoreHole[]>): MissingScoreConsensus[] {
  const missing: MissingScoreConsensus[] = [];
  for (const target of targets) {
    const anchor = activeTargetPlayers(players, target)[0];
    if (!anchor) continue;
    const requiredScorers = requiredScorerIds(players, anchor.player);
    if (requiredScorers.length === 0) continue;
    for (const hole of requiredHoles.get(target.id) ?? holes) {
      const voted = targetVotedScorerIds(players, target, hole.hole);
      const missingCount = requiredScorers.filter((scorerId) => !voted.has(scorerId)).length;
      if (missingCount === 0) continue;
      missing.push(targetMissing({ target, anchor, hole: hole.hole, missing: missingCount, required: requiredScorers.length }));
    }
  }
  return missing;
}

// Competition: each competing SIDE must confirm the card itself.
//  • Singles (player targets): unchanged — every member on the card attests each score (for a head-to-head
//    card that already means both sides confirm), preserving cross-attestation.
//  • Teams (doubles/matchplay pairs): >=1 of the TEAM's OWN registered (non-guest) members must confirm
//    each hole — "at least one registered player from each team submits a matching scorecard". A team with
//    no registered member can never confirm, so its holes stay "missing" (finalize needs an admin override).
// Matching across sides is enforced separately by the conflict check.
function competitionTargetMissing(players: PlayerState[], holes: ScoreHole[], targets: readonly ScoreTarget[], requiredHoles: Map<string, ScoreHole[]>): MissingScoreConsensus[] {
  const missing: MissingScoreConsensus[] = [];
  for (const target of targets) {
    const anchor = activeTargetPlayers(players, target)[0];
    if (!anchor) continue;
    const targetHoles = requiredHoles.get(target.id) ?? holes;
    if (target.type === "player") {
      const requiredScorers = requiredScorerIds(players, anchor.player);
      if (requiredScorers.length === 0) continue;
      for (const hole of targetHoles) {
        const voted = targetVotedScorerIds(players, target, hole.hole);
        const missingCount = requiredScorers.filter((scorerId) => !voted.has(scorerId)).length;
        if (missingCount > 0) missing.push(targetMissing({ target, anchor, hole: hole.hole, missing: missingCount, required: requiredScorers.length }));
      }
      continue;
    }
    const teamScorers = registeredTargetScorerIds(players, target);
    for (const hole of targetHoles) {
      const voted = targetVotedScorerIds(players, target, hole.hole);
      if (teamScorers.some((id) => voted.has(id))) continue; // this team confirmed the hole
      missing.push(targetMissing({ target, anchor, hole: hole.hole, missing: 1, required: Math.max(1, teamScorers.length) }));
    }
  }
  return missing;
}

export function purgeScoreTargetScorerVotes(players: PlayerState[], removedIndex: number, holes: ScoreHole[], targets: readonly ScoreTarget[]): void {
  const removedId = playerScorerId(removedIndex);
  for (const player of players) {
    if (!player || player.removed || !player.scorecards) continue;
    for (const hole of holes) {
      delete player.scorecards[hole.hole]?.[removedId];
    }
  }
  for (const target of targets) {
    for (const hole of holes) syncTargetConsensusScore(players, target, hole.hole);
  }
}

function recordScoreVote(input: { players: PlayerState[]; targetIndex: number; scorerId: string; hole: number; strokes: number }): ScoreConflict | null {
  const target = input.players[input.targetIndex];
  if (!target || target.removed) return null;
  target.scores = target.scores ?? {};
  const scorecards = (target.scorecards ??= {});
  const votes = (scorecards[input.hole] ??= {});
  votes[input.scorerId] = input.strokes;
  syncConsensusScore(input.players, target, input.hole);
  return scoreConflictFor(input.players, input.targetIndex, input.hole);
}

function scoreConflictFor(players: PlayerState[], playerIndex: number, hole: number): ScoreConflict | null {
  const player = players[playerIndex];
  if (!player || player.removed) return null;
  const values = activeVoteValues(players, player, hole);
  if (values.length <= 1) return null;
  return { cardId: player.cardId ?? null, playerIndex, playerName: player.name, hole, values };
}

function syncConsensusScore(players: PlayerState[], player: PlayerState, hole: number): void {
  const values = activeVoteValues(players, player, hole);
  if (values.length === 1) {
    const score = values[0];
    if (score != null) player.scores[hole] = score;
  } else if (values.length > 1) {
    delete player.scores[hole];
  }
}

function scoreTargetConflictFor(players: PlayerState[], target: ScoreTarget, hole: number): ScoreConflict | null {
  if (target.type === "player") return scoreConflictFor(players, target.playerIndexes[0], hole);
  const anchor = activeTargetPlayers(players, target)[0];
  if (!anchor) return null;
  const values = targetActiveVoteValues(players, target, hole);
  if (values.length <= 1) return null;
  return targetConflict({ target, anchor, hole, values });
}

function syncTargetConsensusScore(players: PlayerState[], target: ScoreTarget, hole: number): void {
  if (target.type === "player") {
    const player = players[target.playerIndexes[0]];
    if (player && !player.removed) syncConsensusScore(players, player, hole);
    return;
  }
  const values = targetActiveVoteValues(players, target, hole);
  for (const member of activeTargetPlayers(players, target)) {
    member.player.scores = member.player.scores ?? {};
    if (values.length === 1) {
      const score = values[0];
      if (score != null) member.player.scores[hole] = score;
    } else if (values.length > 1) {
      delete member.player.scores[hole];
    }
  }
}

function activeVoteValues(players: PlayerState[], target: PlayerState, hole: number): number[] {
  const active = new Set(cardScorerIds(players, target));
  const out: number[] = [];
  for (const [scorerId, strokes] of Object.entries(target.scorecards?.[hole] ?? {})) {
    if (active.has(scorerId) && typeof strokes === "number") out.push(strokes);
  }
  return uniqueSorted(out);
}

function targetActiveVoteValues(players: PlayerState[], target: ScoreTarget, hole: number): number[] {
  if (target.type === "player") {
    const player = players[target.playerIndexes[0]];
    return player && !player.removed ? activeVoteValues(players, player, hole) : [];
  }
  const anchor = activeTargetPlayers(players, target)[0];
  if (!anchor) return [];
  const active = new Set(cardScorerIds(players, anchor.player));
  const valuesByScorer = new Map<string, Set<number>>();
  for (const member of activeTargetPlayers(players, target)) {
    for (const [scorerId, strokes] of Object.entries(member.player.scorecards?.[hole] ?? {})) {
      if (!active.has(scorerId) || typeof strokes !== "number") continue;
      const values = valuesByScorer.get(scorerId) ?? new Set<number>();
      values.add(strokes);
      valuesByScorer.set(scorerId, values);
    }
  }
  return uniqueSorted([...valuesByScorer.values()].flatMap((values) => [...values]));
}

function targetVotedScorerIds(players: PlayerState[], target: ScoreTarget, hole: number): Set<string> {
  if (target.type === "player") {
    const player = players[target.playerIndexes[0]];
    return new Set(player && !player.removed ? Object.keys(player.scorecards?.[hole] ?? {}) : []);
  }
  const voted = new Set<string>();
  for (const member of activeTargetPlayers(players, target)) {
    for (const scorerId of Object.keys(member.player.scorecards?.[hole] ?? {})) voted.add(scorerId);
  }
  return voted;
}

function uniqueSorted(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function activeTargetPlayers(players: PlayerState[], target: ScoreTarget): TargetAnchor[] {
  const members: TargetAnchor[] = [];
  for (const index of target.playerIndexes) {
    const player = players[index];
    if (player && !player.removed) members.push({ index, player });
  }
  return members;
}

function targetConflict(input: TargetIssue & { values: number[] }): ScoreConflict {
  const { target, anchor, hole, values } = input;
  if (target.type === "player") {
    return { cardId: anchor.player.cardId ?? null, playerIndex: anchor.index, playerName: target.label, hole, values };
  }
  return { cardId: anchor.player.cardId ?? null, playerIndex: anchor.index, playerName: target.label, hole, values, targetId: target.id, targetType: target.type, playerIndexes: [...target.playerIndexes] };
}

function targetMissing(input: TargetIssue & { missing: number; required: number }): MissingScoreConsensus {
  const { target, anchor, hole, missing, required } = input;
  if (target.type === "player") {
    return { cardId: anchor.player.cardId ?? null, playerIndex: anchor.index, playerName: target.label, hole, missing, required };
  }
  return { cardId: anchor.player.cardId ?? null, playerIndex: anchor.index, playerName: target.label, hole, missing, required, targetId: target.id, targetType: target.type, playerIndexes: [...target.playerIndexes] };
}

function cardScorerIds(players: PlayerState[], target: PlayerState): string[] {
  const cardId = target.cardId ?? null;
  const ids: string[] = [];
  for (let index = 0; index < players.length; index++) {
    const player = players[index];
    if (!player || player.removed || (player.cardId ?? null) !== cardId) continue;
    ids.push(playerScorerId(index));
  }
  return ids;
}

function requiredScorerIds(players: PlayerState[], target: PlayerState): string[] {
  const cardId = target.cardId ?? null;
  const ids: string[] = [];
  for (let index = 0; index < players.length; index++) {
    const player = players[index];
    if (!player || player.removed || (player.cardId ?? null) !== cardId) continue;
    if (!player.memberId || player.memberId.startsWith("g_")) continue;
    ids.push(playerScorerId(index));
  }
  return ids;
}

// Scorer ids of the registered (non-guest) members ON a specific team/target — used by the competition
// gate to require each side to confirm the card itself (not just anyone on the card).
function registeredTargetScorerIds(players: PlayerState[], target: ScoreTarget): string[] {
  const ids: string[] = [];
  for (const index of target.playerIndexes) {
    const player = players[index];
    if (!player || player.removed) continue;
    if (!player.memberId || player.memberId.startsWith("g_")) continue;
    ids.push(playerScorerId(index));
  }
  return ids;
}

function playerScorerId(index: number): string {
  return "player:" + index;
}
