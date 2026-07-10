// LiveEventDO — one Durable Object per in-progress event. Holds the live scorecard (layout pars +
// players + per-hole strokes) in DO storage, accepts score submissions, pushes leaderboard updates to
// WebSocket viewers, and on finalize writes results to D1 and marks the event final.
//
// Auth is enforced by the Worker BEFORE forwarding here (start/score/finalize are admin-gated; the
// snapshot + ws reads are public). The DO trusts requests it receives.

import { normalizeScorecards, playerScorerId, purgeScorerVotes, purgeScoreTargetScorerVotes, recordScoreTargetVote } from "./live-consensus.js";
import { isLiveFormatError, normalizeLiveScoringConfig, normalizePairLabel, type LiveScoringConfig } from "./live-format.js";
import { finalizeLiveEvent } from "./live-finalize.js";
import { updateLivePairs } from "./live-pairs.js";
import { canEnterScorecard, findPlayer, invalidScoreTargetsResponse, scoreTargetForBody, scoringState, targetAnchor } from "./live-state.js";
import { mineData, publicSnapshot } from "./live-snapshot.js";
import { j, type LiveEnv, type LiveMeta, type LiveState, type OverrideBody, type PairAssignmentBody, type RemoveBody, type ScoreBody, type StartBody, type WeatherBody } from "./live-types.js";
import { assignCards, type PlayerState } from "./scoring.js";
import { createWeatherState, refreshWeatherState, WEATHER_REFRESH_MS } from "./weather.js";

// Stop the background weather alarm for a round "live" longer than this — a safety bound so an abandoned
// (started, never finalized) round can't keep polling Open-Meteo indefinitely.
const WEATHER_MAX_AGE_MS = 12 * 60 * 60 * 1000;

export class LiveEventDO {
  private state: LiveState;
  private env: LiveEnv;
  private loaded = false;
  private meta: LiveMeta | null = null;
  private players: PlayerState[] = [];

  constructor(state: LiveState, env: LiveEnv) {
    this.state = state;
    this.env = env;
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.meta = (await this.state.storage.get<LiveMeta>("meta")) ?? null;
    this.players = (await this.state.storage.get<PlayerState[]>("players")) ?? [];
    normalizeScorecards(this.players, this.meta?.holes ?? []);
    this.loaded = true;
  }
  private async persist(): Promise<void> {
    if (this.meta) this.meta.rev = (this.meta.rev ?? 0) + 1; // one bump per mutation (persist is the mutation marker)
    await this.state.storage.put("meta", this.meta);
    await this.state.storage.put("players", this.players);
  }

  /** Fetch latest weather and fold into meta WITHOUT persisting — the caller persists once. */
  private async refreshWeatherNow(): Promise<void> {
    if (this.meta?.weather) this.meta.weather = await refreshWeatherState(this.meta.weather);
  }
  /** Ensure a weather-refresh alarm is scheduled for a live, weather-tracked round (idempotent — never stacks). */
  private async scheduleWeatherAlarm(): Promise<void> {
    if (this.meta?.status !== "live" || !this.meta.weather) return;
    if ((await this.state.storage.getAlarm()) == null) await this.state.storage.setAlarm(Date.now() + WEATHER_REFRESH_MS);
  }
  /** DO alarm handler (Cloudflare invokes by name): refresh weather + reschedule while live; clear the
   *  alarm once the round is final/none or past the max-age bound. */
  async alarm(): Promise<void> {
    await this.load();
    const startedMs = Date.parse(this.meta?.startedAt ?? "");
    const stale = Number.isFinite(startedMs) && Date.now() - startedMs > WEATHER_MAX_AGE_MS;
    if (this.meta?.status !== "live" || !this.meta.weather || stale) {
      await this.state.storage.deleteAlarm();
      return;
    }
    // The alarm MUST NOT throw: an uncaught error here retries + wedges the Durable Object, making every
    // subsequent request (score/cancel/finalize) fail with "internal error". Guard the refresh + broadcast,
    // and always reschedule while the round is live so a transient hiccup doesn't stop weather updates.
    try {
      this.meta.weather = await refreshWeatherState(this.meta.weather);
      // Persist WITHOUT bumping rev: a weather refresh is not a scoring change, so it must not force every
      // scorekeeper's client to re-render the scorecard (which would reset scroll + any open dropdown). The
      // snapshot keeps its current rev; clients apply the new weather in-place off this same-rev broadcast.
      await this.state.storage.put("meta", this.meta);
      this.broadcast();
    } catch (error) {
      console.error(JSON.stringify({ message: "weather_alarm_failed", eventId: this.meta?.eventId ?? null, error: error instanceof Error ? error.message : String(error) }));
    }
    await this.state.storage.setAlarm(Date.now() + WEATHER_REFRESH_MS);
  }
  /** One-time weather backfill for a live round that started before it had a location (or before weather
   *  tracking existed): record the location, take an initial reading, and start the refresh alarm. */
  private async ensureWeather(b: WeatherBody): Promise<Response> {
    if (!this.meta || this.meta.status !== "live") return j({ error: "not_live" }, 409);
    if (!this.meta.weather && b.weatherLocation) {
      this.meta.weather = createWeatherState(b.weatherLocation);
      await this.refreshWeatherNow();
      await this.persist();
      await this.scheduleWeatherAlarm();
      this.broadcast();
      return j(this.snapshot());
    }
    await this.scheduleWeatherAlarm();
    return j(this.snapshot());
  }

  async fetch(request: Request): Promise<Response> {
    await this.load();
    const action = new URL(request.url).pathname.split("/").filter(Boolean).pop();
    // Identity is set by the Worker AFTER it authenticates the caller — the DO trusts these headers and
    // never reads identity from the request body for authorization (the body is spoofable).
    const authMember = request.headers.get("X-Auth-Member");
    const authAdmin = request.headers.get("X-Auth-Admin") === "true";
    if (action === "ws") return this.handleWs(request);
    if (action === "mine") return this.mine(authMember); // a player's own card (authed read)
    if (request.method === "GET") return j(this.snapshot()); // public leaderboard/scorecard (no identity)
    const body = await request.json().catch(() => ({}));
    if (action === "start") return this.start(body as StartBody);
    if (action === "score") return this.score(body as ScoreBody, authMember, authAdmin);
    if (action === "join") return this.join(authMember, (body as { name?: string }).name); // casual round: caller joins
    if (action === "guest") return this.addGuest(authMember, (body as { name?: string; team?: string }).name, (body as { team?: string }).team); // add a non-member to my card (+ pair label for doubles)
    if (action === "remove") return this.removePlayer(body as RemoveBody, authMember, authAdmin); // drop a player (accidental/left/no-show)
    if (action === "pairs") return this.updatePairs(body as PairAssignmentBody, authMember, authAdmin);
    if (action === "cancel") return this.cancel(authAdmin); // admin: scrap a mis-started round, reset to none
    if (action === "weather") return this.ensureWeather(body as WeatherBody); // one-time weather backfill
    if (action === "override") return this.override(body as OverrideBody);
    if (action === "finalize") return this.finalize(authMember, authAdmin, (body as { force?: boolean }).force === true);
    return j({ error: "not_found" }, 404);
  }

  private snapshot() {
    return publicSnapshot(this.meta, this.players);
  }

  private async start(b: StartBody): Promise<Response> {
    const holes = (Array.isArray(b.holes) ? b.holes : [])
      .filter((h) => h && typeof h.hole === "number" && typeof h.par === "number")
      .map((h) => ({ hole: h.hole, par: h.par, distance_ft: h.distance_ft ?? null, tee_sign_id: h.tee_sign_id ?? null }));
    if (holes.length === 0 || (!b.eventId && !b.casual)) return j({ error: "invalid_start" }, 400);
    let roundConfig: LiveScoringConfig;
    try {
      roundConfig = normalizeLiveScoringConfig(b.liveScoringConfig);
    } catch (error) {
      if (isLiveFormatError(error)) return j({ error: "invalid_live_scoring_config", code: error.code, message: error.message }, 400);
      throw error;
    }
    this.meta = { eventId: b.eventId ?? 0, casual: !!b.casual, roundCode: b.roundCode ?? null, courseId: b.courseId ?? null, layoutId: b.layoutId ?? null, createdBy: b.createdBy ?? null, courseName: b.courseName ?? null, layoutName: b.layoutName ?? null, udiscCourseId: b.udiscCourseId ?? null, holes, status: "live", startedAt: b.startedAt ?? "", weather: createWeatherState(b.weatherLocation ?? null), roundConfig, overrides: {} };
    this.players = (Array.isArray(b.players) ? b.players : []).map((p) => ({
      memberId: p.memberId ?? null,
      name: String(p.name ?? "Player"),
      division: p.division ?? null,
      team: p.team ?? p.pairLabel ?? null,
      startingHole: p.startingHole ?? null,
      cardId: p.cardId ?? null,
      scores: {},
      scorecards: {},
    }));
    assignCards(this.players, b.cardSize); // group into cards (by starting hole, else buckets of 4)
    await this.persist();
    // Take the FIRST weather reading OFF the round-start path: fire the alarm immediately rather than
    // blocking the start response on an Open-Meteo fetch. The alarm populates + broadcasts weather a moment
    // later, and then reschedules itself every 5 min for the life of the round.
    if (this.meta?.weather) await this.state.storage.setAlarm(Date.now());
    this.broadcast();
    return j(this.snapshot());
  }

  private findPlayer(b: ScoreBody): PlayerState | undefined {
    return findPlayer(b, this.players);
  }

  private async score(b: ScoreBody, authMember: string | null, authAdmin: boolean): Promise<Response> {
    if (!this.meta || this.meta.status !== "live") return j({ error: "not_live" }, 409);
    const hole = Number(b.hole);
    const strokes = Number(b.strokes);
    if (!this.meta.holes.some((h) => h.hole === hole)) return j({ error: "bad_hole" }, 400);
    if (!Number.isInteger(strokes) || strokes < 1 || strokes > 30) return j({ error: "bad_strokes" }, 400);
    const scoring = scoringState(this.meta, this.players);
    if (scoring.globalError) return invalidScoreTargetsResponse(scoring.globalError); // whole round unscorable (bad config)
    const target = scoreTargetForBody(b, this.players, scoring.targets);
    const anchor = target ? targetAnchor(this.players, target) : null;
    // Isolate a broken pair/card: block ONLY submissions touching a broken player (the target's anchor, else
    // the body player, else the scorer's own slot). A healthy pair keeps scoring even sharing a card — or a
    // single-card casual round — with a broken one.
    if (scoring.brokenPlayers.length) {
      const broken = new Set(scoring.brokenPlayers);
      const bodyPlayer = this.findPlayer(b);
      const touchedIndex = anchor
        ? anchor.index
        : bodyPlayer
          ? this.players.indexOf(bodyPlayer)
          : authMember
            ? this.players.findIndex((p) => p.memberId === authMember && !p.removed)
            : -1;
      if (touchedIndex >= 0 && broken.has(touchedIndex)) {
        const err = scoring.cardErrors.find((e) => e.playerIndexes.includes(touchedIndex)) ?? scoring.error;
        if (err) return invalidScoreTargetsResponse({ code: err.code, message: err.message });
      }
    }
    if (!target || !anchor) return j({ error: b.targetId ? "no_target" : "no_player" }, 404); // a removed player is no longer scorable
    const meIndex = authMember ? this.players.findIndex((p) => p.memberId === authMember && !p.removed) : -1;
    const me = meIndex >= 0 ? this.players[meIndex] : undefined;
    // Authorize from the Worker-trusted identity ONLY: an admin may score anyone; otherwise the
    // submitter must be a player on the SAME card as the target. Body identity is for targeting, not auth.
    if (!authAdmin) {
      if (!me) return j({ error: "not_on_card" }, 403);
      if ((me.cardId ?? null) !== (anchor.player.cardId ?? null)) return j({ error: "wrong_card" }, 403);
    }
    if (b.scorerIndex != null && (!Number.isInteger(b.scorerIndex) || b.scorerIndex < 0)) return j({ error: "bad_scorer" }, 400);
    const scorerIndex = typeof b.scorerIndex === "number" ? b.scorerIndex : authAdmin ? anchor.index : meIndex;
    const scorer = this.players[scorerIndex];
    if (!scorer || scorer.removed) return j({ error: "bad_scorer" }, 400);
    if ((scorer.cardId ?? null) !== (anchor.player.cardId ?? null)) return j({ error: "scorer_wrong_card" }, 403);
    if (!authAdmin && !canEnterScorecard(scorer, authMember)) return j({ error: "wrong_scorer" }, 403);
    const scorerId = playerScorerId(scorerIndex);
    const conflict = recordScoreTargetVote({ players: this.players, target, scorerId, hole, strokes });
    await this.persist();
    if (conflict) {
      this.sendAll({ type: "conflict", ...conflict, from: conflict.values[0] ?? null, to: conflict.values[1] ?? null });
    }
    this.broadcast();
    return j(this.snapshot());
  }

  private mine(authMember: string | null): Response {
    if (!this.meta || this.meta.status !== "live") return j({ error: "not_live" }, 409);
    return j(mineData(this.meta, this.players, authMember));
  }

  /** Casual round: the authenticated caller joins (added once, on the single card "c0"). No-op if already in. */
  private async join(authMember: string | null, name?: string): Promise<Response> {
    if (!this.meta || this.meta.status !== "live") return j({ error: "round_not_live" }, 409);
    if (!authMember) return j({ error: "unauthorized" }, 401);
    const existing = this.players.find((p) => p.memberId === authMember);
    if (existing) {
      // Already a player: no-op — unless they were removed (accidental/left), in which case rejoining
      // reactivates the same slot (index stays stable) with a fresh, empty card.
      if (existing.removed) {
        existing.removed = false;
        existing.name = String(name || existing.name).slice(0, 60);
        existing.scores = {};
        existing.scorecards = {};
        existing.scoredBy = {};
        await this.persist();
        this.broadcast();
      }
    } else {
      const cardId = this.meta.casual ? "c0" : (this.players[0]?.cardId ?? "c0");
      this.players.push({ memberId: authMember, name: String(name || "Player").slice(0, 60), division: null, startingHole: null, cardId, scores: {}, scorecards: {} });
      await this.persist();
      this.broadcast();
    }
    return j(mineData(this.meta, this.players, authMember));
  }

  /** Add a non-member guest to the caller's card (the caller must already be on the round). A pair label
   *  (team) may be supplied so a doubles walk-on is pairable immediately; it's stored as-is (the pairing
   *  is validated at scoring time once two players share a label), matching how start() records teams. */
  private async addGuest(authMember: string | null, name?: string, team?: string): Promise<Response> {
    if (!this.meta || this.meta.status !== "live") return j({ error: "round_not_live" }, 409);
    const me = authMember ? this.players.find((p) => p.memberId === authMember && !p.removed) : undefined;
    if (!me) return j({ error: "not_on_card" }, 403);
    const nm = String(name || "").trim();
    if (!nm) return j({ error: "name_required" }, 400);
    this.players.push({ memberId: null, name: nm.slice(0, 60), division: null, team: normalizePairLabel(team), startingHole: null, cardId: me.cardId ?? "c0", scores: {}, scorecards: {} });
    await this.persist();
    this.broadcast();
    return j(mineData(this.meta, this.players, authMember));
  }

  /** Remove a player from the card — a casual-round player who registered by accident, had to leave
   *  before the round ended, or no-showed. Authorized from the Worker-trusted identity ONLY (body
   *  identity is for targeting, never auth): an admin may remove anyone; otherwise the caller must be a
   *  member on the SAME card as the target, and may remove themselves. Targets by index, then memberId,
   *  then name; if a name is supplied it must still match the player now at that index, so a stale or
   *  shifted index can't drop the wrong person. Splicing re-indexes later players — every client
   *  re-renders from the returned card (the remover) or the broadcast snapshot. */
  private async removePlayer(b: RemoveBody, authMember: string | null, authAdmin: boolean): Promise<Response> {
    if (!this.meta || this.meta.status !== "live") return j({ error: "not_live" }, 409);
    let idx = -1;
    if (typeof b.index === "number" && Number.isInteger(b.index)) idx = b.index;
    else if (b.memberId) idx = this.players.findIndex((p) => p.memberId === b.memberId);
    else if (b.name) idx = this.players.findIndex((p) => p.name === b.name);
    const target = idx >= 0 ? this.players[idx] : undefined;
    if (!target || target.removed) return j({ error: "no_player" }, 404);
    if (b.name != null && target.name !== b.name) return j({ error: "player_moved" }, 409); // stale index guard
    if (!authAdmin) {
      const me = authMember ? this.players.find((p) => p.memberId === authMember && !p.removed) : undefined;
      if (!me) return j({ error: "not_on_card" }, 403);
      if ((me.cardId ?? null) !== (target.cardId ?? null)) return j({ error: "wrong_card" }, 403);
    }
    // TOMBSTONE, don't splice: the array index is how live scorers target a player, and a casual round
    // has no WebSocket to resync other phones — splicing would shift every later index and silently
    // re-point their next score to the wrong player. Marking removed keeps indexes stable; the player is
    // filtered out of the card, snapshot, and standings, and their scores cleared so a rejoin starts fresh.
    target.removed = true;
    target.scores = {};
    target.scorecards = {};
    target.scoredBy = {};
    const scoring = scoringState(this.meta, this.players);
    if (scoring.error) purgeScorerVotes(this.players, idx, this.meta.holes);
    else purgeScoreTargetScorerVotes(this.players, idx, this.meta.holes, scoring.targets); // drop this player's votes on cardmates + re-derive consensus, so a leaver can't pin a hole in permanent conflict
    await this.persist();
    this.broadcast();
    return j(mineData(this.meta, this.players, authMember));
  }

  private async updatePairs(b: PairAssignmentBody, authMember: string | null, authAdmin: boolean): Promise<Response> {
    const result = updateLivePairs({ meta: this.meta, players: this.players, body: b, authMember, authAdmin });
    if (!result.ok) return j(result.body, result.status);
    if (result.changed) {
      this.players = result.players;
      await this.persist();
      this.broadcast();
    }
    return j(mineData(this.meta, this.players, authMember));
  }

  // Round-scoped single-use override of a hole's par/distance. Admin-gated at the Worker. The layout
  // is never mutated, so the hole reverts to its verified value once this round ends.
  private async override(b: OverrideBody): Promise<Response> {
    if (!this.meta || this.meta.status !== "live") return j({ error: "not_live" }, 409);
    const hole = Number(b.hole);
    if (!this.meta.holes.some((h) => h.hole === hole)) return j({ error: "bad_hole" }, 400);
    const overrides = this.meta.overrides ?? (this.meta.overrides = {});
    if (b.clear) {
      delete overrides[String(hole)];
    } else {
      const entry: { par?: number; distance_ft?: number } = {};
      const par = Number(b.par);
      const dist = Number(b.distance_ft);
      if (b.par != null && Number.isInteger(par) && par >= 1 && par <= 15) entry.par = par;
      if (b.distance_ft != null && Number.isFinite(dist) && dist >= 20 && dist <= 2000) entry.distance_ft = Math.round(dist);
      if (entry.par == null && entry.distance_ft == null) return j({ error: "empty_override" }, 400);
      overrides[String(hole)] = entry;
    }
    await this.persist();
    this.broadcast();
    return j(this.snapshot());
  }

  /** Admin: scrap the current round entirely (mis-started, wrong layout/format, etc.) and reset the DO to
   *  an empty "none" state. The Worker route separately returns the event to "scheduled" in D1. Refused
   *  once finalized — that round's results are already written, so it must not be silently reset. */
  private async cancel(authAdmin: boolean): Promise<Response> {
    if (!authAdmin) return j({ error: "forbidden" }, 403);
    if (this.meta?.status === "final") return j({ error: "round_already_final" }, 409);
    this.meta = null;
    this.players = [];
    await this.persist();
    await this.state.storage.deleteAlarm(); // round reset — stop the background weather refresh
    this.broadcast(); // push the "none" snapshot so live viewers/scorekeepers see the round end
    return j(this.snapshot());
  }

  private async finalize(authMember: string | null, authAdmin: boolean, force = false): Promise<Response> {
    return finalizeLiveEvent({
      meta: this.meta,
      players: this.players,
      env: this.env,
      authMember,
      authAdmin,
      force,
      persist: () => this.persist(),
      broadcast: () => this.broadcast(),
    });
  }

  private handleWs(_request: Request): Response {
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.state.acceptWebSocket(server);
    try { server.send(JSON.stringify({ type: "snapshot", ...this.snapshot() })); } catch { /* ignore */ }
    return new Response(null, { status: 101, webSocket: client });
  }

  private sendAll(obj: unknown): void {
    const msg = JSON.stringify(obj);
    for (const ws of this.state.getWebSockets()) {
      try { ws.send(msg); } catch { /* ignore */ }
    }
  }
  private broadcast(): void {
    this.sendAll({ type: "snapshot", ...this.snapshot() });
  }
}
