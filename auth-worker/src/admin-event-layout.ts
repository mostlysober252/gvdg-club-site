import { asInt, asStr, sanitizeHoles } from "./input.js";
import { enrichHoles, type LayoutHole } from "./layouts.js";

export function inlineLayout(raw: unknown): { name: string; holes: LayoutHole[]; total_par: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const body = raw as Record<string, unknown>;
  const name = asStr(body.name, 60) ?? "Main";
  if (Array.isArray(body.holes)) {
    const clean = sanitizeHoles(body.holes);
    if (!clean || clean.length === 0 || clean.length > 36) return null;
    return { name, ...enrichHoles(clean) };
  }
  const holeCount = asInt(body.hole_count ?? body.holeCount);
  const defaultPar = asInt(body.default_par ?? body.defaultPar ?? body.par);
  if (holeCount == null || holeCount < 1 || holeCount > 36 || defaultPar == null || defaultPar < 1 || defaultPar > 15) return null;
  const holes = Array.from({ length: holeCount }, (_, index): LayoutHole => ({ hole: index + 1, par: defaultPar }));
  return { name, ...enrichHoles(holes) };
}
