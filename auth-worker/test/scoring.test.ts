import { describe, it, expect } from "vitest";
import { normalizeLiveScoringConfig, scoreTargetsForPlayers, validateCardTargetsForScoring, normalizePairLabel } from "../src/live-format.js";
import {
  assignCards,
  countScores,
  computeLeaderboard,
  computeLiveStandings,
  finalizeStandings,
  finalizeLiveStandings,
  computeLeagueStandings,
  type PlayerState,
} from "../src/scoring.js";

describe("assignCards", () => {
  const mk = (over: Partial<PlayerState>): PlayerState => ({ memberId: null, name: "P", scores: {}, ...over });
  it("buckets players into cards of 4 when no starting holes are assigned", () => {
    const players = Array.from({ length: 9 }, (_, i) => mk({ memberId: "m" + i }));
    assignCards(players);
    expect(players.map((p) => p.cardId)).toEqual(["c0", "c0", "c0", "c0", "c1", "c1", "c1", "c1", "c2"]);
  });
  it("groups players by shotgun starting hole when assigned", () => {
    const players = [mk({ startingHole: 5 }), mk({ startingHole: 5 }), mk({ startingHole: 9 })];
    assignCards(players);
    expect(players.map((p) => p.cardId)).toEqual(["h5", "h5", "h9"]);
  });
  it("never overwrites an explicit cardId", () => {
    const players = [mk({ cardId: "x" }), mk({})];
    assignCards(players);
    expect(players[0]!.cardId).toBe("x");
  });
});

describe("countScores (UDisc-style breakdown)", () => {
  it("buckets holes by score-to-par and tallies aces separately", () => {
    // pars:  3  4  3  5     strokes: 1  4  2  7
    // hole1: ace (1) + eagle (d=-2); hole2: par; hole3: birdie (d=-1); hole4: double+ (d=+2)
    const b = countScores([3, 4, 3, 5], [1, 4, 2, 7]);
    expect(b).toEqual({ aces: 1, eagles: 1, birdies: 1, pars: 1, bogeys: 0, doubles_plus: 1 });
  });
  it("counts bogeys and ignores missing/null holes", () => {
    const b = countScores([3, 3, 4], [4, null, 4]);
    expect(b).toEqual({ aces: 0, eagles: 0, birdies: 0, pars: 1, bogeys: 1, doubles_plus: 0 });
  });
});

describe("computeLeaderboard", () => {
  const holes = [
    { hole: 1, par: 3 },
    { hole: 2, par: 4 },
    { hole: 3, par: 3 },
  ];
  it("computes thru/total/toPar and sorts by to-par then total then name", () => {
    const players: PlayerState[] = [
      { memberId: "a", name: "Ann", scores: { 1: 4, 2: 4, 3: 3 } }, // +1, thru3, 11
      { memberId: "b", name: "Bo", scores: { 1: 2, 2: 4 } }, //          -1, thru2, 6
      { memberId: "c", name: "Cy", scores: {} }, //                       E, thru0, 0
    ];
    const lb = computeLeaderboard(holes, players);
    expect(lb.map((s) => s.name)).toEqual(["Bo", "Cy", "Ann"]); // -1, E, +1
    const bo = lb[0]!;
    expect(bo).toMatchObject({ name: "Bo", thru: 2, total: 6, toPar: -1 });
    expect(lb.find((s) => s.name === "Ann")).toMatchObject({ thru: 3, total: 11, toPar: 1 });
  });
});

describe("finalizeStandings (placements + breakdown for results)", () => {
  const holes = [
    { hole: 1, par: 3 },
    { hole: 2, par: 4 },
    { hole: 3, par: 3 },
  ];
  it("sorts, assigns competition ranks (ties share a place), and includes each player's breakdown", () => {
    const players: PlayerState[] = [
      { memberId: "a", name: "Ann", scores: { 1: 3, 2: 4, 3: 3 } }, // E, 10
      { memberId: "b", name: "Bo", scores: { 1: 2, 2: 4, 3: 3 } }, //  -1, 9
      { memberId: "c", name: "Cy", scores: { 1: 3, 2: 4, 3: 3 } }, //  E, 10 (ties Ann)
    ];
    const fs = finalizeStandings(holes, players);
    expect(fs.map((s) => s.name)).toEqual(["Bo", "Ann", "Cy"]);
    expect(fs[0]).toMatchObject({ name: "Bo", place: 1, total: 9, toPar: -1 });
    expect(fs[1]!.place).toBe(2);
    expect(fs[2]!.place).toBe(2); // tie shares place 2 (next would be 4)
    expect(fs[0]!.breakdown).toMatchObject({ birdies: 1, pars: 2, bogeys: 0 });
  });

  it("marks an incomplete card DNF (place null) but still tallies its played holes", () => {
    const fs = finalizeStandings(holes, [{ memberId: "x", name: "X", scores: { 1: 4 } }]); // thru 1 of 3
    expect(fs[0]).toMatchObject({ place: null, thru: 1, total: 4, toPar: 1 });
    expect(fs[0]!.breakdown).toMatchObject({ bogeys: 1 });
  });

  it("emits each player's played holes in layout order for the UDisc scorecard (skips unplayed)", () => {
    const fs = finalizeStandings(holes, [
      { memberId: "a", name: "Ann", scores: { 1: 3, 2: 4, 3: 3 } }, // complete
      { memberId: "p", name: "Partial", scores: { 1: 4, 3: 2 } }, //  skipped hole 2
    ]);
    expect(fs.find((s) => s.name === "Ann")!.holes).toEqual([
      { hole: 1, par: 3, strokes: 3 },
      { hole: 2, par: 4, strokes: 4 },
      { hole: 3, par: 3, strokes: 3 },
    ]);
    expect(fs.find((s) => s.name === "Partial")!.holes).toEqual([
      { hole: 1, par: 3, strokes: 4 },
      { hole: 3, par: 3, strokes: 2 },
    ]); // unplayed hole 2 omitted, order preserved
  });

  it("ranks only finishers; no-shows/partials are DNF (null) and never outrank a real finisher", () => {
    const players: PlayerState[] = [
      { memberId: "f", name: "Finisher", scores: { 1: 4, 2: 5, 3: 4 } }, // +3, complete
      { memberId: "n", name: "NoShow", scores: {} }, //                     thru 0
      { memberId: "p", name: "Partial", scores: { 1: 3 } }, //             thru 1 of 3
    ];
    const fs = finalizeStandings(holes, players);
    expect(fs[0]).toMatchObject({ name: "Finisher", place: 1 }); // ranked despite being +3
    expect(fs.find((s) => s.name === "NoShow")!.place).toBeNull();
    expect(fs.find((s) => s.name === "Partial")!.place).toBeNull();
    expect(new Set([fs[1]!.name, fs[2]!.name])).toEqual(new Set(["Partial", "NoShow"])); // DNFs sort last
  });
});

describe("config-aware live standings", () => {
  const twoHoleLayout = [
    { hole: 1, par: 3 },
    { hole: 2, par: 3 },
  ];

  it("keeps legacy singles stroke callers unchanged through the config-aware surface", () => {
    // Given a legacy singles stroke card with no pair or matchplay behavior.
    const players: PlayerState[] = [
      { memberId: "a", name: "Ann", scores: { 1: 4, 2: 3 } },
      { memberId: "b", name: "Bo", scores: { 1: 3, 2: 3 } },
    ];
    const legacy = computeLeaderboard(twoHoleLayout, players);
    const targets = scoreTargetsForPlayers(players, { groupFormat: "singles", scoringStyle: "stroke" });

    // When the config-aware scorer runs in singles stroke mode.
    const live = computeLiveStandings({ holes: twoHoleLayout, players, config: { groupFormat: "singles", scoringStyle: "stroke" }, targets });
    const finalized = finalizeLiveStandings({ holes: twoHoleLayout, players, config: { groupFormat: "singles", scoringStyle: "stroke" }, targets });

    // Then legacy player ordering and stroke totals are preserved.
    expect(live.map(({ name, thru, total, toPar }) => ({ name, thru, total, toPar }))).toEqual(
      legacy.map(({ name, thru, total, toPar }) => ({ name, thru, total, toPar })),
    );
    expect(finalized.map(({ name, place, total, toPar }) => ({ name, place, total, toPar }))).toEqual([
      { name: "Bo", place: 1, total: 6, toPar: 0 },
      { name: "Ann", place: 2, total: 7, toPar: 1 },
    ]);
  });

  it("groups doubles stroke standings by pair target and finalizes member rows with shared pair metadata", () => {
    // Given two doubles pairs with mirrored pair scores over two holes.
    const players: PlayerState[] = [
      { memberId: "a", name: "Ann", team: "Alpha", scores: { 1: 3, 2: 3 } },
      { memberId: "b", name: "Bo", team: "Alpha", scores: { 1: 3, 2: 3 } },
      { memberId: "c", name: "Cy", team: "Beta", scores: { 1: 4, 2: 4 } },
      { memberId: "d", name: "Dee", team: "Beta", scores: { 1: 4, 2: 4 } },
    ];
    const config = { groupFormat: "doubles", scoringStyle: "stroke" } as const;
    const targets = scoreTargetsForPlayers(players, config);

    // When live and final standings are computed by pair target.
    const live = computeLiveStandings({ holes: twoHoleLayout, players, config, targets });
    const finalized = finalizeLiveStandings({ holes: twoHoleLayout, players, config, targets });

    // Then one pair leads by strokes, and each member gets the shared pair result.
    expect(live.map(({ targetId, name, total, toPar, members }) => ({ targetId, name, total, toPar, members }))).toEqual([
      { targetId: "pair:alpha", name: "Alpha", total: 6, toPar: 0, members: ["Ann", "Bo"] },
      { targetId: "pair:beta", name: "Beta", total: 8, toPar: 2, members: ["Cy", "Dee"] },
    ]);
    expect(finalized.map(({ name, place, total, toPar, scoringGroup }) => ({ name, place, total, toPar, scoringGroup }))).toEqual([
      { name: "Ann", place: 1, total: 6, toPar: 0, scoringGroup: { targetId: "pair:alpha", targetType: "pair", label: "Alpha", members: ["Ann", "Bo"] } },
      { name: "Bo", place: 1, total: 6, toPar: 0, scoringGroup: { targetId: "pair:alpha", targetType: "pair", label: "Alpha", members: ["Ann", "Bo"] } },
      { name: "Cy", place: 2, total: 8, toPar: 2, scoringGroup: { targetId: "pair:beta", targetType: "pair", label: "Beta", members: ["Cy", "Dee"] } },
      { name: "Dee", place: 2, total: 8, toPar: 2, scoringGroup: { targetId: "pair:beta", targetType: "pair", label: "Beta", members: ["Cy", "Dee"] } },
    ]);
  });

  it("keeps tied doubles stroke pairs on the same final place", () => {
    const players: PlayerState[] = [
      { memberId: "a", name: "Ann", team: "Alpha", scores: { 1: 3, 2: 3 } },
      { memberId: "b", name: "Bo", team: "Alpha", scores: { 1: 3, 2: 3 } },
      { memberId: "c", name: "Cy", team: "Beta", scores: { 1: 2, 2: 4 } },
      { memberId: "d", name: "Dee", team: "Beta", scores: { 1: 2, 2: 4 } },
    ];
    const config = { groupFormat: "doubles", scoringStyle: "stroke" } as const;
    const targets = scoreTargetsForPlayers(players, config);

    const finalized = finalizeLiveStandings({ holes: twoHoleLayout, players, config, targets });

    expect(finalized.map(({ name, place, total, toPar, scoringGroup }) => ({ name, place, total, toPar, group: scoringGroup?.label }))).toEqual([
      { name: "Ann", place: 1, total: 6, toPar: 0, group: "Alpha" },
      { name: "Bo", place: 1, total: 6, toPar: 0, group: "Alpha" },
      { name: "Cy", place: 1, total: 6, toPar: 0, group: "Beta" },
      { name: "Dee", place: 1, total: 6, toPar: 0, group: "Beta" },
    ]);
  });

  it("marks incomplete doubles stroke pairs as DNF without outranking complete pairs", () => {
    const players: PlayerState[] = [
      { memberId: "a", name: "Ann", team: "Alpha", scores: { 1: 4, 2: 4 } },
      { memberId: "b", name: "Bo", team: "Alpha", scores: { 1: 4, 2: 4 } },
      { memberId: "c", name: "Cy", team: "Beta", scores: { 1: 3 } },
      { memberId: "d", name: "Dee", team: "Beta", scores: { 1: 3 } },
    ];
    const config = { groupFormat: "doubles", scoringStyle: "stroke" } as const;
    const targets = scoreTargetsForPlayers(players, config);

    const live = computeLiveStandings({ holes: twoHoleLayout, players, config, targets });
    const finalized = finalizeLiveStandings({ holes: twoHoleLayout, players, config, targets });

    expect(live.map(({ name, thru, total, toPar }) => ({ name, thru, total, toPar }))).toEqual([
      { name: "Beta", thru: 1, total: 3, toPar: 0 },
      { name: "Alpha", thru: 2, total: 8, toPar: 2 },
    ]);
    expect(finalized.map(({ name, place, thru, total, toPar }) => ({ name, place, thru, total, toPar }))).toEqual([
      { name: "Ann", place: 1, thru: 2, total: 8, toPar: 2 },
      { name: "Bo", place: 1, thru: 2, total: 8, toPar: 2 },
      { name: "Cy", place: null, thru: 1, total: 3, toPar: 0 },
      { name: "Dee", place: null, thru: 1, total: 3, toPar: 0 },
    ]);
  });

  it("reports singles matchplay as all square when hole wins are tied", () => {
    // Given each side wins one hole.
    const players: PlayerState[] = [
      { memberId: "a", name: "Ann", scores: { 1: 3, 2: 5 } },
      { memberId: "b", name: "Bo", scores: { 1: 4, 2: 4 } },
    ];
    const config = { groupFormat: "singles", scoringStyle: "matchplay" } as const;
    const targets = scoreTargetsForPlayers(players, config);

    // When matchplay standings are computed.
    const live = computeLiveStandings({ holes: twoHoleLayout, players, config, targets });

    // Then the match status is all square and row order is side order, not total-to-par ranking.
    expect(live.map(({ name, total, match }) => ({ name, total, match }))).toEqual([
      { name: "Ann", total: 8, match: { status: "AS", outcome: "draw", holesWon: 1, holesLost: 1, holesTied: 0, lead: 0, holesRemaining: 0, opponent: "Bo", dormie: false } },
      { name: "Bo", total: 8, match: { status: "AS", outcome: "draw", holesWon: 1, holesLost: 1, holesTied: 0, lead: 0, holesRemaining: 0, opponent: "Ann", dormie: false } },
    ]);
  });

  it("reports singles matchplay as N up before the match is closed", () => {
    // Given Ann wins the first hole and the second hole is unplayed.
    const players: PlayerState[] = [
      { memberId: "a", name: "Ann", scores: { 1: 3 } },
      { memberId: "b", name: "Bo", scores: { 1: 4 } },
    ];
    const config = { groupFormat: "singles", scoringStyle: "matchplay" } as const;
    const targets = scoreTargetsForPlayers(players, config);

    // When matchplay standings are computed.
    const live = computeLiveStandings({ holes: twoHoleLayout, players, config, targets });

    // Then the leading side is 1 up with 1 to play = DORMIE (a win or a halve on the last hole clinches it).
    expect(live.map(({ name, match }) => ({ name, match }))).toEqual([
      { name: "Ann", match: { status: "1 up (dormie)", outcome: "leading", holesWon: 1, holesLost: 0, holesTied: 0, lead: 1, holesRemaining: 1, opponent: "Bo", dormie: true } },
      { name: "Bo", match: { status: "1 up (dormie)", outcome: "trailing", holesWon: 0, holesLost: 1, holesTied: 0, lead: -1, holesRemaining: 1, opponent: "Ann", dormie: true } },
    ]);
  });

  it("reports singles matchplay as won N&M once the lead exceeds holes remaining", () => {
    // Given Ann wins two holes with one hole remaining.
    const players: PlayerState[] = [
      { memberId: "a", name: "Ann", scores: { 1: 3, 2: 3 } },
      { memberId: "b", name: "Bo", scores: { 1: 4, 2: 4 } },
    ];
    const holes = [...twoHoleLayout, { hole: 3, par: 3 }];
    const config = { groupFormat: "singles", scoringStyle: "matchplay" } as const;
    const targets = scoreTargetsForPlayers(players, config);

    // When final matchplay rows are computed.
    const finalized = finalizeLiveStandings({ holes, players, config, targets });

    // Then winner and loser rows carry the same closed match status metadata.
    expect(finalized.map(({ name, place, matchResult }) => ({ name, place, matchResult }))).toEqual([
      { name: "Ann", place: 1, matchResult: { status: "won 2&1", outcome: "won", holesWon: 2, holesLost: 0, holesTied: 0, lead: 2, holesRemaining: 1, opponent: "Bo", dormie: false } },
      { name: "Bo", place: 2, matchResult: { status: "won 2&1", outcome: "lost", holesWon: 0, holesLost: 2, holesTied: 0, lead: -2, holesRemaining: 1, opponent: "Ann", dormie: false } },
    ]);
  });

  it("computes doubles matchplay from pair side scores and expands final metadata to both members", () => {
    // Given two pair targets in matchplay and Alpha closes the match.
    const players: PlayerState[] = [
      { memberId: "a", name: "Ann", team: "Alpha", scores: { 1: 3, 2: 3 } },
      { memberId: "b", name: "Bo", team: "Alpha", scores: { 1: 3, 2: 3 } },
      { memberId: "c", name: "Cy", team: "Beta", scores: { 1: 4, 2: 4 } },
      { memberId: "d", name: "Dee", team: "Beta", scores: { 1: 4, 2: 4 } },
    ];
    const holes = [...twoHoleLayout, { hole: 3, par: 3 }];
    const config = { groupFormat: "doubles", scoringStyle: "matchplay" } as const;
    const targets = scoreTargetsForPlayers(players, config);

    // When doubles matchplay is finalized.
    const finalized = finalizeLiveStandings({ holes, players, config, targets });

    // Then both members on a side receive the same side result and pair metadata.
    expect(finalized.map(({ name, place, scoringGroup, matchResult }) => ({ name, place, scoringGroup, matchResult }))).toEqual([
      { name: "Ann", place: 1, scoringGroup: { targetId: "pair:alpha", targetType: "pair", label: "Alpha", members: ["Ann", "Bo"] }, matchResult: { status: "won 2&1", outcome: "won", holesWon: 2, holesLost: 0, holesTied: 0, lead: 2, holesRemaining: 1, opponent: "Beta", dormie: false } },
      { name: "Bo", place: 1, scoringGroup: { targetId: "pair:alpha", targetType: "pair", label: "Alpha", members: ["Ann", "Bo"] }, matchResult: { status: "won 2&1", outcome: "won", holesWon: 2, holesLost: 0, holesTied: 0, lead: 2, holesRemaining: 1, opponent: "Beta", dormie: false } },
      { name: "Cy", place: 2, scoringGroup: { targetId: "pair:beta", targetType: "pair", label: "Beta", members: ["Cy", "Dee"] }, matchResult: { status: "won 2&1", outcome: "lost", holesWon: 0, holesLost: 2, holesTied: 0, lead: -2, holesRemaining: 1, opponent: "Alpha", dormie: false } },
      { name: "Dee", place: 2, scoringGroup: { targetId: "pair:beta", targetType: "pair", label: "Beta", members: ["Cy", "Dee"] }, matchResult: { status: "won 2&1", outcome: "lost", holesWon: 0, holesLost: 2, holesTied: 0, lead: -2, holesRemaining: 1, opponent: "Alpha", dormie: false } },
    ]);
  });

  it("rejects matchplay standings with three targets instead of returning misleading stroke rankings", () => {
    // Given three active singles targets on one card.
    const players: PlayerState[] = [
      { memberId: "a", name: "Ann", scores: { 1: 3 } },
      { memberId: "b", name: "Bo", scores: { 1: 4 } },
      { memberId: "c", name: "Cy", scores: { 1: 5 } },
    ];
    const config = { groupFormat: "singles", scoringStyle: "matchplay" } as const;
    const targets = scoreTargetsForPlayers(players, config);

    // When matchplay standings are requested, then target validation fails.
    expect(() => computeLiveStandings({ holes: twoHoleLayout, players, config, targets })).toThrow(/exactly two/i);
  });
});

describe("computeLeagueStandings (season table across a league's events)", () => {
  it("aggregates per member into points/wins, sorts with tiebreaks", () => {
    const rows = [
      { member_id: "a", name: "Ann", place: 1, to_par: -3 }, // round 1
      { member_id: "b", name: "Bo", place: 2, to_par: -1 },
      { member_id: "a", name: "Ann", place: 2, to_par: -1 }, // round 2
      { member_id: "b", name: "Bo", place: 1, to_par: -4 },
      { member_id: "c", name: "Cy", place: 3, to_par: 1 },
    ];
    const st = computeLeagueStandings(rows);
    // Ann & Bo both 17 pts / 1 win → tiebreak total_to_par asc → Bo (-5) ahead of Ann (-4)
    expect(st.map((s) => s.name)).toEqual(["Bo", "Ann", "Cy"]);
    expect(st[0]).toMatchObject({ name: "Bo", events: 2, wins: 1, points: 17, total_to_par: -5, best_place: 1 });
    expect(st.find((s) => s.name === "Cy")).toMatchObject({ events: 1, wins: 0, points: 5, best_place: 3 });
  });

  it("groups guests (null member_id) by name", () => {
    const st = computeLeagueStandings([
      { member_id: null, name: "Guest", place: 1, to_par: -2 },
      { member_id: null, name: "Guest", place: 1, to_par: -1 },
    ]);
    expect(st).toHaveLength(1);
    expect(st[0]).toMatchObject({ name: "Guest", events: 2, wins: 2 });
  });
});

describe("live scoring format helpers", () => {
  it("defaults missing legacy live scoring config to singles stroke", () => {
    // Given a legacy live round with no explicit scoring configuration.
    // When the config crosses the helper boundary.
    const config = normalizeLiveScoringConfig(undefined);

    // Then it remains compatible with existing singles stroke scoring.
    expect(config).toEqual({ groupFormat: "singles", scoringStyle: "stroke" });
  });

  it("returns one singles score target per active player", () => {
    // Given singles scoring with two active players and one removed player.
    const players = [
      { memberId: "a", name: "Ann" },
      { memberId: null, name: "Guest" },
      { memberId: "r", name: "Removed", removed: true },
    ];

    // When singles score targets are built.
    const targets = scoreTargetsForPlayers(players, { groupFormat: "singles", scoringStyle: "stroke" });

    // Then only active players receive individual score targets.
    expect(targets).toEqual([
      {
        type: "player",
        id: "player:0",
        label: "Ann",
        playerIndexes: [0],
        memberIds: ["a"],
      },
      {
        type: "player",
        id: "player:1",
        label: "Guest",
        playerIndexes: [1],
        memberIds: [null],
      },
    ]);
  });

  it("normalizes pair labels for doubles grouping", () => {
    // Given a pair label with extra spacing.
    // When the label is normalized.
    const label = normalizePairLabel("  Team   Alpha  ");

    // Then the display label is stable for grouping and target labels.
    expect(label).toBe("Team Alpha");
  });

  it("returns one doubles score target for two active players sharing a pair label", () => {
    // Given two active players sharing the same normalized pair label.
    const players = [
      { memberId: "a", name: "Ann", team: "Team Alpha" },
      { memberId: "b", name: "Bo", team: " team   alpha " },
    ];

    // When doubles stroke score targets are built.
    const targets = scoreTargetsForPlayers(players, { groupFormat: "doubles", scoringStyle: "stroke" });

    // Then both players share one pair target.
    expect(targets).toEqual([
      {
        type: "pair",
        id: "pair:team alpha",
        label: "Team Alpha",
        playerIndexes: [0, 1],
        memberIds: ["a", "b"],
      },
    ]);
  });

  it("rejects doubles scoring when an active player has no pair label", () => {
    // Given a doubles round with an unpaired active player.
    const players = [
      { memberId: "a", name: "Ann", team: "A" },
      { memberId: "b", name: "Bo", team: "A" },
      { memberId: "c", name: "Cy", team: "" },
    ];

    // When score targets are built, then the helper rejects the malformed card.
    expect(() => scoreTargetsForPlayers(players, { groupFormat: "doubles", scoringStyle: "stroke" })).toThrow(/pair label/i);
  });

  it("rejects doubles scoring when a pair label has more than two active players", () => {
    // Given a doubles round where three active players share one pair label.
    const players = [
      { memberId: "a", name: "Ann", team: "A" },
      { memberId: "b", name: "Bo", team: "A" },
      { memberId: "c", name: "Cy", team: "A" },
    ];

    // When score targets are built, then the helper enforces exact doubles pair size.
    expect(() => scoreTargetsForPlayers(players, { groupFormat: "doubles", scoringStyle: "stroke" })).toThrow(/exactly two/i);
  });

  it("rejects doubles scoring when exactly one active player has a pair label", () => {
    // Given a doubles round where one active player has a nonblank pair label.
    const players = [{ memberId: "a", name: "Ann", team: "A" }];

    // When score targets are built, then the helper rejects the invalid pair size.
    expect(() => scoreTargetsForPlayers(players, { groupFormat: "doubles", scoringStyle: "stroke" })).toThrow(/exactly two active players/i);
  });

  it("requires exactly two score targets for matchplay cards", () => {
    // Given three singles targets on one card.
    const targets = scoreTargetsForPlayers(
      [
        { memberId: "a", name: "Ann" },
        { memberId: "b", name: "Bo" },
        { memberId: "c", name: "Cy" },
      ],
      { groupFormat: "singles", scoringStyle: "matchplay" },
    );

    // When validating a matchplay card, then more than two sides are rejected.
    expect(() => validateCardTargetsForScoring(targets, { groupFormat: "singles", scoringStyle: "matchplay" })).toThrow(/exactly two/i);
  });

  it("rejects unsupported team group format and custom scoring style", () => {
    // Given unsupported future/legacy values outside this feature scope.
    // When each value is normalized, then the boundary rejects it.
    expect(() => normalizeLiveScoringConfig({ groupFormat: "team", scoringStyle: "stroke" })).toThrow(/groupFormat/i);
    expect(() => normalizeLiveScoringConfig({ groupFormat: "singles", scoringStyle: "custom" })).toThrow(/scoringStyle/i);
  });
});
