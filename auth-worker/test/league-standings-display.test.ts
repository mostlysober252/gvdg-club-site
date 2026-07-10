import { describe, expect, it } from "vitest";
import { computeLeagueStandings } from "../src/scoring.js";

// A matchplay round's to_par is a stroke artifact (meaningless for the season "To Par" column). Points and
// wins come from finishing place (already correct for matchplay via matchPlace); only the to_par sum must
// skip matchplay rows. Stroke rounds are unchanged.
describe("league standings do not accumulate stroke to_par for matchplay rounds", () => {
  it("counts a matchplay win but ignores its stroke to_par", () => {
    const [s] = computeLeagueStandings([
      { member_id: "m1", name: "A", place: 1, to_par: -3, match_result: JSON.stringify({ status: "won 3&2", outcome: "won" }) },
    ]);
    expect(s?.total_to_par).toBe(0);
    expect(s?.wins).toBe(1);
    expect(s?.points).toBe(2); // matchplay win = 2 pts (not place-points)
  });

  it("still sums to_par for stroke rounds (no match_result)", () => {
    const [s] = computeLeagueStandings([
      { member_id: "m1", name: "A", place: 2, to_par: 4, match_result: null },
      { member_id: "m1", name: "A", place: 1, to_par: -2, match_result: null },
    ]);
    expect(s?.total_to_par).toBe(2);
    expect(s?.events).toBe(2);
  });
});
