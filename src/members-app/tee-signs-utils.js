export const HOLE_OPTIONS = Array.from({ length: 24 }, (_, index) => index + 1);
export const TS_MAX_DATA_URL = 4_100_000;

export function teeSignStatusMeta(status) {
  if (status === "official") return { className: "official", label: "Official" };
  if (status === "rejected") return { className: "rejected", label: "Not used" };
  return { className: "candidate", label: "Pending review" };
}

export function teeSignChipText(layout) {
  const source = layout && typeof layout === "object" ? layout : {};
  const label = source.label ? String(source.label) : "Layout";
  const details = [];
  if (source.par != null) details.push(`Par ${source.par}`);
  if (source.distance_ft != null) details.push(`${source.distance_ft} ft`);
  if (source.color) details.push(String(source.color));
  return details.length ? `${label} - ${details.join(" | ")}` : label;
}

export function teeSignLayouts(row) {
  try {
    const extracted = row?.extracted_json ? JSON.parse(row.extracted_json) : null;
    return extracted && Array.isArray(extracted.layouts) ? extracted.layouts : [];
  } catch {
    return [];
  }
}

export function teeSignWhen(value) {
  const source = String(value || "");
  if (!source) return "";
  try {
    const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/.test(source) ? source : `${source.replace(" ", "T")}Z`;
    const date = new Date(normalized);
    if (!Number.isNaN(date.getTime())) {
      return `${date.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "America/New_York" })}, ${date.toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
        timeZone: "America/New_York",
        timeZoneName: "short",
      })}`;
    }
  } catch {
    return source;
  }
  return source;
}

export function resizeImageFile(file, maxSide = 1024) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve(null);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => resolve(null);
      img.onload = () => {
        const longest = Math.max(img.width, img.height) || 1;
        const scale = Math.min(1, maxSide / longest);
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.86));
      };
      img.src = String(reader.result || "");
    };
    reader.readAsDataURL(file);
  });
}
