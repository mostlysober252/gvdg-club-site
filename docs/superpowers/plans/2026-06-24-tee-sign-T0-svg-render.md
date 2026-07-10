# Tee-Sign T0 — Multi-layout, color-aware SVG render — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `tee-sign.js` — a pure, DOM-free function that renders a disc-golf tee-sign graphic (hole number + a row per layout with par, distance, and a color swatch) as an XSS-safe SVG string — plus a standalone preview page to live-verify it.

**Architecture:** Mirror the existing `events.js` pattern exactly: pure, DOM-free, ESM-exported helpers tested headless under `node --test`; the host page handles insertion + theming. `tee-sign.js` returns an SVG **string** in which every dynamic value is XML-escaped and every color is sanitized against an allowlist, so it is safe to inject and trivially unit-testable. Hosts insert the returned string via `DOMParser` (inert `image/svg+xml` parse), never `innerHTML` — matching the codebase's no-`innerHTML` rule; T4 reuses the same insertion pattern. No backend, no network, no dependency on the `0008` migration — this slice is self-contained and renders from data the system will populate in T1+.

**Tech Stack:** Vanilla ES modules, `node --test` + `node:assert/strict` (the repo's frontend test harness), SVG, CSS custom properties for light/dark theming (`var(--text-primary)` etc., `[data-theme="dark"]`).

**Scope note:** T0 delivers the component + tests + a standalone `tee-sign-preview.html` (the live-verify artifact, works with sample data today). Wiring the graphic into event detail / the live scorecard is **T4** (render-in-scoring), where real layout data and the merged live-scoring surface exist.

---

## Setup (once, before Task 1)

This work happens in the isolated worktree `/home/kg/gvdg-wt-teesign` (branch `feat/tee-sign-capture`). Set the commit identity once so plain `git commit` works:

```bash
cd /home/kg/gvdg-wt-teesign
git config user.name "Your Name"
git config user.email "you@example.com"
```

## File Structure

- Create: `tee-sign.js` — pure renderer. Public API: `escapeXml`, `sanitizeColor`, `teeSignModel`, `teeSignSvg`.
- Create: `tests/tee-sign.test.mjs` — `node --test` unit tests (escaping, color allowlist, clamping, SVG output, injection).
- Create: `tee-sign-preview.html` — standalone page rendering sample multi-layout signs with a light/dark toggle (live-verify).

All three are root-level static files, consistent with `events.js` / `ryder-cup.js` / `tests/events.parse.test.mjs`.

---

## Task 1: Escaping + color sanitizer (the security boundary)

**Files:**
- Create: `tee-sign.js`
- Test: `tests/tee-sign.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/tee-sign.test.mjs`:

```js
// node --test tests/tee-sign.test.mjs   (from repo root)
// Pure unit tests for the tee-sign SVG renderer — no DOM, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { escapeXml, sanitizeColor } from '../tee-sign.js';

test('escapeXml escapes the five XML metacharacters', () => {
  assert.equal(escapeXml(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  assert.equal(escapeXml(null), '');
  assert.equal(escapeXml(42), '42');
});

test('sanitizeColor accepts known names and #hex, rejects everything else', () => {
  assert.equal(sanitizeColor('Blue'), 'blue');   // case-insensitive
  assert.equal(sanitizeColor('  red '), 'red');  // trimmed
  assert.equal(sanitizeColor('#0a0'), '#0a0');
  assert.equal(sanitizeColor('#00AAFF'), '#00aaff');
  assert.equal(sanitizeColor('red; fill:url(#x)'), null);   // CSS injection
  assert.equal(sanitizeColor('expression(alert(1))'), null);
  assert.equal(sanitizeColor('#1234'), null);    // 4-digit hex not allowed
  assert.equal(sanitizeColor(null), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/tee-sign.test.mjs`
Expected: FAIL — `Cannot find module '../tee-sign.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `tee-sign.js`:

```js
// tee-sign.js — pure, DOM-free renderer for a disc-golf "tee sign" graphic.
// No DOM, no network: returns an SVG *string* with every dynamic value XML-escaped
// and every color sanitized, so it is safe to inject and runnable under node --test.
// Mirrors events.js: pure helpers here; the host page handles insertion + theming.
//
// Public API: escapeXml, sanitizeColor, teeSignModel, teeSignSvg.

// Disc-golf tee/target colors allowed as-is (lowercased). Anything outside this set
// OR a #RGB / #RRGGBB hex is dropped (no swatch) — prevents CSS/markup injection.
const NAMED_COLORS = new Set([
  'blue', 'white', 'red', 'gold', 'yellow', 'green', 'black', 'silver', 'gray',
  'grey', 'orange', 'purple', 'pink', 'brown', 'teal', 'navy',
]);

export function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Return a safe CSS color (a known name or #hex) or null. Never returns
// attacker-controlled text — the SVG only ever receives a vetted value.
export function sanitizeColor(raw) {
  if (raw == null) return null;
  const c = String(raw).trim().toLowerCase();
  if (NAMED_COLORS.has(c)) return c;
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(c)) return c;
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/tee-sign.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add tee-sign.js tests/tee-sign.test.mjs
git commit -m "feat(tee-sign): XML escaper + color allowlist sanitizer"
```

---

## Task 2: `teeSignModel` — normalize + clamp raw inputs

**Files:**
- Modify: `tee-sign.js`
- Test: `tests/tee-sign.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `tests/tee-sign.test.mjs`:

```js
import { teeSignModel } from '../tee-sign.js';

test('teeSignModel clamps par/distance, sanitizes color, coerces strings', () => {
  const m = teeSignModel({
    hole: '7',
    courseName: 'Battle Park',
    layouts: [
      { label: 'Long', color: 'Blue', par: '4', distance_ft: '420', distance_source: 'geo' },
      { label: 'Short', color: 'bogus', par: 99, distance_ft: 5 },
    ],
  });
  assert.equal(m.hole, 7);
  assert.equal(m.courseName, 'Battle Park');
  assert.deepEqual(m.layouts[0], {
    label: 'Long', color: 'blue', par: 4, distance_ft: 420, distance_source: 'geo',
  });
  assert.equal(m.layouts[1].color, null);        // bogus name dropped
  assert.equal(m.layouts[1].par, null);          // 99 out of [1,10]
  assert.equal(m.layouts[1].distance_ft, null);  // 5 below [20,2000]
});

test('teeSignModel is null-safe and defaults empty', () => {
  const m = teeSignModel(null);
  assert.equal(m.hole, null);
  assert.equal(m.courseName, '');
  assert.deepEqual(m.layouts, []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/tee-sign.test.mjs`
Expected: FAIL — `teeSignModel` is not a function / not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `tee-sign.js`:

```js
function clampInt(value, min, max) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

// Normalize raw inputs into a vetted model: ints clamped, colors sanitized,
// strings coerced. This is the pure logic the unit tests pin down.
export function teeSignModel(input) {
  const src = input && typeof input === 'object' ? input : {};
  const layoutsIn = Array.isArray(src.layouts) ? src.layouts : [];
  const layouts = layoutsIn.map((l) => {
    const row = l && typeof l === 'object' ? l : {};
    return {
      label: row.label != null ? String(row.label) : '',
      color: sanitizeColor(row.color),
      par: clampInt(row.par, 1, 10),
      distance_ft: clampInt(row.distance_ft, 20, 2000),
      distance_source: row.distance_source != null ? String(row.distance_source) : null,
    };
  });
  return {
    hole: clampInt(src.hole, 1, 99),
    courseName: src.courseName != null ? String(src.courseName) : '',
    layouts,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/tee-sign.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add tee-sign.js tests/tee-sign.test.mjs
git commit -m "feat(tee-sign): teeSignModel normalizer (clamp + sanitize)"
```

---

## Task 3: `teeSignSvg` — build the escaped SVG string

**Files:**
- Modify: `tee-sign.js`
- Test: `tests/tee-sign.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `tests/tee-sign.test.mjs`:

```js
import { teeSignSvg } from '../tee-sign.js';

test('teeSignSvg renders a row per layout with hole, par, distance, swatch', () => {
  const svg = teeSignSvg({
    hole: 5,
    courseName: 'Battle Park',
    layouts: [
      { label: 'Long', color: 'blue', par: 4, distance_ft: 420 },
      { label: 'Short', par: 3, distance_ft: 280 },
    ],
  });
  assert.match(svg, /^<svg[\s\S]*<\/svg>$/);
  assert.ok(svg.includes('>5<'));            // hole number
  assert.ok(svg.includes('Battle Park'));
  assert.ok(svg.includes('Long'));
  assert.ok(svg.includes('Short'));
  assert.ok(svg.includes('Par 4'));
  assert.ok(svg.includes('420 ft'));
  assert.ok(svg.includes('fill="blue"'));    // sanitized swatch present
});

test('teeSignSvg renders a placeholder hole and no swatch when data is missing', () => {
  const svg = teeSignSvg({ hole: null, courseName: '', layouts: [{ label: 'Main', par: null, distance_ft: null }] });
  assert.ok(svg.includes('>—<'));            // em-dash hole placeholder
  assert.ok(svg.includes('Par –'));          // en-dash par placeholder
  assert.ok(!svg.includes('<rect x="16" y'));// no color swatch rect for the row
});

test('teeSignSvg escapes injection attempts in every dynamic field', () => {
  const svg = teeSignSvg({
    hole: 1,
    courseName: '</text><script>alert(1)</script>',
    layouts: [{ label: '"><rect onload=alert(1)>', color: 'red"/><script>', par: 3, distance_ft: 200 }],
  });
  assert.ok(!svg.includes('<script>'));
  assert.ok(!svg.includes('onload=alert'));
  assert.ok(svg.includes('&lt;script&gt;'));
  assert.ok(!svg.includes('red"/>'));        // bogus color dropped, never hits a fill attr
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/tee-sign.test.mjs`
Expected: FAIL — `teeSignSvg` is not a function / not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `tee-sign.js`:

```js
// Build the SVG string from raw or pre-normalized input. Always re-normalizes,
// so callers can never bypass the escaping/sanitizing. Colors are emitted only
// after sanitizeColor; all text is escapeXml'd. Themed via CSS classes the host
// page styles (currentColor inherits the page text color for light/dark).
export function teeSignSvg(input) {
  const m = teeSignModel(input);
  const W = 320;
  const rowH = 30;
  const headH = 96;
  const H = headH + Math.max(1, m.layouts.length) * rowH + 16;
  const holeText = m.hole == null ? '—' : String(m.hole); // em dash when unknown

  const rows = m.layouts.map((l, i) => {
    const y = headH + i * rowH;
    const swatch = l.color
      ? `<rect x="16" y="${y + 6}" width="16" height="16" rx="3" fill="${escapeXml(l.color)}" stroke="currentColor" stroke-opacity="0.3"/>`
      : '';
    const labelX = l.color ? 40 : 16;
    const par = l.par == null ? '–' : String(l.par);       // en dash when unknown
    const dist = l.distance_ft == null ? '' : `${l.distance_ft} ft`;
    return `<g class="tee-sign-row">${swatch}` +
      `<text x="${labelX}" y="${y + 19}" class="tee-sign-label">${escapeXml(l.label)}</text>` +
      `<text x="${W - 96}" y="${y + 19}" text-anchor="end" class="tee-sign-par">Par ${escapeXml(par)}</text>` +
      `<text x="${W - 16}" y="${y + 19}" text-anchor="end" class="tee-sign-dist">${escapeXml(dist)}</text>` +
      `</g>`;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" ` +
    `class="tee-sign" role="img" aria-label="Tee sign for hole ${escapeXml(holeText)}">` +
    `<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="16" class="tee-sign-bg"/>` +
    `<text x="16" y="58" class="tee-sign-hole">${escapeXml(holeText)}</text>` +
    `<text x="${W - 16}" y="40" text-anchor="end" class="tee-sign-course">${escapeXml(m.courseName)}</text>` +
    `<line x1="16" y1="${headH - 14}" x2="${W - 16}" y2="${headH - 14}" class="tee-sign-rule"/>` +
    `${rows}</svg>`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/tee-sign.test.mjs`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add tee-sign.js tests/tee-sign.test.mjs
git commit -m "feat(tee-sign): teeSignSvg — escaped multi-layout SVG string"
```

---

## Task 4: Standalone preview page (live-verify artifact)

**Files:**
- Create: `tee-sign-preview.html`

- [ ] **Step 1: Create the preview page**

Create `tee-sign-preview.html`:

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Tee-sign preview · GVDG</title>
<style>
  :root { --bg-primary:#f4f7fb; --text-primary:#0b2239; --tee-sign-bg:#fffdf5; --tee-sign-border:#0b2239; }
  [data-theme="dark"] { --bg-primary:#0b1622; --text-primary:#e8eef6; --tee-sign-bg:#13202e; --tee-sign-border:#9fc1e0; }
  body { background: var(--bg-primary); color: var(--text-primary); font-family: system-ui, sans-serif; margin: 0; padding: 2rem; }
  .grid { display: flex; flex-wrap: wrap; gap: 1.5rem; align-items: flex-start; }
  /* tee-sign component styles (the host page owns theming) */
  .tee-sign { color: var(--text-primary); }
  .tee-sign-bg { fill: var(--tee-sign-bg); stroke: var(--tee-sign-border); stroke-opacity: 0.5; }
  .tee-sign-hole { font: 700 44px 'Bebas Neue', system-ui, sans-serif; fill: currentColor; }
  .tee-sign-course { font: 600 14px system-ui, sans-serif; fill: currentColor; opacity: 0.7; }
  .tee-sign-rule { stroke: currentColor; stroke-opacity: 0.2; }
  .tee-sign-label { font: 600 14px system-ui, sans-serif; fill: currentColor; }
  .tee-sign-par { font: 600 14px system-ui, sans-serif; fill: currentColor; }
  .tee-sign-dist { font: 600 14px system-ui, sans-serif; fill: currentColor; opacity: 0.8; }
  button { margin-bottom: 1.5rem; padding: 0.5rem 1rem; border-radius: 8px; cursor: pointer; }
</style>
</head>
<body>
<button id="toggle">Toggle dark</button>
<div class="grid" id="grid"></div>
<script type="module">
  import { teeSignSvg } from './tee-sign.js';
  const samples = [
    { hole: 1, courseName: 'Battle Park', layouts: [
      { label: 'Long', color: 'blue', par: 4, distance_ft: 420 },
      { label: 'Short', color: 'white', par: 3, distance_ft: 285 },
    ]},
    { hole: 7, courseName: 'West Meadowbrook', layouts: [
      { label: 'Gold', color: 'gold', par: 5, distance_ft: 615 },
      { label: 'Blue', color: 'blue', par: 4, distance_ft: 480 },
      { label: 'Red', color: 'red', par: 3, distance_ft: 300 },
    ]},
    { hole: 12, courseName: 'No data yet', layouts: [{ label: 'Main', par: null, distance_ft: null }] },
  ];
  const grid = document.getElementById('grid');
  for (const s of samples) {
    const wrap = document.createElement('div');
    // Insert via DOMParser (image/svg+xml parses inert — no script execution), NOT innerHTML,
    // matching the codebase's no-innerHTML rule. teeSignSvg already escapes every value.
    const svgDoc = new DOMParser().parseFromString(teeSignSvg(s), 'image/svg+xml');
    wrap.appendChild(svgDoc.documentElement);
    grid.appendChild(wrap);
  }
  document.getElementById('toggle').addEventListener('click', () => {
    const root = document.documentElement;
    root.setAttribute('data-theme', root.getAttribute('data-theme') === 'dark' ? '' : 'dark');
  });
</script>
</body>
</html>
```

- [ ] **Step 2: Live-verify in a real browser (per CLAUDE.md — not optional)**

Serve the worktree and open the preview:

```bash
cd /home/kg/gvdg-wt-teesign
python3 -m http.server 8090 >/tmp/teesign-preview.log 2>&1 &
# then drive http://localhost:8090/tee-sign-preview.html in a browser
```

Confirm in the running page:
- Three signs render: a 2-layout, a 3-layout, and the "no data" placeholder (em-dash hole, "Par –").
- Color swatches show blue/white/gold/red next to the right rows.
- Toggling dark mode reflows colors via the CSS vars (text + background invert; swatches stay their color).
- Browser console: 0 errors.
- (Optional) In DevTools console, run `document.body.innerHTML.includes('<script>')` after rendering a hostile sample — confirm escaping holds in the live DOM.

Stop the server when done: `kill %1` (or by PID from `ss -ltnp | grep :8090`).

- [ ] **Step 3: Commit**

```bash
git add tee-sign-preview.html
git commit -m "feat(tee-sign): standalone multi-layout preview page"
```

---

## Definition of done (T0)

- `node --test tests/tee-sign.test.mjs` → all 7 tests pass.
- `tee-sign-preview.html` live-verified in a real browser: multi-layout signs render, swatches correct, light+dark both clean, 0 console errors, injection escaped.
- 4 commits on `feat/tee-sign-capture`.
- **Then:** run `/simplify` → `/code-review` → `/security-review` on the diff before opening the T0 PR (per the standing per-slice workflow). Next slice: **T1 — storage + upload backbone** (its own plan).
