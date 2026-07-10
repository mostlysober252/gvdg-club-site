import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { holeWinner, holeWinners, teamSide, winnerColor, playersFromResults, TEAM_COLORS } from '../src/shared/matchplay-colors.js';

test('holeWinner: lower score wins, equal is a tie, missing is null', () => {
  assert.equal(holeWinner(3, 4), 'red');
  assert.equal(holeWinner(4, 3), 'blue');
  assert.equal(holeWinner(3, 3), 'tie');
  assert.equal(holeWinner(3, undefined), null);
  assert.equal(holeWinner(null, 3), null);
});

test('teamSide normalizes labels and team names', () => {
  assert.equal(teamSide('Red'), 'red');
  assert.equal(teamSide('Blue'), 'blue');
  assert.equal(teamSide('Juan Team'), null); // only color labels resolve; team names do not contain red/blue
  assert.equal(teamSide(null), null);
});

test('holeWinners: doubles alt-shot uses each pair’s shared hole score', () => {
  const holes = [{ hole: 1 }, { hole: 2 }, { hole: 3 }, { hole: 18 }];
  const players = [
    { team: 'Blue', scores: { 1: 2, 2: 3, 3: 3 } },
    { team: 'Blue', scores: { 1: 2, 2: 3, 3: 3 } }, // partner shares the score (alt-shot)
    { team: 'Red', scores: { 1: 3, 2: 3, 3: 4 } },
    { team: 'Red', scores: { 1: 3, 2: 3, 3: 4 } },
  ];
  const w = holeWinners(holes, players);
  assert.equal(w[1], 'blue'); // 2 < 3
  assert.equal(w[2], 'tie'); // 3 == 3
  assert.equal(w[3], 'blue'); // 3 < 4
  assert.equal(w[18], null); // unscored
});

test('winnerColor: teams always colored; ties suppressible for the scoring app', () => {
  assert.equal(winnerColor('red'), TEAM_COLORS.red);
  assert.equal(winnerColor('blue'), TEAM_COLORS.blue);
  assert.equal(winnerColor('tie'), TEAM_COLORS.tie); // default: yellow
  assert.equal(winnerColor('tie', { tie: false }), null); // scoring app keeps halved holes as-is
  assert.equal(winnerColor(null), null);
});

test('playersFromResults parses team + scorecard into the holeWinners shape', () => {
  const rows = [
    { scoring_group: JSON.stringify({ label: 'Blue' }), scorecard: JSON.stringify([{ hole: 1, strokes: 2 }, { hole: 2, strokes: 3 }]) },
    { scoring_group: JSON.stringify({ label: 'Red' }), scorecard: null }, // backfilled — no scorecard
  ];
  const players = playersFromResults(rows);
  assert.equal(players[0].team, 'Blue');
  assert.equal(players[0].scores[1], 2);
  assert.deepEqual(players[1].scores, {}); // no per-hole data → no coloring
});

test('matchplay helpers stay module-only without browser globals or a root shim', () => {
  const shared = readFileSync('src/shared/matchplay-colors.js', 'utf8');

  assert.equal(existsSync('matchplay-colors.js'), false);
  assert.doesNotMatch(shared, /GVDGMatchplay|installMatchplayGlobal|window\./);
});
