// Pure assignment helpers for event customization (Track G G3). Randomness is injected by the caller
// (pre-shuffle the players) so these stay deterministic + unit-testable.

/** Shotgun start: place players into groups of `groupSize` and assign each group a hole (wrapping). */
export function assignShotgun(players: string[], holes: number[], groupSize = 4): { player: string; hole: number | null }[] {
  if (!holes.length) return players.map((p) => ({ player: p, hole: null }));
  const size = Math.max(1, groupSize);
  return players.map((p, i) => ({ player: p, hole: holes[Math.floor(i / size) % holes.length]! }));
}

/** Card assignment: split players into sequential cards of `size` (default 4) → "Card 1", "Card 2", …
 *  Randomness is injected by the caller (pre-shuffle), so this stays deterministic + unit-testable. */
export function assignCards(players: string[], size = 4): { player: string; card: string }[] {
  const n = Math.max(1, size);
  return players.map((p, i) => ({ player: p, card: "Card " + (Math.floor(i / n) + 1) }));
}

/** Team assignment: fixed-size teams (opts.size, e.g. doubles=2) or round-robin into opts.count teams. */
export function assignTeams(players: string[], opts: { size?: number; count?: number }): { player: string; team: string }[] {
  if (opts.size && opts.size > 0) {
    return players.map((p, i) => ({ player: p, team: "Team " + (Math.floor(i / opts.size!) + 1) }));
  }
  const count = Math.max(2, opts.count || 2);
  return players.map((p, i) => ({ player: p, team: "Team " + ((i % count) + 1) }));
}
