import assert from 'node:assert/strict';
import test from 'node:test';

import { installCourseLayoutsController } from '../src/admin-app/course-layouts-controller.js';
import { installDataArchiveController } from '../src/admin-app/data-archive-controller.js';
import { installImportController } from '../src/admin-app/import-controller.js';
import { installTeeSignReviewController } from '../src/admin-app/tee-sign-review-controller.js';

function withWindow(target, fn) {
  const previousWindow = globalThis.window;
  globalThis.window = target;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (previousWindow === undefined) delete globalThis.window;
      else globalThis.window = previousWindow;
    });
}

function emit(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function waitForAsyncHandlers() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test('data archive controller posts endpoint saves and publishes result events', async () => {
  const target = new EventTarget();
  await withWindow(target, async () => {
    const calls = [];
    const messages = [];
    const saveResults = [];
    window.addEventListener('gvdg:admin-data-archive-destination-save-result', (event) => saveResults.push(event.detail));

    installDataArchiveController({
      adminApi: async (path, opts) => {
        calls.push({ path, opts });
        return { ok: true, json: async () => ({}) };
      },
      adminMsg: (text, ok) => messages.push({ text, ok }),
    });

    emit('gvdg:admin-data-archive-destination-save-request', {
      requestId: 'save-1',
      valid: true,
      body: { label: 'Archive', endpoint_url: 'https://example.com/hook' },
      editing: false,
      labelText: 'Archive',
    });
    await waitForAsyncHandlers();

    assert.deepEqual(calls, [
      {
        path: '/admin/export/endpoints',
        opts: { method: 'POST', body: { label: 'Archive', endpoint_url: 'https://example.com/hook' } },
      },
    ]);
    assert.deepEqual(saveResults, [{ ok: true, requestId: 'save-1' }]);
    assert.deepEqual(messages, [{ text: 'Added destination "Archive"', ok: true }]);
  });
});

test('data archive controller publishes download details and run completion', async () => {
  const target = new EventTarget();
  await withWindow(target, async () => {
    const exportResults = [];
    const runResults = [];
    window.addEventListener('gvdg:admin-data-archive-export-result', (event) => exportResults.push(event.detail));
    window.addEventListener('gvdg:admin-data-archive-export-run-result', (event) => runResults.push(event.detail));

    installDataArchiveController({
      adminApi: async () => ({
        ok: true,
        json: async () => ({
          mode: 'download',
          exportData: { exportedAt: '2026-07-09T12:00:00Z', counts: { events: 2 } },
        }),
      }),
      adminMsg: () => {},
    });

    emit('gvdg:admin-data-archive-export-run-request', { requestId: 'export-1', body: { mode: 'download' } });
    await waitForAsyncHandlers();

    assert.equal(exportResults.length, 1);
    assert.equal(exportResults[0].ok, true);
    assert.equal(exportResults[0].download.filename, 'gvdg-archive-2026-07-09.json');
    assert.deepEqual(exportResults[0].download.data.counts, { events: 2 });
    assert.deepEqual(runResults, [{ ok: true, requestId: 'export-1' }]);
  });
});

test('import controller posts CSV imports and publishes candidate/result events', async () => {
  const target = new EventTarget();
  await withWindow(target, async () => {
    const calls = [];
    const candidateStates = [];
    const csvResults = [];
    window.addEventListener('gvdg:admin-import-candidates', (event) => candidateStates.push(event.detail));
    window.addEventListener('gvdg:admin-csv-import-result', (event) => csvResults.push(event.detail));

    installImportController({
      adminApi: async (path, opts) => {
        calls.push({ path, opts });
        return { ok: true, json: async () => ({ candidates: [{ name: 'Monthly', type: 'tournament' }] }) };
      },
      adminMsg: () => {},
    });

    emit('gvdg:admin-csv-import-request', { requestId: 'csv-1', valid: true, csv: 'name,type\nMonthly,tournament' });
    await waitForAsyncHandlers();

    assert.deepEqual(calls, [
      { path: '/admin/import/csv', opts: { method: 'POST', body: { csv: 'name,type\nMonthly,tournament' } } },
    ]);
    assert.deepEqual(candidateStates, [
      { status: 'loading', candidates: [] },
      { status: 'ready', candidates: [{ name: 'Monthly', type: 'tournament' }] },
    ]);
    assert.deepEqual(csvResults, [{ ok: true, requestId: 'csv-1' }]);
  });
});

test('tee-sign review controller loads queue data with course layouts', async () => {
  const target = new EventTarget();
  await withWindow(target, async () => {
    let courses = [];
    const states = [];
    const adminCalls = [];
    const publicCalls = [];
    window.addEventListener('gvdg:admin-tee-sign-review', (event) => states.push(event.detail));

    const controller = installTeeSignReviewController({
      adminApi: async (path) => {
        adminCalls.push(path);
        return { ok: true, json: async () => ({ teeSigns: [{ id: 11, course_id: 7, hole: 1 }] }) };
      },
      adminMsg: () => {},
      api: async (path) => {
        publicCalls.push(path);
        return { ok: true, json: async () => ({ layouts: [{ id: 21, name: 'Longs' }] }) };
      },
      authBase: 'https://auth.example',
      getCourses: () => courses,
      ensureCoursesLoaded: async () => {
        courses = [{ id: 7, name: 'ECU North' }];
      },
    });

    await controller.loadReview({ status: 'official' });

    assert.deepEqual(adminCalls, ['/admin/tee-signs?status=official']);
    assert.deepEqual(publicCalls, ['/courses/7/layouts']);
    assert.equal(states[0].status, 'loading');
    assert.equal(states[0].queueStatus, 'official');
    assert.deepEqual(states[0].courses, []);
    assert.equal(states[1].status, 'ready');
    assert.deepEqual(states[1].courses, [{ id: 7, name: 'ECU North' }]);
    assert.deepEqual(states[1].layoutsByCourse, { 7: [{ id: 21, name: 'Longs' }] });
    assert.equal(states[1].authBase, 'https://auth.example');
  });
});

test('tee-sign review controller validates approval rows before posting', async () => {
  const target = new EventTarget();
  await withWindow(target, async () => {
    const messages = [];
    const actionResults = [];
    window.addEventListener('gvdg:admin-tee-sign-review-action-result', (event) => actionResults.push(event.detail));

    installTeeSignReviewController({
      adminApi: async () => {
        throw new Error('adminApi should not be called for invalid rows');
      },
      adminMsg: (text, ok) => messages.push({ text, ok }),
      api: async () => ({ ok: true, json: async () => ({ layouts: [] }) }),
      authBase: '',
      getCourses: () => [],
      ensureCoursesLoaded: async () => {},
    });

    emit('gvdg:admin-tee-sign-review-approve-request', { requestId: 'approve-1', sign: { id: 11 }, rows: [] });
    await waitForAsyncHandlers();

    assert.deepEqual(messages, [{ text: 'Add at least one valid row before approving', ok: false }]);
    assert.deepEqual(actionResults, [{ requestId: 'approve-1', ok: false }]);
  });
});

test('course layouts controller loads positions and normalized layouts', async () => {
  const target = new EventTarget();
  await withWindow(target, async () => {
    const states = [];
    const publicCalls = [];
    window.addEventListener('gvdg:admin-course-layouts-state', (event) => states.push(event.detail));

    const controller = installCourseLayoutsController({
      api: async (path) => {
        publicCalls.push(path);
        if (path.endsWith('/positions')) return { ok: true, json: async () => ({ positions: [{ id: 1, label: 'Long' }] }) };
        return { ok: true, json: async () => ({ layouts: [{ id: 2, name: 'Main', holes: '[{"hole":1,"par":3}]' }] }) };
      },
      adminApi: async () => ({ ok: true, json: async () => ({}) }),
      adminMsg: () => {},
    });

    await controller.loadCourseLayouts({ courseId: 7 });

    assert.deepEqual(publicCalls, ['/courses/7/positions', '/courses/7/layouts']);
    assert.deepEqual(states, [
      { status: 'loading', courseId: '7', layouts: [], positions: [] },
      {
        status: 'ready',
        courseId: '7',
        layouts: [{ id: 2, name: 'Main', holes: [{ hole: 1, par: 3 }] }],
        positions: [{ id: 1, label: 'Long' }],
      },
    ]);
  });
});

test('course layouts controller validates position labels before posting', async () => {
  const target = new EventTarget();
  await withWindow(target, async () => {
    const messages = [];
    const actionResults = [];
    window.addEventListener('gvdg:admin-course-layouts-action-result', (event) => actionResults.push(event.detail));

    installCourseLayoutsController({
      api: async () => ({ ok: true, json: async () => ({}) }),
      adminApi: async () => {
        throw new Error('adminApi should not be called for invalid positions');
      },
      adminMsg: (text, ok) => messages.push({ text, ok }),
    });

    emit('gvdg:admin-course-layout-position-add-request', { requestId: 'pos-1', courseId: 7, body: { kind: 'tee', label: '' } });
    await waitForAsyncHandlers();

    assert.deepEqual(messages, [{ text: 'Position label required', ok: false }]);
    assert.deepEqual(actionResults, [{ ok: false, requestId: 'pos-1' }]);
  });
});
