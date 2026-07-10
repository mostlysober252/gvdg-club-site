const NAMED_COLORS = new Set([
  "blue", "white", "red", "gold", "yellow", "green", "black", "silver", "gray",
  "grey", "orange", "purple", "pink", "brown", "teal", "navy",
]);

export function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function sanitizeColor(raw) {
  if (raw == null) return null;
  const color = String(raw).trim().toLowerCase();
  if (NAMED_COLORS.has(color)) return color;
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(color)) return color;
  return null;
}

function clampInt(value, min, max) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number) || number < min || number > max) return null;
  return number;
}

export function teeSignModel(input) {
  const src = input && typeof input === "object" ? input : {};
  const layoutsIn = Array.isArray(src.layouts) ? src.layouts : [];
  const layouts = layoutsIn.map((layout) => {
    const row = layout && typeof layout === "object" ? layout : {};
    return {
      label: row.label != null ? String(row.label) : "",
      color: sanitizeColor(row.color),
      par: clampInt(row.par, 1, 15),
      distance_ft: clampInt(row.distance_ft, 20, 2000),
    };
  });
  return {
    hole: clampInt(src.hole, 1, 99),
    courseName: src.courseName != null ? String(src.courseName) : "",
    layouts,
  };
}

export function teeSignSvg(input) {
  const model = teeSignModel(input);
  const width = 320;
  const rowHeight = 30;
  const headerHeight = 96;
  const height = headerHeight + Math.max(1, model.layouts.length) * rowHeight + 16;
  const holeText = model.hole == null ? "\u2014" : String(model.hole);

  const rows = model.layouts.map((layout, index) => {
    const y = headerHeight + index * rowHeight;
    const swatch = layout.color
      ? `<rect x="16" y="${y + 6}" width="16" height="16" rx="3" fill="${escapeXml(layout.color)}" stroke="currentColor" stroke-opacity="0.3"/>`
      : "";
    const labelX = layout.color ? 40 : 16;
    const par = layout.par == null ? "\u2013" : String(layout.par);
    const distance = layout.distance_ft == null ? "" : `${layout.distance_ft} ft`;
    return `<g class="tee-sign-row">${swatch}` +
      `<text x="${labelX}" y="${y + 19}" class="tee-sign-label">${escapeXml(layout.label)}</text>` +
      `<text x="${width - 96}" y="${y + 19}" text-anchor="end" class="tee-sign-par">Par ${escapeXml(par)}</text>` +
      `<text x="${width - 16}" y="${y + 19}" text-anchor="end" class="tee-sign-dist">${escapeXml(distance)}</text>` +
      "</g>";
  }).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" ` +
    `class="tee-sign" role="img" aria-label="Tee sign for hole ${escapeXml(holeText)}">` +
    `<rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="16" class="tee-sign-bg"/>` +
    `<text x="16" y="58" class="tee-sign-hole">${escapeXml(holeText)}</text>` +
    `<text x="${width - 16}" y="40" text-anchor="end" class="tee-sign-course">${escapeXml(model.courseName)}</text>` +
    `<line x1="16" y1="${headerHeight - 14}" x2="${width - 16}" y2="${headerHeight - 14}" class="tee-sign-rule"/>` +
    `${rows}</svg>`;
}
