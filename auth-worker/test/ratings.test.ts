import { describe, expect, it } from "vitest";
import { estimateRoundRating, summarizeRatingRows } from "../src/ratings.js";

describe("GVDG member ratings", () => {
  it("estimates per-round ratings from score-to-par when no stored rating exists", () => {
    expect(estimateRoundRating(-4)).toBe(940);
    expect(estimateRoundRating(7)).toBe(830);
  });

  it("keeps competitive ratings separate and prefers stored round ratings", () => {
    const group = summarizeRatingRows("competitive", [
      { id: 1, event_name: "Fall Open", event_date: "2026-09-20", place: 1, total: 54, to_par: -3, rating: 945 },
      { id: 2, event_name: "June Monthly", event_date: "2026-06-12", place: 5, total: 61, to_par: 4 },
      { id: 3, event_name: "DNF Round", event_date: "2026-05-01", place: null, total: null, to_par: null },
    ]);

    expect(group.live_rating).toBe(903);
    expect(group.rated_rounds).toBe(2);
    expect(group.rounds_count).toBe(3);
    expect(group.rounds[0]).toMatchObject({ kind: "competitive", label: "Fall Open", rating: 945, rating_source: "stored" });
    expect(group.rounds[1]).toMatchObject({ kind: "competitive", rating: 860, rating_source: "estimated" });
    expect(group.rounds[2]).toMatchObject({ kind: "competitive", rating: null, rating_source: "unrated" });
  });

  it("summarizes casual rounds without mixing them into competitive ratings", () => {
    const group = summarizeRatingRows("casual", [
      { id: 7, round_code: "K7M2QX", course_name: "West Meadowbrook Park", layout_name: "Long", finalized_at: "2026-07-01T16:00:00Z", place: 2, total: 59, to_par: 1 },
      { id: 8, round_code: "A1B2C3", course_name: "The Meadow", finalized_at: "2026-06-27T16:00:00Z", place: 1, total: 50, to_par: -5 },
    ]);

    expect(group.live_rating).toBe(920);
    expect(group.rounds.map((round) => round.kind)).toEqual(["casual", "casual"]);
    expect(group.rounds[0]).toMatchObject({ label: "West Meadowbrook Park · Long", rating: 890 });
    expect(group.rounds[1]).toMatchObject({ label: "The Meadow", rating: 950 });
  });
});
