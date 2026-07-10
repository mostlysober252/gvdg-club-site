import { describe, expect, it } from "vitest";
import { computeLeagueStandings, computeRoundWinners, computeTeamStandings } from "../src/scoring.js";

// Ryder Cup / matchplay league scoring: a match is worth 2 pts to the winning side, 1 pt to EACH side on a
// tie/draw, 0 to the loser — replacing the stroke-tournament place-points. Team standings count each MATCH
// once (a doubles match = 4 result rows but one team result), with a per-player breakdown alongside.
const mr = (outcome: string) => JSON.stringify({ status: outcome === "draw" ? "AS" : "won 3&2", outcome });
const sg = (label: string, teamName: string) => JSON.stringify({ label, teamName, members: [] });

describe("matchplay league points (2 win / 1 tie / 0 loss)", () => {
  it("awards a player 2 for a win, 1 for a tie, 0 for a loss (not place-points)", () => {
    expect(computeLeagueStandings([{ member_id: "m1", name: "A", place: 1, to_par: -3, match_result: mr("won") }])[0]?.points).toBe(2);
    expect(computeLeagueStandings([{ member_id: "m2", name: "B", place: 1, to_par: 0, match_result: mr("draw") }])[0]?.points).toBe(1);
    expect(computeLeagueStandings([{ member_id: "m3", name: "C", place: 2, to_par: 0, match_result: mr("lost") }])[0]?.points).toBe(0);
  });

  it("counts a matchplay win in the player's wins tally", () => {
    const [s] = computeLeagueStandings([{ member_id: "m1", name: "A", place: 1, to_par: -3, match_result: mr("won") }]);
    expect(s?.wins).toBe(1);
    expect(s?.events).toBe(1);
  });

  it("leaves stroke rounds on place-points (unchanged)", () => {
    expect(computeLeagueStandings([{ member_id: "m1", name: "A", place: 1, to_par: -5, match_result: null }])[0]?.points).toBe(10);
  });
});

describe("team standings (Red vs Blue, per-match)", () => {
  it("scores each match once per team — a doubles match's 4 rows count as ONE team result", () => {
    const rows = [
      { event_id: 6, scoring_group: sg("Blue", "Jesus Team"), match_result: mr("won") },
      { event_id: 6, scoring_group: sg("Blue", "Jesus Team"), match_result: mr("won") },
      { event_id: 6, scoring_group: sg("Red", "Juan Team"), match_result: mr("lost") },
      { event_id: 6, scoring_group: sg("Red", "Juan Team"), match_result: mr("lost") },
    ];
    const teams = computeTeamStandings(rows);
    const blue = teams.find((t) => t.team === "Blue");
    const red = teams.find((t) => t.team === "Red");
    expect(blue?.points).toBe(2);
    expect(blue?.matches).toBe(1);
    expect(blue?.wins).toBe(1);
    expect(blue?.teamName).toBe("Jesus Team");
    expect(red?.points).toBe(0);
    expect(red?.matches).toBe(1);
    expect(red?.losses).toBe(1);
  });

  it("computeRoundWinners maps each round to its winning side (tie wins over stragglers)", () => {
    const winners = computeRoundWinners([
      { event_id: 6, scoring_group: sg("Blue", "Jesus"), match_result: mr("won") },
      { event_id: 6, scoring_group: sg("Red", "Juan"), match_result: mr("lost") },
      { event_id: 7, scoring_group: sg("Red", "Juan"), match_result: mr("won") },
      { event_id: 9, scoring_group: sg("Blue", "Jesus"), match_result: mr("draw") },
      { event_id: 9, scoring_group: sg("Red", "Juan"), match_result: mr("draw") },
    ]);
    expect(winners[6]).toBe("blue");
    expect(winners[7]).toBe("red");
    expect(winners[9]).toBe("tie");
  });

  it("a tie gives BOTH teams 1 point", () => {
    const rows = [
      { event_id: 9, scoring_group: sg("Blue", "Jesus Team"), match_result: mr("draw") },
      { event_id: 9, scoring_group: sg("Red", "Juan Team"), match_result: mr("draw") },
    ];
    const teams = computeTeamStandings(rows);
    expect(teams.find((t) => t.team === "Blue")?.points).toBe(1);
    expect(teams.find((t) => t.team === "Red")?.points).toBe(1);
    expect(teams.find((t) => t.team === "Blue")?.ties).toBe(1);
  });
});
