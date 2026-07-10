import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import worker from "../src/index.js";
import { jsonObject } from "./json.js";

// Disable network by default so the club-feed fetch (Google Sheets) doesn't make real calls; the
// OpenRouter tests below re-stub fetch with their own behavior.
beforeEach(() => vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network disabled in test"); })));
afterEach(() => vi.unstubAllGlobals());

// Minimal Map-backed KV + no-op D1 so we can exercise the /assistant route end-to-end in-process,
// without wrangler or a real Workers AI binding (which needs a Cloudflare account).
function mockKV() {
  const m = new Map<string, string>();
  return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => void m.set(k, v), delete: async (k: string) => void m.delete(k) };
}
const mockDB = { prepare: () => ({ bind() { return this; }, all: async () => ({ results: [], success: true }), first: async () => null, run: async () => ({ results: [], success: true }) }) };
function makeEnv(extra: Record<string, unknown> = {}) {
  return { ROSTER: mockKV(), RATELIMIT: mockKV(), DB: mockDB, JWT_SECRET: "x".repeat(40), ALLOWED_ORIGINS: "http://localhost:8080", ...extra } as unknown as Parameters<typeof worker.fetch>[1];
}
function req(body: unknown, ip = "1.2.3.4") {
  return new Request("https://w/assistant", { method: "POST", headers: { "content-type": "application/json", Origin: "http://localhost:8080", "CF-Connecting-IP": ip }, body: JSON.stringify(body) });
}

describe("POST /assistant", () => {
  it("returns a dev stub reply when no AI binding is present", async () => {
    const res = await worker.fetch(req({ message: "hi" }), makeEnv());
    expect(res.status).toBe(200);
    const j = await jsonObject(res);
    expect(j.stub).toBe(true);
    expect(j.reply).toMatch(/Crotts/);
  });

  it("passes the model reply through when AI is bound", async () => {
    const AI = { run: async (_m: string, opts: { messages: unknown[] }) => ({ response: "Fall Open is the next event! (" + opts.messages.length + " msgs)" }) };
    const res = await worker.fetch(req({ message: "what's next?" }), makeEnv({ AI }));
    expect(res.status).toBe(200);
    const j = await jsonObject(res);
    expect(j.reply).toMatch(/Fall Open is the next event/);
    expect(j.stub).toBeUndefined();
  });

  it("uses the atomic ASSISTANT_RL binding when present (429 when it denies)", async () => {
    const calls: { key: string }[] = [];
    const ASSISTANT_RL = { limit: async (o: { key: string }) => { calls.push(o); return { success: false }; } };
    const res = await worker.fetch(req({ message: "hi" }), makeEnv({ ASSISTANT_RL }));
    expect(res.status).toBe(429);
    expect(calls[0]!.key).toBe("asst:1.2.3.4"); // consulted the atomic limiter, not the KV counter
  });

  it("rejects an empty message with 400", async () => {
    const res = await worker.fetch(req({ message: "   " }), makeEnv());
    expect(res.status).toBe(400);
  });

  it("rejects an oversized assistant body before model selection", async () => {
    const res = await worker.fetch(req({ message: "hi", padding: "x".repeat(70_000) }), makeEnv());
    expect(res.status).toBe(413);
  });

  it("rate-limits a flooding IP with 429", async () => {
    const env = makeEnv();
    let last = 200;
    for (let i = 0; i < 25; i++) last = (await worker.fetch(req({ message: "spam " + i }, "9.9.9.9"), env)).status;
    expect(last).toBe(429);
  });

  it("returns 502 (not a crash) when the AI call throws", async () => {
    const AI = { run: async () => { throw new Error("no account"); } };
    const res = await worker.fetch(req({ message: "hi" }), makeEnv({ AI }));
    expect(res.status).toBe(502);
  });

  it("uses OpenRouter as the primary brain when a key is set", async () => {
    const bodies: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("openrouter.ai")) bodies.push(String(init?.body ?? ""));
      return new Response(JSON.stringify({ choices: [{ message: { content: "From OpenRouter!" } }] }), { status: 200 });
    }));
    const res = await worker.fetch(req({ message: "hi" }), makeEnv({ OPENROUTER_API_KEY: "sk-or-test" }));
    const j = await jsonObject(res);
    expect(j.reply).toBe("From OpenRouter!");
    expect(j.provider).toBe("openrouter");
    expect(bodies[0]).toContain('"model":"openai/gpt-oss-120b:free"');
  });

  it("uses the OpenRouter fallback model when GPT-OSS is rate-limited", async () => {
    const bodies: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!String(input).includes("openrouter.ai")) return new Response("", { status: 503 });
      bodies.push(String(init?.body ?? ""));
      if (bodies.length === 1) return new Response("rate limited", { status: 429 });
      return new Response(JSON.stringify({ choices: [{ message: { content: "From OpenRouter fallback" } }] }), { status: 200 });
    }));
    const AI = { run: async () => ({ response: "Workers AI should not run" }) };
    const res = await worker.fetch(req({ message: "hi" }), makeEnv({ OPENROUTER_API_KEY: "sk-or-test", AI }));
    const j = await jsonObject(res);
    expect(j.reply).toBe("From OpenRouter fallback");
    expect(j.provider).toBe("openrouter");
    expect(bodies[0]).toContain('"model":"openai/gpt-oss-120b:free"');
    expect(bodies[1]).toContain('"model":"nvidia/nemotron-3-super-120b-a12b:free"');
  });

  it("falls back to Workers AI when the free OpenRouter model is unavailable", async () => {
    const bodies: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("openrouter.ai")) bodies.push(String(init?.body ?? ""));
      return new Response("rate limited", { status: 429 });
    }));
    const AI = { run: async () => ({ response: "From Workers AI fallback" }) };
    const res = await worker.fetch(req({ message: "hi" }), makeEnv({ OPENROUTER_API_KEY: "sk-or-test", AI }));
    const j = await jsonObject(res);
    expect(j.reply).toBe("From Workers AI fallback");
    expect(j.provider).toBe("workers-ai");
    expect(bodies.length).toBe(2);
  });
});
