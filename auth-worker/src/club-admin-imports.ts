import type { Env } from "./env.js";
import { safeFetch, normalizeDgs, normalizeCsvEvents, parseCsvRows, parseUdiscLayouts, ImportError } from "./imports.js";
import { json, readJson } from "./http.js";
import { asStr } from "./input.js";

const DEFAULT_DGS_FEED = "https://raw.githubusercontent.com/mostlysober252/GVDG-DGS-Scraper-2.0/main/tournaments.json";
const IMPORT_BODY_BYTES = 600_000;

export async function handleAdminImport(request: Request, env: Env, origin: string | null): Promise<Response> {
  const kind = new URL(request.url).pathname.split("/").filter(Boolean)[2];
  const b = (await readJson(request, IMPORT_BODY_BYTES)) ?? {};
  try {
    if (kind === "dgs") {
      const url = asStr(b.feedUrl, 500) ?? DEFAULT_DGS_FEED;
      const text = await safeFetch(url, ["raw.githubusercontent.com", "discgolfscene.com"]);
      let feed: unknown;
      try { feed = JSON.parse(text); } catch { return json({ error: "import_parse_failed" }, 422, origin); }
      return json({ source: "dgs", candidates: normalizeDgs(feed) }, 200, origin);
    }
    if (kind === "csv") {
      let csvText = typeof b.csv === "string" ? b.csv : null;
      if (csvText && csvText.length > 500_000) return json({ error: "csv_too_large" }, 413, origin);
      if (!csvText && typeof b.url === "string") csvText = await safeFetch(b.url, ["docs.google.com"]);
      if (!csvText) return json({ error: "invalid_request" }, 400, origin);
      return json({ source: "csv", candidates: normalizeCsvEvents(parseCsvRows(csvText)) }, 200, origin);
    }
    if (kind === "udisc") {
      const url = asStr(b.url, 500);
      if (!url) return json({ error: "invalid_request" }, 400, origin);
      // UDisc ships its data as a large turbo-stream payload — allow more than the 1 MB default.
      const html = await safeFetch(url, ["udisc.com"], { maxBytes: 3_000_000 });
      const { name, udisc_course_id, layouts } = parseUdiscLayouts(html, url);
      // `candidate` keeps the old single-layout shape working; `layouts` exposes all of them.
      // `udisc_course_id` (course-level) lets the admin save it on the course to enable "Add to UDisc".
      return json({ source: "udisc", name, udisc_course_id, layouts, candidate: layouts[0] ?? null }, 200, origin);
    }
    return json({ error: "not_found" }, 404, origin);
  } catch (e) {
    if (e instanceof ImportError) return json({ error: "import_failed", reason: e.message }, 400, origin);
    throw e;
  }
}
