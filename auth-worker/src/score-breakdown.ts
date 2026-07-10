export interface Breakdown {
  aces: number;
  eagles: number;
  birdies: number;
  pars: number;
  bogeys: number;
  doubles_plus: number;
}

export function countScores(pars: readonly (number | null | undefined)[], strokes: readonly (number | null | undefined)[]): Breakdown {
  const b: Breakdown = { aces: 0, eagles: 0, birdies: 0, pars: 0, bogeys: 0, doubles_plus: 0 };
  const n = Math.min(pars.length, strokes.length);
  for (let i = 0; i < n; i++) {
    const par = pars[i];
    const s = strokes[i];
    if (s == null || par == null) continue;
    if (s === 1) b.aces++;
    const d = s - par;
    if (d <= -2) b.eagles++;
    else if (d === -1) b.birdies++;
    else if (d === 0) b.pars++;
    else if (d === 1) b.bogeys++;
    else b.doubles_plus++;
  }
  return b;
}
