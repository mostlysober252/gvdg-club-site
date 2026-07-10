import type { ScoreTarget } from "./live-format.js";
import type { PlayerState } from "./scoring.js";

export interface MatchStatus {
  readonly status: string;
  readonly outcome: "draw" | "leading" | "trailing" | "won" | "lost";
  readonly holesWon: number;
  readonly holesLost: number;
  readonly holesTied: number;
  readonly lead: number;
  readonly holesRemaining: number;
  readonly opponent: string;
  /** Dormie: the leader is up by exactly the number of holes left, so winning OR halving the current hole
   *  clinches the match (the trailer can at best force a tie by winning every remaining hole). */
  readonly dormie: boolean;
}

export type MatchplaySide = {
  readonly target: ScoreTarget;
  readonly name: string;
  readonly match: MatchStatus;
};

export type MatchplaySummary = {
  readonly sides: readonly [MatchplaySide, MatchplaySide];
  readonly isFinal: boolean;
};

export function summarizeMatchplay(input: {
  readonly holes: readonly { readonly hole: number }[];
  readonly players: readonly PlayerState[];
  readonly targets: readonly [ScoreTarget, ScoreTarget];
  readonly targetName: (target: ScoreTarget) => string;
  readonly scoreForTarget: (players: readonly PlayerState[], target: ScoreTarget, hole: number) => number | undefined;
}): MatchplaySummary {
  const [leftTarget, rightTarget] = input.targets;
  const leftName = input.targetName(leftTarget);
  const rightName = input.targetName(rightTarget);
  let leftWins = 0;
  let rightWins = 0;
  let tied = 0;
  let played = 0;

  for (const hole of input.holes) {
    const leftScore = input.scoreForTarget(input.players, leftTarget, hole.hole);
    const rightScore = input.scoreForTarget(input.players, rightTarget, hole.hole);
    if (leftScore == null || rightScore == null) continue;
    played++;
    if (leftScore < rightScore) leftWins++;
    else if (rightScore < leftScore) rightWins++;
    else tied++;
  }

  const holesRemaining = Math.max(0, input.holes.length - played);
  const lead = leftWins - rightWins;
  // Dormie: the leader's margin equals the holes left AND the match isn't already decided/over — a win or a
  // halve on the current hole ends it. A match-level property, so it's the same for both sides.
  const dormie = Math.abs(lead) > 0 && Math.abs(lead) === holesRemaining && holesRemaining > 0;
  const status = matchStatusLabel(lead, holesRemaining, dormie);
  const isFinal = holesRemaining === 0 || Math.abs(lead) > holesRemaining;
  const rightLead = lead === 0 ? 0 : -lead;
  return {
    isFinal,
    sides: [
      {
        target: leftTarget,
        name: leftName,
        match: {
          status,
          outcome: liveOutcome(lead),
          holesWon: leftWins,
          holesLost: rightWins,
          holesTied: tied,
          lead,
          holesRemaining,
          opponent: rightName,
          dormie,
        },
      },
      {
        target: rightTarget,
        name: rightName,
        match: {
          status,
          outcome: liveOutcome(-lead),
          holesWon: rightWins,
          holesLost: leftWins,
          holesTied: tied,
          lead: rightLead,
          holesRemaining,
          opponent: leftName,
          dormie,
        },
      },
    ],
  };
}

export function finalMatchResult(match: MatchStatus, place: number | null): MatchStatus {
  if (place == null) return match;
  switch (match.outcome) {
    case "leading":
      return { ...match, outcome: "won" };
    case "trailing":
      return { ...match, outcome: "lost" };
    case "draw":
    case "won":
    case "lost":
      return match;
    default:
      return assertNever(match.outcome);
  }
}

export function matchOutcomeOrder(match: MatchStatus | undefined): number {
  if (match == null) return 1;
  switch (match.outcome) {
    case "leading":
    case "won":
      return 0;
    case "draw":
      return 1;
    case "trailing":
    case "lost":
      return 2;
    default:
      return assertNever(match.outcome);
  }
}

export function matchPlace(match: MatchStatus): number {
  switch (match.outcome) {
    case "draw":
    case "leading":
    case "won":
      return 1;
    case "trailing":
    case "lost":
      return 2;
    default:
      return assertNever(match.outcome);
  }
}

function liveOutcome(lead: number): MatchStatus["outcome"] {
  if (lead > 0) return "leading";
  if (lead < 0) return "trailing";
  return "draw";
}

function matchStatusLabel(lead: number, holesRemaining: number, dormie: boolean): string {
  const margin = Math.abs(lead);
  if (margin === 0) return "AS";
  if (margin > holesRemaining) return `won ${margin}&${holesRemaining}`;
  if (dormie) return `${margin} up (dormie)`;
  return `${margin} up`;
}

function assertNever(value: never): never {
  throw new Error(`unhandled matchplay variant: ${String(value)}`);
}
