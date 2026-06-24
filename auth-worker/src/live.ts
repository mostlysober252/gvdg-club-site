// LiveEventDO — one Durable Object per live "container" (an event OR a casual round). It holds the
// multi-card scorecard state (see cards.ts) in DO storage, applies card/score operations, pushes
// leaderboard snapshots to WebSocket viewers, and on finalize writes results to D1.
//
// Trust boundary: the Worker authenticates every request BEFORE forwarding here and injects the
// verified identity as `X-Auth-Member` / `X-Auth-Admin` headers (never from client input). The DO
// authorizes card/score writes from THOSE headers via cards.ts (admin OR a member of the card).
// Container lifecycle writes (start/finalize) are admin-gated by the Worker for events.

import * as db from "./db.js";
import * as cards from "./cards.js";

interface LiveEnv {
  DB: db.D1Like;
}

interface StartBody {
  type?: "event" | "casual";
  eventId?: number | null;
  roundId?: string | null;
  courseId?: number | null;
  layoutId?: number | null;
  holes: { hole: number; par: number }[];
  seed?: cards.SeedPlayer[];
  startedAt?: string;
  force?: boolean; // restart a live round that already has scores (admin-confirmed)
}

const j = (o: unknown, status = 200): Response =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });

export class LiveEventDO {
  private state: DurableObjectState;
  private env: LiveEnv;
  private sockets = new Set<WebSocket>();
  private loaded = false;
  private container: cards.ContainerState | null = null;

  constructor(state: DurableObjectState, env: LiveEnv) {
    this.state = state;
    this.env = env;
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.container = (await this.state.storage.get<cards.ContainerState>("state")) ?? null;
    this.loaded = true;
  }
  private async persist(): Promise<void> {
    if (this.container) this.container.meta.updatedAt = new Date().toISOString(); // advance "last updated"
    await this.state.storage.put("state", this.container);
  }

  private authOf(request: Request): cards.Auth {
    return {
      memberId: request.headers.get("X-Auth-Member") || null,
      isAdmin: request.headers.get("X-Auth-Admin") === "1",
    };
  }

  async fetch(request: Request): Promise<Response> {
    await this.load();
    const action = new URL(request.url).pathname.split("/").filter(Boolean).pop();
    if (action === "ws") return this.handleWs();
    if (request.method === "GET") return j(this.snap());

    // Read the body + identity BEFORE entering the critical section: request.json() is non-storage I/O,
    // so it opens the DO input gate and would let another event (a concurrent start/finalize) interleave.
    const auth = this.authOf(request);
    const b = (await request.json().catch(() => ({}))) as Record<string, any>;

    // Serialize the entire mutate → persist → broadcast (and finalize's D1 writes) so concurrent
    // start/score/finalize requests cannot interleave and corrupt state. The input gate reopens on every
    // await (incl. D1 calls); blockConcurrencyWhile holds it shut for the whole critical section.
    return this.state.blockConcurrencyWhile<Response>(async () => {
      if (action === "start") return this.start(b as StartBody);
      if (action === "finalize") return this.finalize(auth);

      if (!this.container) return j({ error: "not_started" }, 409);
      const s = this.container;
      let res: cards.OpResult;
      let extra: Record<string, unknown> = {};
      switch (action) {
        case "score": res = cards.applyScore(s, auth, b as cards.ScoreInput); break;
        case "card": {
          const r = cards.createCard(s, auth, { label: b.label, name: String(b.name ?? "Player"), division: b.division ?? null });
          res = r; if (!cards.isErr(r)) extra = { cardId: r.cardId }; break;
        }
        case "join": res = cards.joinCard(s, auth, String(b.cardId), { name: String(b.name ?? "Player"), division: b.division ?? null }); break;
        case "cardmate": res = cards.addMember(s, auth, String(b.cardId), { memberId: String(b.memberId), name: String(b.name ?? "Player"), division: b.division ?? null }); break;
        case "guest": {
          const r = cards.addGuest(s, auth, String(b.cardId), String(b.name ?? ""));
          res = r; if (!cards.isErr(r)) extra = { pid: r.pid }; break;
        }
        case "leave": res = cards.removePlayer(s, auth, String(b.cardId), String(b.pid)); break;
        case "scorekeeper": res = cards.setScorekeeper(s, auth, String(b.cardId), String(b.pid)); break;
        default: return j({ error: "not_found" }, 404);
      }

      if (cards.isErr(res)) return j({ error: res.error }, res.status);
      await this.persist();
      this.broadcast();
      return j({ ...this.snap(), ...extra });
    });
  }

  private snap(): Record<string, unknown> {
    if (!this.container) return { status: "none", cards: [], players: [], standings: [], holes: [] };
    return cards.snapshot(this.container);
  }

  private async start(b: StartBody): Promise<Response> {
    const holes = (Array.isArray(b.holes) ? b.holes : [])
      .filter((h) => h && typeof h.hole === "number" && typeof h.par === "number")
      .map((h) => ({ hole: h.hole, par: h.par }));
    if (holes.length === 0) return j({ error: "invalid_start" }, 400);
    // Don't silently wipe a live round that already has scores — an accidental re-start would erase the
    // card. Require an explicit force flag to restart in that case.
    if (this.container && this.container.meta.status === "live" && !b.force) {
      const hasScores = this.container.cards.some((c) => c.players.some((p) => Object.keys(p.scores).length > 0));
      if (hasScores) return j({ error: "already_live", hint: "scores exist — pass force:true to restart" }, 409);
    }
    this.container = cards.initContainer(
      {
        type: b.type === "casual" ? "casual" : "event",
        eventId: b.eventId ?? null,
        roundId: b.roundId ?? null,
        courseId: b.courseId ?? null,
        layoutId: b.layoutId ?? null,
        holes,
        startedAt: b.startedAt ?? "",
      },
      Array.isArray(b.seed) ? b.seed : [],
    );
    await this.persist();
    this.broadcast();
    return j(this.snap());
  }

  private async finalize(auth: cards.Auth): Promise<Response> {
    if (!this.container) return j({ error: "not_started" }, 409);
    // Idempotent re-entry: a second finalize (admin double-click / retry) returns the standings without
    // re-running the clear+insert. Combined with blockConcurrencyWhile, two finalizes cannot interleave.
    if (this.container.meta.status === "final") return j({ status: "final", standings: cards.finalize(this.container) });
    // Casual rounds: only a participant (someone on a card) or an admin may finish. Events are pre-gated
    // admin-only by the Worker (which forwards isAdmin=1), so this only constrains casual rounds.
    if (this.container.meta.type === "casual" && !auth.isAdmin) {
      const onCard = auth.memberId != null && this.container.cards.some((c) => c.players.some((p) => p.memberId === auth.memberId));
      if (!onCard) return j({ error: "forbidden" }, 403);
    }
    const standings = cards.finalize(this.container);
    const meta = this.container.meta;
    if (meta.type === "event" && meta.eventId != null) {
      // Idempotent: clear any prior results for this event, then write fresh (inserts run concurrently).
      await db.clearResults(this.env.DB, meta.eventId);
      const eventId = meta.eventId;
      await Promise.all(
        standings.map((s) =>
          db.createResult(this.env.DB, {
            event_id: eventId,
            member_id: s.memberId,
            name: s.name,
            place: s.place,
            total: s.total,
            to_par: s.toPar,
            breakdown: JSON.stringify(s.breakdown),
          }),
        ),
      );
      await db.updateEvent(this.env.DB, eventId, { status: "final" });
    } else if (meta.type === "casual" && meta.roundId != null) {
      // Casual round → personal history (Track N3). round_results mirror the event results shape.
      await db.clearRoundResults(this.env.DB, meta.roundId);
      const roundId = meta.roundId;
      await Promise.all(
        standings.map((s) =>
          db.createRoundResult(this.env.DB, {
            round_id: roundId,
            member_id: s.memberId,
            name: s.name,
            place: s.place,
            total: s.total,
            to_par: s.toPar,
            breakdown: JSON.stringify(s.breakdown),
          }),
        ),
      );
      await db.finishRound(this.env.DB, roundId);
    }
    meta.status = "final";
    await this.persist();
    this.broadcast();
    return j({ status: "final", standings });
  }

  private handleWs(): Response {
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();
    this.sockets.add(server);
    server.addEventListener("close", () => this.sockets.delete(server));
    server.addEventListener("error", () => this.sockets.delete(server));
    try { server.send(JSON.stringify({ type: "snapshot", ...this.snap() })); } catch { /* ignore */ }
    return new Response(null, { status: 101, webSocket: client });
  }

  private broadcast(): void {
    const msg = JSON.stringify({ type: "snapshot", ...this.snap() });
    for (const ws of [...this.sockets]) {
      try { ws.send(msg); } catch { this.sockets.delete(ws); }
    }
  }
}
