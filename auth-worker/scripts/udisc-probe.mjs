#!/usr/bin/env node
// UDisc import probe — fetch a REAL UDisc course page and report the layouts the importer can extract.
//
// UDisc (React Router v7) ships course data as a turbo-stream pool inside
// `window.__reactRouterContext.streamController.enqueue("…")`. This mirrors the worker decoder
// (src/imports/udisc.ts): unflatten the pool, then list every layout with its per-hole pars and the
// first hole's tee/target coordinates. Use it to confirm the importer still tracks UDisc's markup.
//
// Run from a machine with normal internet (udisc.com must be reachable). Node 18+:
//   node auth-worker/scripts/udisc-probe.mjs https://udisc.com/courses/west-meadowbrook-park-40Aw
// Paste the printed JSON back into the chat. It contains only public course data.

const url = process.argv[2] || "https://udisc.com/courses/west-meadowbrook-park-40Aw";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function turboStreamValues(html) {
  const chunks = [];
  for (const m of html.matchAll(/streamController\.enqueue\((\"(?:[^"\\]|\\.)*\")\)/g)) {
    try {
      const arr = JSON.parse(JSON.parse(m[1]));
      if (Array.isArray(arr)) chunks.push(arr);
    } catch {
      /* skip */
    }
  }
  return chunks.flat();
}

function unflatten(values) {
  const cache = new Array(values.length);
  const done = new Array(values.length).fill(false);
  function hyd(i) {
    if (typeof i !== "number") return undefined;
    if (i < 0) return i === -3 ? NaN : null;
    if (i >= values.length) return null;
    if (done[i]) return cache[i];
    const v = values[i];
    if (v === null || typeof v !== "object") {
      done[i] = true;
      cache[i] = v;
      return v;
    }
    if (Array.isArray(v)) {
      if (typeof v[0] === "string") {
        done[i] = true;
        cache[i] = v[0] === "D" ? new Date(v[1]) : v;
        return cache[i];
      }
      const arr = [];
      done[i] = true;
      cache[i] = arr;
      for (const el of v) arr.push(hyd(el));
      return arr;
    }
    const obj = {};
    done[i] = true;
    cache[i] = obj;
    for (const k of Object.keys(v)) {
      const kn = k[0] === "_" ? hyd(parseInt(k.slice(1), 10)) : k;
      obj[String(kn)] = hyd(v[k]);
    }
    return obj;
  }
  return hyd(0);
}

function collectLayouts(root) {
  const out = [];
  const seen = new Set();
  (function walk(n, d) {
    if (!n || typeof n !== "object" || d > 60 || seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) {
      for (const x of n) walk(x, d + 1);
      return;
    }
    if (Array.isArray(n.holes) && n.holes.some((h) => h && typeof h === "object" && typeof h.par === "number")) out.push(n);
    for (const v of Object.values(n)) walk(v, d + 1);
  })(root, 0);
  return out;
}

const coord = (p) => {
  if (!p || typeof p !== "object") return null;
  const la = p.latitude ?? p.lat;
  const ln = p.longitude ?? p.lng;
  return typeof la === "number" && typeof ln === "number" ? { lat: la, lng: ln } : null;
};

const res = await fetch(url, {
  headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
});
const html = await res.text();
const values = turboStreamValues(html);
let layouts = [];
try {
  layouts = collectLayouts(unflatten(values));
} catch (e) {
  layouts = [];
}
const seenIds = new Set();
const summary = layouts
  .filter((l) => (l.layoutId == null ? true : !seenIds.has(l.layoutId) && seenIds.add(l.layoutId)))
  .map((l) => ({
    name: l.name,
    layoutId: l.layoutId,
    holeCount: l.holes.length,
    pars: l.holes.map((h) => h && h.par),
    firstHole: l.holes[0]
      ? { name: l.holes[0].name, par: l.holes[0].par, tee: coord(l.holes[0].teePosition), target: coord(l.holes[0].targetPosition) }
      : null,
  }));

console.log(
  JSON.stringify(
    { url, status: res.status, bytes: html.length, valueCount: values.length, layoutCount: summary.length, layouts: summary },
    null,
    2,
  ),
);
