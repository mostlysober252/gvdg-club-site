import { describe, expect, it } from "vitest";
import {
  aggregatePlayerRating,
  pointsPerThrow,
  roundRatingForScore,
  roundRatingForScoreWithWeather,
  solveSsa,
  weatherSsaAdjustment,
} from "../src/rating-engine.js";

function rated(daysAgo: number, roundRating: number) {
  const date = new Date(Date.UTC(2026, 6, 1 - daysAgo));
  return { roundDate: date.toISOString(), roundRating };
}

describe("ratings engine", () => {
  it("uses the PDGA-style compression curve", () => {
    expect(pointsPerThrow(54)).toBeCloseTo(9.232182, 6);
    expect(pointsPerThrow(45)).toBeCloseTo(12.654125, 6);
  });

  it("solves SSA from three propagators and rates scores against that SSA", () => {
    const solved = solveSsa([
      { score: 54, rating: 1000 },
      { score: 59, rating: 954 },
      { score: 51, rating: 1028 },
    ]);

    expect(solved).toMatchObject({ status: "stable", propagatorCount: 3, droppedCount: 0 });
    expect(solved?.ssa).toBeCloseTo(54, 0);
    expect(solved ? roundRatingForScore(54, solved.ssa, solved.ppt) : null).toBe(1000);
  });

  it("keeps layout-based ratings unchanged when gusts are calm or missing", () => {
    expect(weatherSsaAdjustment(null)).toBe(0);
    expect(weatherSsaAdjustment({ windGustMph: 18 })).toBe(0);
    expect(roundRatingForScoreWithWeather({
      score: 57,
      ssa: 54,
      ppt: 10,
      weather: { windGustMph: null },
    })).toEqual({ roundRating: 970, ssa: 54, ppt: 10, weatherAdjustment: 0 });
  });

  it("raises the effective layout SSA for sustained high gusts", () => {
    expect(weatherSsaAdjustment({ windGustMph: 38 })).toBe(0.7);
    expect(weatherSsaAdjustment({ windGustMph: 90 })).toBe(1.5);
    expect(roundRatingForScoreWithWeather({
      score: 57,
      ssa: 54,
      ppt: 10,
      weather: { windGustMph: 38 },
    })).toEqual({ roundRating: 977, ssa: 54.7, ppt: 10, weatherAdjustment: 0.7 });
  });

  it("drops propagators whose round is more than 60 below their pre-round rating", () => {
    const solved = solveSsa([
      { score: 54, rating: 1000 },
      { score: 59, rating: 954 },
      { score: 90, rating: 900 },
    ]);

    expect(solved).toMatchObject({ status: "provisional", propagatorCount: 2, droppedCount: 1 });
  });

  it("requires eight eligible rounds after low-outlier filtering", () => {
    const summary = aggregatePlayerRating({
      now: "2026-07-01T00:00:00.000Z",
      rounds: [
        rated(1, 900),
        rated(2, 901),
        rated(3, 899),
        rated(4, 900),
        rated(5, 902),
        rated(6, 898),
        rated(7, 900),
        rated(8, 901),
        rated(9, 700),
      ],
    });

    expect(summary.rating).toBe(900);
    expect(summary.ratedRounds).toBe(8);
  });

  it("double-weights the most recent quarter once a player has at least nine rounds", () => {
    const rounds = [
      rated(1, 1000),
      rated(2, 1000),
      rated(3, 1000),
      rated(10, 900),
      rated(11, 900),
      rated(12, 900),
      rated(13, 900),
      rated(14, 900),
      rated(15, 900),
      rated(16, 900),
      rated(17, 900),
      rated(18, 900),
    ];

    expect(aggregatePlayerRating({ now: "2026-07-01T00:00:00.000Z", rounds }).rating).toBe(940);
  });
});
