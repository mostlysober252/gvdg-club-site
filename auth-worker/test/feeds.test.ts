import { describe, it, expect } from "vitest";
import { parseTournaments, parseEvents, upcoming } from "../src/feeds.js";

const NOW = Date.UTC(2026, 5, 1); // 2026-06-01, so May items are "recent past", Jun+ are upcoming

// Real shapes from the club's published sheets.
const TOURNAMENT_CSV = [
  "Date,Name,Location,Tier,URL,,Updated: 2026-05-24",
  '"May 31, 2026",GVDG Monthly,"Greenville, NC",C-tier,https://example.com/gvdg,,',
  '"Jun 17, 2026",GVDG RYDER CUP MATCHPLAY,"Greenville, NC",,https://example.com/ryder,,',
].join("\n");

const EVENT_CSV = [
  "date,title,description,url,active",
  "5/14,Club Meeting,To be held at Local Oak Brewing Co. at 7PM,https://example.com/mtg,TRUE",
  "6/22,GVDG Summer Doubles League,Farmville,https://example.com/dubs,TRUE",
  "7/1,Course Cleanup Fundraiser,Volunteer day,https://example.com/clean,TRUE",
  "6/30,Cancelled Thing,nope,https://example.com/x,FALSE",
].join("\n");

describe("club feed parsing", () => {
  it("parses tournaments as events (name + date + location/tier detail)", () => {
    const t = parseTournaments(TOURNAMENT_CSV, NOW);
    expect(t.map((x) => x.name)).toEqual(["GVDG Monthly", "GVDG RYDER CUP MATCHPLAY"]);
    expect(t[0]!.detail).toBe("Greenville, NC · C-tier");
    expect(t[1]!.epoch).toBe(Date.UTC(2026, 5, 17));
  });

  it("splits the event feed: league rounds -> events, meetings/fundraisers -> club events", () => {
    const { events, clubEvents } = parseEvents(EVENT_CSV, NOW);
    expect(events.map((e) => e.name)).toEqual(["GVDG Summer Doubles League"]);
    expect(clubEvents.map((e) => e.name)).toEqual(["Club Meeting", "Course Cleanup Fundraiser"]);
    expect(events.some((e) => e.name === "Cancelled Thing")).toBe(false); // active=FALSE dropped
  });

  it("resolves bare M/D dates to the inferred year", () => {
    const { clubEvents } = parseEvents(EVENT_CSV, NOW);
    expect(clubEvents.find((e) => e.name === "Club Meeting")!.epoch).toBe(Date.UTC(2026, 4, 14));
  });

  it("upcoming() keeps recent+future, soonest first, capped", () => {
    const items = [
      { name: "old", date: null, epoch: Date.UTC(2025, 0, 1) },
      { name: "soon", date: null, epoch: Date.UTC(2026, 5, 10) },
      { name: "later", date: null, epoch: Date.UTC(2026, 7, 1) },
      { name: "tbd", date: null, epoch: 0 },
    ];
    const out = upcoming(items, NOW, 8).map((x) => x.name);
    expect(out).toEqual(["soon", "later", "tbd"]); // "old" dropped; tbd (epoch 0) sorts last but kept
  });
});
