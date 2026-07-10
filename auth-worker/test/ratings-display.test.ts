import { describe, expect, it } from "vitest";
import { summarizeRatingRows } from "../src/ratings.js";

// The member "ratings" history must show the MATCH RESULT for a matchplay round (not a stroke score), and
// must NOT assign it a rating — PDGA-style ratings are a stroke concept (mirrors the finalize-time gate).
describe("ratings display surfaces match_result and never rates matchplay rounds", () => {
  it("rates a stroke round and carries no match_result", () => {
    const g = summarizeRatingRows("competitive", [{ id: 1, place: 1, total: 54, to_par: 0, event_name: "Weekly" }]);
    expect(g.rounds[0]?.match_result).toBeNull();
    expect(g.rounds[0]?.rating).not.toBeNull();
    expect(g.rated_rounds).toBe(1);
  });

  it("surfaces match_result + scoring_group and leaves a matchplay round UNRATED", () => {
    const mr = JSON.stringify({ status: "won 3&2", outcome: "won" });
    const sg = JSON.stringify({ label: "Blue", members: ["Caleb", "Mike"] });
    const g = summarizeRatingRows("competitive", [
      { id: 2, place: 1, total: 56, to_par: -3, event_name: "Ryder Cup", match_result: mr, scoring_group: sg },
    ]);
    expect(g.rounds[0]?.match_result).toBe(mr);
    expect(g.rounds[0]?.scoring_group).toBe(sg);
    expect(g.rounds[0]?.rating).toBeNull();
    expect(g.rounds[0]?.rating_source).toBe("unrated");
    expect(g.rated_rounds).toBe(0);
  });
});
