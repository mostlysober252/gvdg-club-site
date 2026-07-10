import { afterEach, describe, expect, it, vi } from "vitest";
import { extractTeeSign, parseVisionJson } from "../src/vision.js";

interface FetchCall {
  input: RequestInfo | URL;
  init?: RequestInit;
}

interface GeminiRequest {
  contents?: { parts?: { text?: string; inlineData?: { mimeType?: string; data?: string } }[] }[];
  generationConfig?: { responseMimeType?: string; maxOutputTokens?: number; temperature?: number };
}

function jsonBody<T>(init: RequestInit | undefined): T {
  return JSON.parse(String(init?.body ?? "{}")) as T;
}

describe("parseVisionJson", () => {
  it("parses a clean multi-layout response", () => {
    const r = parseVisionJson('{"hole":7,"layouts":[{"label":"Long","color":"blue","par":4,"distance_ft":420},{"label":"Short","color":"white","par":3,"distance_ft":285}]}');
    expect(r.hole).toBe(7);
    expect(r.layouts.length).toBe(2);
    expect(r.layouts[0]!).toEqual({ label: "Long", color: "blue", par: 4, distance_ft: 420, tee: null, target: null });
  });
  it("extracts JSON from a markdown code fence and prose", () => {
    const r = parseVisionJson('Sure!\n```json\n{"hole":3,"layouts":[{"label":"Main","par":3,"distance_ft":250}]}\n```');
    expect(r.hole).toBe(3);
    expect(r.layouts[0]!.par).toBe(3);
  });
  it("clamps out-of-range par/distance to null and coerces color to string", () => {
    const r = parseVisionJson('{"hole":99,"layouts":[{"label":"X","color":5,"par":40,"distance_ft":5}]}');
    expect(r.hole).toBe(99);                 // hole clamp is [1,99]
    expect(r.layouts[0]!.par).toBeNull();     // 40 out of [1,10]
    expect(r.layouts[0]!.distance_ft).toBeNull(); // 5 < 20
    expect(r.layouts[0]!.color).toBe("5");    // coerced
  });
  it("returns an empty result on garbage / no JSON", () => {
    expect(parseVisionJson("the sign is unreadable").layouts).toEqual([]);
    expect(parseVisionJson("").hole).toBeNull();
    expect(parseVisionJson('{"nope":true}').layouts).toEqual([]);
  });
  it("drops malformed layout rows but keeps good ones", () => {
    const r = parseVisionJson('{"hole":1,"layouts":[{"label":"A","par":3,"distance_ft":200},"junk",{"par":4}]}');
    expect(r.layouts.length).toBe(2);        // "A" + the {par:4} (label defaults to "")
    expect(r.layouts[0]!.label).toBe("A");
  });
});

describe("extractTeeSign", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses Gemini vision when a Gemini key is configured", async () => {
    const calls: FetchCall[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: '{"hole":7,"layouts":[{"label":"Long","color":"blue","par":4,"distance_ft":420}]}' }] } }],
      }), { headers: { "Content-Type": "application/json" } });
    }));

    const result = await extractTeeSign({ GEMINI_API_KEY: "gemini-secret" }, new Uint8Array([1, 2, 3]), "image/jpeg");

    expect(result.source).toBe("gemini:gemini-2.5-flash");
    expect(result.hole).toBe(7);
    expect(calls.length).toBe(1);
    expect(String(calls[0]!.input)).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent");
    expect(new Headers(calls[0]!.init?.headers).get("x-goog-api-key")).toBe("gemini-secret");
    const body = jsonBody<GeminiRequest>(calls[0]!.init);
    expect(body.generationConfig).toMatchObject({ responseMimeType: "application/json", maxOutputTokens: 700, temperature: 0 });
    expect(body.contents?.[0]?.parts?.[0]?.text).toContain("Read this disc golf tee sign");
    expect(body.contents?.[0]?.parts?.[1]?.inlineData).toEqual({ mimeType: "image/jpeg", data: "AQID" });
  });

  it("falls back to OpenRouter when Gemini fails", async () => {
    const calls: FetchCall[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      if (String(input).includes("generativelanguage.googleapis.com")) {
        return new Response("rate limited", { status: 429 });
      }
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"hole":8,"layouts":[{"label":"Short","par":3,"distance_ft":245}]}' } }],
      }), { headers: { "Content-Type": "application/json" } });
    }));

    const result = await extractTeeSign(
      { GEMINI_API_KEY: "gemini-secret", OPENROUTER_API_KEY: "openrouter-secret" },
      new Uint8Array([4, 5, 6]),
      "image/png",
    );

    expect(result.source).toBe("openrouter:nvidia/nemotron-nano-12b-v2-vl:free");
    expect(result.hole).toBe(8);
    expect(calls.map((call) => String(call.input))).toEqual([
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      "https://openrouter.ai/api/v1/chat/completions",
    ]);
  });
});
