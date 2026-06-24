// Integration test for the live-scoring ROUTES in index.ts (the Worker side of the trust boundary):
// who may start/finalize/score/form-cards, and that the Worker injects the VERIFIED identity into the
// DO sub-request (never trusting client input). The DO itself is a fake recorder here — its own card
// authorization logic is covered exhaustively by cards.test.ts.
import { describe, it, expect } from "vitest";
import worker from "../src/index.js";
import { signSession } from "../src/jwt.js";

const SECRET = "x".repeat(40);
const members = {
  "member:m_jane": JSON.stringify({ memberId: "m_jane", name: "Jane", isAdmin: false, pinHash: "x", mustChangePin: false }),
  "member:m_bob": JSON.stringify({ memberId: "m_bob", name: "Bob", isAdmin: false, pinHash: "x", mustChangePin: false }),
  "member:m_admin": JSON.stringify({ memberId: "m_admin", name: "Admin", isAdmin: true, pinHash: "x", mustChangePin: false }),
};
function kv(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => void m.set(k, v), delete: async (k: string) => void m.delete(k) };
}

// `registered` is the set of memberIds that have a registration for the event.
function mockDb(registered: Set<string>) {
  return {
    prepare: (sql: string) => {
      let args: unknown[] = [];
      return {
        bind(...a: unknown[]) { args = a; return this; },
        all: async () => ({ results: [], success: true }), // listRegistrations -> [] (empty seed)
        first: async () => {
          if (/FROM events WHERE id/i.test(sql)) return { id: 5, course_id: 10, layout_id: 7, status: "live" };
          if (/FROM course_layouts WHERE id/i.test(sql)) return { holes: JSON.stringify([{ hole: 1, par: 3 }, { hole: 2, par: 4 }]) };
          if (/FROM registrations WHERE event_id/i.test(sql)) {
            const memberId = args[1]; // getMyRegistration binds (eventId, memberId)
            return registered.has(String(memberId)) ? { id: 1, member_id: memberId, division: "MA1" } : null;
          }
          return null;
        },
        run: async () => ({ results: [], success: true }),
      };
    },
  };
}

// Fake DO that records the LAST forwarded request so we can assert path + injected identity headers.
function fakeLive() {
  const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
  const stub = {
    async fetch(url: string, init?: RequestInit) {
      const headers: Record<string, string> = {};
      const h = init?.headers as Record<string, string> | undefined;
      if (h) for (const k of Object.keys(h)) headers[k.toLowerCase()] = h[k]!;
      calls.push({ url, headers, body: typeof init?.body === "string" ? init.body : "" });
      return new Response(JSON.stringify({ status: "live", cards: [], players: [], standings: [] }), { status: 200, headers: { "content-type": "application/json" } });
    },
  };
  return { calls, ns: { idFromName: (n: string) => n, get: () => stub } };
}

const tok = (sub: string) => signSession({ sub, mustChangePin: false }, SECRET, 900);

async function call(path: string, method: string, token: string | undefined, body: unknown, live: ReturnType<typeof fakeLive>, registered = new Set<string>()) {
  const h: Record<string, string> = { Origin: "http://localhost:8080" };
  if (token) h.authorization = "Bearer " + token;
  if (body) h["content-type"] = "application/json";
  const env = { ROSTER: kv(members), RATELIMIT: kv(), DB: mockDb(registered), JWT_SECRET: SECRET, ALLOWED_ORIGINS: "http://localhost:8080", LIVE: live.ns } as unknown as Parameters<typeof worker.fetch>[1];
  return worker.fetch(new Request("https://w" + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined }), env);
}

describe("live route — public reads", () => {
  it("snapshot is public (no auth)", async () => {
    const live = fakeLive();
    const r = await call("/events/5/live", "GET", undefined, null, live);
    expect(r.status).toBe(200);
    expect(live.calls[0]!.url).toBe("https://do/snapshot");
  });
});

describe("live route — admin lifecycle", () => {
  it("start requires admin (403 for a member, 401 for anon)", async () => {
    expect((await call("/events/5/live/start", "POST", undefined, {}, fakeLive())).status).toBe(401);
    expect((await call("/events/5/live/start", "POST", await tok("m_jane"), {}, fakeLive())).status).toBe(403);
  });
  it("admin start forwards a typed event container to the DO", async () => {
    const live = fakeLive();
    const r = await call("/events/5/live/start", "POST", await tok("m_admin"), {}, live);
    expect(r.status).toBe(200);
    const start = live.calls.find((c) => c.url === "https://do/start")!;
    const sent = JSON.parse(start.body);
    expect(sent.type).toBe("event");
    expect(sent.eventId).toBe(5);
    expect(sent.holes).toHaveLength(2);
  });
  it("finalize requires admin and forwards with admin identity", async () => {
    expect((await call("/events/5/live/finalize", "POST", await tok("m_jane"), {}, fakeLive())).status).toBe(403);
    const live = fakeLive();
    await call("/events/5/live/finalize", "POST", await tok("m_admin"), {}, live);
    const fin = live.calls.find((c) => c.url === "https://do/finalize")!;
    expect(fin.headers["x-auth-admin"]).toBe("1");
  });
});

describe("live route — member scoring + cards (the new delegation)", () => {
  it("score requires a member (401 anon) and injects the verified identity", async () => {
    expect((await call("/events/5/live/score", "POST", undefined, { cardId: "c1", hole: 1, strokes: 3 }, fakeLive())).status).toBe(401);
    const live = fakeLive();
    await call("/events/5/live/score", "POST", await tok("m_jane"), { cardId: "c1", hole: 1, strokes: 3 }, live);
    const score = live.calls.find((c) => c.url === "https://do/score")!;
    expect(score.headers["x-auth-member"]).toBe("m_jane");
    expect(score.headers["x-auth-admin"]).toBe("0");
  });

  it("creating a card requires registration for the event (403 if not registered)", async () => {
    expect((await call("/events/5/live/cards", "POST", await tok("m_jane"), {}, fakeLive(), new Set())).status).toBe(403);
    const live = fakeLive();
    const r = await call("/events/5/live/cards", "POST", await tok("m_jane"), {}, live, new Set(["m_jane"]));
    expect(r.status).toBe(200);
    const create = live.calls.find((c) => c.url === "https://do/card")!;
    expect(JSON.parse(create.body).name).toBe("Jane"); // name is roster-resolved, not client-supplied
  });

  it("an admin may create/score without being registered", async () => {
    const live = fakeLive();
    const r = await call("/events/5/live/cards", "POST", await tok("m_admin"), {}, live, new Set());
    expect(r.status).toBe(200);
    expect(live.calls.find((c) => c.url === "https://do/card")!.headers["x-auth-admin"]).toBe("1");
  });

  it("adding a cardmate resolves their name from the roster and requires they be registered", async () => {
    // m_jane (registered) tries to add m_bob who is NOT registered -> 403
    expect((await call("/events/5/live/cards/c1/cardmate", "POST", await tok("m_jane"), { memberId: "m_bob" }, fakeLive(), new Set(["m_jane"]))).status).toBe(403);
    // both registered -> forwarded with Bob's roster name
    const live = fakeLive();
    await call("/events/5/live/cards/c1/cardmate", "POST", await tok("m_jane"), { memberId: "m_bob" }, live, new Set(["m_jane", "m_bob"]));
    const add = live.calls.find((c) => c.url === "https://do/cardmate")!;
    expect(JSON.parse(add.body).name).toBe("Bob");
  });

  it("adding an unknown cardmate is 404", async () => {
    expect((await call("/events/5/live/cards/c1/cardmate", "POST", await tok("m_jane"), { memberId: "nope" }, fakeLive(), new Set(["m_jane"]))).status).toBe(404);
  });
});

describe("casual rounds (N3)", () => {
  it("starting a round requires auth", async () => {
    expect((await call("/rounds", "POST", undefined, { course_id: 1, layout_id: 7 }, fakeLive())).status).toBe(401);
  });
  it("a member starts a casual round → DO start with type 'casual' + a roundId", async () => {
    const live = fakeLive();
    const r = await call("/rounds", "POST", await tok("m_jane"), { course_id: 1, layout_id: 7 }, live);
    expect(r.status).toBe(200);
    const start = live.calls.find((c) => c.url === "https://do/start")!;
    const sent = JSON.parse(start.body);
    expect(sent.type).toBe("casual");
    expect(sent.seed[0].name).toBe("Jane"); // creator seeded, roster-resolved name
  });
  it("scoring a casual round requires auth and injects identity (no registration gate)", async () => {
    expect((await call("/rounds/abc/live/score", "POST", undefined, { cardId: "c1", hole: 1, strokes: 3 }, fakeLive())).status).toBe(401);
    const live = fakeLive();
    await call("/rounds/abc/live/score", "POST", await tok("m_jane"), { cardId: "c1", hole: 1, strokes: 3 }, live);
    expect(live.calls.find((c) => c.url === "https://do/score")!.headers["x-auth-member"]).toBe("m_jane");
  });
  it("the round snapshot is public (CardCast)", async () => {
    const live = fakeLive();
    expect((await call("/rounds/abc", "GET", undefined, null, live)).status).toBe(200);
    expect(live.calls[0]!.url).toBe("https://do/snapshot");
  });
});
