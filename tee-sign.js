// tee-sign.js — pure, DOM-free renderer for a disc-golf "tee sign" graphic.
// No DOM, no network: returns an SVG *string* with every dynamic value XML-escaped
// and every color sanitized, so it is safe to inject and runnable under node --test.
// Mirrors events.js: pure helpers here; the host page handles insertion + theming.
//
// Public API: escapeXml, sanitizeColor, teeSignModel, teeSignSvg.

// Disc-golf tee/target colors allowed as-is (lowercased). A value that is neither a
// known color name NOR a #RGB / #RRGGBB hex is dropped (no swatch) — blocks CSS/markup injection.
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
