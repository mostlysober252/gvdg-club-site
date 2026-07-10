// Plain Node test for the events hub pure helpers. Run with:
//   node --test tests/events.parse.test.mjs
// (from the repo root). No network, no DOM — exercises normalize/bucket/group
// and the defensive date formatter against inline fixtures.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import {
  VALID_STATUSES,
  VALID_TYPES,
  normalizeEvent,
  bucketEvents,
  groupPlayersByDivision,
  parseEventDate,
  formatEventDate,
  formatClubDateTime,
  typeLabel,
  statusLabel,
  buildCourseIndex,
  courseNameFor,
  eventCourseSummary,
} from '../src/shared/events-model.js';

// --- normalizeEvent -----------------------------------------------------------
test('normalizeEvent fills safe defaults for a sparse object', () => {
  const ev = normalizeEvent({ id: 7 });
  assert.equal(ev.id, '7'); // coerced to string
  assert.equal(ev.name, 'Untitled Event');
  assert.equal(ev.status, 'scheduled'); // default
  assert.equal(ev.date, null);
  assert.deepEqual(ev.players, []);
});

test('normalizeEvent is null-safe', () => {
  const ev = normalizeEvent(null);
  assert.equal(ev.name, 'Untitled Event');
  assert.equal(ev.notes, '');
  assert.deepEqual(ev.players, []);
  assert.equal(ev.layout_id, ''); // T4: layout_id default is the empty string
});

test('normalizeEvent passes through the selected layout_id as a string (T4 tee-sign render)', () => {
  assert.equal(normalizeEvent({ id: 1, layout_id: 99 }).layout_id, '99');
  assert.equal(normalizeEvent({ id: 1 }).layout_id, '');
});

test('normalizeEvent preserves ordered event course/layout assignments', () => {
  const ev = normalizeEvent({
    id: 1,
    course_id: 7,
    event_courses: [
      { course_id: 7, layout_id: 44, course_name: 'West Meadowbrook', layout_name: 'Gold', sort_order: 0 },
      { course_id: 8, layout_id: 45, course_name: 'ECU', layout_name: 'Short', sort_order: 1 },
    ],
  });
  assert.deepEqual(ev.event_courses.map((row) => [row.course_id, row.layout_id, row.course_name, row.layout_name]), [
    ['7', '44', 'West Meadowbrook', 'Gold'],
    ['8', '45', 'ECU', 'Short'],
  ]);
});

test('normalizeEvent preserves an unknown status verbatim', () => {
  const ev = normalizeEvent({ id: 1, status: 'postponed' });
  assert.equal(ev.status, 'postponed');
});

// --- enum labels --------------------------------------------------------------
test('typeLabel / statusLabel map known enums and pass unknowns through', () => {
  assert.equal(typeLabel('league_round'), 'League Round');
  assert.equal(typeLabel('tournament'), 'Tournament');
  assert.equal(typeLabel('something_new'), 'something_new');
  assert.equal(typeLabel(null), 'Event');
  assert.equal(statusLabel('live'), 'Live');
  assert.equal(statusLabel('final'), 'Final');
  assert.equal(statusLabel(null), '');
  // Every documented enum has a label.
  for (const t of VALID_TYPES) assert.notEqual(typeLabel(t), undefined);
  for (const s of VALID_STATUSES) assert.notEqual(statusLabel(s), undefined);
});

// --- date handling ------------------------------------------------------------
test('parseEventDate tolerates ISO, date-only, null and junk', () => {
  assert.ok(parseEventDate('2026-07-04') instanceof Date);
  assert.ok(parseEventDate('2026-07-04T17:30:00Z') instanceof Date);
  assert.equal(parseEventDate(null), null);
  assert.equal(parseEventDate(''), null);
  assert.equal(parseEventDate('not a date'), null);
});

test('formatEventDate never throws and labels missing dates', () => {
  assert.equal(formatEventDate(null), 'Date TBD');
  assert.equal(formatEventDate('garbage'), 'Date TBD');
  const out = formatEventDate('2026-07-04');
  assert.equal(typeof out, 'string');
  assert.ok(out.length > 0);
  // Date-only renders without a time component.
  assert.ok(!/\d:\d\d/.test(out), `expected no time in "${out}"`);
  // Off-by-one guard: a bare calendar date must NOT shift back a day in a behind-UTC zone (was showing
  // "Jul 3" for a July 4 event in Eastern). Zone-independent because date-only renders in UTC.
  assert.ok(/Jul 4/.test(out) && !/Jul 3/.test(out), `expected "Jul 4" (no shift) in "${out}"`);
});

test('formatClubDateTime renders a timestamp in Eastern time', () => {
  assert.equal(formatClubDateTime(''), '');
  assert.equal(formatClubDateTime(null), '');
  // 2026-07-04T12:00Z == 8:00 AM EDT — must show the Eastern wall clock regardless of the runner's TZ.
  const out = formatClubDateTime('2026-07-04T12:00:00.000Z');
  assert.ok(/Jul 4/.test(out), `expected Jul 4 in "${out}"`);
  assert.ok(/8:00/.test(out) && /EDT/.test(out), `expected 8:00 AM EDT in "${out}"`);
});

// --- bucketEvents -------------------------------------------------------------
const SAMPLE = [
  { id: 'a', name: 'Live Now', status: 'live', date: '2026-06-23' },
  { id: 'b', name: 'Soon', status: 'scheduled', date: '2026-07-10' },
  { id: 'c', name: 'Sooner', status: 'scheduled', date: '2026-06-30' },
  { id: 'd', name: 'No Date', status: 'scheduled', date: null },
  { id: 'e', name: 'Older Final', status: 'final', date: '2026-01-01' },
  { id: 'f', name: 'Recent Final', status: 'final', date: '2026-05-01' },
  { id: 'g', name: 'Called Off', status: 'cancelled', date: '2026-04-01' },
  { id: 'h', name: 'Weird', status: 'mystery', date: '2026-08-01' },
];

test('bucketEvents splits by status (unknown status -> upcoming)', () => {
  const { live, upcoming, past, cancelled } = bucketEvents(SAMPLE);
  assert.deepEqual(live.map((e) => e.id), ['a']);
  assert.deepEqual(past.map((e) => e.id), ['f', 'e']); // most recent first
  assert.deepEqual(cancelled.map((e) => e.id), ['g']);
  // upcoming = scheduled + unknown status, soonest first, date-less last.
  assert.deepEqual(upcoming.map((e) => e.id), ['c', 'b', 'h', 'd']);
});

test('bucketEvents is empty-safe', () => {
  const out = bucketEvents(null);
  assert.deepEqual(out, { live: [], upcoming: [], past: [], cancelled: [] });
});

// --- groupPlayersByDivision ---------------------------------------------------
test('groupPlayersByDivision preserves first-seen order; null division -> Open', () => {
  const players = [
    { id: 1, name: 'MA1 player', division: 'MA1' },
    { id: 2, name: 'MPO player', division: 'MPO' },
    { id: 3, name: 'second MA1', division: 'MA1' },
    { id: 4, name: 'no division' },
  ];
  const grouped = groupPlayersByDivision(players);
  assert.deepEqual(grouped.map((g) => g.division), ['MA1', 'MPO', 'Open']);
  assert.equal(grouped[0].players.length, 2);
  assert.equal(grouped[2].players[0].name, 'no division');
});

test('groupPlayersByDivision is array-safe', () => {
  assert.deepEqual(groupPlayersByDivision(undefined), []);
  assert.deepEqual(groupPlayersByDivision([]), []);
});

// --- course index -------------------------------------------------------------
test('courseNameFor resolves ids and falls back gracefully', () => {
  const index = buildCourseIndex([
    { id: 1, name: 'River Park North' },
    { id: 2, name: 'Bradford Creek' },
  ]);
  assert.equal(courseNameFor(index, 1), 'River Park North');
  assert.equal(courseNameFor(index, '2'), 'Bradford Creek');
  assert.equal(courseNameFor(index, 99), ''); // unknown id -> blank
  assert.equal(courseNameFor(index, null), ''); // no course on event
});

test('eventCourseSummary summarizes multiple courses and layouts', () => {
  const index = buildCourseIndex([{ id: 1, name: 'River Park North' }]);
  const event = normalizeEvent({
    course_id: 1,
    event_courses: [
      { course_id: 1, layout_name: 'Gold' },
      { course_id: 2, course_name: 'Bradford Creek', layout_name: 'Short' },
      { course_id: 3, course_name: 'ECU', layout_name: 'Long' },
    ],
  });
  assert.equal(eventCourseSummary(index, event, true), 'River Park North (Gold) · Bradford Creek (Short) + 1 more');
  assert.equal(eventCourseSummary(index, normalizeEvent({ course_id: 1 }), false), 'River Park North');
});

test('public React modules import the shared events model without a root compatibility shim', () => {
  const publicSources = [
    'src/public-app/events-detail-data.js',
    'src/public-app/events-registration-app.js',
    'src/public-app/events-league-detail-app.js',
    'src/public-app/events-detail-app.js',
    'src/public-app/events-hub-data.js',
  ].map((file) => readFileSync(file, 'utf8'));

  assert.equal(existsSync('events.js'), false);
  for (const source of publicSources) {
    assert.match(source, /from "\.\.\/shared\/events-model\.js"/);
    assert.doesNotMatch(source, /from "\.\.\/\.\.\/events\.js"/);
  }
});
