import { describe, expect, it } from "vitest";
import { recomputeRatingRows, type StoredRoundRating } from "../src/ratings-recompute-core.js";

type RoundInput = Omit<StoredRoundRating, "toPar" | "windGustMph"> & {
  readonly toPar?: number | null;
  readonly windGustMph?: number | null;
};

function round(input: RoundInput): StoredRoundRating {
  return { ...input, toPar: input.toPar ?? null, windGustMph: input.windGustMph ?? null };
}

describe("ratings recompute", () => {
  it("re-solves competition rounds from official PDGA anchors", () => {
    const rows = [
      round({ id: 1, memberId: "m1", stream: "competition", eventId: 10, casualRoundCode: null, layoutId: 100, roundDate: "2026-06-01T00:00:00.000Z", total: 54 }),
      round({ id: 2, memberId: "m2", stream: "competition", eventId: 10, casualRoundCode: null, layoutId: 100, roundDate: "2026-06-01T00:00:00.000Z", total: 59 }),
      round({ id: 3, memberId: "m3", stream: "competition", eventId: 10, casualRoundCode: null, layoutId: 100, roundDate: "2026-06-01T00:00:00.000Z", total: 51 }),
    ];

    const result = recomputeRatingRows({
      rows,
      officialAnchors: new Map([["m1", 1000], ["m2", 954], ["m3", 1028]]),
      layoutBaselines: new Map(),
      now: "2026-07-01T00:00:00.000Z",
    });

    const byMember = new Map(result.rows.map((row) => [row.memberId, row]));
    expect(byMember.get("m1")?.ratingMethod).toBe("stable");
    expect(byMember.get("m1")?.roundRating).toBe(1000);
    expect(byMember.get("m2")?.roundRating).toBe(954);
    expect(byMember.get("m3")?.roundRating).toBe(1028);
    expect(result.layoutBaselines.at(0)).toMatchObject({ layoutId: 100, eventId: 10, propagatorCount: 3 });
  });

  it("rates casual rounds from the competition layout baseline", () => {
    const result = recomputeRatingRows({
      rows: [
        round({ id: 4, memberId: "m4", stream: "casual", eventId: null, casualRoundCode: "ABC123", layoutId: 100, roundDate: "2026-06-02T00:00:00.000Z", total: 57 }),
      ],
      officialAnchors: new Map(),
      layoutBaselines: new Map([[100, { ssa: 54, ppt: 10, propagatorCount: 3 }]]),
      now: "2026-07-01T00:00:00.000Z",
    });

    expect(result.rows.at(0)).toMatchObject({
      memberId: "m4",
      roundRating: 970,
      ssa: 54,
      ppt: 10,
      propagatorCount: 3,
      ratingMethod: "layout",
    });
  });

  it("weather-adjusts casual ratings that use a stored layout baseline", () => {
    const result = recomputeRatingRows({
      rows: [
        round({ id: 4, memberId: "m4", stream: "casual", eventId: null, casualRoundCode: "ABC123", layoutId: 100, roundDate: "2026-06-02T00:00:00.000Z", total: 57, windGustMph: 38 }),
      ],
      officialAnchors: new Map(),
      layoutBaselines: new Map([[100, { ssa: 54, ppt: 10, propagatorCount: 3 }]]),
      now: "2026-07-01T00:00:00.000Z",
    });

    expect(result.rows.at(0)).toMatchObject({
      memberId: "m4",
      roundRating: 977,
      ssa: 54.7,
      ppt: 10,
      propagatorCount: 3,
      ratingMethod: "layout",
      windGustMph: 38,
      weatherAdjustment: 0.7,
    });
  });

  it("applies newly solved competition layout baselines to casual rounds in the same recompute", () => {
    const result = recomputeRatingRows({
      rows: [
        round({ id: 1, memberId: "m1", stream: "competition", eventId: 10, casualRoundCode: null, layoutId: 100, roundDate: "2026-06-01T00:00:00.000Z", total: 54 }),
        round({ id: 2, memberId: "m2", stream: "competition", eventId: 10, casualRoundCode: null, layoutId: 100, roundDate: "2026-06-01T00:00:00.000Z", total: 59 }),
        round({ id: 3, memberId: "m3", stream: "competition", eventId: 10, casualRoundCode: null, layoutId: 100, roundDate: "2026-06-01T00:00:00.000Z", total: 51 }),
        round({ id: 4, memberId: "m4", stream: "casual", eventId: null, casualRoundCode: "ABC123", layoutId: 100, roundDate: "2026-06-02T00:00:00.000Z", total: 57 }),
      ],
      officialAnchors: new Map([["m1", 1000], ["m2", 954], ["m3", 1028]]),
      layoutBaselines: new Map(),
      now: "2026-07-01T00:00:00.000Z",
    });

    const casual = result.rows.find((row) => row.stream === "casual");
    expect(casual).toMatchObject({
      memberId: "m4",
      ratingMethod: "layout",
      propagatorCount: 3,
    });
    expect(casual?.roundRating).not.toBeNull();
  });

  it("leaves rounds unrated when there are no anchors or layout baselines", () => {
    const result = recomputeRatingRows({
      rows: [
        round({ id: 5, memberId: "m5", stream: "competition", eventId: 11, casualRoundCode: null, layoutId: null, roundDate: "2026-06-03T00:00:00.000Z", total: 60 }),
      ],
      officialAnchors: new Map(),
      layoutBaselines: new Map(),
      now: "2026-07-01T00:00:00.000Z",
    });

    expect(result.rows.at(0)).toMatchObject({
      memberId: "m5",
      roundRating: null,
      ssa: null,
      ppt: null,
      propagatorCount: 0,
      ratingMethod: "unrated",
    });
  });
});
