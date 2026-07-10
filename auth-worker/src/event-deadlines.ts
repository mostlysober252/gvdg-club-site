// A deadline is "passed" only when it is set AND parses to a time at/*before* now. An empty/unset deadline
// never closes anything, so events with no cutoff behave exactly as before this feature.
export function deadlinePassed(raw: string | null | undefined, nowMs = Date.now()): boolean {
  const text = String(raw ?? "").trim();
  if (!text) return false;
  const time = Date.parse(text);
  return Number.isFinite(time) && time <= nowMs;
}
