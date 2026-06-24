import { describe, it, expect } from "vitest";
import { assignShotgun, assignTeams, assignCards } from "../src/assign.js";

describe("assignShotgun (starting holes)", () => {
  it("groups players onto holes by group size (shotgun start)", () => {
    const out = assignShotgun(["a", "b", "c", "d", "e", "f", "g", "h", "i"], [1, 2, 3, 4, 5, 6, 7, 8, 9], 4);
    expect(out.map((x) => x.hole)).toEqual([1, 1, 1, 1, 2, 2, 2, 2, 3]);
  });
  it("wraps holes if there are more groups than holes", () => {
    const out = assignShotgun(["a", "b", "c"], [1, 2], 1);
    expect(out.map((x) => x.hole)).toEqual([1, 2, 1]);
  });
  it("assigns null holes when no holes are given", () => {
    expect(assignShotgun(["a"], [], 4)).toEqual([{ player: "a", hole: null }]);
  });
});

describe("assignTeams", () => {
  it("pairs players into fixed-size teams (e.g. doubles)", () => {
    const out = assignTeams(["a", "b", "c", "d"], { size: 2 });
    expect(out.map((x) => x.team)).toEqual(["Team 1", "Team 1", "Team 2", "Team 2"]);
  });
  it("distributes players round-robin into N teams", () => {
    const out = assignTeams(["a", "b", "c", "d"], { count: 2 });
    expect(out.map((x) => x.team)).toEqual(["Team 1", "Team 2", "Team 1", "Team 2"]);
  });
});

describe("assignCards", () => {
  it("splits players into sequential cards of the given size", () => {
    const out = assignCards(["a", "b", "c", "d", "e"], 2);
    expect(out.map((x) => x.card)).toEqual(["Card 1", "Card 1", "Card 2", "Card 2", "Card 3"]);
  });
  it("defaults to cards of 4", () => {
    const out = assignCards(["a", "b", "c", "d", "e"]);
    expect(out.map((x) => x.card)).toEqual(["Card 1", "Card 1", "Card 1", "Card 1", "Card 2"]);
  });
});
