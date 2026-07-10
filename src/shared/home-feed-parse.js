export function parseCsvLine(line) {
  const values = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      values.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  values.push(current.trim());
  return values;
}

export function parseTournamentCsv(csv) {
  const lines = String(csv || '').trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const tournaments = [];
  for (let i = 1; i < lines.length; i++) {
    const v = parseCsvLine(lines[i]);
    if (v.length >= 2 && v[1]) {
      tournaments.push({ date: v[0] || '', name: v[1] || '', location: v[2] || '', tier: v[3] || '', url: v[4] || '' });
    }
  }
  return tournaments;
}

export function parseTournamentDate(raw, now = new Date()) {
  if (!raw) return null;
  const match = String(raw).match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),?\s*(\d{4})?/i);
  if (!match) return null;
  return { month: match[1].substring(0, 3), day: parseInt(match[2], 10), year: match[3] || now.getFullYear() };
}

export function parseHomepageEventCsv(csv) {
  const lines = String(csv || '').trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase().trim());
  const events = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    const event = {};
    headers.forEach((h, j) => {
      event[h] = values[j] ? values[j].trim() : '';
    });
    if (String(event.active).toUpperCase() !== 'FALSE' && event.title && event.date) events.push(event);
  }
  return events;
}

// Club-business items (meetings, minutes, fundraisers, socials) belong under "Club Events", not the
// homepage "Events" list — which is for disc golf tournaments & league rounds. Mirrors the worker's
// classifier in auth-worker/src/feeds.ts so Crotts and the site agree on the split.
const CLUB_EVENT_RE = /\b(meeting|minutes|agenda|fundrais|donat|social|banquet|cleanup|clean-up|volunteer|board|election|membership drive|potluck|holiday party)\b/i;
export function isClubEvent(event) {
  return CLUB_EVENT_RE.test((((event && event.title) || '') + ' ' + ((event && event.description) || '')));
}

export function parseHomepageEventDate(raw, now = new Date()) {
  if (!raw || typeof raw !== 'string') return tbdDate();
  const s = raw.trim();
  if (!s || s.toUpperCase() === 'TBD') return tbdDate();
  const monthsShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthIndex = {
    jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4, jun: 5, june: 5,
    jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9,
    nov: 10, november: 10, dec: 11, december: 11,
  };
  let date = null;
  let match = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (match) date = new Date(+match[1], +match[2] - 1, +match[3]);
  if (!date) {
    match = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
    if (match) {
      let y = +match[3];
      if (y < 100) y += y < 50 ? 2000 : 1900;
      date = new Date(y, +match[1] - 1, +match[2]);
    }
  }
  if (!date) {
    match = s.match(/^(\d{1,2})[/-](\d{1,2})$/);
    if (match) {
      const year = now.getFullYear();
      const month = +match[1] - 1;
      const day = +match[2];
      let candidate = new Date(year, month, day);
      const sixtyAgo = new Date(now);
      sixtyAgo.setDate(sixtyAgo.getDate() - 60);
      if (candidate < sixtyAgo) candidate = new Date(year + 1, month, day);
      date = candidate;
    }
  }
  if (!date) {
    match = s.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
    if (match) {
      const mi = monthIndex[match[1].toLowerCase()];
      if (mi !== undefined) date = new Date(+match[3], mi, +match[2]);
    }
  }
  if (!date) {
    match = s.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
    if (match) {
      const mi = monthIndex[match[2].toLowerCase()];
      if (mi !== undefined) date = new Date(+match[3], mi, +match[1]);
    }
  }
  if (!date && /^\d+(\.\d+)?$/.test(s)) {
    const n = parseFloat(s);
    if (n > 1 && n < 100000) date = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
  }
  if (!date || Number.isNaN(date.getTime())) {
    const fallback = new Date(s);
    if (!Number.isNaN(fallback.getTime())) date = fallback;
  }
  if (!date || Number.isNaN(date.getTime())) return tbdDate();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return { day: date.getDate(), month: monthsShort[date.getMonth()], year: date.getFullYear(), isPast: date < today, isTBD: false, dateObj: date };
}

function tbdDate() {
  return { day: 'TBD', month: '', year: '', isPast: false, isTBD: true, dateObj: new Date(9999, 11, 31) };
}
