import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function adminPageAndControllerSource() {
  return `${readFileSync('admin.html', 'utf8')}\n${readFileSync('src/admin-app/admin-controller.js', 'utf8')}`;
}

test('admin live start area sends normalized scoring config', () => {
  const html = adminPageAndControllerSource();
  const main = readFileSync('src/admin-app/main.js', 'utf8');
  const panel = readFileSync('src/admin-app/scoring-panel.js', 'utf8');

  assert.match(html, /id="adminScoringReactApp"/);
  assert.match(main, /import \{ AdminScoringPanel \} from "\.\/scoring-panel\.js"/);
  assert.match(main, /const scoringMount = document\.getElementById\("adminScoringReactApp"\)/);
  assert.match(main, /createRoot\(scoringMount\)\.render\(h\(AdminScoringPanel\)\)/);
  assert.match(html, /function setAdminScoringEventsState\(state\) \{[\s\S]*new CustomEvent\('gvdg:admin-scoring-events-state', \{ detail: scEventsState \}\)/);
  assert.match(html, /function setAdminScoringState\(state\) \{[\s\S]*new CustomEvent\('gvdg:admin-scoring-state', \{ detail: scState \}\)/);
  assert.doesNotMatch(html, /publishAdminState\('scoringEvents'|publishAdminState\('scoring'|currentAdminState\('scoringEvents'|currentAdminState\('scoring'/);
  assert.match(panel, /name: "scGroupFormat"/);
  assert.match(panel, /name: "scScoringStyle"/);
  // Format selectors are BUTTON toggles (not dropdowns) — preserve this UI.
  assert.match(panel, /className: "fmt-btn"/);
  assert.match(panel, /\{ label: "Singles", value: "singles" \}/);
  assert.match(panel, /\{ label: "Doubles", value: "doubles" \}/);
  assert.match(panel, /\{ label: "Stroke play", value: "stroke" \}/);
  assert.match(panel, /\{ label: "Match play", value: "matchplay" \}/);
  assert.doesNotMatch(panel, /h\("select", \{[^}]*id: "scGroupFormat"/);
  assert.match(html, /import \{ normalizeConfig as normalizeScoringConfig \} from "\.\/scoring-model\.js"/);
  assert.match(html, /function scCurrentConfig\(config\)/);
  // The round always seeds from BOTH registered players AND manually-added walk-ons (unioned server-side),
  // so there is no manual-roster checkbox and the start body is just the config.
  assert.match(html, /body: \{ liveScoringConfig \}/);
  assert.doesNotMatch(html + panel, /scUseManualPlayers/);
});

test('admin start defaults preserve saved and legacy format fields separately', () => {
  const source = adminPageAndControllerSource();
  const model = readFileSync('src/admin-app/scoring-model.js', 'utf8');
  assert.match(source, /import \{ normalizeConfig as normalizeScoringConfig \} from "\.\/scoring-model\.js"/);
  assert.doesNotMatch(source, /function scNormalizeConfig\(raw, fallbackPlayFormat, fallbackEventFormat\)/);
  assert.match(source, /normalizeScoringConfig\(config \|\| null, null, null\)/);
  assert.match(source, /normalizeScoringConfig\(event && \(event\.liveScoringConfig \|\| event\.live_scoring_config \|\| event\.live_scoring_config_json \|\| null\), event && event\.play_format, event && event\.format\)/);
  assert.match(model, /groupFormat: fallbackPlayFormat === "doubles" \? "doubles" : "singles"/);
  assert.match(model, /scoringStyle: fallbackEventFormat === "matchplay" \? "matchplay" : "stroke"/);
  assert.match(source, /scEventConfig\(event\)/);
  assert.match(source, /event && event\.play_format, event && event\.format/);
  assert.match(model, /playFormat: text\(source\.play_format\)/);
  assert.match(model, /eventFormat: text\(source\.format\)/);
  assert.doesNotMatch(source + model, /dataset\.format = e\.play_format \|\| e\.format/);
});

test('admin live grid uses pair target rows and target-id score posts', () => {
  const html = adminPageAndControllerSource();
  const model = readFileSync('src/admin-app/scoring-model.js', 'utf8');
  const scorecard = readFileSync('src/admin-app/scoring-scorecard.js', 'utf8');

  assert.match(model, /export function scoreRows\(snapshot\)/);
  assert.match(model, /target\?\.type === "pair"/);
  assert.match(html, /body\.targetId = row\.targetId/);
  assert.match(scorecard, /isMatchplay\(snap\) \? "Match" : "To Par"/);
  assert.match(model, /target\.members\) \? target\.members\.join\(" \/ "\)/);
  assert.match(scorecard, /data-react-admin-scoring-grid/);
  assert.match(scorecard, /data-react-admin-scoring-board/);
  assert.doesNotMatch(html + scorecard, /admin-state-store|currentAdminState|publishAdminState/);
  assert.doesNotMatch(html, /function scRenderGrid|function scRenderBoard|function scScoreRows|scGrid'\)\.querySelectorAll|document\.createElement\('(?:thead|tbody|tr|td|th|input)'\)/);
});
