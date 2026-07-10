import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('admin data archive export result is rendered by React from direct result events', () => {
  const html = `${readFileSync('admin.html', 'utf8')}\n${readFileSync('src/admin-app/admin-controller.js', 'utf8')}`;
  const dataArchiveController = readFileSync('src/admin-app/data-archive-controller.js', 'utf8');
  const main = readFileSync('src/admin-app/main.js', 'utf8');
  const dataArchive = readFileSync('src/admin-app/data-archive-destinations-list.js', 'utf8');
  const setExportResult = dataArchiveController.match(/export function setDataArchiveExportResult\(message, ok, options\) \{[\s\S]*?\n\}/)?.[0];

  assert.match(html, /id="adminDataArchiveExportResultReactApp"/);
  assert.doesNotMatch(html, /id="dxExportResult"/);
  assert.ok(setExportResult);
  assert.match(setExportResult, /download: details\.download \|\| null/);
  assert.match(setExportResult, /dispatchAdminEvent\('gvdg:admin-data-archive-export-result', state\)/);
  assert.doesNotMatch(setExportResult, /publishAdminState\('dataArchiveExportResult'/);
  assert.doesNotMatch(setExportResult, /dxExportResult|textContent|className|querySelector|classList|document\.createElement|appendChild|URL\.createObjectURL|revokeObjectURL|new Blob/);
  assert.match(main, /import \{ AdminDataArchiveDestinationsList, AdminDataArchiveExportResult \} from "\.\/data-archive-destinations-list\.js"/);
  assert.match(main, /const dataArchiveExportResultMount = document\.getElementById\("adminDataArchiveExportResultReactApp"\)/);
  assert.match(main, /createRoot\(dataArchiveExportResultMount\)\.render\(h\(AdminDataArchiveExportResult\)\)/);
  assert.match(dataArchive, /export function AdminDataArchiveExportResult/);
  assert.doesNotMatch(dataArchive, /currentAdminState\("dataArchiveExportResult"|admin-state-store/);
  assert.match(dataArchive, /gvdg:admin-data-archive-export-result/);
  assert.match(dataArchive, /normalizeDownload/);
  assert.match(dataArchive, /URL\.createObjectURL/);
  assert.match(dataArchive, /URL\.revokeObjectURL/);
  assert.match(dataArchive, /downloadLinkRef\.current\.click\(\)/);
  assert.match(dataArchive, /download: downloadLink\.filename/);
  assert.match(dataArchive, /data-react-admin-data-archive-export-result/);
  assert.match(dataArchive, /role: state\.ok === false \? "alert" : "status"/);
  assert.doesNotMatch(dataArchive, /innerHTML|insertAdjacentHTML|replaceChildren|document\.createElement|querySelector|classList|textContent\s*=|☰|✕|🔒|🌙|☀️|🏆|⚠|⏱|—/);
});
