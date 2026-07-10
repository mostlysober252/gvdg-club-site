const PAR_FT = { 2: 120, 3: 250, 4: 400, 5: 600, 6: 800 };

export function objectOrEmpty(value) {
  return value && typeof value === "object" ? value : {};
}

export function normalizeText(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function finiteNumber(value) {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : null;
}

export function parseNumber(value) {
  const num = parseFloat(String(value ?? ""));
  return Number.isFinite(num) ? num : null;
}

export function normalizeCourse(course) {
  const source = objectOrEmpty(course);
  const id = source.id == null ? "" : String(source.id);
  const name = normalizeText(source.name, id ? `Course #${id}` : "Course");
  const location = normalizeText(source.location);
  return { id, label: location ? `${name} - ${location}` : name, source };
}

export function normalizePosition(position, index = 0) {
  const source = objectOrEmpty(position);
  const kind = source.kind === "target" ? "target" : "tee";
  const id = source.id == null ? "" : String(source.id);
  const label = normalizeText(source.label, id ? `${kind} ${id}` : `${kind} ${index + 1}`);
  return {
    id,
    kind,
    label,
    lat: finiteNumber(source.lat),
    lng: finiteNumber(source.lng),
    source,
  };
}

function verifiedOf(hole) {
  const source = objectOrEmpty(hole);
  if (source.verified && typeof source.verified === "object") return source.verified;
  if (source.distance_source === "tee_sign" && source.tee_sign_key) {
    return { par: source.par, distance_ft: source.distance_ft, tee_sign_key: source.tee_sign_key };
  }
  return null;
}

function positionFromHole(value) {
  const source = objectOrEmpty(value);
  const label = normalizeText(source.label);
  if (!label) return null;
  return { label, lat: finiteNumber(source.lat), lng: finiteNumber(source.lng) };
}

export function rowFromHole(hole, index = 0) {
  const source = objectOrEmpty(hole);
  const verified = verifiedOf(source);
  return {
    key: `hole-${index}-${normalizeText(source.hole, index + 1)}`,
    manualDistance: source.manual_distance == null ? "" : String(source.manual_distance),
    par: String(verified ? verified.par : source.par ?? 3),
    target: positionFromHole(source.target),
    tee: positionFromHole(source.tee),
    verified,
  };
}

export function newHoleRow(index = 0) {
  return {
    key: `hole-new-${Date.now()}-${index}`,
    manualDistance: "",
    par: "3",
    target: null,
    tee: null,
    verified: null,
  };
}

function haversineFt(a, b) {
  const radiusMeters = 6371000;
  const rad = (degrees) => degrees * Math.PI / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * radiusMeters * Math.asin(Math.min(1, Math.sqrt(h))) * 3.28084);
}

export function estimateHole(row) {
  if (row.verified) {
    return { ft: finiteNumber(row.verified.distance_ft), source: "verified" };
  }
  const manual = parseNumber(row.manualDistance);
  if (manual != null && manual > 0) return { ft: Math.round(manual), source: "manual" };
  if (row.tee?.lat != null && row.tee?.lng != null && row.target?.lat != null && row.target?.lng != null) {
    return { ft: haversineFt(row.tee, row.target), source: "geo" };
  }
  const par = parseInt(row.par, 10) || 0;
  if (par > 0) return { ft: PAR_FT[par] ?? Math.max(250, (par - 2) * 200), source: "par" };
  return { ft: null, source: null };
}

export function parseLayoutHoles(layout) {
  const source = objectOrEmpty(layout);
  if (Array.isArray(source.holes)) return source.holes;
  try {
    const parsed = JSON.parse(normalizeText(source.holes, "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function normalizeLayout(layout, index = 0) {
  const source = objectOrEmpty(layout);
  const id = source.id == null ? "" : String(source.id);
  const holes = parseLayoutHoles(source);
  return {
    holes,
    id,
    key: id || `layout-${index}`,
    name: normalizeText(source.name, id ? `Layout #${id}` : "Layout"),
    source,
    totalPar: source.total_par == null ? null : Number(source.total_par),
  };
}

function positionPayload(position) {
  return position ? { label: position.label, lat: position.lat, lng: position.lng } : null;
}

export function layoutPayload(rows) {
  return rows.map((row, index) => ({
    hole: index + 1,
    manual_distance: parseNumber(row.manualDistance),
    par: parseInt(row.par, 10),
    target: positionPayload(row.target),
    tee: positionPayload(row.tee),
  }));
}
