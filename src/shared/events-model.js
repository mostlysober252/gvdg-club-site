// Pure, DOM-free helpers for the GVDG public events hub.
//
// No DOM, no network access here so it can run headless under `node --test`.
// These functions normalize the club Worker's REST payloads, bucket events into Live / Upcoming / Past, sort
// each bucket, group a roster by division, and format ISO dates defensively.
//
// Public API: VALID_STATUSES, VALID_TYPES, normalizeEvent, bucketEvents,
// groupPlayersByDivision, formatEventDate, typeLabel, statusLabel, courseNameFor.

export const VALID_STATUSES = ['scheduled', 'live', 'final', 'cancelled'];
export const VALID_TYPES = ['tournament', 'league_round', 'fundraiser', 'meeting'];

// Human labels for the enum values the API returns. Anything unrecognized is
// passed through verbatim (still XSS-safe — it only ever lands in textContent).
const TYPE_LABELS = {
  tournament: 'Tournament',
  league_round: 'League Round',
  fundraiser: 'Fundraiser',
  meeting: 'Meeting',
};
const STATUS_LABELS = {
  scheduled: 'Scheduled',
  live: 'Live',
  final: 'Final',
  cancelled: 'Cancelled',
};

export function typeLabel(type) {
  if (type == null) return 'Event';
  return TYPE_LABELS[type] || String(type);
}

export function statusLabel(status) {
  if (status == null) return '';
  return STATUS_LABELS[status] || String(status);
}

// Parse an event's date defensively. The API may send a full ISO timestamp, a
// bare YYYY-MM-DD, null, or junk. Returns a Date or null (never throws).
export function parseEventDate(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

// The club runs on Eastern time — show ALL wall-clock times in it regardless of the viewer's timezone.
// (America/New_York tracks EST/EDT automatically.)
export const CLUB_TIME_ZONE = 'America/New_York';

// Format a date for display. Tolerates ISO strings, Date objects and nulls.
// A bare YYYY-MM-DD is a calendar date: render it in UTC (parseEventDate made it UTC-midnight) so it never
// shifts a day backward in a behind-UTC zone — the old local render turned a July 4 event into "July 3" in
// Eastern. A full timestamp is a wall-clock instant: render it in club (Eastern) time.
export function formatEventDate(raw) {
  const d = parseEventDate(raw);
  if (!d) return 'Date TBD';
  const dateOnly = typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.trim());
  const opts = dateOnly
    ? { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }
    : { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: CLUB_TIME_ZONE, timeZoneName: 'short' };
  try {
    return d.toLocaleString([], opts);
  } catch (_e) {
    return d.toDateString();
  }
}

// Format a timestamp (ISO instant) as an Eastern-time wall clock, e.g. "Sat, Jul 4, 9:00 AM EDT".
// Used for scheduled start + registration/check-in deadlines. Returns '' for empty/invalid input.
export function formatClubDateTime(raw) {
  if (raw == null || raw === '') return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return d.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: CLUB_TIME_ZONE, timeZoneName: 'short' });
  } catch (_e) {
    return d.toISOString();
  }
}

// Normalize one raw API event into a predictable shape with safe defaults.
// Unknown status/type values are preserved (rendered verbatim) but the bucketer
// treats unknown statuses as "upcoming-ish" so nothing silently vanishes.
export function normalizeEvent(raw) {
  const ev = raw && typeof raw === 'object' ? raw : {};
  return {
    id: ev.id != null ? String(ev.id) : '',
    type: ev.type != null ? String(ev.type) : '',
    name: ev.name != null ? String(ev.name) : 'Untitled Event',
    status: ev.status != null ? String(ev.status) : 'scheduled',
    format: ev.format != null ? String(ev.format) : '',
    date: ev.date != null ? String(ev.date) : null,
    starts_at: ev.starts_at != null ? String(ev.starts_at) : null,
    registration_deadline: ev.registration_deadline != null ? String(ev.registration_deadline) : null,
    checkin_deadline: ev.checkin_deadline != null ? String(ev.checkin_deadline) : null,
    course_id: ev.course_id != null ? String(ev.course_id) : '',
    layout_id: ev.layout_id != null ? String(ev.layout_id) : '', // selected scoring layout (T4 tee-sign render)
    league_id: ev.league_id != null ? String(ev.league_id) : '',
    source: ev.source != null ? String(ev.source) : '',
    external_url: ev.external_url != null ? String(ev.external_url) : '',
    notes: ev.notes != null ? String(ev.notes) : '',
    event_courses: normalizeEventCourses(ev.event_courses),
    // Detail payloads carry a players array; hub payloads don't.
    players: Array.isArray(ev.players) ? ev.players : [],
    _date: parseEventDate(ev.date),
  };
}

export function normalizeEventCourses(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const row = item && typeof item === 'object' ? item : {};
    return {
      course_id: row.course_id != null ? String(row.course_id) : '',
      layout_id: row.layout_id != null ? String(row.layout_id) : '',
      course_name: row.course_name != null ? String(row.course_name) : '',
      course_location: row.course_location != null ? String(row.course_location) : '',
      course_udisc_url: row.course_udisc_url != null ? String(row.course_udisc_url) : '',
      course_udisc_course_id: row.course_udisc_course_id != null ? String(row.course_udisc_course_id) : '',
      layout_name: row.layout_name != null ? String(row.layout_name) : '',
      sort_order: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : 0,
      total_par: Number.isFinite(Number(row.total_par)) ? Number(row.total_par) : null,
    };
  }).filter((row) => row.course_id || row.course_name);
}

// Bucket a list of raw events into { live, upcoming, past, cancelled }.
//   - live      : status === 'live'                       (highlighted in UI)
//   - upcoming  : status === 'scheduled' (or unknown)     (soonest first)
//   - past      : status === 'final'                      (most recent first)
//   - cancelled : status === 'cancelled'                  (kept out of the way)
// Events with no parseable date sort to the end of their bucket.
export function bucketEvents(rawEvents) {
  const list = Array.isArray(rawEvents) ? rawEvents.map(normalizeEvent) : [];
  const live = [];
  const upcoming = [];
  const past = [];
  const cancelled = [];

  for (const ev of list) {
    if (ev.status === 'live') live.push(ev);
    else if (ev.status === 'final') past.push(ev);
    else if (ev.status === 'cancelled') cancelled.push(ev);
    else upcoming.push(ev); // 'scheduled' + any unrecognized status
  }

  // Soonest-first; missing dates last.
  const ascending = (a, b) => dateRank(a, +1) - dateRank(b, +1);
  // Most-recent-first; missing dates last.
  const descending = (a, b) => dateRank(b, -1) - dateRank(a, -1);

  upcoming.sort(ascending);
  live.sort(ascending);
  past.sort(descending);
  cancelled.sort(descending);

  return { live, upcoming, past, cancelled };
}

// Sort key that always pushes date-less events to the end of their bucket,
// regardless of sort direction. `dir` is +1 for ascending, -1 for descending.
function dateRank(ev, dir) {
  if (!ev._date) return dir === +1 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  return ev._date.getTime();
}

// Group an event's player roster by division, preserving first-seen order of
// both divisions and players. Players with no division fall under 'Open'.
// Returns an array of { division, players: [...] } so the caller can render
// stable, ordered sections. Non-array input yields [].
export function groupPlayersByDivision(players) {
  if (!Array.isArray(players)) return [];
  const order = [];
  const byDivision = new Map();
  for (const p of players) {
    const player = p && typeof p === 'object' ? p : {};
    const division = (player.division != null && String(player.division).trim()) || 'Open';
    if (!byDivision.has(division)) {
      byDivision.set(division, []);
      order.push(division);
    }
    byDivision.get(division).push(player);
  }
  return order.map((division) => ({ division, players: byDivision.get(division) }));
}

// Build a course_id -> course-name lookup from the /courses payload, then a
// resolver. Falls back to a friendly placeholder when the id is unknown/blank.
export function buildCourseIndex(rawCourses) {
  const index = new Map();
  if (Array.isArray(rawCourses)) {
    for (const c of rawCourses) {
      if (c && c.id != null) index.set(String(c.id), c);
    }
  }
  return index;
}

export function courseNameFor(courseIndex, courseId) {
  if (!courseId) return '';
  const course = courseIndex instanceof Map ? courseIndex.get(String(courseId)) : null;
  return course && course.name ? String(course.name) : '';
}

export function eventCourseSummary(courseIndex, event, includeLayouts = false) {
  const rows = Array.isArray(event?.event_courses) ? event.event_courses : [];
  const labels = rows.map((row) => {
    const courseName = row.course_name || courseNameFor(courseIndex, row.course_id);
    if (!courseName) return '';
    const layoutName = includeLayouts && row.layout_name ? ` (${row.layout_name})` : '';
    return `${courseName}${layoutName}`;
  }).filter(Boolean);
  if (!labels.length) return courseNameFor(courseIndex, event?.course_id);
  if (labels.length <= 2) return labels.join(' · ');
  return `${labels.slice(0, 2).join(' · ')} + ${labels.length - 2} more`;
}
