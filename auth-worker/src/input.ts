import * as db from "./db.js";
import { EVENT_FORMATS, EVENT_STATUSES, EVENT_TYPES } from "./db.js";
import type { LayoutHole } from "./layouts.js";

export interface WindowQuery {
  readonly limit: number | null;
  readonly offset: number;
}

export interface ParseWindowOptions {
  readonly defaultLimit?: number | null;
  readonly defaultOffset?: number;
  readonly maxLimit?: number;
  readonly limitParam?: string;
  readonly offsetParam?: string;
}

export const RECORD_PAGE_DEFAULTS = {
  events: { defaultLimit: 500, maxLimit: 4000 },
  memberResults: { defaultLimit: 250, maxLimit: 4000 },
  memberRatings: { defaultLimit: 250, maxLimit: 2000 },
} as const;

export function parseWindow(
  p: URLSearchParams,
  defaults: { limit?: number | null; offset?: number } = {},
  opts: ParseWindowOptions = {},
): WindowQuery {
  const limitParam = opts.limitParam ?? "limit";
  const offsetParam = opts.offsetParam ?? "offset";
  const maxLimit = opts.maxLimit;
  const rawLimit = p.get(limitParam);
  const rawOffset = p.get(offsetParam);

  const defaultLimit = defaults.limit ?? opts.defaultLimit ?? null;
  const defaultOffset = defaults.offset ?? opts.defaultOffset ?? 0;

  const limitParsed = rawLimit == null ? defaultLimit : parseWindowNumber(rawLimit, defaultLimit);
  const offsetParsed = rawOffset == null ? defaultOffset : parseWindowOffset(rawOffset, defaultOffset);

  if (limitParsed == null) {
    return { limit: null, offset: offsetParsed };
  }

  return {
    limit: maxLimit == null ? limitParsed : Math.min(limitParsed, maxLimit),
    offset: offsetParsed,
  };
}

function parseWindowNumber(raw: string, fallback: number | null): number | null {
  if (!/^\d+$/.test(raw.trim())) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isSafeInteger(n) && n >= 0 ? n : fallback;
}

function parseWindowOffset(raw: string, fallback: number): number {
  if (!/^\d+$/.test(raw.trim())) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isSafeInteger(n) && n >= 0 ? n : fallback;
}

export function asInt(v: unknown): number | null {
  if (typeof v === "number" && Number.isInteger(v) && v >= 0) return v;
  if (typeof v === "string" && /^\d+$/.test(v.trim())) return parseInt(v, 10);
  return null;
}

export function asStr(v: unknown, max = 500): string | null {
  return typeof v === "string" && v.trim().length > 0 && v.length <= max ? v.trim() : null;
}

// Normalize a client timestamp to an ISO string. null/"" -> null (clear); a valid instant -> its ISO form;
// anything unparseable OR a zone-less "YYYY-MM-DDTHH:MM" (the Worker runs UTC and would misread it) ->
// undefined, which callers treat as "invalid input" (reject) vs null ("explicitly cleared").
export function asIsoTimestamp(v: unknown): string | null | undefined {
  if (v == null || v === "") return null;
  const text = asStr(v, 80);
  if (!text) return undefined;
  if (/T\d/.test(text) && !/(Z|[+-]\d\d:?\d\d)$/.test(text)) return undefined;
  const time = Date.parse(text);
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

export function asNum(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export const inSet = (arr: readonly string[], v: unknown): v is string => typeof v === "string" && arr.includes(v);
export const isUniqueViolation = (e: unknown): boolean => /UNIQUE constraint failed/i.test(String(e));

export const jsonStringArray = (v: unknown, max: number): string | null =>
  Array.isArray(v) ? JSON.stringify(v.filter((x) => typeof x === "string").slice(0, max)) : null;

const validLat = (n: number | null): number | null => (n != null && n >= -90 && n <= 90 ? n : null);
const validLng = (n: number | null): number | null => (n != null && n >= -180 && n <= 180 ? n : null);
const hasField = (body: Record<string, unknown>, field: string): boolean => Object.prototype.hasOwnProperty.call(body, field);

export function cleanPosition(raw: unknown): { label: string; lat: number | null; lng: number | null } | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const label = asStr(o.label, 80);
  if (!label) return null;
  return { label, lat: validLat(asNum(o.lat)), lng: validLng(asNum(o.lng)) };
}

export function sanitizeHoles(raw: unknown[]): LayoutHole[] | null {
  const out: LayoutHole[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") return null;
    const o = r as Record<string, unknown>;
    const hole = asInt(o.hole);
    const par = asInt(o.par);
    if (hole == null || par == null || par < 1 || par > 15) return null;
    const md = asNum(o.manual_distance);
    out.push({
      hole,
      par,
      tee: cleanPosition(o.tee),
      target: cleanPosition(o.target),
      manual_distance: md != null && md > 0 ? md : null,
    });
  }
  return out;
}

export function validEventCoursesInput(raw: unknown): db.EventCourseInput[] | null {
  if (raw == null) return [];
  if (!Array.isArray(raw) || raw.length > 20) return null;
  const out: db.EventCourseInput[] = [];
  for (const [index, item] of raw.entries()) {
    if (!item || typeof item !== "object") return null;
    const source = item as Record<string, unknown>;
    const courseId = source.course_id == null || source.course_id === "" ? null : asInt(source.course_id);
    if (courseId == null) return null;
    const rawLayoutId = source.layout_id;
    const layoutId = rawLayoutId == null || rawLayoutId === "" ? null : asInt(rawLayoutId);
    if (layoutId == null && rawLayoutId != null && rawLayoutId !== "") return null;
    const rawLabel = source.label;
    const label = rawLabel == null || rawLabel === "" ? null : asStr(rawLabel, 120);
    if (label == null && rawLabel != null && rawLabel !== "") return null;
    const rawSort = source.sort_order;
    const sortOrder = rawSort == null || rawSort === "" ? index : asInt(rawSort);
    if (sortOrder == null) return null;
    out.push({ course_id: courseId, layout_id: layoutId, label, sort_order: sortOrder });
  }
  return out;
}

export function validEventInput(b: Record<string, unknown>): db.EventInput | null {
  const name = asStr(b.name, 200);
  if (!inSet(EVENT_TYPES, b.type) || !name) return null;
  const status = b.status == null ? "scheduled" : b.status;
  if (!inSet(EVENT_STATUSES, status)) return null;
  let format: string | null = null;
  if (b.format != null && b.format !== "") {
    if (!inSet(EVENT_FORMATS, b.format)) return null;
    format = b.format;
  }
  const source = b.source == null ? "manual" : b.source;
  if (!inSet(["manual", "dgs", "csv", "udisc"], source)) return null;
  const ext = b.external_url == null ? null : asStr(b.external_url, 1000);
  if (b.external_url != null && (!ext || !/^https?:\/\//.test(ext))) return null;
  const startsAt = asIsoTimestamp(b.starts_at ?? b.start_time);
  const registrationDeadline = asIsoTimestamp(b.registration_deadline);
  const checkinDeadline = asIsoTimestamp(b.checkin_deadline);
  if (startsAt === undefined || registrationDeadline === undefined || checkinDeadline === undefined) return null;
  const input: db.EventInput = {
    type: b.type as string,
    name,
    status,
    format,
    date: b.date == null ? null : asStr(b.date, 40),
    course_id: b.course_id == null ? null : asInt(b.course_id),
    layout_id: b.layout_id == null ? null : asInt(b.layout_id),
    league_id: b.league_id == null ? null : asInt(b.league_id),
    source,
    external_url: ext,
    notes: b.notes == null ? null : asStr(b.notes, 5000),
    starts_at: startsAt,
    registration_deadline: registrationDeadline,
    checkin_deadline: checkinDeadline,
  };
  if (hasField(b, "event_courses")) {
    const eventCourses = validEventCoursesInput(b.event_courses);
    if (!eventCourses) return null;
    input.event_courses = eventCourses;
    input.course_id = eventCourses[0]?.course_id ?? null;
    input.layout_id = eventCourses[0]?.layout_id ?? null;
  }
  return input;
}
