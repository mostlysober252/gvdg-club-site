// Pure layout helpers — enrich each hole with a best-estimate distance and sum total par.
// Holes embed their chosen tee/target (label + optional coords); the SAFARI editor (L3) picks
// those from the course's position pool (course_positions), so a hole may link ANY tee to ANY
// target. Distance precedence is delegated to estimateDistance (tee_sign > manual > geo > par > none).

import { estimateDistance, type DistanceSource, type LatLng } from "./distance.js";

/** A tee-sign-confirmed (verified) par/distance for a hole. Set only via the tee-sign approve flow;
 *  authoritative and STICKY — a layout edit / re-enrichment never recomputes it away. */
export interface VerifiedHole {
  par: number;
  distance_ft: number | null;
  tee_sign_key: string;
  tee_sign_id?: number | null;
}

export interface LayoutHole {
  hole: number;
  par: number;
  tee?: ({ label?: string | null } & LatLng) | null;
  target?: ({ label?: string | null } & LatLng) | null;
  manual_distance?: number | null;
  verified?: VerifiedHole | null;
  distance_ft?: number | null;
  distance_source?: DistanceSource | null;
}

export interface EnrichedLayout {
  holes: LayoutHole[];
  total_par: number;
}

/** A verified record from a hole, tolerating legacy rows that only have flat tee_sign fields
 *  (distance_source==='tee_sign' from before the `verified` object existed). Exported so the layout
 *  PATCH path can re-attach verified from the stored row (clients can never supply/forge it). */
export function verifiedOf(h: LayoutHole): VerifiedHole | null {
  if (h.verified && typeof h.verified.par === "number") return h.verified;
  if (h.distance_source === "tee_sign" && (h as { tee_sign_key?: string }).tee_sign_key) {
    const legacy = h as { tee_sign_key?: string; tee_sign_id?: number | null };
    return { par: Number(h.par) || 0, distance_ft: h.distance_ft ?? null, tee_sign_key: legacy.tee_sign_key!, tee_sign_id: legacy.tee_sign_id ?? null };
  }
  return null;
}

/** Recompute each hole's effective par/distance_ft/distance_source and the layout's total par.
 *  Idempotent and STICKY: a hole with a verified (tee-sign) record always resolves to the verified
 *  par + distance (source 'tee_sign'); otherwise manual_distance > geo > par_estimate is used. */
export function enrichHoles(holes: LayoutHole[]): EnrichedLayout {
  let total_par = 0;
  const out = (holes ?? []).map((h) => {
    const verified = verifiedOf(h);
    const par = verified ? Number(verified.par) || 0 : Number(h.par) || 0;
    total_par += par;
    const { distance_ft, source } = estimateDistance({
      verified: verified ? verified.distance_ft : null,
      manual: h.manual_distance ?? null,
      tee: h.tee,
      target: h.target,
      par,
    });
    return { ...h, par, verified: verified ?? null, distance_ft, distance_source: source };
  });
  return { holes: out, total_par };
}
