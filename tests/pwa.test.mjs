import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appPages = [
  'index.html',
  'events.html',
  'gvdg-members.html',
  'score.html',
  'pro-shop.html',
  'ryder-cup.html',
  'gvdg-blog.html',
  'admin.html',
];

function pngSize(path) {
  const buf = readFileSync(path);
  assert.equal(buf.toString('ascii', 1, 4), 'PNG');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

test('manifest is installable and launches members', () => {
  const manifest = JSON.parse(readFileSync('site.webmanifest', 'utf8'));
  assert.equal(manifest.name, 'Greenville Disc Golf Club');
  assert.equal(manifest.short_name, 'GVDG Club');
  assert.equal(manifest.start_url, 'gvdg-members.html');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.theme_color, '#FF6B35');
  assert.ok(manifest.icons.some((icon) => icon.sizes === '192x192' && icon.purpose.includes('any')));
  assert.ok(manifest.icons.some((icon) => icon.sizes === '512x512' && icon.purpose.includes('any')));
  assert.ok(manifest.icons.some((icon) => icon.sizes === '512x512' && icon.purpose.includes('maskable')));
  assert.deepEqual(manifest.shortcuts.map((shortcut) => shortcut.url), [
    'gvdg-members.html',
    'score.html',
    'events.html',
    'pro-shop.html',
  ]);
});

test('manifest icons have the declared square dimensions', () => {
  assert.deepEqual(pngSize('img/icons/app-icon-192.png'), { width: 192, height: 192 });
  assert.deepEqual(pngSize('img/icons/app-icon-512.png'), { width: 512, height: 512 });
  assert.deepEqual(pngSize('img/icons/maskable-icon-512.png'), { width: 512, height: 512 });
  assert.deepEqual(pngSize('img/icons/apple-touch-icon.png'), { width: 180, height: 180 });
});

test('app entry pages link manifest, touch icon, theme color, and pwa registrar', () => {
  for (const page of appPages) {
    const html = readFileSync(page, 'utf8');
    assert.match(html, /<meta name="theme-color" content="#FF6B35">/, page);
    assert.match(html, /<link rel="manifest" href="site\.webmanifest">/, page);
    assert.match(html, /<link rel="apple-touch-icon" href="img\/icons\/apple-touch-icon\.png">/, page);
    assert.match(html, /<script src="pwa\.js" defer><\/script>/, page);
  }
});

test('live scoring links back to the members dashboard', () => {
  const html = readFileSync('score.html', 'utf8');
  const shellSource = readFileSync('src/score-app/main.js', 'utf8');
  const authSource = readFileSync('src/score-app/auth-flow.js', 'utf8');
  assert.match(html, /<script type="module" src="score-app\/score-app\.js"><\/script>/);
  assert.match(shellSource, /href: "gvdg-members\.html"/);
  assert.match(shellSource, /"aria-label": "Return to members"/);
  assert.match(authSource, /Return to members/);
  assert.match(authSource, /href: props\.membersHref \|\| "gvdg-members\.html"/);
  assert.match(html, /\.iconbtn\[hidden\] \{ display: none; \}/);
});

test('shared service worker caches app install assets and member fallback', () => {
  const sw = readFileSync('sw.js', 'utf8');
  const cacheVersion = sw.match(/const CACHE = "gvdg-club-v(\d+)"/);
  assert.ok(cacheVersion, 'service worker cache version is present');
  assert.ok(Number(cacheVersion[1]) >= 79, 'Bundled matchplay helper migration requires v79 or newer');
  assert.match(sw, /const OFFLINE_PAGE = "gvdg-members\.html"/);
  assert.match(sw, /const STATIC_DESTINATIONS = new Set/);
  assert.match(sw, /if \(!staticAsset\(req, url\)\) return/);
  for (const asset of [
    'site.webmanifest',
    'pwa.js',
    'home-app/home-app.js',
    'admin-app/admin-app.js',
    'members-app/members-app.js',
    'public-app/public-app.js',
    'tee-sign-preview-app/tee-sign-preview-app.js',
    'score-app/score-app.js',
    'img/icons/app-icon-192.png',
    'img/icons/app-icon-512.png',
    'img/icons/maskable-icon-512.png',
    'img/icons/apple-touch-icon.png',
  ]) {
    assert.ok(sw.includes(`"${asset}"`), asset);
  }
  assert.doesNotMatch(sw, /"nav\.js"/);
  assert.doesNotMatch(sw, /"crotts\.js"/);
  assert.doesNotMatch(sw, /"matchplay-colors\.js"/);
  assert.match(readFileSync('pwa.js', 'utf8'), /serviceWorker\.register\('sw\.js', \{ scope: '\.\/' \}\)/);
});

test('admin order badge clears stale counts when refresh fails closed', () => {
  const html = readFileSync('admin.html', 'utf8');
  const controller = readFileSync('src/admin-app/admin-controller.js', 'utf8');
  const shellState = readFileSync('src/admin-app/admin-shell-state.js', 'utf8');
  assert.match(controller, /function setOrdersBadge\(n\) \{[\s\S]*publishAdminOrdersBadgeCount\(n\)/);
  assert.match(shellState, /export function publishAdminOrdersBadgeCount\(count\)[\s\S]*gvdg:admin-orders-badge/);
  assert.doesNotMatch(controller, /__gvdgAdminOrdersBadgeCount/);
  assert.match(controller, /async function refreshOrdersBadge\(\) \{[\s\S]*setOrdersBadge\(0\);[\s\S]*catch \(e\) \{[\s\S]*setOrdersBadge\(0\);/);
  assert.doesNotMatch(html, /id="ordersBadge" class="orders-badge" hidden/);
});
