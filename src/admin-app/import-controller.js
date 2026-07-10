function dispatchAdminEvent(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function showImportCandidates(candidates) {
  dispatchAdminEvent('gvdg:admin-import-candidates', { status: 'ready', candidates: Array.isArray(candidates) ? candidates : [] });
}

export async function adminDgsImportFromReact(detail, { adminApi, adminMsg }) {
  const requestId = detail.requestId;
  if (!requestId) return;
  adminMsg('Importing from DiscGolfScene...', true);
  dispatchAdminEvent('gvdg:admin-import-candidates', { status: 'loading', candidates: [] });
  let r;
  try {
    r = await adminApi('/admin/import/dgs', { method: 'POST', body: {} });
  } catch (err) {
    adminMsg('DGS import failed', false);
    dispatchAdminEvent('gvdg:admin-dgs-import-result', { ok: false, requestId });
    return;
  }
  if (r.ok) {
    const d = await r.json();
    showImportCandidates(d.candidates);
    adminMsg((d.candidates || []).length + ' candidates loaded', true);
    dispatchAdminEvent('gvdg:admin-dgs-import-result', { ok: true, requestId });
  } else {
    adminMsg('DGS import failed (' + r.status + ')', false);
    dispatchAdminEvent('gvdg:admin-dgs-import-result', { ok: false, requestId });
  }
}

export async function adminCsvImportFromReact(detail, { adminApi, adminMsg }) {
  const requestId = detail.requestId;
  if (!requestId) return;
  const csv = typeof detail.csv === 'string' ? detail.csv : '';
  if (detail.valid !== true || !csv.trim()) {
    adminMsg('Paste CSV first', false);
    dispatchAdminEvent('gvdg:admin-csv-import-result', { ok: false, requestId });
    return;
  }
  dispatchAdminEvent('gvdg:admin-import-candidates', { status: 'loading', candidates: [] });
  let r;
  try {
    r = await adminApi('/admin/import/csv', { method: 'POST', body: { csv } });
  } catch (err) {
    adminMsg('CSV import failed', false);
    dispatchAdminEvent('gvdg:admin-csv-import-result', { ok: false, requestId });
    return;
  }
  if (r.ok) {
    const d = await r.json();
    showImportCandidates(d.candidates);
    adminMsg((d.candidates || []).length + ' rows parsed', true);
    dispatchAdminEvent('gvdg:admin-csv-import-result', { ok: true, requestId });
  } else {
    adminMsg('CSV import failed (' + r.status + ')', false);
    dispatchAdminEvent('gvdg:admin-csv-import-result', { ok: false, requestId });
  }
}

export function installImportController(deps) {
  window.addEventListener('gvdg:admin-dgs-import-request', async (event) => {
    await adminDgsImportFromReact(event.detail || {}, deps);
  });
  window.addEventListener('gvdg:admin-csv-import-request', async (event) => {
    await adminCsvImportFromReact(event.detail || {}, deps);
  });
}
