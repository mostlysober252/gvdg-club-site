import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isClubEvent,
  parseCsvLine,
  parseHomepageEventCsv,
  parseHomepageEventDate,
  parseTournamentCsv,
  parseTournamentDate,
} from '../src/shared/home-feed-parse.js';

test('isClubEvent flags club business but keeps tournaments/league rounds', () => {
  assert.equal(isClubEvent({ title: 'Club Meeting', description: 'At Local Oak Brewing' }), true);
  assert.equal(isClubEvent({ title: 'Course Cleanup Fundraiser', description: '' }), true);
  assert.equal(isClubEvent({ title: 'GVDG Summer Doubles League', description: 'Farmville' }), false);
  assert.equal(isClubEvent({ title: 'Ryder Cup Matchplay', description: '' }), false);
});

test('parseCsvLine handles quoted commas and escaped quotes', () => {
  assert.deepEqual(parseCsvLine('"One, Two","He said ""go""",Plain'), ['One, Two', 'He said "go"', 'Plain']);
});

test('parseTournamentCsv maps sheet columns into tournament cards', () => {
  const csv = 'date,name,location,tier,url\n"Aug 3, 2026","Throwdown, East",Greenville,C,https://example.com';
  assert.deepEqual(parseTournamentCsv(csv), [
    { date: 'Aug 3, 2026', name: 'Throwdown, East', location: 'Greenville', tier: 'C', url: 'https://example.com' },
  ]);
});

test('parseTournamentDate handles short month dates', () => {
  assert.deepEqual(parseTournamentDate('Aug 3, 2026'), { month: 'Aug', day: 3, year: '2026' });
  assert.deepEqual(parseTournamentDate('Aug 3', new Date(2026, 0, 1)), { month: 'Aug', day: 3, year: 2026 });
  assert.equal(parseTournamentDate('TBD'), null);
});

test('parseHomepageEventCsv filters inactive and blank events', () => {
  const csv = 'title,date,description,url,active\nWeekly Doubles,2026-08-01,Bring tags,https://example.com,TRUE\nOld Hidden,2026-08-02,,https://example.com,FALSE\nNo Date,,Missing date,,TRUE';
  assert.deepEqual(parseHomepageEventCsv(csv), [
    { title: 'Weekly Doubles', date: '2026-08-01', description: 'Bring tags', url: 'https://example.com', active: 'TRUE' },
  ]);
});

test('parseHomepageEventDate handles common sheet date formats', () => {
  const now = new Date('2026-03-20T12:00:00Z');
  assert.equal(parseHomepageEventDate('2026-08-01', now).month, 'Aug');
  assert.equal(parseHomepageEventDate('8/1/26', now).year, 2026);
  assert.equal(parseHomepageEventDate('01/15', now).year, 2027);
  assert.equal(parseHomepageEventDate('TBD', now).isTBD, true);
});
