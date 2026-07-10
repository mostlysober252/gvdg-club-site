function dispatchAdminEvent(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

export function setDataArchiveExportResult(message, ok, options) {
  const details = options && typeof options === 'object' ? options : {};
  const state = {
    download: details.download || null,
    message: message || 'No export run yet.',
    ok: ok === true ? true : ok === false ? false : null,
  };
  dispatchAdminEvent('gvdg:admin-data-archive-export-result', state);
}

function dataArchiveDestinationLabel(destination) {
  return destination && (destination.label || ('Endpoint ' + destination.id));
}

function setDataArchiveEndpointForm(destination) {
  dispatchAdminEvent('gvdg:admin-data-archive-destination-form-edit', { destination });
}

export function editDataArchiveDestination(destination, { adminMsg }) {
  setDataArchiveEndpointForm(destination);
  adminMsg('Editing destination "' + dataArchiveDestinationLabel(destination) + '".');
}

export async function adminSaveDataArchiveEndpointFromReact(detail, { adminApi, adminMsg }) {
  const requestId = detail.requestId;
  if (!requestId) return;
  const body = detail.body || {};
  const label = String(body.label || '').trim();
  const endpointUrl = String(body.endpoint_url || '').trim();
  if (detail.valid !== true || !label || !/^https?:\/\//.test(endpointUrl)) {
    const message = 'Label and https endpoint URL are required.';
    adminMsg(message, false);
    dispatchAdminEvent('gvdg:admin-data-archive-destination-save-result', { ok: false, requestId, message });
    return;
  }
  const id = Number(detail.endpointId);
  const editing = detail.editing === true && Number.isFinite(id);
  const path = editing ? '/admin/export/endpoints/' + id : '/admin/export/endpoints';
  const method = editing ? 'PATCH' : 'POST';
  let r;
  try {
    r = await adminApi(path, { method, body });
  } catch (err) {
    const message = 'Save failed';
    adminMsg(message, false);
    dispatchAdminEvent('gvdg:admin-data-archive-destination-save-result', { ok: false, requestId, message });
    return;
  }
  if (r.ok) {
    const labelText = detail.labelText || label || ('Endpoint ' + (id || ''));
    adminMsg(editing ? 'Saved destination "' + labelText + '"' : 'Added destination "' + labelText + '"', true);
    dispatchAdminEvent('gvdg:admin-data-archive-destination-save-result', { ok: true, requestId });
  } else {
    let payload = {};
    try { payload = await r.json(); } catch (err) {}
    const message = (payload.error || 'Save failed') + ' (' + r.status + ')';
    adminMsg(message, false);
    dispatchAdminEvent('gvdg:admin-data-archive-destination-save-result', { ok: false, requestId, message });
  }
}

export async function adminRunArchiveExportFromReact(detail, { adminApi, adminMsg }) {
  const requestId = detail.requestId;
  if (!requestId) return;
  const body = detail.body || {};
  let ok = false;
  try {
    const r = await adminApi('/admin/export', { method: 'POST', body });
    const payload = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (payload.error === 'invalid_date_range') adminMsg('Export failed: invalid date range', false);
      else adminMsg('Export failed (' + r.status + '): ' + (payload.error || 'request error'), false);
      setDataArchiveExportResult('Export failed (' + (payload.error || 'request error') + ')', false);
      return;
    }
    if (payload.mode === 'download' && payload.exportData) {
      setDataArchiveExportResult('Download ready: ' + (payload.exportData.exportedAt || 'snapshot') + ' (events: ' + (payload.exportData.counts?.events || 0) + ')', true, {
        download: {
          data: payload.exportData,
          filename: 'gvdg-archive-' + new Date().toISOString().slice(0, 10) + '.json',
          mimeType: 'application/json;charset=utf-8',
        },
      });
      ok = true;
      return;
    }
    if (payload.mode === 'test') {
      setDataArchiveExportResult('Test passed for "' + (payload.destination && payload.destination.label ? payload.destination.label : payload.destination) + '" (HTTP ' + payload.status + ')', true);
      ok = true;
      return;
    }
    if (payload.mode === 'sent') {
      setDataArchiveExportResult('Export sent to "' + (payload.destination && payload.destination.label ? payload.destination.label : payload.destination) + '" (HTTP ' + payload.status + ', events: ' + (payload.counts?.events || 0) + ')', true);
      ok = true;
      return;
    }
    setDataArchiveExportResult('Export completed.', true);
    ok = true;
  } catch (error) {
    setDataArchiveExportResult('Export failed unexpectedly.', false);
    adminMsg('Export failed unexpectedly', false);
  } finally {
    dispatchAdminEvent('gvdg:admin-data-archive-export-run-result', { ok, requestId });
  }
}

async function activateDataArchiveDestination(destination, { adminApi, adminMsg }) {
  if (!destination || destination.id == null) return;
  const r = await adminApi('/admin/export/endpoints/' + destination.id + '/activate', { method: 'POST' });
  if (r.ok) {
    adminMsg('Activated endpoint "' + dataArchiveDestinationLabel(destination) + '"', true);
    dispatchAdminEvent('gvdg:admin-data-archive-destination-activate-result', { ok: true, destination });
  } else {
    adminMsg('Activate failed (' + r.status + ')', false);
    dispatchAdminEvent('gvdg:admin-data-archive-destination-activate-result', { ok: false, destination });
  }
}

async function deleteDataArchiveDestination(destination, { adminApi, adminMsg }) {
  if (!destination || destination.id == null) return;
  const r = await adminApi('/admin/export/endpoints/' + destination.id, { method: 'DELETE' });
  if (r.ok) {
    adminMsg('Deleted "' + dataArchiveDestinationLabel(destination) + '"', true);
    dispatchAdminEvent('gvdg:admin-data-archive-destination-delete-result', { ok: true, destination });
  } else {
    adminMsg('Delete failed (' + r.status + ')', false);
    dispatchAdminEvent('gvdg:admin-data-archive-destination-delete-result', { ok: false, destination });
  }
}

export function installDataArchiveController(deps) {
  window.addEventListener('gvdg:admin-data-archive-destination-edit-request', (event) => {
    const destination = event.detail && event.detail.destination;
    if (!destination || destination.id == null) return;
    editDataArchiveDestination(destination, deps);
  });
  window.addEventListener('gvdg:admin-data-archive-destination-save-request', async (event) => {
    await adminSaveDataArchiveEndpointFromReact(event.detail || {}, deps);
  });
  window.addEventListener('gvdg:admin-data-archive-destination-activate-request', async (event) => {
    await activateDataArchiveDestination(event.detail && event.detail.destination, deps);
  });
  window.addEventListener('gvdg:admin-data-archive-destination-delete-request', async (event) => {
    await deleteDataArchiveDestination(event.detail && event.detail.destination, deps);
  });
  window.addEventListener('gvdg:admin-data-archive-export-run-request', async (event) => {
    await adminRunArchiveExportFromReact(event.detail || {}, deps);
  });
}
