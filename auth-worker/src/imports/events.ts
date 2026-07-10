export interface EventCandidate {
  type: string;
  source: string;
  name: string;
  date: string | null;
  format: string | null;
  external_url: string | null;
  venue?: string | null;
  city?: string | null;
  tier?: string | null;
}

const EVENT_TYPES = new Set(["tournament", "league_round", "fundraiser", "meeting"]);

export function normalizeDgs(feed: unknown): EventCandidate[] {
  const arr: unknown[] = Array.isArray(feed)
    ? feed
    : feed && typeof feed === "object" && Array.isArray((feed as Record<string, unknown>).tournaments)
      ? ((feed as Record<string, unknown>).tournaments as unknown[])
      : [];
  return arr
    .filter((t): t is Record<string, unknown> => !!t && typeof t === "object" && typeof (t as Record<string, unknown>).name === "string" && String((t as Record<string, unknown>).name).trim() !== "")
    .map((t) => ({
      type: "tournament",
      source: "dgs",
      name: String(t.name).trim(),
      date: t.date ? String(t.date) : null,
      format: null,
      external_url: typeof t.url === "string" ? t.url : null,
      venue: t.venue != null ? String(t.venue) : null,
      city: t.city != null ? String(t.city) : null,
      tier: t.tier != null ? String(t.tier) : null,
    }));
}

export function normalizeCsvEvents(rows: Record<string, string>[]): EventCandidate[] {
  return rows
    .filter((r) => (r.name ?? "").trim() !== "")
    .map((r) => {
      const t = (r.type ?? "").trim();
      return {
        type: EVENT_TYPES.has(t) ? t : "tournament",
        source: "csv",
        name: (r.name ?? "").trim(),
        date: (r.date ?? "").trim() || null,
        format: (r.format ?? "").trim() || null,
        external_url: (r.url ?? "").trim() || null,
      };
    });
}
