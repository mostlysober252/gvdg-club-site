// Pure, testable model for UDisc-style multi-card live scoring. NO Durable Object / D1 / DOM here —
// `live.ts` is the thin DO shell that loads state, calls these functions, persists, and broadcasts.
//
// A "container" is one live unit: an event OR a casual round. It holds many CARDS; each card is a
// group of players (cardmates) sharing one scorecard. ANY member on a card may keep score for it
// (the UDisc "Live Scorecard" model); guests (no account) are scored by their cardmates. The event
// leaderboard aggregates every player across every card.
//
// Authorization is enforced here from a trusted `Auth` the WORKER derives from the verified JWT
// (never from client input). A score/card write is allowed iff the requester is an admin OR a member
// of that card. This is the security boundary that replaces the old "everything is admin-gated".

import { computeLeaderboard, finalizeStandings, type PlayerState, type Standing, type FinalStanding } from "./scoring.js";

export const MAX_PLAYERS_PER_CARD = 6;
export const MAX_CARDS = 36;

export interface CardPlayer {
  pid: string; // stable within the container ("p1", "p2", …)
  memberId: string | null; // null for guests
  name: string;
  division: string | null;
  startingHole: number | null;
  isGuest: boolean;
  scores: Record<number, number>; // hole -> strokes
}

export interface Card {
  id: string; // stable within the container ("c1", "c2", …)
  label: string;
  startingHole: number | null;
  scorekeeperId: string | null; // pid of the designated scorekeeper (informational; any cardmate may write)
  players: CardPlayer[];
}

export interface ContainerMeta {
  type: "event" | "casual";
  eventId: number | null;
  roundId: string | null;
  courseId: number | null;
  layoutId: number | null;
  holes: { hole: number; par: number }[];
  status: "live" | "final";
  startedAt: string;
  cardSeq: number; // monotonic id source
  playerSeq: number;
}

export interface ContainerState {
  meta: ContainerMeta;
  cards: Card[];
}

/** Identity the Worker derives from the verified session and forwards to the DO. */
export interface Auth {
  memberId: string | null;
  isAdmin: boolean;
}

export type OpError = { error: string; status: number };
export type OpOk<T = unknown> = { ok: true } & T;
export type OpResult<T = unknown> = OpOk<T> | OpError;

const fail = (error: string, status: number): OpError => ({ error, status });
const isErr = (r: OpResult): r is OpError => (r as OpError).error !== undefined;
export { isErr };

export interface SeedPlayer {
  memberId?: string | null;
  name: string;
  division?: string | null;
  startingHole?: number | null;
  cardLabel?: string | null; // admin pre-assignment (Track N4); groups players into the same card
}

/** Build a fresh container. Optionally seed players into cards (admin "start"): group by explicit
 *  cardLabel, else by startingHole (shotgun), else everyone into one card. Members may still create
 *  their own cards afterwards; an empty seed is valid (pure self-organize). */
export function initContainer(
  base: Pick<ContainerMeta, "type" | "eventId" | "roundId" | "courseId" | "layoutId"> & {
    holes: { hole: number; par: number }[];
    startedAt: string;
  },
  seed: SeedPlayer[] = [],
): ContainerState {
  const meta: ContainerMeta = {
    type: base.type,
    eventId: base.eventId,
    roundId: base.roundId,
    courseId: base.courseId,
    layoutId: base.layoutId,
    holes: base.holes,
    status: "live",
    startedAt: base.startedAt,
    cardSeq: 0,
    playerSeq: 0,
  };
  const state: ContainerState = { meta, cards: [] };

  if (!seed.length) return state;

  // Decide grouping: explicit card label > shotgun starting hole > one undifferentiated group.
  // Each group is then chunked into cards of at most MAX_PLAYERS_PER_CARD so no card overflows and
  // no player is dropped (a 20-person field with no shotgun → four cards of five/six).
  const useLabel = seed.some((p) => p.cardLabel);
  const useHole = !useLabel && seed.some((p) => p.startingHole != null);
  const groups = new Map<string, SeedPlayer[]>();
  for (const p of seed) {
    const key = useLabel ? String(p.cardLabel ?? "Card") : useHole ? "Hole " + String(p.startingHole ?? "?") : "Card";
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(p);
  }
  for (const [label, players] of groups) {
    for (let off = 0, part = 0; off < players.length; off += MAX_PLAYERS_PER_CARD, part++) {
      const slice = players.slice(off, off + MAX_PLAYERS_PER_CARD);
      const multi = players.length > MAX_PLAYERS_PER_CARD;
      const card = newCard(state, multi ? `${label} (${part + 1})` : label, slice[0]?.startingHole ?? null);
      for (const p of slice)
        addPlayerTo(state, card, {
          memberId: p.memberId ?? null,
          name: p.name,
          division: p.division ?? null,
          startingHole: p.startingHole ?? card.startingHole,
          isGuest: p.memberId == null,
        });
    }
  }
  return state;
}

function newCard(state: ContainerState, label: string, startingHole: number | null): Card {
  const id = "c" + ++state.meta.cardSeq;
  const card: Card = { id, label: label || id, startingHole, scorekeeperId: null, players: [] };
  state.cards.push(card);
  return card;
}

function addPlayerTo(
  state: ContainerState,
  card: Card,
  p: { memberId: string | null; name: string; division: string | null; startingHole: number | null; isGuest: boolean },
): CardPlayer {
  const pid = "p" + ++state.meta.playerSeq;
  const player: CardPlayer = {
    pid,
    memberId: p.memberId,
    name: p.name,
    division: p.division,
    startingHole: p.startingHole,
    isGuest: p.isGuest,
    scores: {},
  };
  card.players.push(player);
  if (!card.scorekeeperId && !p.isGuest) card.scorekeeperId = pid; // first member becomes default scorekeeper
  return player;
}

const card = (state: ContainerState, cardId: string): Card | undefined => state.cards.find((c) => c.id === cardId);

/** True if `auth` may write `card`: admins always; otherwise the requester must be a member on it. */
export function canWriteCard(c: Card, auth: Auth): boolean {
  if (auth.isAdmin) return true;
  return auth.memberId != null && c.players.some((p) => p.memberId === auth.memberId);
}

const onAnyCard = (state: ContainerState, memberId: string | null): boolean =>
  memberId != null && state.cards.some((c) => c.players.some((p) => p.memberId === memberId));

function requireLive(state: ContainerState): OpError | null {
  return state.meta.status !== "live" ? fail("not_live", 409) : null;
}

/** Member creates a new card and is added as its first player. */
export function createCard(state: ContainerState, auth: Auth, opts: { label?: string; name: string; division?: string | null }): OpResult<{ cardId: string }> {
  const live = requireLive(state);
  if (live) return live;
  if (!auth.memberId) return fail("auth_required", 401);
  if (state.cards.length >= MAX_CARDS) return fail("too_many_cards", 409);
  if (onAnyCard(state, auth.memberId)) return fail("already_on_card", 409);
  const c = newCard(state, opts.label?.trim() || "Card " + (state.cards.length + 1), null);
  addPlayerTo(state, c, { memberId: auth.memberId, name: opts.name, division: opts.division ?? null, startingHole: c.startingHole, isGuest: false });
  return { ok: true, cardId: c.id };
}

/** Member joins an existing card. */
export function joinCard(state: ContainerState, auth: Auth, cardId: string, who: { name: string; division?: string | null }): OpResult {
  const live = requireLive(state);
  if (live) return live;
  if (!auth.memberId) return fail("auth_required", 401);
  const c = card(state, cardId);
  if (!c) return fail("no_card", 404);
  if (c.players.some((p) => p.memberId === auth.memberId)) return { ok: true }; // idempotent
  if (onAnyCard(state, auth.memberId)) return fail("already_on_card", 409);
  if (c.players.length >= MAX_PLAYERS_PER_CARD) return fail("card_full", 409);
  addPlayerTo(state, c, { memberId: auth.memberId, name: who.name, division: who.division ?? null, startingHole: c.startingHole, isGuest: false });
  return { ok: true };
}

/** A cardmate (or admin) adds another roster member to the card. Name/division are Worker-resolved (trusted). */
export function addMember(state: ContainerState, auth: Auth, cardId: string, who: { memberId: string; name: string; division?: string | null }): OpResult {
  const live = requireLive(state);
  if (live) return live;
  const c = card(state, cardId);
  if (!c) return fail("no_card", 404);
  if (!canWriteCard(c, auth)) return fail("forbidden", 403);
  if (c.players.some((p) => p.memberId === who.memberId)) return { ok: true };
  if (onAnyCard(state, who.memberId)) return fail("member_on_other_card", 409);
  if (c.players.length >= MAX_PLAYERS_PER_CARD) return fail("card_full", 409);
  addPlayerTo(state, c, { memberId: who.memberId, name: who.name, division: who.division ?? null, startingHole: c.startingHole, isGuest: false });
  return { ok: true };
}

/** A cardmate (or admin) adds a guest (no account) — a label scored by their cardmates. */
export function addGuest(state: ContainerState, auth: Auth, cardId: string, name: string): OpResult<{ pid: string }> {
  const live = requireLive(state);
  if (live) return live;
  const c = card(state, cardId);
  if (!c) return fail("no_card", 404);
  if (!canWriteCard(c, auth)) return fail("forbidden", 403);
  if (c.players.length >= MAX_PLAYERS_PER_CARD) return fail("card_full", 409);
  const clean = name.trim().slice(0, 60);
  if (!clean) return fail("bad_name", 400);
  const p = addPlayerTo(state, c, { memberId: null, name: clean, division: c.players[0]?.division ?? null, startingHole: c.startingHole, isGuest: true });
  return { ok: true, pid: p.pid };
}

/** Remove a player from a card. A member may remove themselves; an admin (or a cardmate) may remove a guest. */
export function removePlayer(state: ContainerState, auth: Auth, cardId: string, pid: string): OpResult {
  const live = requireLive(state);
  if (live) return live;
  const c = card(state, cardId);
  if (!c) return fail("no_card", 404);
  const p = c.players.find((x) => x.pid === pid);
  if (!p) return fail("no_player", 404);
  const self = p.memberId != null && p.memberId === auth.memberId;
  const guestByCardmate = p.isGuest && canWriteCard(c, auth);
  if (!(auth.isAdmin || self || guestByCardmate)) return fail("forbidden", 403);
  c.players = c.players.filter((x) => x.pid !== pid);
  if (c.scorekeeperId === pid) c.scorekeeperId = c.players.find((x) => !x.isGuest)?.pid ?? null;
  if (c.players.length === 0) state.cards = state.cards.filter((x) => x.id !== c.id); // drop empty cards
  return { ok: true };
}

/** Designate the scorekeeper for a card (informational — any cardmate may still write). */
export function setScorekeeper(state: ContainerState, auth: Auth, cardId: string, pid: string): OpResult {
  const c = card(state, cardId);
  if (!c) return fail("no_card", 404);
  if (!canWriteCard(c, auth)) return fail("forbidden", 403);
  if (!c.players.some((x) => x.pid === pid && !x.isGuest)) return fail("no_player", 404);
  c.scorekeeperId = pid;
  return { ok: true };
}

export interface ScoreInput {
  cardId?: string;
  pid?: string;
  memberId?: string | null;
  index?: number; // legacy admin grid: index into the flattened player list
  hole: number;
  strokes: number;
}

/** Locate the target player + their card for a score write (supports new pid/cardId and legacy index). */
function locate(state: ContainerState, b: ScoreInput): { c: Card; p: CardPlayer } | null {
  if (b.cardId) {
    const c = card(state, b.cardId);
    if (!c) return null;
    const p = b.pid ? c.players.find((x) => x.pid === b.pid) : b.memberId ? c.players.find((x) => x.memberId === b.memberId) : undefined;
    return p ? { c, p } : null;
  }
  if (b.pid) {
    for (const c of state.cards) { const p = c.players.find((x) => x.pid === b.pid); if (p) return { c, p }; }
    return null;
  }
  if (typeof b.index === "number") {
    const flat = flattenPlayers(state);
    const f = flat[b.index];
    if (!f) return null;
    const c = card(state, f.cardId)!;
    return { c, p: c.players.find((x) => x.pid === f.pid)! };
  }
  return null;
}

/** Apply one hole score, enforcing card-membership auth + validation. */
export function applyScore(state: ContainerState, auth: Auth, b: ScoreInput): OpResult {
  const live = requireLive(state);
  if (live) return live;
  const hole = Number(b.hole);
  const strokes = Number(b.strokes);
  if (!state.meta.holes.some((h) => h.hole === hole)) return fail("bad_hole", 400);
  if (!Number.isInteger(strokes) || strokes < 1 || strokes > 30) return fail("bad_strokes", 400);
  const found = locate(state, b);
  if (!found) return fail("no_player", 404);
  if (!canWriteCard(found.c, auth)) return fail("forbidden", 403);
  found.p.scores[hole] = strokes;
  return { ok: true };
}

/** Flatten every player across every card, preserving a stable order, for the leaderboard + legacy grid. */
export function flattenPlayers(state: ContainerState): (PlayerState & { pid: string; cardId: string; isGuest: boolean })[] {
  const out: (PlayerState & { pid: string; cardId: string; isGuest: boolean })[] = [];
  for (const c of state.cards)
    for (const p of c.players)
      out.push({ pid: p.pid, cardId: c.id, memberId: p.memberId, name: p.name, division: p.division, startingHole: p.startingHole, isGuest: p.isGuest, scores: p.scores });
  return out;
}

/** Back-compatible snapshot: `cards` for the new card UIs, flat `players` for the legacy admin grid,
 *  `standings` aggregated across all cards for the public leaderboard. */
export function snapshot(state: ContainerState): Record<string, unknown> {
  const flat = flattenPlayers(state);
  return {
    status: state.meta.status,
    type: state.meta.type,
    eventId: state.meta.eventId,
    roundId: state.meta.roundId,
    courseId: state.meta.courseId,
    layoutId: state.meta.layoutId,
    holes: state.meta.holes,
    cards: state.cards.map((c) => ({
      id: c.id,
      label: c.label,
      startingHole: c.startingHole,
      scorekeeperId: c.scorekeeperId,
      players: c.players.map((p) => ({ pid: p.pid, memberId: p.memberId, name: p.name, division: p.division, startingHole: p.startingHole, isGuest: p.isGuest, scores: p.scores })),
    })),
    players: flat.map((p, index) => ({ index, pid: p.pid, cardId: p.cardId, memberId: p.memberId, name: p.name, division: p.division, startingHole: p.startingHole, scores: p.scores })),
    standings: computeLeaderboard(state.meta.holes, flat),
    updatedAt: state.meta.startedAt,
  };
}

export function finalize(state: ContainerState): FinalStanding[] {
  return finalizeStandings(state.meta.holes, flattenPlayers(state));
}

export type { Standing };
