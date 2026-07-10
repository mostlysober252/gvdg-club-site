function dispatchAdminEvent(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function setAdminCourseLayoutsState(state) {
  dispatchAdminEvent('gvdg:admin-course-layouts-state', state);
}

function finishCourseLayoutsAction(requestId, ok, extra) {
  if (requestId) dispatchAdminEvent('gvdg:admin-course-layouts-action-result', { ...(extra || {}), ok, requestId });
}

function parseLayoutHolesForReact(layout) {
  if (Array.isArray(layout && layout.holes)) return layout.holes;
  try {
    const parsed = JSON.parse((layout && layout.holes) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function normalizeCourseLayoutForReact(layout) {
  return { ...(layout || {}), holes: parseLayoutHolesForReact(layout) };
}

export function installCourseLayoutsController({ api, adminApi, adminMsg }) {
  async function loadCourseLayouts(detail) {
    const courseId = detail && detail.courseId ? String(detail.courseId) : '';
    if (!courseId) {
      setAdminCourseLayoutsState({ status: 'idle', courseId: '', layouts: [], positions: [] });
      return;
    }
    setAdminCourseLayoutsState({ status: 'loading', courseId, layouts: [], positions: [] });
    let positions = [];
    let layouts = [];
    try {
      const [positionResponse, layoutResponse] = await Promise.all([
        api('/courses/' + encodeURIComponent(courseId) + '/positions'),
        api('/courses/' + encodeURIComponent(courseId) + '/layouts'),
      ]);
      if (positionResponse.ok) positions = ((await positionResponse.json()).positions || []);
      if (layoutResponse.ok) layouts = ((await layoutResponse.json()).layouts || []).map(normalizeCourseLayoutForReact);
      setAdminCourseLayoutsState({ status: 'ready', courseId, layouts, positions });
    } catch (e) {
      setAdminCourseLayoutsState({ status: 'error', courseId, layouts, positions });
    }
  }

  async function adminAddLayoutPositionFromReact(detail) {
    const courseId = detail.courseId;
    const body = detail.body || {};
    if (!courseId || !body.label) {
      adminMsg('Position label required', false);
      finishCourseLayoutsAction(detail.requestId, false);
      return;
    }
    const r = await adminApi('/admin/courses/' + encodeURIComponent(courseId) + '/positions', { method: 'POST', body });
    adminMsg(r.ok ? 'Added ' + body.kind : 'Add position failed (' + r.status + ')', r.ok);
    finishCourseLayoutsAction(detail.requestId, r.ok);
    if (r.ok) await loadCourseLayouts({ courseId });
  }

  async function adminDeleteLayoutPositionFromReact(detail) {
    const courseId = detail.courseId;
    const position = detail.position || {};
    if (!courseId || position.id == null) return;
    const r = await adminApi('/admin/courses/' + encodeURIComponent(courseId) + '/positions/' + encodeURIComponent(position.id), { method: 'DELETE' });
    adminMsg(r.ok ? 'Removed position' : 'Remove failed (' + r.status + ')', r.ok);
    finishCourseLayoutsAction(detail.requestId, r.ok);
    if (r.ok) await loadCourseLayouts({ courseId });
  }

  async function adminFetchUdiscLayoutsFromReact(detail) {
    const courseId = detail.courseId;
    const url = typeof detail.url === 'string' ? detail.url.trim() : '';
    if (!url) {
      adminMsg('Paste a UDisc course URL', false);
      finishCourseLayoutsAction(detail.requestId, false, { message: 'Paste a UDisc course URL', layouts: [] });
      return;
    }
    adminMsg('Fetching from UDisc...', true);
    const r = await adminApi('/admin/import/udisc', { method: 'POST', body: { url } });
    if (!r.ok) {
      adminMsg('UDisc import failed (' + r.status + ')', false);
      finishCourseLayoutsAction(detail.requestId, false, { message: 'UDisc import failed (' + r.status + ')', layouts: [] });
      return;
    }
    const data = await r.json();
    const messages = [];
    if (data.udisc_course_id && courseId) {
      const pr = await adminApi('/admin/courses/' + encodeURIComponent(courseId), { method: 'PATCH', body: { udisc_course_id: String(data.udisc_course_id) } });
      messages.push(pr.ok ? 'Saved UDisc course id ' + data.udisc_course_id + '.' : 'Found UDisc course id ' + data.udisc_course_id + ' but could not save it (' + pr.status + ').');
    } else if (!data.udisc_course_id) {
      messages.push('No UDisc course id found on that page; enter it on the course form if needed.');
    }
    const layouts = Array.isArray(data.layouts) ? data.layouts : [];
    if (!layouts.length) {
      messages.push('No scorable layouts found on that UDisc page' + (data.name ? ' (' + data.name + ')' : '') + '. Enter pars manually below.');
      adminMsg('No layouts found', false);
    } else {
      messages.push(layouts.length + ' UDisc layout' + (layouts.length > 1 ? 's' : '') + ' found.');
      adminMsg(layouts.length + ' layout' + (layouts.length > 1 ? 's' : '') + ' loaded', true);
    }
    finishCourseLayoutsAction(detail.requestId, true, { layouts, message: messages.join(' ') });
  }

  async function adminApplyUdiscLayoutFromReact(detail) {
    const courseId = detail.courseId;
    const layout = detail.layout || {};
    if (!courseId) {
      adminMsg('Pick a course first', false);
      finishCourseLayoutsAction(detail.requestId, false);
      return;
    }
    if (layout.positions && layout.positions.length) {
      const pr = await adminApi('/admin/courses/' + encodeURIComponent(courseId) + '/positions', { method: 'PUT', body: { positions: layout.positions } });
      if (!pr.ok) {
        adminMsg('Could not import tee/target positions (' + pr.status + ')', false);
        finishCourseLayoutsAction(detail.requestId, false);
        return;
      }
    }
    await loadCourseLayouts({ courseId });
    adminMsg('Applied ' + (layout.name || 'Layout') + '. Review the pars below, then save.', true);
    finishCourseLayoutsAction(detail.requestId, true, { layout });
  }

  async function adminSaveCourseLayoutFromReact(detail) {
    const courseId = detail.courseId;
    const layout = detail.layout || {};
    const holes = Array.isArray(layout.holes) ? layout.holes : [];
    const name = (typeof layout.name === 'string' && layout.name.trim()) || 'Main';
    if (!courseId) { adminMsg('Pick a course first', false); finishCourseLayoutsAction(detail.requestId, false); return; }
    if (!holes.length) { adminMsg('Add at least one hole', false); finishCourseLayoutsAction(detail.requestId, false); return; }
    if (holes.some((h) => !(h.par >= 1 && h.par <= 15))) { adminMsg('Every hole needs a par 1-15', false); finishCourseLayoutsAction(detail.requestId, false); return; }
    const r = layout.id
      ? await adminApi('/admin/layouts/' + encodeURIComponent(layout.id), { method: 'PATCH', body: { name, holes } })
      : await adminApi('/admin/layouts', { method: 'POST', body: { course_id: Number(courseId), name, holes } });
    adminMsg(r.ok ? ((layout.id ? 'Updated' : 'Saved') + ' layout "' + name + '"') : 'Save layout failed (' + r.status + ')', r.ok);
    finishCourseLayoutsAction(detail.requestId, r.ok);
    if (r.ok) await loadCourseLayouts({ courseId });
  }

  async function adminDeleteCourseLayoutFromReact(detail) {
    const layout = detail.layout || {};
    const courseId = layout.course_id || detail.courseId;
    if (layout.id == null) return;
    const r = await adminApi('/admin/layouts/' + encodeURIComponent(layout.id), { method: 'DELETE' });
    adminMsg(r.ok ? 'Deleted layout' : 'Delete failed (' + r.status + ')', r.ok);
    finishCourseLayoutsAction(detail.requestId, r.ok);
    if (r.ok && courseId) await loadCourseLayouts({ courseId });
  }

  window.addEventListener('gvdg:admin-course-layouts-load-request', async (event) => {
    await loadCourseLayouts(event.detail || {});
  });
  window.addEventListener('gvdg:admin-course-layout-position-add-request', async (event) => {
    await adminAddLayoutPositionFromReact(event.detail || {});
  });
  window.addEventListener('gvdg:admin-course-layout-position-delete-request', async (event) => {
    await adminDeleteLayoutPositionFromReact(event.detail || {});
  });
  window.addEventListener('gvdg:admin-course-layout-udisc-fetch-request', async (event) => {
    await adminFetchUdiscLayoutsFromReact(event.detail || {});
  });
  window.addEventListener('gvdg:admin-course-layout-udisc-apply-request', async (event) => {
    await adminApplyUdiscLayoutFromReact(event.detail || {});
  });
  window.addEventListener('gvdg:admin-course-layout-save-request', async (event) => {
    await adminSaveCourseLayoutFromReact(event.detail || {});
  });
  window.addEventListener('gvdg:admin-course-layout-delete-request', async (event) => {
    await adminDeleteCourseLayoutFromReact(event.detail || {});
  });

  return { loadCourseLayouts };
}
