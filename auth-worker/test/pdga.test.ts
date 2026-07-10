import { describe, it, expect } from "vitest";
import { parsePlayerPage, parseDetailRounds, fetchPdgaStats } from "../src/pdga.js";

// Fixtures mirror the real pdga.com markup (verified against player #273070).
const PLAYER_HTML = `
<h1 class="title" id="page-title">Kevin Gray #273070</h1>
<ul><li class="current-rating"> <strong>Current Rating:</strong> 891
  <a title="-3 point" href="/player/273070/history">-3</a>
  <small class="rating-date">(as of 09-Jun-2026)</small> </li></ul>`;

const DETAILS_HTML = `
<table><tr><th class="round-rating">Rating</th></tr>
<tr class="evaluated included odd"><td class="tournament"><a href="/tour/event/104398">GVDG Monthly</a></td><td class="tier">C</td><td class="date" data-text="1780200000">31-May-2026</td><td class="division">MA2</td><td class="round tooltip" data-tooltip-content="#a">2</td><td class="score">69</td><td class="round-rating">888</td><td class="evaluated">Yes</td></tr>
<tr class="evaluated included even"><td class="tournament"><a href="/tour/event/104398">GVDG Monthly</a></td><td class="tier">C</td><td class="date" data-text="1780200000">31-May-2026</td><td class="division">MA2</td><td class="round tooltip" data-tooltip-content="#b">1</td><td class="score">75</td><td class="round-rating">836</td><td class="evaluated">Yes</td></tr>
<tr class="odd"><td class="tournament"><a href="/tour/event/100001">Spring Open</a></td><td class="tier">B</td><td class="date" data-text="1770000000">01-Mar-2026</td><td class="division">MA1</td><td class="round">1</td><td class="score">61</td><td class="round-rating">925</td><td class="evaluated">Yes</td></tr>
</table>`;

describe("pdga.com parsers", () => {
  it("parses name + official rating + date from the player page", () => {
    const p = parsePlayerPage(PLAYER_HTML);
    expect(p).toEqual({ name: "Kevin Gray", official_rating: 891, rating_date: "09-Jun-2026" });
  });

  it("returns nulls (no throw) on unexpected markup", () => {
    expect(parsePlayerPage("<html>nope</html>")).toEqual({ name: null, official_rating: null, rating_date: null });
    expect(parseDetailRounds("<html>nope</html>")).toEqual([]);
  });

  it("groups detail rounds into events, most recent first", () => {
    const events = parseDetailRounds(DETAILS_HTML);
    expect(events.length).toBe(2);
    expect(events[0]!).toMatchObject({ tournament: "GVDG Monthly", date: "31-May-2026", division: "MA2" });
    expect(events[0]!.rounds.map((r) => r.rating)).toEqual([888, 836]);
    expect(events[1]!).toMatchObject({ tournament: "Spring Open", division: "MA1" });
    expect(events[1]!.rounds[0]!.rating).toBe(925);
  });

  it("computes live (recent-form mean) + peak from a stubbed fetch", async () => {
    const stub = (async (url: string) =>
      new Response(String(url).endsWith("/details") ? DETAILS_HTML : PLAYER_HTML, { status: 200 })) as unknown as typeof fetch;
    const s = await fetchPdgaStats("273070", stub);
    expect(s.official_rating).toBe(891);
    expect(s.peak_rating).toBe(925); // max round rating
    expect(s.live_rating).toBe(883); // round((888+836+925)/3)
    expect(s.events_count).toBe(2);
    expect(s.name).toBe("Kevin Gray");
  });
});
