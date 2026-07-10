// Distance estimation for course layouts (incl. SAFARI holes) — pure, unit-testable.
// Precedence: a VERIFIED tee-sign distance wins (admin-confirmed from a real sign photo); else an
// admin's manual override; else a geodesic distance between the tee pad and target when both have
// GPS coords; else a par-based heuristic; else unknown.

export interface LatLng {
  lat?: number | null;
  lng?: number | null;
}

export type DistanceSource = "tee_sign" | "manual" | "geo" | "par_estimate";

export interface DistanceResult {
  distance_ft: number | null;
  source: DistanceSource | null;
}

const FEET_PER_METER = 3.28084;
const EARTH_RADIUS_M = 6371000;

/** Great-circle distance between two coordinates, in feet. */
export function haversineFeet(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  const meters = 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
  return Math.round(meters * FEET_PER_METER);
}

// Typical GVDG-area distances by par; admins override anything that looks off.
const PAR_FEET: Record<number, number> = { 2: 120, 3: 250, 4: 400, 5: 600, 6: 800 };

/** Rough straight-line distance to expect for a hole of the given par, in feet. */
export function parEstimateFeet(par: number): number {
  return PAR_FEET[par] ?? Math.max(250, (par - 2) * 200);
}

function hasCoords(p?: LatLng | null): p is { lat: number; lng: number } {
  return !!p && typeof p.lat === "number" && typeof p.lng === "number";
}

/** Best-estimate distance for a (possibly custom/safari) hole — see precedence above. */
export function estimateDistance(opts: {
  verified?: number | null;
  manual?: number | null;
  tee?: LatLng | null;
  target?: LatLng | null;
  par?: number | null;
}): DistanceResult {
  if (typeof opts.verified === "number" && opts.verified > 0) {
    return { distance_ft: Math.round(opts.verified), source: "tee_sign" };
  }
  if (typeof opts.manual === "number" && opts.manual > 0) {
    return { distance_ft: Math.round(opts.manual), source: "manual" };
  }
  if (hasCoords(opts.tee) && hasCoords(opts.target)) {
    return { distance_ft: haversineFeet(opts.tee, opts.target), source: "geo" };
  }
  if (typeof opts.par === "number" && opts.par > 0) {
    return { distance_ft: parEstimateFeet(opts.par), source: "par_estimate" };
  }
  return { distance_ft: null, source: null };
}
