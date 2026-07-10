import { describe, expect, it } from "vitest";
import { recordScoreTargetVote, scoreTargetConsensusIssues } from "../src/live-consensus.js";
import type { LiveScoringConfig, ScoreTarget } from "../src/live-format.js";
import type { PlayerState } from "../src/scoring.js";

// A doubles-matchplay card: Blue pair (idx 0,1) vs Red pair (idx 2,3), all on one card.
const blue = { type: "pair", id: "pair:blue", label: "Blue", playerIndexes: [0, 1], memberIds: ["m0", "m1"] } satisfies ScoreTarget;
const red = { type: "pair", id: "pair:red", label: "Red", playerIndexes: [2, 3], memberIds: ["m2", "m3"] } satisfies ScoreTarget;

const MATCHPLAY_DOUBLES: LiveScoringConfig = { groupFormat: "doubles", scoringStyle: "matchplay" };
const STROKE_DOUBLES: LiveScoringConfig = { groupFormat: "doubles", scoringStyle: "stroke" };

function card(): PlayerState[] {
  return [
    { memberId: "m0", name: "A", cardId: "c0", scores: {} },
    { memberId: "m1", name: "B", cardId: "c0", scores: {} },
    { memberId: "m2", name: "C", cardId: "c0", scores: {} },
    { memberId: "m3", name: "D", cardId: "c0", scores: {} },
  ];
}

const holes18 = Array.from({ length: 18 }, (_, i) => ({ hole: i + 1 }));

/** Record a confirmed hole result for both teams: one registered member of each side attests (Blue via
 *  player:0, Red via player:2) — enough for competition confirmation. blueStrokes<redStrokes → Blue wins it. */
function playHole(players: PlayerState[], hole: number, blueStrokes: number, redStrokes: number): void {
  recordScoreTargetVote({ players, target: blue, scorerId: "player:0", hole, strokes: blueStrokes });
  recordScoreTargetVote({ players, target: red, scorerId: "player:2", hole, strokes: redStrokes });
}

describe("matchplay finalize gate — post-clinch hole waiver", () => {
  it("finalizes a decided match (Blue 3&2) WITHOUT scoring the dead holes 17-18", () => {
    const players = card();
    // Blue wins holes 1-3, halves 4-16 → 3 up with 2 to play after 16 = clinched (3&2). 17-18 not played.
    for (let h = 1; h <= 3; h++) playHole(players, h, 3, 4);
    for (let h = 4; h <= 16; h++) playHole(players, h, 3, 3);

    const issues = scoreTargetConsensusIssues(players, holes18, [blue, red], { casual: false, config: MATCHPLAY_DOUBLES });

    expect(issues.conflicts).toEqual([]);
    expect(issues.missing).toEqual([]); // holes 17-18 are waived — the match is mathematically over
  });

  it("still requires every hole for an all-square match (never clinches early)", () => {
    const players = card();
    for (let h = 1; h <= 16; h++) playHole(players, h, 3, 3); // dead even after 16 → 17-18 still matter

    const missing = scoreTargetConsensusIssues(players, holes18, [blue, red], { casual: false, config: MATCHPLAY_DOUBLES }).missing;
    const missingHoles = new Set(missing.map((m) => m.hole));
    expect(missingHoles.has(17)).toBe(true);
    expect(missingHoles.has(18)).toBe(true);
  });

  it("still requires remaining holes when dormie but not yet decided (2 up, 2 to play)", () => {
    const players = card();
    for (let h = 1; h <= 2; h++) playHole(players, h, 3, 4); // Blue +2
    for (let h = 3; h <= 16; h++) playHole(players, h, 3, 3); // stays +2 with 2 to play = dormie, not decided

    const missingHoles = new Set(
      scoreTargetConsensusIssues(players, holes18, [blue, red], { casual: false, config: MATCHPLAY_DOUBLES }).missing.map((m) => m.hole),
    );
    expect(missingHoles.has(17)).toBe(true);
    expect(missingHoles.has(18)).toBe(true);
  });

  it("does NOT waive holes for stroke play (every hole always required)", () => {
    const players = card();
    for (let h = 1; h <= 3; h++) playHole(players, h, 3, 4);
    for (let h = 4; h <= 16; h++) playHole(players, h, 3, 3); // same scores, but stroke config → no waiver

    const missingHoles = new Set(
      scoreTargetConsensusIssues(players, holes18, [blue, red], { casual: false, config: STROKE_DOUBLES }).missing.map((m) => m.hole),
    );
    expect(missingHoles.has(17)).toBe(true);
    expect(missingHoles.has(18)).toBe(true);
  });
});
