import { describe, expect, it } from "vitest";
import { roundEarnsRatings } from "../src/live-finalize.js";
import type { LiveScoringConfig } from "../src/live-format.js";

// PDGA-style round ratings are only meaningful for an individual's own stroke total. Matchplay has no
// stroke rating, and doubles partners share one team total — so neither may create round_ratings.
describe("round ratings are gated to singles stroke play", () => {
  const cfg = (groupFormat: LiveScoringConfig["groupFormat"], scoringStyle: LiveScoringConfig["scoringStyle"]): LiveScoringConfig => ({ groupFormat, scoringStyle });

  it("rates a singles stroke round", () => {
    expect(roundEarnsRatings(cfg("singles", "stroke"))).toBe(true);
  });

  it("does NOT rate matchplay rounds (singles or doubles)", () => {
    expect(roundEarnsRatings(cfg("singles", "matchplay"))).toBe(false);
    expect(roundEarnsRatings(cfg("doubles", "matchplay"))).toBe(false);
  });

  it("does NOT rate doubles stroke rounds (partners share one team total)", () => {
    expect(roundEarnsRatings(cfg("doubles", "stroke"))).toBe(false);
  });
});
