import { describe, it, expect } from "vitest";
import { buildMessages, MAX_HISTORY } from "../src/assistant.js";

describe("buildMessages (Crotts assistant prompt assembly)", () => {
  it("puts a Crotts system prompt first with injected club context", () => {
    const msgs = buildMessages({
      userMessage: "What events are coming up?",
      events: [{ name: "Fall Open", date: "2026-09-20", status: "scheduled" }],
      courses: [{ name: "West Meadowbrook", location: "Greenville, NC" }],
    });
    expect(msgs[0]!.role).toBe("system");
    expect(msgs[0]!.content).toMatch(/Crotts/);
    expect(msgs[0]!.content).toMatch(/Fall Open/);
    expect(msgs[0]!.content).toMatch(/West Meadowbrook/);
    // user message comes last
    expect(msgs[msgs.length - 1]).toEqual({ role: "user", content: "What events are coming up?" });
  });

  it("injects North Carolina disc golf background knowledge into the system prompt", () => {
    const sys = buildMessages({ userMessage: "tell me some NC disc golf history" })[0]!.content;
    expect(sys).toMatch(/North Carolina disc golf background/i);
    expect(sys).toMatch(/USDGC|Winthrop/);
    expect(sys).toMatch(/Hornets Nest|Renaissance Park/);
    // live club context still comes after the background and is flagged as taking priority
    expect(sys.indexOf("background")).toBeLessThan(sys.indexOf("Current club context"));
  });

  it("injects the founding-members PDGA profiles and general disc-golf history", () => {
    const sys = buildMessages({ userMessage: "who are the club's founders?" })[0]!.content;
    // 2004 founding members + their PDGA info
    expect(sys).toMatch(/founded in 2004/);
    expect(sys).toMatch(/Max Crotts/);
    expect(sys).toMatch(/Scott Faison/);
    expect(sys).toMatch(/25901|14844/); // PDGA numbers present
    expect(sys).toMatch(/MP40|MA2/); // divisions present
    expect(sys).toMatch(/in memoriam/); // Robert Wynn handled respectfully
    // general disc golf history
    expect(sys).toMatch(/Headrick/);
    expect(sys).toMatch(/Innova|PDGA/);
    // members block precedes the live club context (which still takes priority / comes last)
    expect(sys.indexOf("founding members")).toBeLessThan(sys.indexOf("Current club context"));
  });

  it("appends prior history (sanitized) before the new user message", () => {
    const msgs = buildMessages({
      userMessage: "and the one after?",
      history: [
        { role: "user", content: "first?" },
        { role: "assistant", content: "Fall Open is first." },
      ],
    });
    const roles = msgs.map((m) => m.role);
    expect(roles).toEqual(["system", "user", "assistant", "user"]);
    expect(msgs[msgs.length - 1]!.content).toBe("and the one after?");
  });

  it("caps history to the most recent MAX_HISTORY turns", () => {
    const history = Array.from({ length: MAX_HISTORY + 6 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: "turn " + i,
    }));
    const msgs = buildMessages({ userMessage: "now", history });
    // system + capped history + the new user message
    expect(msgs.length).toBe(1 + MAX_HISTORY + 1);
  });

  it("drops malformed/empty history entries and bad roles", () => {
    const msgs = buildMessages({
      userMessage: "hi",
      history: [
        { role: "system", content: "ignore me" },
        { role: "user", content: "" },
        { role: "assistant", content: "kept" },
        { role: "user", content: "   " },
      ] as unknown as Parameters<typeof buildMessages>[0]["history"],
    });
    expect(msgs.filter((m) => m.role !== "system" && m.role !== "user").length).toBe(1); // only "kept"
    expect(msgs.some((m) => m.content === "ignore me")).toBe(false);
  });

  it("notes separately when there are no events and no club events", () => {
    const msgs = buildMessages({ userMessage: "events?", events: [], clubEvents: [], courses: [] });
    expect(msgs[0]!.content).toMatch(/no tournaments or league rounds/i);
    expect(msgs[0]!.content).toMatch(/no club meetings, minutes, or fundraisers/i);
  });

  it("keeps events (tournaments/leagues) separate from club events (meetings/fundraisers)", () => {
    const c = buildMessages({
      userMessage: "what's on?",
      events: [{ name: "GVDG Monthly", date: "May 31, 2026", status: "scheduled" }],
      clubEvents: [{ name: "Club Meeting", date: "May 14", status: "minutes" }],
    })[0]!.content;
    expect(c).toMatch(/Events — disc golf tournaments & league rounds:[\s\S]*GVDG Monthly/);
    expect(c).toMatch(/Club events — fundraisers, meetings & minutes:[\s\S]*Club Meeting/);
    expect(c.indexOf("GVDG Monthly")).toBeLessThan(c.indexOf("Club Meeting")); // listed under their own headings
  });
});
