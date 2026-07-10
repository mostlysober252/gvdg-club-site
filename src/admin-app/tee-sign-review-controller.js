function dispatchAdminEvent(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function setAdminTeeSignReviewState(state) {
  dispatchAdminEvent('gvdg:admin-tee-sign-review', state);
}

function currentCourses(getCourses) {
  const courses = getCourses();
  return Array.isArray(courses) ? courses : [];
}

export function installTeeSignReviewController({ adminApi, adminMsg, api, authBase, getCourses, ensureCoursesLoaded }) {
  let teeSignReviewControlsSnapshot = {};

  function adminTeeSignReviewControlsState(detail) {
    const source = detail && typeof detail === 'object' ? detail : teeSignReviewControlsSnapshot;
    const status = ['candidate', 'official', 'rejected'].includes(source.status) ? source.status : 'candidate';
    teeSignReviewControlsSnapshot = { status };
    return teeSignReviewControlsSnapshot;
  }

  async function tsLayoutsForCourse(courseId) {
    try {
      const r = await api('/courses/' + encodeURIComponent(courseId) + '/layouts');
      if (r.ok) return (await r.json()).layouts || [];
    } catch (e) {}
    return [];
  }

  async function loadReview(detail) {
    const { status: queueStatus } = adminTeeSignReviewControlsState(detail);
    setAdminTeeSignReviewState({ status: 'loading', queueStatus, signs: [], courses: currentCourses(getCourses), layoutsByCourse: {}, authBase });
    if (!currentCourses(getCourses).length) await ensureCoursesLoaded();
    const courses = currentCourses(getCourses);
    let r;
    try {
      r = await adminApi('/admin/tee-signs?status=' + encodeURIComponent(queueStatus));
    } catch (e) {
      setAdminTeeSignReviewState({ status: 'error', queueStatus, signs: [], courses, layoutsByCourse: {}, authBase });
      return;
    }
    if (!r.ok) {
      setAdminTeeSignReviewState({ status: 'error', queueStatus, signs: [], courses, layoutsByCourse: {}, authBase });
      return;
    }
    const signs = (await r.json()).teeSigns || [];
    const layoutsByCourse = {};
    for (const sign of signs) {
      const cid = Number(sign.course_id);
      if (!layoutsByCourse[String(cid)]) layoutsByCourse[String(cid)] = await tsLayoutsForCourse(cid);
    }
    setAdminTeeSignReviewState({ status: 'ready', queueStatus, signs, courses: currentCourses(getCourses), layoutsByCourse, authBase });
  }

  function finishTeeSignReviewAction(requestId, ok) {
    if (requestId) dispatchAdminEvent('gvdg:admin-tee-sign-review-action-result', { requestId, ok });
  }

  async function tsApproveFromReact(detail) {
    const sign = detail.sign || {};
    const rows = Array.isArray(detail.rows) ? detail.rows : [];
    if (!rows.length) {
      adminMsg('Add at least one valid row before approving', false);
      finishTeeSignReviewAction(detail.requestId, false);
      return;
    }
    const r = await adminApi('/admin/tee-signs/' + sign.id + '/approve', { method: 'POST', body: { rows } });
    adminMsg(r.ok ? 'Tee sign approved and layout holes updated' : 'Approve failed (' + r.status + ')', r.ok);
    finishTeeSignReviewAction(detail.requestId, r.ok);
    if (r.ok) loadReview();
  }

  async function tsExtractFromReact(detail) {
    const sign = detail.sign || {};
    adminMsg('Re-running tee-sign vision...', true);
    const r = await adminApi('/admin/tee-signs/' + sign.id + '/extract', { method: 'POST', body: {} });
    adminMsg(r.ok ? 'Vision extraction refreshed' : 'Vision refresh failed (' + r.status + ')', r.ok);
    finishTeeSignReviewAction(detail.requestId, r.ok);
    if (r.ok) loadReview();
  }

  async function tsRejectFromReact(detail) {
    const sign = detail.sign || {};
    const r = await adminApi('/admin/tee-signs/' + sign.id + '/reject', { method: 'POST', body: {} });
    adminMsg(r.ok ? 'Tee sign rejected' : 'Reject failed (' + r.status + ')', r.ok);
    finishTeeSignReviewAction(detail.requestId, r.ok);
    if (r.ok) loadReview();
  }

  async function tsDeleteFromReact(detail) {
    const sign = detail.sign || {};
    const r = await adminApi('/admin/tee-signs/' + sign.id, { method: 'DELETE' });
    adminMsg(r.ok ? 'Tee sign deleted' : 'Delete failed (' + r.status + ')', r.ok);
    finishTeeSignReviewAction(detail.requestId, r.ok);
    if (r.ok) loadReview();
  }

  window.addEventListener('gvdg:admin-tee-sign-review-controls-request', async (event) => {
    await loadReview(event.detail || {});
  });
  window.addEventListener('gvdg:admin-tee-sign-review-approve-request', async (event) => {
    await tsApproveFromReact(event.detail || {});
  });
  window.addEventListener('gvdg:admin-tee-sign-review-extract-request', async (event) => {
    await tsExtractFromReact(event.detail || {});
  });
  window.addEventListener('gvdg:admin-tee-sign-review-reject-request', async (event) => {
    await tsRejectFromReact(event.detail || {});
  });
  window.addEventListener('gvdg:admin-tee-sign-review-delete-request', async (event) => {
    await tsDeleteFromReact(event.detail || {});
  });

  return { loadReview };
}
