import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('admin registration manual player form is rendered by React from request events', () => {
  const html = `${readFileSync('admin.html', 'utf8')}\n${readFileSync('src/admin-app/admin-controller.js', 'utf8')}`;
  const main = readFileSync('src/admin-app/main.js', 'utf8');
  const form = readFileSync('src/admin-app/registration-manual-player-form.js', 'utf8');
  const panel = readFileSync('src/admin-app/registration-panel.js', 'utf8');
  const rgAddManualPlayer = html.match(/async function rgAddManualPlayerFromReact\(detail\) \{[\s\S]*?\n        \}/)?.[0];
  const initAdmin = html.match(/function initAdmin\(\) \{[\s\S]*?adminLoadEvents\(\);\n            adminLoadCourses\(\);\n            adminLoadLeagues\(\);\n        \}/)?.[0];

  assert.match(html, /id="adminRegistrationReactApp"/);
  assert.doesNotMatch(html, /id="adminRegistrationManualPlayerFormReactApp"/);
  assert.doesNotMatch(html, /id="rgPlayerName"|id="rgPlayerMember"|id="rgPlayerPdga"|id="rgPlayerDivision"|id="rgPlayerTeam"|id="rgPlayerAdd"/);
  assert.ok(rgAddManualPlayer);
  assert.match(rgAddManualPlayer, /if \(!rgEventId\) \{[\s\S]*?Select an event first[\s\S]*?gvdg:admin-registration-manual-player-add-result[\s\S]*?ok: false, requestId[\s\S]*?return;/);
  assert.match(rgAddManualPlayer, /const body = detail\.body \|\| \{\}/);
  assert.match(rgAddManualPlayer, /adminApi\('\/admin\/events\/' \+ rgEventId \+ '\/players', \{ method: 'POST', body \}\)/);
  assert.match(rgAddManualPlayer, /gvdg:admin-registration-manual-player-add-result/);
  assert.match(rgAddManualPlayer, /rgLoadRoster\(\)/);
  assert.doesNotMatch(rgAddManualPlayer, /\$\('rgPlayerName'\)|\$\('rgPlayerMember'\)|\$\('rgPlayerPdga'\)|\$\('rgPlayerDivision'\)|\$\('rgPlayerTeam'\)|\.value = ''/);
  assert.ok(initAdmin);
  assert.match(initAdmin, /gvdg:admin-registration-manual-player-add-request/);
  assert.match(initAdmin, /rgAddManualPlayerFromReact\(event\.detail \|\| \{\}\)/);
  assert.doesNotMatch(initAdmin, /\$\('rgPlayerAdd'\)\.addEventListener/);

  assert.match(main, /import \{ AdminRegistrationPanel \} from "\.\/registration-panel\.js"/);
  assert.match(main, /const registrationMount = document\.getElementById\("adminRegistrationReactApp"\)/);
  assert.match(main, /createRoot\(registrationMount\)\.render\(h\(AdminRegistrationPanel\)\)/);
  assert.match(panel, /import \{ AdminRegistrationManualPlayerForm \} from "\.\/registration-manual-player-form\.js"/);
  assert.match(panel, /h\(AdminRegistrationManualPlayerForm/);

  assert.match(form, /export function AdminRegistrationManualPlayerForm/);
  assert.match(form, /data-react-admin-registration-manual-player-form/);
  assert.match(form, /gvdg:admin-registration-manual-player-add-request/);
  assert.match(form, /gvdg:admin-registration-manual-player-add-result/);
  assert.match(form, /id: "rgPlayerName"/);
  assert.match(form, /id: "rgPlayerMember"/);
  assert.match(form, /id: "rgPlayerPdga"/);
  assert.match(form, /id: "rgPlayerDivision"/);
  assert.match(form, /id: "rgPlayerTeam"/);
  assert.match(form, /className: "admin-btn secondary"/);
  assert.doesNotMatch(form, /innerHTML|insertAdjacentHTML|replaceChildren|document\.createElement|querySelector|classList|textContent\s*=|☰|✕|🔒|🌙|☀️|🏆|⚠|⏱|—/);
});
