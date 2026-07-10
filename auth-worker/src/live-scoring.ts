import { countScores, type Breakdown } from "./score-breakdown.js";
import { validateCardTargetsForScoring, type LiveScoringConfig, type ScoreTarget } from "./live-format.js";
import { finalMatchResult, matchOutcomeOrder, matchPlace, summarizeMatchplay, type MatchStatus } from "./matchplay-scoring.js";
import type { FinalStanding, PlayerState, Standing } from "./scoring.js";

export interface ScoringGroup {
  readonly targetId: string;
  readonly targetType: ScoreTarget["type"];
  readonly label: string;
  readonly members: readonly string[];
}

export interface LiveStanding extends Standing {
  readonly targetId: string;
  readonly targetType: ScoreTarget["type"];
  readonly playerIndexes: readonly number[];
  readonly memberIds: readonly (string | null)[];
  readonly members: readonly string[];
  readonly scoringGroup?: ScoringGroup;
  readonly match?: MatchStatus;
}

export interface FinalLiveStanding extends FinalStanding {
  readonly scoringGroup?: ScoringGroup;
  readonly matchResult?: MatchStatus;
}

export type LiveScoringInput = {
  readonly holes: readonly { readonly hole: number; readonly par: number }[];
  readonly players: readonly PlayerState[];
  readonly config: LiveScoringConfig;
  readonly targets: readonly ScoreTarget[];
};

type TargetStrokeRow = LiveStanding & {
  readonly breakdown: Breakdown;
  readonly holes: { hole: number; par: number; strokes: number }[];
};

type RankedTargetRow = TargetStrokeRow & {
  readonly place: number | null;
};

class ScoringError extends Error {
  readonly code: "invalid_score_target";

  constructor(message: string) {
    super(message);
    this.name = "ScoringError";
    this.code = "invalid_score_target";
  }
}

export function computeLiveStandings(input: LiveScoringInput): LiveStanding[] {
  validateCardTargetsForScoring(input.targets, input.config);
  switch (input.config.scoringStyle) {
    case "stroke":
      return strokeTargetRows(input).map(toLiveStanding);
    case "matchplay":
      return matchplayTargetRows(input).map(toLiveStanding);
    default:
      return assertNever(input.config.scoringStyle);
  }
}

export function finalizeLiveStandings(input: LiveScoringInput): FinalLiveStanding[] {
  validateCardTargetsForScoring(input.targets, input.config);
  switch (input.config.scoringStyle) {
    case "stroke":
      return rankedStrokeTargets(input).flatMap((row) => expandFinalTargetRow(input.players, row));
    case "matchplay":
      return rankedMatchplayTargets(input).flatMap((row) => expandFinalTargetRow(input.players, row));
    default:
      return assertNever(input.config.scoringStyle);
  }
}

function strokeTargetRows(input: LiveScoringInput): TargetStrokeRow[] {
  const rows = input.targets.map((target) => targetStrokeRow(input.holes, input.players, target));
  rows.sort((a, b) => a.toPar - b.toPar || a.total - b.total || a.name.localeCompare(b.name));
  return rows;
}

function rankedStrokeTargets(input: LiveScoringInput): RankedTargetRow[] {
  const holeCount = input.holes.length;
  const rows = strokeTargetRows(input);
  const finishers = rows.filter((row) => completed(row, holeCount));
  const dnf = rows.filter((row) => !completed(row, holeCount));
  dnf.sort((a, b) => b.thru - a.thru || a.name.localeCompare(b.name));
  return [...rankTargets(finishers), ...dnf.map((row) => ({ ...row, place: null }))];
}

function matchplayTargetRows(input: LiveScoringInput): TargetStrokeRow[] {
  const match = matchplaySummary(input);
  return [...match.rows];
}

function rankedMatchplayTargets(input: LiveScoringInput): RankedTargetRow[] {
  const match = matchplaySummary(input);
  const ordered = [...match.rows].sort((a, b) => matchOutcomeOrder(a.match) - matchOutcomeOrder(b.match));
  return ordered.map((row) => {
    if (row.match == null) throw new ScoringError("matchplay row is missing match metadata");
    const place = match.isFinal ? matchPlace(row.match) : null;
    return { ...row, place };
  });
}

function matchplaySummary(input: LiveScoringInput): { readonly rows: readonly [TargetStrokeRow, TargetStrokeRow]; readonly isFinal: boolean } {
  const leftTarget = input.targets[0];
  const rightTarget = input.targets[1];
  if (leftTarget == null || rightTarget == null) {
    throw new ScoringError("matchplay scoring requires exactly two score targets per card");
  }
  const summary = summarizeMatchplay({
    holes: input.holes,
    players: input.players,
    targets: [leftTarget, rightTarget],
    targetName: (target) => targetStrokeRow(input.holes, input.players, target).name,
    scoreForTarget,
  });
  const [leftSide, rightSide] = summary.sides;
  return {
    isFinal: summary.isFinal,
    rows: [
      withMatch(targetStrokeRow(input.holes, input.players, leftSide.target), leftSide.match),
      withMatch(targetStrokeRow(input.holes, input.players, rightSide.target), rightSide.match),
    ],
  };
}

function targetStrokeRow(
  holes: readonly { readonly hole: number; readonly par: number }[],
  players: readonly PlayerState[],
  target: ScoreTarget,
): TargetStrokeRow {
  const pars: number[] = [];
  const strokes: number[] = [];
  const played: { hole: number; par: number; strokes: number }[] = [];
  let thru = 0;
  let total = 0;
  let toPar = 0;

  for (const hole of holes) {
    const score = scoreForTarget(players, target, hole.hole);
    if (score == null) continue;
    pars.push(hole.par);
    strokes.push(score);
    played.push({ hole: hole.hole, par: hole.par, strokes: score });
    thru++;
    total += score;
    toPar += score - hole.par;
  }

  const group = scoringGroup(players, target);
  return {
    memberId: target.memberIds[0] ?? null,
    name: target.label,
    division: null,
    thru,
    total,
    toPar,
    targetId: target.id,
    targetType: target.type,
    playerIndexes: target.playerIndexes,
    memberIds: target.memberIds,
    members: group.members,
    scoringGroup: target.type === "pair" ? group : undefined,
    breakdown: countScores(pars, strokes),
    holes: played,
  };
}

function scoreForTarget(players: readonly PlayerState[], target: ScoreTarget, hole: number): number | undefined {
  for (const index of target.playerIndexes) {
    const score = players[index]?.scores?.[hole];
    if (score != null) return score;
  }
  return undefined;
}

function scoringGroup(players: readonly PlayerState[], target: ScoreTarget): ScoringGroup {
  return {
    targetId: target.id,
    targetType: target.type,
    label: target.label,
    members: target.playerIndexes.map((index) => playerAt(players, index).name),
  };
}

function expandFinalTargetRow(players: readonly PlayerState[], row: RankedTargetRow): FinalLiveStanding[] {
  return row.playerIndexes.map((index) => {
    const player = playerAt(players, index);
    const base = {
      memberId: player.memberId,
      name: player.name,
      division: player.division ?? null,
      thru: row.thru,
      total: row.total,
      toPar: row.toPar,
      place: row.place,
      breakdown: row.breakdown,
      holes: row.holes,
    };
    if (row.scoringGroup != null && row.match != null) return { ...base, scoringGroup: row.scoringGroup, matchResult: finalMatchResult(row.match, row.place) };
    if (row.scoringGroup != null) return { ...base, scoringGroup: row.scoringGroup };
    if (row.match != null) return { ...base, matchResult: finalMatchResult(row.match, row.place) };
    return base;
  });
}

function toLiveStanding(row: TargetStrokeRow): LiveStanding {
  const base = {
    memberId: row.memberId,
    name: row.name,
    division: row.division,
    thru: row.thru,
    total: row.total,
    toPar: row.toPar,
    targetId: row.targetId,
    targetType: row.targetType,
    playerIndexes: row.playerIndexes,
    memberIds: row.memberIds,
    members: row.members,
  };
  if (row.scoringGroup != null && row.match != null) return { ...base, scoringGroup: row.scoringGroup, match: row.match };
  if (row.scoringGroup != null) return { ...base, scoringGroup: row.scoringGroup };
  if (row.match != null) return { ...base, match: row.match };
  return base;
}

function withMatch(row: TargetStrokeRow, match: MatchStatus): TargetStrokeRow {
  return { ...row, match };
}

function completed(row: TargetStrokeRow, holeCount: number): boolean {
  return holeCount > 0 && row.thru === holeCount;
}

function rankTargets(rows: readonly TargetStrokeRow[]): RankedTargetRow[] {
  let place = 0;
  let prevKey = "";
  return rows.map((row, index) => {
    const key = row.toPar + "/" + row.total;
    if (key !== prevKey) {
      place = index + 1;
      prevKey = key;
    }
    return { ...row, place };
  });
}

function playerAt(players: readonly PlayerState[], index: number): PlayerState {
  const player = players[index];
  if (player == null) throw new ScoringError(`score target references missing player index ${index}`);
  return player;
}

function assertNever(value: never): never {
  throw new ScoringError(`unhandled scoring variant: ${String(value)}`);
}
