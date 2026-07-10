// Pure scoring logic for live events — no DO/D1/DOM here so it's unit-testable.

import { countScores, type Breakdown } from "./score-breakdown.js";

export { countScores } from "./score-breakdown.js";
export type { Breakdown } from "./score-breakdown.js";
export { computeLiveStandings, finalizeLiveStandings } from "./live-scoring.js";
export type { FinalLiveStanding, LiveScoringInput, LiveStanding, ScoringGroup } from "./live-scoring.js";
export type { MatchStatus } from "./matchplay-scoring.js";

export interface PlayerState {
  memberId: string | null;
  name: string;
  division?: string | null;
  team?: string | null;
  startingHole?: number | null; // assigned shotgun start (Track G G4); display-only, doesn't affect scoring
  cardId?: string | null; // which scoring card/group this player is on (a player may score only their own card)
  scores: Record<number, number>; // hole -> strokes
  scorecards?: Record<number, Record<string, number>>;
  scoredBy?: Record<number, string | null>; // hole -> who last set it (for live scoring-conflict detection)
  removed?: boolean; // tombstoned (accidental join / left early / no-show): kept in the array so positional
  // indexes never shift under live scorers, but filtered out of the card, snapshot, and standings.
}

export const DEFAULT_CARD_SIZE = 4;

/** Stamp each player with a stable cardId so players can be authorized to score only their own card.
 *  If shotgun starting holes are assigned, players sharing a starting hole are one card ("h<hole>");
 *  otherwise players are bucketed consecutively into cards of `size` ("c<n>"). Only fills missing ids. */
export function assignCards(players: PlayerState[], size = DEFAULT_CARD_SIZE): void {
  const byHole = players.some((p) => p.startingHole != null);
  players.forEach((p, i) => {
    if (p.cardId != null) return;
    p.cardId = byHole && p.startingHole != null ? "h" + p.startingHole : "c" + Math.floor(i / Math.max(1, size));
  });
}

export interface Standing {
  memberId: string | null;
  name: string;
  division: string | null;
  thru: number;
  total: number;
  toPar: number;
}

/** Live leaderboard: per player thru/total/to-par over played holes, sorted to-par ↑, total ↑, name. */
export function computeLeaderboard(holes: { hole: number; par: number }[], players: PlayerState[]): Standing[] {
  const parByHole = new Map(holes.map((h) => [h.hole, h.par]));
  const standings: Standing[] = players.filter((p) => !p.removed).map((p) => {
    let thru = 0;
    let total = 0;
    let toPar = 0;
    for (const [holeStr, strokes] of Object.entries(p.scores ?? {})) {
      const par = parByHole.get(Number(holeStr));
      if (par == null || strokes == null) continue;
      thru++;
      total += strokes;
      toPar += strokes - par;
    }
    return { memberId: p.memberId, name: p.name, division: p.division ?? null, thru, total, toPar };
  });
  standings.sort((a, b) => a.toPar - b.toPar || a.total - b.total || a.name.localeCompare(b.name));
  return standings;
}

export interface FinalStanding extends Standing {
  /** Competition rank for a completed round; `null` = DNF (no-show or partial round): recorded but
   *  unranked, so it never outranks a real finisher and earns no podium/league points. */
  place: number | null;
  breakdown: Breakdown;
  /** The holes this player actually scored, in layout order — persisted as the result's scorecard so
   *  a player can later open the right UDisc course and tap these in (UDisc has no import API). */
  holes: { hole: number; par: number; strokes: number }[];
}

/** Final results for an event: only players who completed every hole are ranked (ties share a place,
 *  e.g. 1,2,2,4). No-shows and partial cards are recorded as DNF (place null) and sorted to the bottom,
 *  so a registrant who never played can't sit at "even par" ahead of an over-par finisher. */
export function finalizeStandings(holes: { hole: number; par: number }[], players: PlayerState[]): FinalStanding[] {
  const holeCount = holes.length;
  const rows = players.filter((p) => !p.removed).map((p) => {
    const pars: number[] = [];
    const strokes: number[] = [];
    const played: { hole: number; par: number; strokes: number }[] = [];
    let thru = 0;
    let total = 0;
    let toPar = 0;
    for (const h of holes) {
      const s = p.scores?.[h.hole];
      if (s == null) continue;
      pars.push(h.par);
      strokes.push(s);
      played.push({ hole: h.hole, par: h.par, strokes: s });
      thru++;
      total += s;
      toPar += s - h.par;
    }
    return {
      memberId: p.memberId,
      name: p.name,
      division: p.division ?? null,
      thru,
      total,
      toPar,
      breakdown: countScores(pars, strokes),
      holes: played,
    };
  });
  const completed = (r: { thru: number }) => holeCount > 0 && r.thru === holeCount;
  const finishers = rows.filter(completed);
  const dnf = rows.filter((r) => !completed(r));
  finishers.sort((a, b) => a.toPar - b.toPar || a.total - b.total || a.name.localeCompare(b.name));
  dnf.sort((a, b) => b.thru - a.thru || a.name.localeCompare(b.name)); // most-played first; display only
  let place = 0;
  let prevKey = "";
  const ranked: FinalStanding[] = finishers.map((r, i) => {
    const key = r.toPar + "/" + r.total;
    if (key !== prevKey) { place = i + 1; prevKey = key; } // competition ranking: ties share, gaps after
    return { ...r, place };
  });
  const unranked: FinalStanding[] = dnf.map((r) => ({ ...r, place: null }));
  return [...ranked, ...unranked];
}

// ---------------- league standings ----------------
export interface LeagueStanding {
  member_id: string | null;
  name: string;
  events: number;
  wins: number;
  podiums: number;
  total_to_par: number;
  best_place: number | null;
  points: number;
}

// Season points by finishing place, for STROKE rounds (tunable).
const placePoints = (place: number | null): number =>
  place == null ? 0 : place === 1 ? 10 : place === 2 ? 7 : place === 3 ? 5 : place === 4 ? 3 : place <= 10 ? 1 : 0;

function parseOutcome(matchResult: string | null | undefined): string | null {
  if (!matchResult) return null;
  try {
    const m = JSON.parse(matchResult) as { outcome?: unknown };
    return typeof m?.outcome === "string" ? m.outcome : null;
  } catch {
    return null;
  }
}
const isWinOutcome = (o: string | null): boolean => o === "won" || o === "leading";
const isTieOutcome = (o: string | null): boolean => o === "draw";
// Matchplay points: 2 for a win, 1 for a tie, 0 for a loss.
const matchplayPoints = (o: string | null): number => (isWinOutcome(o) ? 2 : isTieOutcome(o) ? 1 : 0);

/** Aggregate a league's per-event result rows into a per-PLAYER season standings table. Matchplay rounds
 *  (a stored match_result) score 2/1/0 by outcome; stroke rounds keep place-points + cumulative to-par.
 *  Members keyed by member_id; guests grouped by name. See computeTeamStandings for the Red/Blue view. */
export function computeLeagueStandings(
  rows: { member_id: string | null; name: string; place: number | null; to_par: number | null; match_result?: string | null }[],
): LeagueStanding[] {
  const map = new Map<string, LeagueStanding>();
  for (const r of rows) {
    const key = r.member_id || "name:" + r.name;
    let s = map.get(key);
    if (!s) {
      s = { member_id: r.member_id ?? null, name: r.name, events: 0, wins: 0, podiums: 0, total_to_par: 0, best_place: null, points: 0 };
      map.set(key, s);
    }
    s.name = r.name; // keep the most recent display name
    s.events++;
    const outcome = parseOutcome(r.match_result);
    if (outcome) {
      // matchplay: points + wins come from the match outcome; to_par/podiums don't apply.
      s.points += matchplayPoints(outcome);
      if (isWinOutcome(outcome)) s.wins++;
    } else {
      if (r.place === 1) s.wins++;
      if (r.place != null && r.place <= 3) s.podiums++;
      if (r.to_par != null) s.total_to_par += r.to_par;
      s.points += placePoints(r.place);
    }
    if (r.place != null && (s.best_place == null || r.place < s.best_place)) s.best_place = r.place;
  }
  return [...map.values()].sort(
    (a, b) => b.points - a.points || b.wins - a.wins || a.total_to_par - b.total_to_par || a.name.localeCompare(b.name),
  );
}

export interface TeamStanding {
  team: string;
  teamName: string | null;
  matches: number;
  wins: number;
  ties: number;
  losses: number;
  points: number;
}

/** Team (Red vs Blue) standings for a matchplay league. Each MATCH scores 2 to the winner / 1 to each side
 *  on a tie / 0 to the loser, counted ONCE per (event, team) — so a doubles match's several result rows per
 *  team count as one team result. Rows lacking a team scoring_group + match outcome (stroke rounds) are
 *  ignored. Returns [] when the league has no matchplay team rounds. */
export function computeTeamStandings(
  rows: { event_id?: number | null; scoring_group?: string | null; match_result?: string | null }[],
): TeamStanding[] {
  const seen = new Set<string>();
  const map = new Map<string, TeamStanding>();
  for (const r of rows) {
    const outcome = parseOutcome(r.match_result);
    if (!outcome || !r.scoring_group) continue;
    let group: { label?: unknown; teamName?: unknown } | null = null;
    try {
      group = JSON.parse(r.scoring_group);
    } catch {
      group = null;
    }
    const team = typeof group?.label === "string" ? group.label : null;
    if (!team) continue;
    const dedup = String(r.event_id ?? "") + "|" + team;
    if (seen.has(dedup)) continue; // count each match once per team
    seen.add(dedup);
    let t = map.get(team);
    if (!t) {
      t = { team, teamName: typeof group?.teamName === "string" ? group.teamName : null, matches: 0, wins: 0, ties: 0, losses: 0, points: 0 };
      map.set(team, t);
    }
    if (typeof group?.teamName === "string") t.teamName = group.teamName;
    t.matches++;
    if (isWinOutcome(outcome)) {
      t.wins++;
      t.points += 2;
    } else if (isTieOutcome(outcome)) {
      t.ties++;
      t.points += 1;
    } else {
      t.losses++;
    }
  }
  return [...map.values()].sort((a, b) => b.points - a.points || b.wins - a.wins || a.team.localeCompare(b.team));
}

function teamSide(label: unknown): "red" | "blue" | null {
  const t = String(label ?? "").toLowerCase();
  return t.includes("red") ? "red" : t.includes("blue") ? "blue" : null;
}

/** Which side won each matchplay round: event_id -> "red" | "blue" | "tie". Used to tint the rounds list on
 *  the league standings page. A draw outcome on any row makes the round a tie. */
export function computeRoundWinners(
  rows: { event_id?: number | null; scoring_group?: string | null; match_result?: string | null }[],
): Record<number, "red" | "blue" | "tie"> {
  const out: Record<number, "red" | "blue" | "tie"> = {};
  for (const r of rows) {
    const outcome = parseOutcome(r.match_result);
    if (!outcome || r.event_id == null) continue;
    if (isTieOutcome(outcome)) {
      out[r.event_id] = "tie";
      continue;
    }
    if (out[r.event_id] === "tie") continue; // a recorded tie wins over stragglers
    if (!isWinOutcome(outcome) || !r.scoring_group) continue;
    let label: unknown = null;
    try {
      label = (JSON.parse(r.scoring_group) as { label?: unknown }).label;
    } catch {
      label = null;
    }
    const side = teamSide(label);
    if (side) out[r.event_id] = side;
  }
  return out;
}
