import { describe, it, expect } from "vitest";
import { generateReply, stripReasoning, type ReplyProvider } from "../src/assistant.js";

const msgs = [{ role: "user" as const, content: "hi" }];
const ok = (name: string, text: string): ReplyProvider => ({ name, generate: async () => text });
const fail = (name: string): ReplyProvider => ({ name, generate: async () => { throw new Error(name + " down"); } });

describe("stripReasoning (hide chain-of-thought, keep only the answer)", () => {
  it("removes a well-formed <think> block", () => {
    expect(stripReasoning("<think>let me ponder the wind</think>Throw a midrange.")).toBe("Throw a midrange.");
  });
  it("handles a stray closing tag (model started mid-thought)", () => {
    expect(stripReasoning("okay so the user asks about events</think>The Fall Open is Sept 20.")).toBe("The Fall Open is Sept 20.");
  });
  it("drops a truncated opening-only block (ran out of tokens mid-thought) → empty", () => {
    expect(stripReasoning("<think>still reasoning and never finished")).toBe("");
  });
  it("also matches <thinking> and <reasoning> tag variants", () => {
    expect(stripReasoning("<reasoning>x</reasoning><thinking>y</thinking>Hi there!")).toBe("Hi there!");
  });
  it("leaves a normal answer untouched", () => {
    expect(stripReasoning("Welcome to GVDG! : ) :")).toBe("Welcome to GVDG! : ) :");
  });
});

describe("generateReply (OpenRouter-primary, Workers-AI-fallback chain)", () => {
  it("uses the first provider that returns text", async () => {
    const r = await generateReply([ok("openrouter", "hello"), ok("workers-ai", "nope")], msgs);
    expect(r).toEqual({ reply: "hello", provider: "openrouter" });
  });

  it("falls back to the next provider when the first throws", async () => {
    const r = await generateReply([fail("openrouter"), ok("workers-ai", "backup")], msgs);
    expect(r).toEqual({ reply: "backup", provider: "workers-ai" });
  });

  it("falls back when the first returns empty/whitespace", async () => {
    const r = await generateReply([ok("openrouter", "   "), ok("workers-ai", "real")], msgs);
    expect(r?.provider).toBe("workers-ai");
  });

  it("trims the winning reply", async () => {
    const r = await generateReply([ok("openrouter", "  hi there \n")], msgs);
    expect(r?.reply).toBe("hi there");
  });

  it("returns null when every provider fails", async () => {
    const r = await generateReply([fail("openrouter"), fail("workers-ai")], msgs);
    expect(r).toBeNull();
  });
});
