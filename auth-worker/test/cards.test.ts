import { describe, it, expect } from "vitest";
import * as cards from "../src/cards.js";

const HOLES = [
  { hole: 1, par: 3 },
  { hole: 2, par: 4 },
  { hole: 3, par: 3 },
];
const base = { type: "event" as const, eventId: 1, roundId: null, courseId: 10, layoutId: 5, holes: HOLES, startedAt: "2026-06-24T00:00:00Z" };
const admin: cards.Auth = { memberId: "pdga:1", isAdmin: true };
const alice: cards.Auth = { memberId: "pdga:100", isAdmin: false };
const bob: cards.Auth = { memberId: "pdga:200", isAdmin: false };
const carol: cards.Auth = { memberId: "pdga:300", isAdmin: false };

const ok = <T>(r: cards.OpResult<T>): OpOkNarrow<T> => {
  if (cards.isErr(r)) throw new Error("expected ok, got " + r.error);
  return r as OpOkNarrow<T>;
};
type OpOkNarrow<T> = { ok: true } & T;

describe("initContainer seeding", () => {
  it("empty seed → no cards (pure self-organize)", () => {
    const s = cards.initContainer(base);
    expect(s.cards).toHaveLength(0);
    expect(s.meta.status).toBe("live");
  });

  it("no startingHole/label → one card with everyone", () => {
    const s = cards.initContainer(base, [
      { name: "A", memberId: "pdga:100" },
      { name: "B", memberId: "pdga:200" },
    ]);
    expect(s.cards).toHaveLength(1);
    expect(s.cards[0]!.players).toHaveLength(2);
  });

  it("shotgun starting holes → one card per hole", () => {
    const s = cards.initContainer(base, [
      { name: "A", memberId: "pdga:100", startingHole: 1 },
      { name: "B", memberId: "pdga:200", startingHole: 1 },
      { name: "C", memberId: "pdga:300", startingHole: 5 },
    ]);
    expect(s.cards).toHaveLength(2);
    expect(s.cards.flatMap((c) => c.players)).toHaveLength(3);
  });

  it("explicit cardLabel wins over starting hole", () => {
    const s = cards.initContainer(base, [
      { name: "A", memberId: "pdga:100", startingHole: 1, cardLabel: "Card 1" },
      { name: "B", memberId: "pdga:200", startingHole: 5, cardLabel: "Card 1" },
    ]);
    expect(s.cards).toHaveLength(1);
  });

  it("dedups the seed by memberId so a member is never on two cards", () => {
    const s = cards.initContainer(base, [
      { name: "A", memberId: "pdga:100", startingHole: 1 },
      { name: "A again", memberId: "pdga:100", startingHole: 5 }, // duplicate registration / event_players overlap
      { name: "B", memberId: "pdga:200", startingHole: 1 },
      { name: "Guest", memberId: null, startingHole: 1 },
      { name: "Guest2", memberId: null, startingHole: 1 },
    ]);
    const all = s.cards.flatMap((c) => c.players);
    expect(all.filter((p) => p.memberId === "pdga:100")).toHaveLength(1); // deduped to one
    expect(all.filter((p) => p.memberId == null)).toHaveLength(2); // guests not deduped
  });

  it("chunks an oversized group into cards of at most MAX_PLAYERS_PER_CARD (no player dropped)", () => {
    const seed = Array.from({ length: 8 }, (_, i) => ({ name: "P" + i, memberId: "pdga:" + i }));
    const s = cards.initContainer(base, seed);
    expect(s.cards).toHaveLength(2); // 6 + 2
    expect(s.cards[0]!.players.length).toBe(cards.MAX_PLAYERS_PER_CARD);
    expect(s.cards.flatMap((c) => c.players)).toHaveLength(8);
    expect(s.cards.every((c) => c.players.length <= cards.MAX_PLAYERS_PER_CARD)).toBe(true);
  });
});

describe("card formation", () => {
  it("createCard adds the creator as first player + default scorekeeper", () => {
    const s = cards.initContainer(base);
    const r = ok(cards.createCard(s, alice, { name: "Alice" }));
    expect(s.cards).toHaveLength(1);
    const c = s.cards[0]!;
    expect(c.id).toBe(r.cardId);
    expect(c.players[0]!.memberId).toBe("pdga:100");
    expect(c.scorekeeperId).toBe(c.players[0]!.pid);
  });

  it("a member cannot be on two cards", () => {
    const s = cards.initContainer(base);
    cards.createCard(s, alice, { name: "Alice" });
    const r = cards.createCard(s, alice, { name: "Alice" });
    expect(cards.isErr(r) && r.status).toBe(409);
  });

  it("join is idempotent and capacity-checked", () => {
    const s = cards.initContainer(base);
    const { cardId } = ok(cards.createCard(s, alice, { name: "Alice" }));
    expect(ok(cards.joinCard(s, bob, cardId, { name: "Bob" })).ok).toBe(true);
    expect(ok(cards.joinCard(s, bob, cardId, { name: "Bob" })).ok).toBe(true); // idempotent
    expect(s.cards[0]!.players).toHaveLength(2);
  });

  it("addMember requires the requester be on the card", () => {
    const s = cards.initContainer(base);
    const { cardId } = ok(cards.createCard(s, alice, { name: "Alice" }));
    const denied = cards.addMember(s, bob, cardId, { memberId: "pdga:300", name: "Carol" });
    expect(cards.isErr(denied) && denied.status).toBe(403);
    expect(ok(cards.addMember(s, alice, cardId, { memberId: "pdga:300", name: "Carol" })).ok).toBe(true);
  });

  it("addGuest creates a no-account player that cannot be a scorekeeper", () => {
    const s = cards.initContainer(base);
    const { cardId } = ok(cards.createCard(s, alice, { name: "Alice" }));
    const { pid } = ok(cards.addGuest(s, alice, cardId, "  Guest Greg  "));
    const guest = s.cards[0]!.players.find((p) => p.pid === pid)!;
    expect(guest.isGuest).toBe(true);
    expect(guest.name).toBe("Guest Greg");
    const r = cards.setScorekeeper(s, alice, cardId, pid);
    expect(cards.isErr(r) && r.status).toBe(404); // guests can't be scorekeeper
  });

  it("removePlayer: self-remove ok; non-self denied; empty card is dropped", () => {
    const s = cards.initContainer(base);
    const { cardId } = ok(cards.createCard(s, alice, { name: "Alice" }));
    ok(cards.joinCard(s, bob, cardId, { name: "Bob" }));
    const bobPid = s.cards[0]!.players.find((p) => p.memberId === "pdga:200")!.pid;
    const denied = cards.removePlayer(s, carol, cardId, bobPid);
    expect(cards.isErr(denied) && denied.status).toBe(403);
    ok(cards.removePlayer(s, bob, cardId, bobPid)); // self-remove
    const alicePid = s.cards[0]!.players[0]!.pid;
    ok(cards.removePlayer(s, alice, cardId, alicePid));
    expect(s.cards).toHaveLength(0); // dropped when empty
  });
});

describe("score authorization (the security boundary)", () => {
  function setup() {
    const s = cards.initContainer(base);
    const { cardId } = ok(cards.createCard(s, alice, { name: "Alice" }));
    ok(cards.joinCard(s, bob, cardId, { name: "Bob" }));
    return { s, cardId };
  }

  it("a cardmate may score the card", () => {
    const { s, cardId } = setup();
    ok(cards.applyScore(s, bob, { cardId, memberId: "pdga:100", hole: 1, strokes: 3 }));
    expect(s.cards[0]!.players.find((p) => p.memberId === "pdga:100")!.scores[1]).toBe(3);
  });

  it("a non-cardmate is forbidden", () => {
    const { s, cardId } = setup();
    const r = cards.applyScore(s, carol, { cardId, memberId: "pdga:100", hole: 1, strokes: 3 });
    expect(cards.isErr(r) && r.status).toBe(403);
  });

  it("an admin may score any card", () => {
    const { s, cardId } = setup();
    ok(cards.applyScore(s, admin, { cardId, memberId: "pdga:200", hole: 2, strokes: 4 }));
    expect(s.cards[0]!.players.find((p) => p.memberId === "pdga:200")!.scores[2]).toBe(4);
  });

  it("rejects an unknown hole and out-of-range strokes", () => {
    const { s, cardId } = setup();
    expect((cards.applyScore(s, alice, { cardId, memberId: "pdga:100", hole: 99, strokes: 3 }) as cards.OpError).status).toBe(400);
    expect((cards.applyScore(s, alice, { cardId, memberId: "pdga:100", hole: 1, strokes: 0 }) as cards.OpError).status).toBe(400);
    expect((cards.applyScore(s, alice, { cardId, memberId: "pdga:100", hole: 1, strokes: 99 }) as cards.OpError).status).toBe(400);
  });

  it("legacy index-based score still resolves (admin grid back-compat)", () => {
    const { s } = setup();
    ok(cards.applyScore(s, admin, { index: 1, hole: 1, strokes: 5 })); // 2nd flattened player = Bob
    expect(s.cards[0]!.players[1]!.scores[1]).toBe(5);
  });

  it("writes are rejected once finalized", () => {
    const { s, cardId } = setup();
    s.meta.status = "final";
    expect((cards.applyScore(s, alice, { cardId, memberId: "pdga:100", hole: 1, strokes: 3 }) as cards.OpError).status).toBe(409);
  });
});

describe("snapshot + finalize", () => {
  it("snapshot exposes cards, a flat player list, and aggregated standings", () => {
    const s = cards.initContainer(base);
    const { cardId: c1 } = ok(cards.createCard(s, alice, { name: "Alice" }));
    ok(cards.applyScore(s, alice, { cardId: c1, memberId: "pdga:100", hole: 1, strokes: 2 })); // birdie
    const { cardId: c2 } = ok(cards.createCard(s, bob, { name: "Bob" }));
    ok(cards.applyScore(s, bob, { cardId: c2, memberId: "pdga:200", hole: 1, strokes: 4 })); // bogey

    const snap = cards.snapshot(s) as any;
    expect(snap.cards).toHaveLength(2);
    expect(snap.players).toHaveLength(2);
    expect(snap.players[0]).toHaveProperty("pid");
    expect(snap.players[0]).toHaveProperty("cardId");
    // standings aggregate across cards: Alice (-1) leads Bob (+1)
    expect(snap.standings[0].name).toBe("Alice");
    expect(snap.standings[0].toPar).toBe(-1);
    expect(snap.standings[1].toPar).toBe(1);
  });

  it("finalize ranks all players across every card with a breakdown", () => {
    const s = cards.initContainer(base);
    const { cardId } = ok(cards.createCard(s, alice, { name: "Alice" }));
    ok(cards.joinCard(s, bob, cardId, { name: "Bob" }));
    for (const h of HOLES) {
      ok(cards.applyScore(s, alice, { cardId, memberId: "pdga:100", hole: h.hole, strokes: h.par })); // all pars
      ok(cards.applyScore(s, bob, { cardId, memberId: "pdga:200", hole: h.hole, strokes: h.par + 1 })); // all bogeys
    }
    const finals = cards.finalize(s);
    expect(finals[0]!.name).toBe("Alice");
    expect(finals[0]!.place).toBe(1);
    expect(finals[0]!.breakdown.pars).toBe(3);
    expect(finals[1]!.breakdown.bogeys).toBe(3);
  });
});
