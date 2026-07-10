import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { safeExternalUrl } from '../src/shared/safe-url.js';

test('safeExternalUrl allows http and https URLs', () => {
  assert.equal(safeExternalUrl('https://example.com/path'), 'https://example.com/path');
  assert.equal(safeExternalUrl('http://example.com/path'), 'http://example.com/path');
});

test('safeExternalUrl rejects script, data, relative, and malformed URLs', () => {
  assert.equal(safeExternalUrl('javascript:alert(1)'), '');
  assert.equal(safeExternalUrl('data:text/html,<script></script>'), '');
  assert.equal(safeExternalUrl('/local/path'), '');
  assert.equal(safeExternalUrl('not a url'), '');
});

test('React bundles import the pure shared sanitizer without a root compatibility shim', () => {
  const shared = readFileSync('src/shared/safe-url.js', 'utf8');
  const homeFiles = [
    'src/home-app/courses-app.js',
    'src/home-app/course-modal.js',
    'src/home-app/feed-panels.js',
    'src/home-app/community-sections.js',
    'src/public-app/events-club-content-app.js',
  ].map((file) => readFileSync(file, 'utf8'));

  assert.doesNotMatch(shared, /window\.|GVDGSafeUrl/);
  assert.equal(existsSync('safe-url.js'), false);
  for (const source of homeFiles) {
    assert.match(source, /from "\.\.\/shared\/safe-url\.js"/);
    assert.doesNotMatch(source, /from "\.\.\/\.\.\/safe-url\.js"/);
  }
});
