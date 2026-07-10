// Best-effort import of disc-golf layouts from a UDisc course page.
//
// UDisc is a React Router v7 app: the course/layout data is NOT in the HTML as plain JSON. It ships
// as a turbo-stream payload inside `window.__reactRouterContext.streamController.enqueue("…")` — one
// big flat "pool" array where every object is `{ "_<keyIndex>": <valueIndex> }` and strings are
// interned (so "par"/"distance"/"latitude" appear once and are referenced by index). We rebuild the
// object graph (unflatten), then walk it for layout objects (`{name, layoutId, holes:[…]}`) whose
// holes carry `par` + tee/target GPS. Everything degrades to name-only if the shape ever changes.

export interface CourseCandidate {
  name: string | null;
  udisc_url: string;
  udisc_course_id: string | null;
  holes: { hole: number; par: number }[] | null;
  note: string;
}

export interface UdiscPosition {
  kind: "tee" | "target";
  label: string;
  lat: number | null;
  lng: number | null;
}

export interface UdiscHole {
  hole: number;
  par: number;
  tee: { label: string; lat: number | null; lng: number | null } | null;
  target: { label: string; lat: number | null; lng: number | null } | null;
}

export interface UdiscLayout {
  name: string | null;
  udisc_url: string;
  udisc_course_id: string | null;
  holes: UdiscHole[];
  positions: UdiscPosition[];
  note: string;
}

/** UDisc's internal numeric course id, scraped from the page's "start a round" deep link
 *  (e.g. .../applink/create-scorecard/12345). Needed to build the Add-to-UDisc applink — the slug in
 *  udisc_url can't. Best-effort over the raw payload; returns null if the page doesn't expose it. */
export function courseIdFromHtml(html: string): string | null {
  const m = html.match(/create-scorecard\/(\d+)/);
  return m ? m[1]! : null;
}

export function parseUdiscCourse(html: string, url: string): CourseCandidate {
  const name = titleFromHtml(html) || null;
  return {
    name,
    udisc_url: url,
    udisc_course_id: courseIdFromHtml(html),
    holes: null,
    note: "Imported from UDisc (best-effort): name only. Enter the hole pars manually to enable scoring.",
  };
}

// The title/og:title live in <head>; bound the regex input to it (capped) so a multi-MB or hostile
// body can't turn these scans into a slow polynomial walk over the whole payload.
function headSection(html: string): string {
  const end = html.search(/<\/head>/i);
  return end >= 0 ? html.slice(0, end) : html.slice(0, 50_000);
}

function titleFromHtml(html: string): string {
  const head = headSection(html);
  const og = head.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  const title = head.match(/<title>([^<]+)<\/title>/i);
  let name = (og?.[1] ?? title?.[1] ?? "").trim();
  name = name.replace(/&middot;/gi, "·").replace(/&amp;/gi, "&");
  // UDisc titles look like "West Meadowbrook Park - Greenville, NC | UDisc …" — keep the course name.
  return name.replace(/\s*[·|\-–]\s*(Greenville|.*UDisc).*$/i, "").trim() || name.split(/\s*[|·]\s*/)[0]!.trim();
}

function asCoord(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// A tee/target position object exposes latitude/longitude (UDisc) — tolerate lat/lng/lon aliases too.
function coordOf(obj: unknown): { lat: number | null; lng: number | null } | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  const lat = asCoord(o.latitude) ?? asCoord(o.lat);
  const lng = asCoord(o.longitude) ?? asCoord(o.lng) ?? asCoord(o.lon);
  if (lat == null && lng == null) return null;
  return { lat, lng };
}

// --- turbo-stream decode (React Router v7 single-fetch payload) ---

// Collect and concatenate every enqueued chunk into one flat value pool. Each chunk is a JSON string
// (so double-encoded: the captured group is a JSON string literal whose contents are a JSON array).
function turboStreamValues(html: string): unknown[] {
  const chunks: unknown[][] = [];
  for (const m of html.matchAll(/streamController\.enqueue\((\"(?:[^"\\]|\\.)*\")\)/g)) {
    try {
      const inner = JSON.parse(m[1]!) as string;
      const arr = JSON.parse(inner) as unknown;
      if (Array.isArray(arr)) chunks.push(arr);
    } catch {
      /* skip a malformed chunk */
    }
  }
  return chunks.flat();
}

// Resolve the flat pool into a real object graph. Indices reference other entries; an object's keys
// are themselves index references (`"_<idx>"`). Memoized + cycle-safe (the container is cached before
// its children are filled). Negative indices are turbo-stream sentinels — mapped to null (NaN for -3).
const MAX_HYDRATE_DEPTH = 1000; // backstop: real UDisc graphs are shallow; degrade rather than blow the stack

function unflatten(values: unknown[]): unknown {
  const cache = new Array<unknown>(values.length);
  const done = new Array<boolean>(values.length).fill(false);

  function hyd(i: unknown, depth: number): unknown {
    if (typeof i !== "number") return undefined;
    if (i < 0) return i === -3 ? NaN : null;
    if (i >= values.length) return null;
    if (done[i]) return cache[i];
    if (depth > MAX_HYDRATE_DEPTH) return null; // explicit cap on a pathological reference chain

    const v = values[i];
    if (v === null || typeof v !== "object") {
      done[i] = true;
      cache[i] = v;
      return v;
    }
    if (Array.isArray(v)) {
      // A leading string is a type tag (e.g. ["D", ms] = Date); otherwise it is an array of refs.
      if (typeof v[0] === "string") {
        done[i] = true;
        cache[i] = v[0] === "D" ? new Date(v[1] as number) : v;
        return cache[i];
      }
      const arr: unknown[] = [];
      done[i] = true;
      cache[i] = arr;
      for (const el of v) arr.push(hyd(el, depth + 1));
      return arr;
    }
    const obj: Record<string, unknown> = {};
    done[i] = true;
    cache[i] = obj;
    for (const k of Object.keys(v as Record<string, unknown>)) {
      const keyName = k[0] === "_" ? hyd(parseInt(k.slice(1), 10), depth + 1) : k;
      obj[String(keyName)] = hyd((v as Record<string, unknown>)[k], depth + 1);
    }
    return obj;
  }
  return hyd(0, 0);
}

function isLayout(o: unknown): o is { name?: unknown; layoutId?: unknown; holes: unknown[] } {
  if (!o || typeof o !== "object") return false;
  const holes = (o as { holes?: unknown }).holes;
  return Array.isArray(holes) && holes.length > 0 && holes.some((h) => h && typeof h === "object" && typeof (h as { par?: unknown }).par === "number");
}

// Walk the graph for every distinct layout object. Cycle-safe via `seen`; depth-capped as a backstop.
function collectLayouts(root: unknown): { name?: unknown; layoutId?: unknown; holes: unknown[] }[] {
  const out: { name?: unknown; layoutId?: unknown; holes: unknown[] }[] = [];
  const seen = new Set<unknown>();
  function walk(n: unknown, depth: number): void {
    if (!n || typeof n !== "object" || depth > 60 || seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) {
      for (const x of n) walk(x, depth + 1);
      return;
    }
    if (isLayout(n)) out.push(n);
    for (const v of Object.values(n as Record<string, unknown>)) walk(v, depth + 1);
  }
  walk(root, 0);
  return out;
}

function layoutToUdisc(layout: { name?: unknown; holes: unknown[] }, url: string): UdiscLayout {
  const positions: UdiscPosition[] = [];
  const holes: UdiscHole[] = layout.holes.map((raw, i) => {
    const h = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const parsedNum = parseInt(String(h.name ?? ""), 10);
    const hole = Number.isFinite(parsedNum) ? parsedNum : i + 1;
    const par = typeof h.par === "number" ? h.par : 3;
    const teeC = coordOf(h.teePosition) ?? coordOf(h.teePad);
    const tgtC = coordOf(h.targetPosition) ?? coordOf(h.basket);
    const tee = teeC ? { label: `Hole ${hole} tee`, lat: teeC.lat, lng: teeC.lng } : null;
    const target = tgtC ? { label: `Hole ${hole} basket`, lat: tgtC.lat, lng: tgtC.lng } : null;
    if (tee) positions.push({ kind: "tee", ...tee });
    if (target) positions.push({ kind: "target", ...target });
    return { hole, par, tee, target };
  });
  const name = typeof layout.name === "string" && layout.name.trim() ? layout.name.trim() : null;
  return {
    name,
    udisc_url: url,
    udisc_course_id: null, // course-level; stamped by parseUdiscLayouts from the page
    holes,
    positions,
    note: `Imported ${holes.length} holes from UDisc layout "${name ?? "?"}". Review pars and distances before scoring.`,
  };
}

// Parse ALL scorable layouts from a UDisc course page (deduped by UDisc layout id, in page order).
export function parseUdiscLayouts(html: string, url: string): { name: string | null; udisc_course_id: string | null; layouts: UdiscLayout[] } {
  const name = titleFromHtml(html) || null;
  const udisc_course_id = courseIdFromHtml(html);
  let root: unknown;
  try {
    const values = turboStreamValues(html);
    if (!values.length) return { name, udisc_course_id, layouts: [] };
    root = unflatten(values);
  } catch {
    return { name, udisc_course_id, layouts: [] };
  }

  const seenIds = new Set<unknown>();
  const layouts: UdiscLayout[] = [];
  for (const raw of collectLayouts(root)) {
    if (raw.layoutId != null) {
      if (seenIds.has(raw.layoutId)) continue;
      seenIds.add(raw.layoutId);
    }
    const ul = layoutToUdisc(raw, url);
    if (ul.holes.length) layouts.push({ ...ul, udisc_course_id }); // stamp the course-level id onto each layout
  }
  return { name, udisc_course_id, layouts };
}

// Single-layout convenience used by callers/tests that want one candidate: the first layout, or a
// name-only degrade when nothing scorable was found.
export function parseUdiscLayout(html: string, url: string): UdiscLayout {
  const { name, udisc_course_id, layouts } = parseUdiscLayouts(html, url);
  return (
    layouts[0] ?? {
      name,
      udisc_url: url,
      udisc_course_id,
      holes: [],
      positions: [],
      note: "Imported from UDisc (best-effort): name only — enter hole pars manually to enable scoring.",
    }
  );
}
