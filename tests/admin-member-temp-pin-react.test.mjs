import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('admin member temporary PIN display is rendered by React from direct create/reset events', () => {
  const html = `${readFileSync('admin.html', 'utf8')}\n${readFileSync('src/admin-app/admin-controller.js', 'utf8')}`;
  const main = readFileSync('src/admin-app/main.js', 'utf8');
  const membersList = readFileSync('src/admin-app/members-list.js', 'utf8');
  const showTempPin = html.match(/function showTempPin\(member, tempPin\) \{[\s\S]*?\n        \}/)?.[0];

  assert.match(html, /id="adminMemberTempPinReactApp"/);
  assert.doesNotMatch(html, /id="amTempPin"/);
  assert.match(html, /\.admin-temp-pin \{[^}]*border: 2px solid var\(--primary\)/);
  assert.ok(showTempPin);
  assert.match(showTempPin, /new CustomEvent\('gvdg:admin-member-temp-pin', \{ detail: state \}\)/);
  assert.doesNotMatch(showTempPin, /publishAdminState\('memberTempPin'/);
  assert.doesNotMatch(showTempPin, /amTempPin|textContent|appendChild|style\.cssText|createElement|elx\(|addEventListener|classList/);
  assert.match(main, /import \{ AdminMembersList, AdminMemberTempPin \} from "\.\/members-list\.js"/);
  assert.match(main, /const memberTempPinMount = document\.getElementById\("adminMemberTempPinReactApp"\)/);
  assert.match(main, /createRoot\(memberTempPinMount\)\.render\(h\(AdminMemberTempPin\)\)/);
  assert.match(membersList, /export function AdminMemberTempPin/);
  assert.doesNotMatch(membersList, /currentAdminState\("memberTempPin"|admin-state-store|function currentTempPinState/);
  assert.match(membersList, /gvdg:admin-member-temp-pin/);
  assert.match(membersList, /data-react-admin-member-temp-pin/);
  assert.match(membersList, /className: "admin-temp-pin"/);
  assert.match(membersList, /className: "admin-temp-pin-code"/);
  assert.match(membersList, /navigator\.clipboard/);
  assert.match(membersList, /role: "status"/);
  assert.doesNotMatch(membersList, /innerHTML|insertAdjacentHTML|replaceChildren|document\.createElement|querySelector|classList|textContent\s*=|☰|✕|🔒|🌙|☀️|🏆|⚠|⏱|—/);
});
