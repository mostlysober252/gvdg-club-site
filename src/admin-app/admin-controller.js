import { adminConfirm } from "./admin-dialogs.js";
import { publishAdminActiveTab, publishAdminAuthGateState, publishAdminMessageState, publishAdminOrdersBadgeCount } from "./admin-shell-state.js";
import { installCourseLayoutsController } from "./course-layouts-controller.js";
import { installDataArchiveController } from "./data-archive-controller.js";
import { installImportController } from "./import-controller.js";
import { installTeeSignReviewController } from "./tee-sign-review-controller.js";
import { normalizeConfig as normalizeScoringConfig } from "./scoring-model.js";
import { resolveApiBase } from "../shared/api-base.js";

export function startAdminController() {
        // ============================================================
        //  Config + auth — admin.html relies on the session the member
        //  established on the Members page. The session token lives in
        //  sessionStorage under 'gvdg_member_token' and is preserved
        //  across same-origin, same-tab navigation.
        // ============================================================
        const AUTH_BASE = resolveApiBase({ datasetKeys: ['authBase'] });
        const TOKEN_KEY = 'gvdg_member_token';
        const NAME_KEY = 'gvdg_member_name';
        const PDGA_KEY = 'gvdg_member_pdga';
        let ME_ID = null;   // the signed-in admin's memberId (from /me .sub), for the self-demote warning

        // Shared fetch helper (mirrors gvdg-members.html `api()`).
        function api(path, { method = 'GET', token, body } = {}) {
            const headers = {};
            if (body) headers['Content-Type'] = 'application/json';
            if (token) headers['Authorization'] = 'Bearer ' + token;
            return fetch(AUTH_BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
        }

        function setAdminAuthGateState(state) {
            publishAdminAuthGateState(state);
        }

        function showAdminPanel() {
            setAdminAuthGateState({ status: 'panel' });
            initAdmin();
        }

        // Render the gate with a message and (optionally) a link back to the
        // Members page so the user can sign in. Never injects API data.
        function showGate(message, withMembersLink) {
            setAdminAuthGateState({ status: 'gate', message, withMembersLink: Boolean(withMembersLink) });
        }

        // On load: verify the session token grants admin, then show the panel.
        async function checkAdminSession() {
            const token = sessionStorage.getItem(TOKEN_KEY);
            if (!token) {
                showGate('Admin sign-in required — please log in on the Members page first.', true);
                return;
            }
            try {
                const res = await api('/me', { token });
                if (res.status === 200) {
                    const data = await res.json();
                    ME_ID = data && data.sub ? data.sub : null;
                    if (data && data.isAdmin === true) {
                        showAdminPanel();
                    } else {
                        showGate("You don't have admin access.", false);
                    }
                } else {
                    showGate('Session expired — log in again.', true);
                }
            } catch (e) {
                showGate('Session expired — log in again.', true);
            }
        }

        let adminInited = false;
        function setAdminMessageState(state) {
            publishAdminMessageState(state);
        }
        function adminMsg(text, ok) {
            const message = text || '';
            setAdminMessageState({ text: message, ok: message ? ok === true : null });
        }
        function adminApi(path, opts) { return api(path, { ...(opts || {}), token: sessionStorage.getItem(TOKEN_KEY) }); }
        function dollarsFromCents(c) { const n = Number(c || 0); const abs = Math.abs(n); const out = '$' + (abs / 100).toLocaleString(undefined, { minimumFractionDigits: abs % 100 ? 2 : 0 }); return n < 0 ? '-' + out : out; }
        function dollarsToCents(v) { const n = parseFloat(v); return Number.isFinite(n) ? Math.round(n * 100) : null; }
        let adminCoursesCache = [];
        let loadTeeSignReview = async () => {};
        let adminProductInventoryControlsSnapshot = {};
        let adminOrderControlsSnapshot = {};
        function adminSwitch(tab) {
            publishAdminActiveTab(tab);
            if (tab === 'create') { adminLoadCourses(); adminLoadLeagues(); }
            if (tab === 'scoring') scLoadEvents();
            if (tab === 'layouts') adminLoadCourses();
            if (tab === 'leagues-mgmt') adminLoadLeagues();
            if (tab === 'fundraisers') adminLoadFundraisers();
            if (tab === 'meetings') adminLoadMeetings();
            if (tab === 'registration') rgLoadEvents();
            if (tab === 'shop') adminLoadProducts();
            if (tab === 'orders') adminLoadOrders();
            if (tab === 'tee-signs') loadTeeSignReview();
            if (tab === 'members') adminLoadMembers();
        }

        function setAdminEventFormLayoutsState(state) {
            window.dispatchEvent(new CustomEvent('gvdg:admin-event-form-layouts', { detail: state }));
        }
        async function adminLoadEventFormLayouts(detail) {
            const courseId = detail && detail.courseId != null ? String(detail.courseId) : '';
            if (!courseId) {
                setAdminEventFormLayoutsState({ courseId: '', layouts: [], status: 'idle' });
                return;
            }
            setAdminEventFormLayoutsState({ courseId, layouts: [], status: 'loading' });
            try {
                const r = await api('/courses/' + encodeURIComponent(courseId) + '/layouts');
                if (r.ok) {
                    const layouts = (await r.json()).layouts || [];
                    setAdminEventFormLayoutsState({ courseId, layouts, status: 'ready' });
                    return;
                }
            } catch (e) {}
            setAdminEventFormLayoutsState({ courseId, layouts: [], status: 'error' });
        }

        async function adminLoadCourses() {
            let courses = [];
            try { const r = await api('/courses'); if (r.ok) courses = (await r.json()).courses || []; } catch (e) {}
            adminCoursesCache = courses;
            setAdminCoursesListState({ courses });
        }
        function setAdminCoursesListState(state) {
            window.dispatchEvent(new CustomEvent('gvdg:admin-courses-list', { detail: state }));
        }

        async function adminLoadEvents() {
            window.dispatchEvent(new CustomEvent('gvdg:admin-events-list', { detail: { status: 'loading', events: [] } }));
            let events = [];
            try { const r = await api('/events'); if (r.ok) events = (await r.json()).events || []; } catch (e) {}
            window.dispatchEvent(new CustomEvent('gvdg:admin-events-list', { detail: { status: 'ready', events } }));
        }

        function aeResetForm() {
            window.dispatchEvent(new CustomEvent('gvdg:admin-event-form-reset'));
        }
        function aeEditEvent(ev) {
            adminSwitch('create');
            window.dispatchEvent(new CustomEvent('gvdg:admin-event-form-edit', { detail: { event: ev } }));
        }
        async function adminSaveEventFromReact(detail) {
            const requestId = detail && detail.requestId;
            if (!requestId) return;
            const body = detail.body || {};
            if (detail.valid !== true || !String(body.name || '').trim()) {
                const message = detail.message || 'Name required';
                adminMsg(message, false);
                window.dispatchEvent(new CustomEvent('gvdg:admin-event-save-result', { detail: { ok: false, requestId, message } }));
                return;
            }
            let r;
            try {
                r = detail.eventId != null
                    ? await adminApi('/admin/events/' + detail.eventId, { method: 'PATCH', body })
                    : await adminApi('/admin/events', { method: 'POST', body: { ...body, source: 'manual' } });
            } catch (e) {
                const message = detail.eventId != null ? 'Update failed' : 'Create failed';
                adminMsg(message, false);
                window.dispatchEvent(new CustomEvent('gvdg:admin-event-save-result', { detail: { ok: false, requestId, message } }));
                return;
            }
            if (r.ok) {
                adminMsg((detail.eventId != null ? 'Updated' : 'Created') + ' "' + body.name + '"', true);
                window.dispatchEvent(new CustomEvent('gvdg:admin-event-save-result', { detail: { ok: true, requestId } }));
                adminSwitch('events');
                adminLoadEvents();
            } else {
                const message = (detail.eventId != null ? 'Update' : 'Create') + ' failed (' + r.status + ')';
                adminMsg(message, false);
                window.dispatchEvent(new CustomEvent('gvdg:admin-event-save-result', { detail: { ok: false, requestId, message } }));
            }
        }

        async function adminAddCourseFromReact(detail) {
            const requestId = detail.requestId;
            if (!requestId) return;
            const body = detail.body || {};
            const name = String(body.name || '').trim();
            if (detail.valid !== true || !name) {
                const message = 'Course name required';
                adminMsg(message, false);
                window.dispatchEvent(new CustomEvent('gvdg:admin-course-create-result', { detail: { ok: false, requestId, message } }));
                return;
            }
            let r;
            try {
                r = await adminApi('/admin/courses', { method: 'POST', body });
            } catch (err) {
                const message = 'Add course failed';
                adminMsg(message, false);
                window.dispatchEvent(new CustomEvent('gvdg:admin-course-create-result', { detail: { ok: false, requestId, message } }));
                return;
            }
            if (r.ok) {
                adminMsg('Added course "' + (detail.labelText || name) + '"', true);
                window.dispatchEvent(new CustomEvent('gvdg:admin-course-create-result', { detail: { ok: true, requestId } }));
                adminLoadCourses();
            } else {
                const message = 'Add course failed (' + r.status + ')';
                adminMsg(message, false);
                window.dispatchEvent(new CustomEvent('gvdg:admin-course-create-result', { detail: { ok: false, requestId, message } }));
            }
        }

        // ============================================================
        //  Live Scoring (S2). React owns the visible scorekeeper UI; this
        //  bridge loads events/snapshots, handles admin API requests, and
        //  publishes state/result events.
        // ============================================================
        let scEventId = null, scSnap = null, scSelectedEvent = null, scTeeSignData = { teeSigns: [], layouts: [] };
        let scEventsState = { status: 'loading', events: [] };
        let scState = { eventId: '', layouts: [], status: 'idle' };
        function scCurrentConfig(config) {
            return normalizeScoringConfig(config || null, null, null);
        }
        function setAdminScoringEventsState(state) {
            scEventsState = state && typeof state === 'object' ? state : { status: 'loading', events: [] };
            window.dispatchEvent(new CustomEvent('gvdg:admin-scoring-events-state', { detail: scEventsState }));
        }
        function setAdminScoringState(state) {
            scState = state && typeof state === 'object' ? state : { eventId: '', layouts: [], status: 'idle' };
            window.dispatchEvent(new CustomEvent('gvdg:admin-scoring-state', { detail: scState }));
        }
        function finishAdminScoringAction(kind, ok, extra) {
            window.dispatchEvent(new CustomEvent('gvdg:admin-scoring-action-result', { detail: { ...(extra || {}), kind, ok } }));
        }
        function scEvents() {
            return scEventsState && Array.isArray(scEventsState.events) ? scEventsState.events : [];
        }
        function scEventById(id) {
            return scEvents().find((event) => String(event && event.id) === String(id)) || null;
        }
        function scEventConfig(event) {
            return normalizeScoringConfig(event && (event.liveScoringConfig || event.live_scoring_config || event.live_scoring_config_json || null), event && event.play_format, event && event.format);
        }
        async function scLayoutsForEvent(event) {
            const courseId = event && event.course_id;
            if (!courseId) return [];
            try {
                const r = await api('/courses/' + encodeURIComponent(courseId) + '/layouts');
                if (r.ok) return (await r.json()).layouts || [];
            } catch (e) {}
            return [];
        }

        async function scLoadEvents() {
            setAdminScoringEventsState({ status: 'loading', events: [] });
            let events = [];
            try { const r = await api('/events'); if (r.ok) events = (await r.json()).events || []; } catch (e) {}
            setAdminScoringEventsState({ status: 'ready', events });
            if (scEventId) scSelectedEvent = scEventById(scEventId) || scSelectedEvent;
        }

        async function scSelectEventFromReact(detail) {
            scEventId = detail && detail.eventId ? Number(detail.eventId) : null;
            scSnap = null;
            scTeeSignData = { teeSigns: [], layouts: [] };
            if (!scEventId) {
                scSelectedEvent = null;
                setAdminScoringState({ eventId: '', layouts: [], status: 'idle' });
                return;
            }
            scSelectedEvent = scEventById(scEventId);
            if (!scSelectedEvent) {
                setAdminScoringState({ eventId: String(scEventId), layouts: [], message: 'Event not found.', status: 'error' });
                return;
            }
            setAdminScoringState({ event: scSelectedEvent, eventId: String(scEventId), layouts: [], status: 'loading' });
            if (scSelectedEvent.status === 'live') {
                await scRefresh();
                return;
            }
            const layouts = await scLayoutsForEvent(scSelectedEvent);
            setAdminScoringState({
                config: scEventConfig(scSelectedEvent),
                event: scSelectedEvent,
                eventId: String(scEventId),
                layoutId: scSelectedEvent.layout_id == null ? '' : String(scSelectedEvent.layout_id),
                layouts,
                status: 'start',
                validation: '',
            });
        }

        async function scStartFromReact(detail) {
            scEventId = detail && detail.eventId ? Number(detail.eventId) : scEventId;
            scSelectedEvent = scEventById(scEventId) || scSelectedEvent;
            const layoutId = detail && detail.layoutId ? Number(detail.layoutId) : null;
            if (layoutId) {
                const pr = await adminApi('/admin/events/' + scEventId, { method: 'PATCH', body: { layout_id: layoutId } });
                if (pr.ok && scSelectedEvent) scSelectedEvent.layout_id = layoutId;
            }
            const liveScoringConfig = scCurrentConfig(detail && detail.liveScoringConfig);
            if (liveScoringConfig.scoringStyle === 'matchplay') {
                const current = scState && typeof scState === 'object' ? scState : {};
                setAdminScoringState({ ...current, validation: 'Match play requires exactly two score targets per card; start will be blocked if the roster/pairs do not satisfy that.' });
            }
            // The round always seeds from BOTH registered players and manually-added walk-ons (unioned server-side).
            const r = await adminApi('/events/' + scEventId + '/live/start', { method: 'POST', body: { liveScoringConfig } });
            if (r.ok) {
                adminMsg('Live scoring started', true);
                if (scSelectedEvent) scSelectedEvent.status = 'live';
                finishAdminScoringAction('start', true);
                await scRefresh();
            } else {
                const e = await r.json().catch(() => ({}));
                adminMsg(e.error === 'no_layout_holes' ? 'That event has no layout with pars - pick one above (or build one on the Layouts tab).' : 'Start failed (' + r.status + ')', false);
                finishAdminScoringAction('start', false);
            }
        }

        async function scRefresh() {
            if (!scEventId) return;
            const r = await api('/events/' + scEventId + '/live');
            if (!r.ok) {
                setAdminScoringState({ event: scSelectedEvent, eventId: String(scEventId), layouts: [], message: 'Live scoring is not available for this event.', status: 'error' });
                return;
            }
            scSnap = await r.json();
            if (scSnap.status !== 'live' && scSnap.status !== 'final') {
                setAdminScoringState({ event: scSelectedEvent, eventId: String(scEventId), layouts: [], status: 'idle' });
                return;
            }
            scTeeSignData = await scLoadTeeSignData();
            publishScoringLiveState();
            if (scSnap.status === 'live') scConnectWs();
        }
        async function scLoadTeeSignData() {
            const courseId = scSelectedEvent && scSelectedEvent.course_id;
            if (!courseId) return { teeSigns: [], layouts: [] };
            const token = sessionStorage.getItem(TOKEN_KEY);
            const [td, ld] = await Promise.all([
                api('/courses/' + encodeURIComponent(courseId) + '/tee-signs', { token }).then((r) => r.ok ? r.json() : null).catch(() => null),
                api('/courses/' + encodeURIComponent(courseId) + '/layouts').then((r) => r.ok ? r.json() : null).catch(() => null),
            ]);
            return { authBase: AUTH_BASE, layouts: (ld && ld.layouts) || [], teeSigns: (td && td.teeSigns) || [], token };
        }
        function publishScoringLiveState() {
            const live = scSnap && scSnap.status === 'live';
            setAdminScoringState({
                authBase: AUTH_BASE,
                canCancel: live,
                canOverride: live,
                event: scSelectedEvent,
                eventId: String(scEventId || ''),
                layouts: [],
                snap: scSnap,
                status: scSnap && scSnap.status === 'final' ? 'final' : 'live',
                teeSignData: scTeeSignData,
            });
        }

        // Subscribe to the live event's WebSocket so scores entered by players on the course appear here
        // as they happen. React score inputs preserve focused drafts while snapshots refresh.
        let scWs = null, scWsEvent = null, scWsTimer = null;
        function scConnectWs() {
            if (scWsEvent === scEventId && scWs && scWs.readyState <= 1) return;
            try { if (scWs) scWs.close(); } catch (e) {}
            scWsEvent = scEventId;
            let ws;
            try { ws = new WebSocket(AUTH_BASE.replace(/^http/, 'ws') + '/events/' + scEventId + '/live/ws'); } catch (e) { return; }
            scWs = ws;
            ws.addEventListener('message', (ev) => {
                let msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
                if (msg && msg.type === 'snapshot' && scWsEvent === scEventId) { scSnap = msg; publishScoringLiveState(); }
            });
            ws.addEventListener('close', () => { if (scWsEvent === scEventId && !scWsTimer) scWsTimer = setTimeout(() => { scWsTimer = null; if (scWsEvent === scEventId) scConnectWs(); }, 4000); });
            ws.addEventListener('error', () => { try { ws.close(); } catch (e) {} });
        }

        async function scApplyOverrideFromReact(detail) {
            const clear = detail && detail.clear === true;
            const hole = Number(detail && detail.hole);
            if (!hole) { adminMsg('Pick a hole to override', false); return; }
            const body = { hole, clear };
            if (!clear) {
                const par = parseInt(detail && detail.par, 10);
                const dist = parseInt(detail && detail.distance, 10);
                if (Number.isFinite(par)) { if (par < 1 || par > 15) { adminMsg('Par must be 1-15', false); return; } body.par = par; }
                if (Number.isFinite(dist)) { if (dist < 20 || dist > 2000) { adminMsg('Distance must be 20-2000 ft', false); return; } body.distance_ft = dist; }
                if (body.par == null && body.distance_ft == null) { adminMsg('Enter a temporary par and/or distance', false); return; }
            }
            const r = await adminApi('/events/' + scEventId + '/live/override', { method: 'POST', body });
            if (r.ok) { adminMsg(clear ? 'Override cleared - hole reverted' : 'Temporary override applied (this round only)', true); await scRefresh(); }
            else { const e = await r.json().catch(() => ({})); adminMsg(e.error === 'empty_override' ? 'Enter a temporary par and/or distance' : 'Override failed (' + r.status + ')', false); }
        }

        async function scPostScoreFromReact(detail) {
            const row = detail && detail.row || {};
            const hole = Number(detail && detail.hole);
            const strokes = parseInt(detail && detail.value, 10);
            if (!(strokes >= 1 && strokes <= 30)) { adminMsg('Strokes must be 1–30', false); return; }
            const body = { hole, strokes };
            if (row.targetId) body.targetId = row.targetId;
            else body.index = row.index;
            const r = await adminApi('/events/' + scEventId + '/live/score', { method: 'POST', body });
            if (r.ok) { scSnap = await r.json(); publishScoringLiveState(); }
            else { adminMsg('Score save failed', false); }
        }

        function scFinalize() { return doFinalize(false); } // click handler (no args)
        async function scCancel() {
            const confirmed = await adminConfirm({
                title: 'Cancel live scoring',
                message: 'Cancel live scoring for this event? This wipes every entered score and returns the event to Scheduled so you can re-start it.',
                confirmText: 'Cancel scoring',
                danger: true,
            });
            if (!confirmed) return;
            const r = await adminApi('/events/' + scEventId + '/live/cancel', { method: 'POST' });
            if (r.ok) {
                adminMsg('Scoring cancelled — event returned to Scheduled.', true);
                try { if (scWs) scWs.close(); } catch (e) {} scWsEvent = null;
                if (scSelectedEvent) scSelectedEvent.status = 'scheduled';
                await scLoadEvents();
                await scSelectEventFromReact({ eventId: scEventId });
                adminLoadEvents();
                return;
            }
            adminMsg('Cancel failed (' + r.status + ')', false);
        }
        async function doFinalize(force, skipConfirm) {
            if (!skipConfirm) {
                const ask = force
                    ? 'Force-finalize despite unmatched scorecards? Results lock exactly as they stand.'
                    : 'Finalize this event? This writes final results and closes scoring.';
                const confirmed = await adminConfirm({
                    title: force ? 'Force-finalize event' : 'Finalize event',
                    message: ask,
                    confirmText: force ? 'Force-finalize' : 'Finalize',
                    danger: force,
                });
                if (!confirmed) return;
            }
            const r = await adminApi('/events/' + scEventId + '/live/finalize', { method: 'POST', ...(force ? { body: { force: true } } : {}) });
            if (r.ok) { adminMsg('Event finalized — results saved.', true); scEventId = null; scSnap = null; scSelectedEvent = null; setAdminScoringState({ eventId: '', layouts: [], status: 'idle' }); scLoadEvents(); adminLoadEvents(); return; }
            const data = await r.json().catch(() => ({}));
            if (r.status === 409 && data.error === 'scorecard_incomplete') {
                const conflicts = Array.isArray(data.conflicts) ? data.conflicts.length : 0;
                const missing = Array.isArray(data.missing) ? data.missing.length : 0;
                const c = conflicts + ' conflict' + (conflicts === 1 ? '' : 's');
                const m = missing + ' unconfirmed score' + (missing === 1 ? '' : 's');
                adminMsg('Scorecards don’t agree yet: ' + c + ', ' + m + '.', false);
                await scRefresh();
                // Admin override: the finalize route is admin-gated, so an admin may push it through.
                const confirmed = await adminConfirm({
                    title: 'Force-finalize event',
                    message: 'Scorecards don’t fully agree (' + c + ', ' + m + '). Force-finalize as admin and lock results as they stand?',
                    confirmText: 'Force-finalize',
                    danger: true,
                });
                if (confirmed) return doFinalize(true, true); // this prompt IS the force confirmation → skip the inner one
            } else {
                adminMsg('Finalize failed (' + r.status + ')', false);
            }
        }

        // ---- Leagues management (Phase 4) ----
        async function adminLoadLeagues() {
            let leagues = [];
            try { const r = await api('/leagues'); if (r.ok) leagues = (await r.json()).leagues || []; } catch (e) {}
            window.dispatchEvent(new CustomEvent('gvdg:admin-leagues-list', { detail: { leagues } }));
        }
        async function adminAddLeagueFromReact(detail) {
            const requestId = detail.requestId;
            if (!requestId) return;
            const body = detail.body || {};
            const name = String(body.name || '').trim();
            if (detail.valid !== true || !name) {
                const message = 'League name required';
                adminMsg(message, false);
                window.dispatchEvent(new CustomEvent('gvdg:admin-league-create-result', { detail: { ok: false, requestId, message } }));
                return;
            }
            let r;
            try {
                r = await adminApi('/admin/leagues', { method: 'POST', body });
            } catch (err) {
                const message = 'Add league failed';
                adminMsg(message, false);
                window.dispatchEvent(new CustomEvent('gvdg:admin-league-create-result', { detail: { ok: false, requestId, message } }));
                return;
            }
            if (r.ok) {
                adminMsg('Added league "' + (detail.labelText || name) + '"', true);
                window.dispatchEvent(new CustomEvent('gvdg:admin-league-create-result', { detail: { ok: true, requestId } }));
                adminLoadLeagues();
            } else {
                const message = 'Add league failed (' + r.status + ')';
                adminMsg(message, false);
                window.dispatchEvent(new CustomEvent('gvdg:admin-league-create-result', { detail: { ok: false, requestId, message } }));
            }
        }

        // ---- Fundraisers management (Phase 4) ----
        async function adminLoadFundraisers() {
            let items = [];
            try { const r = await api('/fundraisers'); if (r.ok) items = (await r.json()).fundraisers || []; } catch (e) {}
            window.dispatchEvent(new CustomEvent('gvdg:admin-fundraisers-list', { detail: { fundraisers: items } }));
        }
        async function adminAddFundraiserFromReact(detail) {
            const requestId = detail.requestId;
            if (!requestId) return;
            const body = detail.body || {};
            const title = String(body.title || '').trim();
            if (detail.valid !== true || !title) {
                const message = 'Title required';
                adminMsg(message, false);
                window.dispatchEvent(new CustomEvent('gvdg:admin-fundraiser-create-result', { detail: { ok: false, requestId, message } }));
                return;
            }
            let r;
            try {
                r = await adminApi('/admin/fundraisers', { method: 'POST', body });
            } catch (err) {
                const message = 'Add failed';
                adminMsg(message, false);
                window.dispatchEvent(new CustomEvent('gvdg:admin-fundraiser-create-result', { detail: { ok: false, requestId, message } }));
                return;
            }
            if (r.ok) {
                adminMsg('Added fundraiser', true);
                window.dispatchEvent(new CustomEvent('gvdg:admin-fundraiser-create-result', { detail: { ok: true, requestId } }));
                adminLoadFundraisers();
            } else {
                const message = 'Add failed (' + r.status + ')';
                adminMsg(message, false);
                window.dispatchEvent(new CustomEvent('gvdg:admin-fundraiser-create-result', { detail: { ok: false, requestId, message } }));
            }
        }

        // ---- Meetings management (Phase 4) ----
        async function adminLoadMeetings() {
            let items = [];
            try { const r = await api('/meetings'); if (r.ok) items = (await r.json()).meetings || []; } catch (e) {}
            window.dispatchEvent(new CustomEvent('gvdg:admin-meetings-list', { detail: { meetings: items } }));
        }
        async function adminAddMeetingFromReact(detail) {
            const requestId = detail.requestId;
            if (!requestId) return;
            const body = detail.body || {};
            const title = String(body.title || '').trim();
            if (detail.valid !== true || !body.date || !title) {
                const message = 'Date and title required';
                adminMsg(message, false);
                window.dispatchEvent(new CustomEvent('gvdg:admin-meeting-create-result', { detail: { ok: false, requestId, message } }));
                return;
            }
            let r;
            try {
                r = await adminApi('/admin/meetings', { method: 'POST', body });
            } catch (err) {
                const message = 'Add failed';
                adminMsg(message, false);
                window.dispatchEvent(new CustomEvent('gvdg:admin-meeting-create-result', { detail: { ok: false, requestId, message } }));
                return;
            }
            if (r.ok) {
                adminMsg('Added meeting', true);
                window.dispatchEvent(new CustomEvent('gvdg:admin-meeting-create-result', { detail: { ok: true, requestId } }));
                adminLoadMeetings();
            } else {
                const message = 'Add failed (' + r.status + ')';
                adminMsg(message, false);
                window.dispatchEvent(new CustomEvent('gvdg:admin-meeting-create-result', { detail: { ok: false, requestId, message } }));
            }
        }

        // --- Members: onboard / issue temporary PINs ---
        function showTempPin(member, tempPin) {
            const state = { member: member || null, tempPin: tempPin || '' };
            window.dispatchEvent(new CustomEvent('gvdg:admin-member-temp-pin', { detail: state }));
        }
        async function adminLoadMembers() {
            window.dispatchEvent(new CustomEvent('gvdg:admin-members-list', { detail: { status: 'loading', members: [], currentMemberId: ME_ID } }));
            let members = [];
            try { const r = await adminApi('/admin/members'); if (r.ok) members = (await r.json()).members || []; } catch (e) {}
            window.dispatchEvent(new CustomEvent('gvdg:admin-members-list', { detail: { status: 'ready', members, currentMemberId: ME_ID } }));
        }
        async function adminCreateMemberFromReact(detail) {
            const body = detail.body || {};
            const requestId = detail.requestId;
            if (!requestId) return;
            if (!body.name) {
                adminMsg('Name is required', false);
                window.dispatchEvent(new CustomEvent('gvdg:admin-member-create-result', { detail: { ok: false, requestId } }));
                return;
            }
            if (detail.valid !== true || (!body.pdgaNo && !body.udisc)) {
                adminMsg('PDGA# or UDisc is required', false);
                window.dispatchEvent(new CustomEvent('gvdg:admin-member-create-result', { detail: { ok: false, requestId } }));
                return;
            }
            let r;
            try {
                r = await adminApi('/admin/members', { method: 'POST', body });
            } catch (e) {
                adminMsg('Create failed', false);
                window.dispatchEvent(new CustomEvent('gvdg:admin-member-create-result', { detail: { ok: false, requestId } }));
                return;
            }
            if (r.ok) {
                const j = await r.json().catch(() => ({}));
                showTempPin(j.member, j.tempPin);
                adminMsg('Member created', true);
                window.dispatchEvent(new CustomEvent('gvdg:admin-member-create-result', { detail: { ok: true, requestId } }));
                adminLoadMembers();
            }
            else {
                let err = {};
                try { err = await r.json(); } catch (e) {}
                adminMsg('Create failed: ' + (err.error || r.status), false);
                window.dispatchEvent(new CustomEvent('gvdg:admin-member-create-result', { detail: { ok: false, requestId } }));
            }
        }

        function adminProductInventoryControlsState(detail) {
            const source = detail && typeof detail === 'object' ? detail : adminProductInventoryControlsSnapshot;
            const sort = typeof source.sort === 'string' && source.sort ? source.sort : 'newest';
            const status = typeof source.status === 'string' && source.status ? source.status : 'active';
            adminProductInventoryControlsSnapshot = { sort, status };
            return adminProductInventoryControlsSnapshot;
        }
        async function adminLoadProducts(detail) {
            const { sort, status } = adminProductInventoryControlsState(detail);
            setAdminProductsListState({ status: 'loading', products: [], inventoryStatus: status });
            let products = [];
            const params = new URLSearchParams();
            if (sort) params.set('sort', sort);
            if (status) params.set('status', status);
            try { const r = await adminApi('/admin/shop/products?' + params.toString()); if (r.ok) products = (await r.json()).products || []; } catch (e) {}
            setAdminProductsListState({ status: 'ready', products, inventoryStatus: status });
        }
        function setAdminProductsListState(state) {
            window.dispatchEvent(new CustomEvent('gvdg:admin-products-list', { detail: state }));
        }
        async function adminCreateProductFromReact(detail) {
            const body = detail.body || {};
            const requestId = detail.requestId;
            if (!requestId) return;
            if (detail.valid !== true || !body.name || body.price_cents == null) {
                adminMsg('Product name and price are required', false);
                window.dispatchEvent(new CustomEvent('gvdg:admin-product-create-result', { detail: { ok: false, requestId } }));
                return;
            }
            let r;
            try {
                r = await adminApi('/admin/shop/products', { method: 'POST', body });
            } catch (e) {
                adminMsg('Add product failed', false);
                window.dispatchEvent(new CustomEvent('gvdg:admin-product-create-result', { detail: { ok: false, requestId } }));
                return;
            }
            adminMsg(r.ok ? 'Product added' : 'Add product failed (' + r.status + ')', r.ok);
            window.dispatchEvent(new CustomEvent('gvdg:admin-product-create-result', { detail: { ok: r.ok, requestId } }));
            if (r.ok) adminLoadProducts();
        }
        // ---- Pro shop orders: status, tracking, and the new-order badge ----
        function setOrdersBadge(n) {
            publishAdminOrdersBadgeCount(n);
        }
        function adminOrderControlsState(detail) {
            const source = detail && typeof detail === 'object' ? detail : adminOrderControlsSnapshot;
            const status = typeof source.status === 'string' ? source.status : '';
            adminOrderControlsSnapshot = { status };
            return adminOrderControlsSnapshot;
        }
        async function adminLoadOrders(detail) {
            const { status } = adminOrderControlsState(detail);
            setAdminOrdersListState({ status: 'loading', orders: [], filterStatus: status });
            let orders = [], unfulfilled = 0;
            try {
                const r = await adminApi('/admin/orders' + (status ? '?status=' + encodeURIComponent(status) : ''));
                if (!r.ok) throw new Error('orders_failed');
                const d = await r.json();
                orders = d.orders || [];
                unfulfilled = d.unfulfilled || 0;
            } catch (e) {
                setOrdersBadge(0);
                setAdminOrdersListState({ status: 'error', orders: [], filterStatus: status });
                return;
            }
            setOrdersBadge(unfulfilled);
            setAdminOrdersListState({ status: 'ready', orders, filterStatus: status });
        }
        function setAdminOrdersListState(state) {
            window.dispatchEvent(new CustomEvent('gvdg:admin-orders-list', { detail: state }));
        }
        async function saveOrder(id, body) {
            const r = await adminApi('/admin/orders/' + id, { method: 'PATCH', body });
            if (r.ok) { adminMsg('Order #' + id + ' updated', true); adminLoadOrders(); return true; }
            const d = await r.json().catch(() => ({}));
            adminMsg('Order update failed' + (d.error ? ' (' + d.error + ')' : ''), false);
            return false;
        }
        async function cancelOrder(id, status) {
            if (status === 'cancelled') return false;
            return saveOrder(id, { status: 'cancelled' });
        }
        async function deleteOrder(id) {
            const r = await adminApi('/admin/orders/' + id, { method: 'DELETE' });
            if (r.ok) { adminMsg('Order #' + id + ' deleted', true); adminLoadOrders(); return true; }
            const d = await r.json().catch(() => ({}));
            adminMsg('Order delete failed' + (d.error ? ' (' + d.error + ')' : ''), false);
            return false;
        }
        async function refreshOrdersBadge() {
            setOrdersBadge(0);
            try {
                const r = await adminApi('/admin/orders');
                if (!r.ok) return;
                setOrdersBadge((await r.json()).unfulfilled || 0);
            } catch (e) { setOrdersBadge(0); }
        }

        async function adminPostWalletAdjustmentFromReact(detail) {
            const body = detail.body || {};
            const requestId = detail.requestId;
            if (!requestId) return;
            if (detail.valid !== true || !body.member_id || body.amount_cents == null || body.amount_cents === 0) {
                adminMsg('Member and non-zero amount are required', false);
                window.dispatchEvent(new CustomEvent('gvdg:admin-wallet-adjustment-result', { detail: { ok: false, requestId } }));
                return;
            }
            let r;
            try {
                r = await adminApi('/admin/wallets/credit', { method: 'POST', body });
            } catch (e) {
                adminMsg('Wallet update failed', false);
                window.dispatchEvent(new CustomEvent('gvdg:admin-wallet-adjustment-result', { detail: { ok: false, requestId } }));
                return;
            }
            if (r.ok) {
                const d = await r.json().catch(() => ({}));
                adminMsg('Wallet updated. Balance: ' + dollarsFromCents(d.balance_cents || 0), true);
                window.dispatchEvent(new CustomEvent('gvdg:admin-wallet-adjustment-result', { detail: { ok: true, requestId } }));
            }
            else {
                const d = await r.json().catch(() => ({}));
                const msg = d.error === 'member_not_found' ? 'No member matches that — try their PDGA#, UDisc, or exact name'
                    : d.error === 'member_ambiguous' ? 'More than one member has that name — use their PDGA# or UDisc instead'
                    : 'Wallet update failed (' + r.status + ')';
                adminMsg(msg, false);
                window.dispatchEvent(new CustomEvent('gvdg:admin-wallet-adjustment-result', { detail: { ok: false, requestId } }));
            }
        }

        // ---- Registration management (Track G) ----
        let rgEventId = null;
        let adminRegistrationControlsSnapshot = { status: 'loading', events: [], selectedEventId: null, configStatus: 'idle', config: null };
        function currentAdminRegistrationControlsState() {
            const state = adminRegistrationControlsSnapshot;
            return state && typeof state === 'object' ? state : { status: 'loading', events: [], selectedEventId: null, configStatus: 'idle', config: null };
        }
        function setAdminRegistrationControlsState(state) {
            const current = currentAdminRegistrationControlsState();
            const next = Object.assign({}, current, state || {});
            adminRegistrationControlsSnapshot = next;
            window.dispatchEvent(new CustomEvent('gvdg:admin-registration-controls', { detail: next }));
        }
        function setAdminRegistrationMemberOptionsState(state) {
            window.dispatchEvent(new CustomEvent('gvdg:admin-registration-member-options', { detail: state }));
        }
        function rgClearSelectedEventState() {
            setAdminRegistrationRosterState({ status: 'ready', registrations: [], manualPlayers: [] });
            setAdminRegistrationMemberOptionsState({ status: 'ready', options: [] });
            setAdminRegistrationCtpsState({ status: 'ready', ctps: [] });
            setAdminRegistrationCreditsState({ status: 'ready', payouts: [] });
            setAdminRegistrationAcePotState({ status: 'ready', acePot: null });
        }
        function rgSelectedEventLabel() {
            const state = currentAdminRegistrationControlsState();
            const selected = String(state.selectedEventId || '');
            const event = (state.events || []).find((item) => String(item.id) === selected);
            if (!event) return 'event';
            return event.name ? event.name + (event.status ? ' [' + event.status + ']' : '') : 'event';
        }
        async function rgLoadEvents() {
            setAdminRegistrationControlsState({ status: 'loading' });
            let events = [];
            try {
                const r = await api('/events');
                if (!r.ok) throw new Error('events_failed');
                events = ((await r.json()).events || []).filter((e) => e.status === 'scheduled' || e.status === 'live');
            } catch (e) {
                setAdminRegistrationControlsState({ status: 'error', events: [] });
                return;
            }
            setAdminRegistrationControlsState({ status: 'ready', events });
        }
        async function rgSelectEventFromReact(detail) {
            const rawEventId = detail && detail.eventId != null && detail.eventId !== '' ? detail.eventId : null;
            const selectedEventId = rawEventId == null ? null : rawEventId;
            rgEventId = selectedEventId == null ? null : Number(selectedEventId);
            if (!rgEventId || !Number.isFinite(rgEventId)) {
                rgEventId = null;
                setAdminRegistrationControlsState({ selectedEventId: null, configStatus: 'idle', config: null });
                rgClearSelectedEventState();
                return;
            }
            setAdminRegistrationControlsState({ selectedEventId: rgEventId, configStatus: 'loading', config: null });
            let cfg = null;
            let configStatus = 'ready';
            try {
                const r = await adminApi('/events/' + rgEventId + '/registration');
                if (!r.ok) throw new Error('registration_config_failed');
                cfg = (await r.json()).config || null;
            } catch (e) {
                configStatus = 'error';
            }
            setAdminRegistrationControlsState({ selectedEventId: rgEventId, configStatus, config: cfg });
            rgLoadRoster();
            rgLoadCtps();
            rgLoadCredits();
            rgLoadAcePot();
        }
        async function rgSaveConfigFromReact(detail) {
            const requestId = detail.requestId;
            if (!requestId) return;
            if (!rgEventId || detail.valid !== true) {
                adminMsg('Select an event first', false);
                window.dispatchEvent(new CustomEvent('gvdg:admin-registration-config-save-result', { detail: { ok: false, requestId } }));
                return;
            }
            const body = detail.body || {};
            const r = await adminApi('/admin/events/' + rgEventId + '/config', { method: 'PUT', body });
            adminMsg(r.ok ? 'Registration settings saved' : 'Save failed (' + r.status + ')', r.ok);
            if (r.ok) setAdminRegistrationControlsState({ configStatus: 'ready', config: body });
            window.dispatchEvent(new CustomEvent('gvdg:admin-registration-config-save-result', { detail: { ok: r.ok, requestId } }));
        }
        async function rgLoadRoster() {
            setAdminRegistrationRosterState({ status: 'loading', registrations: [], manualPlayers: [] });
            let regs = [];
            let ok = true;
            try { const r = await adminApi('/admin/events/' + rgEventId + '/registrations'); if (!r.ok) throw new Error('registrations_failed'); regs = (await r.json()).registrations || []; } catch (e) { ok = false; }
            let manual = [];
            try { const r = await api('/events/' + rgEventId); if (!r.ok) throw new Error('event_failed'); manual = ((await r.json()).event || {}).players || []; } catch (e) { ok = false; }
            const memberOptions = regs.filter((rg) => rg.member_id).map((rg) => ({ value: rg.member_id, label: rg.name || rg.member_id }));
            setAdminRegistrationMemberOptionsState({ status: ok ? 'ready' : 'error', options: memberOptions });
            setAdminRegistrationRosterState({ status: ok ? 'ready' : 'error', registrations: regs, manualPlayers: manual });
        }
        function setAdminRegistrationRosterState(state) {
            window.dispatchEvent(new CustomEvent('gvdg:admin-registration-roster', { detail: state }));
        }
        async function rgAddManualPlayerFromReact(detail) {
            const requestId = detail.requestId;
            if (!requestId) return;
            if (!rgEventId) {
                adminMsg('Select an event first', false);
                window.dispatchEvent(new CustomEvent('gvdg:admin-registration-manual-player-add-result', { detail: { ok: false, requestId } }));
                return;
            }
            const body = detail.body || {};
            if (detail.valid !== true || !String(body.name || '').trim()) {
                adminMsg('Player name required', false);
                window.dispatchEvent(new CustomEvent('gvdg:admin-registration-manual-player-add-result', { detail: { ok: false, requestId } }));
                return;
            }
            let r;
            try {
                r = await adminApi('/admin/events/' + rgEventId + '/players', { method: 'POST', body });
            } catch (e) {
                adminMsg('Add player failed', false);
                window.dispatchEvent(new CustomEvent('gvdg:admin-registration-manual-player-add-result', { detail: { ok: false, requestId } }));
                return;
            }
            if (r.ok) {
                adminMsg('Player added', true);
                window.dispatchEvent(new CustomEvent('gvdg:admin-registration-manual-player-add-result', { detail: { ok: true, requestId } }));
                rgLoadRoster();
            } else {
                adminMsg('Add player failed (' + r.status + ')', false);
                window.dispatchEvent(new CustomEvent('gvdg:admin-registration-manual-player-add-result', { detail: { ok: false, requestId } }));
            }
        }
        async function rgRemoveManualPlayer(player) {
            const r = await adminApi('/admin/events/' + rgEventId + '/players/' + player.id, { method: 'DELETE' });
            adminMsg(r.ok ? 'Player removed' : 'Remove failed (' + r.status + ')', r.ok);
            if (r.ok) rgLoadRoster();
        }
        async function rgAwardCredit(memberId, name, amountValue) {
            const amount = dollarsToCents(amountValue);
            if (amount == null || amount <= 0) { adminMsg('Enter a store credit amount', false); return; }
            const r = await adminApi('/admin/events/' + rgEventId + '/store-credit', { method: 'POST', body: { member_id: memberId, member_name: name || null, amount_cents: amount, note: 'Event payout: ' + rgSelectedEventLabel() } });
            if (r.ok) { const d = await r.json(); adminMsg('Awarded ' + dollarsFromCents(amount) + ' to ' + (name || memberId) + '. Balance: ' + dollarsFromCents(d.balance_cents || 0), true); rgLoadRoster(); rgLoadCredits(); }
            else adminMsg(await rgStoreCreditError(r, 'Store credit award failed'), false);
        }
        async function rgStoreCreditError(r, fallback) {
            const d = await r.json().catch(() => ({}));
            if (d.error === 'member_not_found') return fallback + ': member id not found';
            if (d.error === 'invalid_store_credit') return fallback + ': enter a valid member and amount';
            return fallback + ' (' + r.status + ')';
        }
        async function rgPatch(rid, patch) {
            const r = await adminApi('/admin/events/' + rgEventId + '/registrations/' + rid, { method: 'PATCH', body: patch });
            adminMsg(r.ok ? 'Updated' : 'Update failed', r.ok);
            if (r.ok) rgLoadRoster();
        }
        // Assignment (shotgun cards by starting hole), random.
        async function rgAssign(kind, body) {
            const r = await adminApi('/admin/events/' + rgEventId + '/' + kind, { method: 'POST', body });
            adminMsg(r.ok ? 'Assigned' : 'Assign failed (' + r.status + ')', r.ok);
            if (r.ok) rgLoadRoster();
            return r.ok;
        }
        async function rgAssignFromReact(detail) {
            const requestId = detail.requestId;
            if (!requestId) return;
            if (!rgEventId) {
                adminMsg('Select an event first', false);
                window.dispatchEvent(new CustomEvent('gvdg:admin-registration-assign-result', { detail: { ok: false, requestId } }));
                return;
            }
            const groupSize = Math.max(1, parseInt(detail.groupSize, 10) || 4);
            const ok = await rgAssign('assign-starting-holes', { shuffle: true, groupSize });
            window.dispatchEvent(new CustomEvent('gvdg:admin-registration-assign-result', { detail: { ok, requestId } }));
        }
        // CTPs
        async function rgLoadCtps() {
            setAdminRegistrationCtpsState({ status: 'loading', ctps: [] });
            let ctps = [];
            try {
                const r = await api('/events/' + rgEventId + '/ctps');
                if (!r.ok) throw new Error('ctps_failed');
                ctps = (await r.json()).ctps || [];
            } catch (e) {
                setAdminRegistrationCtpsState({ status: 'error', ctps: [] });
                return;
            }
            setAdminRegistrationCtpsState({ status: 'ready', ctps });
        }
        function setAdminRegistrationCtpsState(state) {
            window.dispatchEvent(new CustomEvent('gvdg:admin-registration-ctps-list', { detail: state }));
        }
        async function rgAwardCtpCredit(ctp, memberIdValue, winnerNameValue, amountValue) {
            const memberId = String(memberIdValue || '').trim();
            const winnerName = String(winnerNameValue || '').trim();
            const amount = dollarsToCents(amountValue);
            if (!memberId) { adminMsg('CTP store credit needs a member id', false); return; }
            if (amount == null || amount <= 0) { adminMsg('Enter a CTP store credit amount', false); return; }
            const r = await adminApi('/admin/events/' + rgEventId + '/ctps/' + ctp.id + '/store-credit', { method: 'POST', body: { member_id: memberId, winner_name: winnerName || null, amount_cents: amount } });
            if (r.ok) {
                const d = await r.json();
                adminMsg('Awarded CTP credit ' + dollarsFromCents(amount) + '. Balance: ' + dollarsFromCents(d.balance_cents || 0), true);
                rgLoadCtps();
                rgLoadCredits();
            } else {
                adminMsg(await rgStoreCreditError(r, 'CTP store credit award failed'), false);
            }
        }
        async function rgAddCtpFromReact(detail) {
            const requestId = detail.requestId;
            if (!requestId) return;
            const body = detail.body || {};
            if (!rgEventId) {
                adminMsg('Select an event first', false);
                window.dispatchEvent(new CustomEvent('gvdg:admin-registration-ctp-add-result', { detail: { ok: false, requestId } }));
                return;
            }
            if (detail.valid !== true || !(Number(body.hole) >= 1)) {
                adminMsg('CTP needs a hole', false);
                window.dispatchEvent(new CustomEvent('gvdg:admin-registration-ctp-add-result', { detail: { ok: false, requestId } }));
                return;
            }
            const r = await adminApi('/admin/events/' + rgEventId + '/ctps', { method: 'POST', body });
            if (r.ok) { adminMsg('CTP added', true); rgLoadCtps(); }
            else adminMsg('Add CTP failed', false);
            window.dispatchEvent(new CustomEvent('gvdg:admin-registration-ctp-add-result', { detail: { ok: r.ok, requestId } }));
        }
        async function rgLoadCredits() {
            setAdminRegistrationCreditsState({ status: 'loading', payouts: [] });
            let payouts = [];
            try {
                const r = await adminApi('/admin/events/' + rgEventId + '/store-credit');
                if (!r.ok) throw new Error('credits_failed');
                payouts = (await r.json()).payouts || [];
            } catch (e) {
                setAdminRegistrationCreditsState({ status: 'error', payouts: [] });
                return;
            }
            setAdminRegistrationCreditsState({ status: 'ready', payouts });
        }
        function setAdminRegistrationCreditsState(state) {
            window.dispatchEvent(new CustomEvent('gvdg:admin-registration-credits-list', { detail: state }));
        }
        // Ace pot
        async function rgLoadAcePot() {
            setAdminRegistrationAcePotState({ status: 'loading', acePot: null });
            let pot = null;
            try {
                const r = await api('/events/' + rgEventId + '/ace-pot');
                if (!r.ok) throw new Error('ace_pot_failed');
                pot = (await r.json()).ace_pot;
            } catch (e) {
                setAdminRegistrationAcePotState({ status: 'error', acePot: null });
                return;
            }
            setAdminRegistrationAcePotState({ status: 'ready', acePot: pot });
        }
        function setAdminRegistrationAcePotState(state) {
            window.dispatchEvent(new CustomEvent('gvdg:admin-registration-ace-pot', { detail: state }));
        }
        async function rgAcePut(body) {
            const r = await adminApi('/admin/events/' + rgEventId + '/ace-pot', { method: 'PUT', body });
            adminMsg(r.ok ? 'Ace pot updated' : 'Ace pot failed', r.ok);
            if (r.ok) rgLoadAcePot();
            return r.ok;
        }
        async function rgAcePutFromReact(detail) {
            const requestId = detail.requestId;
            if (!requestId) return;
            if (!rgEventId) {
                adminMsg('Select an event first', false);
                window.dispatchEvent(new CustomEvent('gvdg:admin-registration-ace-pot-action-result', { detail: { ok: false, requestId } }));
                return;
            }
            const ok = await rgAcePut(detail.body || {});
            window.dispatchEvent(new CustomEvent('gvdg:admin-registration-ace-pot-action-result', { detail: { ok, requestId, action: detail.action || '' } }));
        }

        function initAdmin() {
            if (adminInited) { adminLoadEvents(); adminLoadCourses(); adminLoadLeagues(); return; }
            adminInited = true;
            const adminControllerDeps = { adminApi, adminMsg };
            installCourseLayoutsController({ api, ...adminControllerDeps });
            installDataArchiveController(adminControllerDeps);
            installImportController(adminControllerDeps);
            loadTeeSignReview = installTeeSignReviewController({
                adminApi,
                adminMsg,
                api,
                authBase: AUTH_BASE,
                getCourses: () => adminCoursesCache,
                ensureCoursesLoaded: adminLoadCourses,
            }).loadReview;
            window.addEventListener('gvdg:admin-tab-request', (event) => {
                const tab = event.detail && event.detail.tab;
                if (tab) adminSwitch(tab);
            });
            window.addEventListener('gvdg:admin-event-edit-request', (event) => {
                const ev = event.detail && event.detail.event;
                if (ev) aeEditEvent(ev);
            });
            window.addEventListener('gvdg:admin-event-status-request', async (event) => {
                const detail = event.detail || {};
                const ev = detail.event;
                const status = detail.status;
                if (!ev || ev.id == null || !status) return;
                const r = await adminApi('/admin/events/' + ev.id, { method: 'PATCH', body: { status } });
                adminMsg(r.ok ? 'Updated “' + ev.name + '” → ' + status : 'Update failed', r.ok);
                if (r.ok) adminLoadEvents();
            });
            window.addEventListener('gvdg:admin-event-delete-request', async (event) => {
                const ev = event.detail && event.detail.event;
                if (!ev || ev.id == null) return;
                const r = await adminApi('/admin/events/' + ev.id, { method: 'DELETE' });
                adminMsg(r.ok ? 'Deleted “' + ev.name + '”' : 'Delete failed', r.ok);
                if (r.ok) adminLoadEvents();
            });
            window.addEventListener('gvdg:admin-event-form-layouts-load-request', async (event) => {
                await adminLoadEventFormLayouts(event.detail || {});
            });
            window.addEventListener('gvdg:admin-event-save-request', async (event) => {
                await adminSaveEventFromReact(event.detail || {});
            });
            window.addEventListener('gvdg:admin-event-edit-cancel-request', () => {
                aeResetForm();
                adminSwitch('events');
            });
            window.addEventListener('gvdg:admin-import-candidate-create-request', async (event) => {
                const detail = event.detail || {};
                const candidate = detail.candidate || {};
                const requestId = detail.requestId;
                if (!requestId || !candidate.name) return;
                const r = await adminApi('/admin/events', { method: 'POST', body: { type: candidate.type || 'tournament', name: candidate.name, date: candidate.date || null, format: candidate.format || null, source: candidate.source || 'manual', external_url: candidate.external_url || null } });
                window.dispatchEvent(new CustomEvent('gvdg:admin-import-candidate-create-result', { detail: { ok: r.ok, requestId } }));
                if (r.ok) adminLoadEvents();
            });
            window.addEventListener('gvdg:admin-league-create-request', async (event) => {
                await adminAddLeagueFromReact(event.detail || {});
            });
            window.addEventListener('gvdg:admin-fundraiser-create-request', async (event) => {
                await adminAddFundraiserFromReact(event.detail || {});
            });
            window.addEventListener('gvdg:admin-meeting-create-request', async (event) => {
                await adminAddMeetingFromReact(event.detail || {});
            });
            window.addEventListener('gvdg:admin-league-delete-request', async (event) => {
                const league = event.detail && event.detail.league;
                if (!league || league.id == null) return;
                const r = await adminApi('/admin/leagues/' + league.id, { method: 'DELETE' });
                adminMsg(r.ok ? 'Deleted league' : 'Delete failed', r.ok);
                if (r.ok) adminLoadLeagues();
            });
            window.addEventListener('gvdg:admin-fundraiser-status-request', async (event) => {
                const detail = event.detail || {};
                const fundraiser = detail.fundraiser;
                const status = detail.status;
                if (!fundraiser || fundraiser.id == null || !status) return;
                const r = await adminApi('/admin/fundraisers/' + fundraiser.id, { method: 'PATCH', body: { status } });
                adminMsg(r.ok ? 'Updated' : 'Update failed', r.ok);
                if (r.ok) adminLoadFundraisers();
            });
            window.addEventListener('gvdg:admin-fundraiser-delete-request', async (event) => {
                const fundraiser = event.detail && event.detail.fundraiser;
                if (!fundraiser || fundraiser.id == null) return;
                const r = await adminApi('/admin/fundraisers/' + fundraiser.id, { method: 'DELETE' });
                adminMsg(r.ok ? 'Deleted' : 'Delete failed', r.ok);
                if (r.ok) adminLoadFundraisers();
            });
            window.addEventListener('gvdg:admin-meeting-delete-request', async (event) => {
                const meeting = event.detail && event.detail.meeting;
                if (!meeting || meeting.id == null) return;
                const r = await adminApi('/admin/meetings/' + meeting.id, { method: 'DELETE' });
                adminMsg(r.ok ? 'Deleted' : 'Delete failed', r.ok);
                if (r.ok) adminLoadMeetings();
            });
            window.addEventListener('gvdg:admin-member-reset-pin-request', async (event) => {
                const detail = event.detail || {};
                const identifier = detail.identifier;
                if (!identifier) return;
                const r = await adminApi('/admin/members/reset-pin', { method: 'POST', body: { identifier } });
                if (r.ok) {
                    const j = await r.json();
                    showTempPin(j.member, j.tempPin);
                    adminMsg('New temp PIN issued', true);
                    adminLoadMembers();
                } else {
                    adminMsg('Reissue failed (' + r.status + ')', false);
                }
            });
            window.addEventListener('gvdg:admin-member-role-request', async (event) => {
                const detail = event.detail || {};
                const member = detail.member;
                const promoting = detail.isAdmin === true;
                if (!member || !member.memberId) return;
                const r = await adminApi('/admin/members/set-role', { method: 'POST', body: { memberId: member.memberId, isAdmin: promoting } });
                if (r.ok) {
                    adminMsg((promoting ? 'Promoted ' : 'Demoted ') + member.name, true);
                    adminLoadMembers();
                } else {
                    let err = {}; try { err = await r.json(); } catch (e) {}
                    adminMsg(err.error === 'last_admin' ? "Can't remove the last admin" : ('Role change failed (' + r.status + ')'), false);
                }
            });
            window.addEventListener('gvdg:admin-product-save-request', async (event) => {
                const detail = event.detail || {};
                const product = detail.product;
                if (!product || product.id == null) return;
                const r = await adminApi('/admin/shop/products/' + product.id, { method: 'PATCH', body: { price_cents: dollarsToCents(detail.priceValue), stock_qty: parseInt(detail.stockValue, 10) || 0, active: detail.active === true } });
                adminMsg(r.ok ? 'Product updated' : 'Product update failed', r.ok);
                if (r.ok) adminLoadProducts();
            });
            window.addEventListener('gvdg:admin-product-delete-request', async (event) => {
                const product = event.detail && event.detail.product;
                if (!product || product.id == null) return;
                const r = await adminApi('/admin/shop/products/' + product.id, { method: 'DELETE' });
                adminMsg(r.ok ? 'Product permanently deleted' : 'Delete failed', r.ok);
                if (r.ok) adminLoadProducts();
            });
            window.addEventListener('gvdg:admin-product-photo-ready', (event) => {
                const sizeKb = event.detail && Number(event.detail.sizeKb);
                adminMsg('Photo ready (~' + (Number.isFinite(sizeKb) ? sizeKb : '?') + ' KB). Add the product to save it.', true);
            });
            window.addEventListener('gvdg:admin-product-photo-error', () => {
                adminMsg('Could not read that image - try another.', false);
            });
            window.addEventListener('gvdg:admin-product-create-request', async (event) => {
                await adminCreateProductFromReact(event.detail || {});
            });
            window.addEventListener('gvdg:admin-order-save-request', async (event) => {
                const detail = event.detail || {};
                const order = detail.order;
                if (!order || order.id == null) return;
                const trackingCarrier = String(detail.trackingCarrier || '').trim();
                const trackingNumber = String(detail.trackingNumber || '').trim();
                const ok = await saveOrder(order.id, { status: detail.status, tracking_carrier: trackingCarrier || null, tracking_number: trackingNumber || null });
                window.dispatchEvent(new CustomEvent('gvdg:admin-order-action-result', { detail: { requestId: detail.requestId, ok } }));
            });
            window.addEventListener('gvdg:admin-order-cancel-request', async (event) => {
                const detail = event.detail || {};
                const order = detail.order;
                if (!order || order.id == null) return;
                const ok = await cancelOrder(order.id, order.status);
                window.dispatchEvent(new CustomEvent('gvdg:admin-order-action-result', { detail: { requestId: detail.requestId, ok } }));
            });
            window.addEventListener('gvdg:admin-order-delete-request', async (event) => {
                const detail = event.detail || {};
                const order = detail.order;
                if (!order || order.id == null) return;
                const ok = await deleteOrder(order.id);
                window.dispatchEvent(new CustomEvent('gvdg:admin-order-action-result', { detail: { requestId: detail.requestId, ok } }));
            });
            window.addEventListener('gvdg:admin-wallet-adjustment-request', async (event) => {
                await adminPostWalletAdjustmentFromReact(event.detail || {});
            });
            window.addEventListener('gvdg:admin-member-create-request', async (event) => {
                await adminCreateMemberFromReact(event.detail || {});
            });
            window.addEventListener('gvdg:admin-registration-event-select-request', async (event) => {
                await rgSelectEventFromReact(event.detail || {});
            });
            window.addEventListener('gvdg:admin-registration-config-save-request', async (event) => {
                await rgSaveConfigFromReact(event.detail || {});
            });
            window.addEventListener('gvdg:admin-registration-assign-request', async (event) => {
                await rgAssignFromReact(event.detail || {});
            });
            window.addEventListener('gvdg:admin-registration-ctp-add-request', async (event) => {
                await rgAddCtpFromReact(event.detail || {});
            });
            window.addEventListener('gvdg:admin-registration-ace-pot-action-request', async (event) => {
                await rgAcePutFromReact(event.detail || {});
            });
            window.addEventListener('gvdg:admin-registration-roster-patch-request', async (event) => {
                const detail = event.detail || {};
                const registration = detail.registration;
                if (!registration || registration.id == null || !rgEventId) return;
                await rgPatch(registration.id, detail.patch || {});
            });
            window.addEventListener('gvdg:admin-registration-roster-credit-request', async (event) => {
                const detail = event.detail || {};
                if (!detail.memberId || !rgEventId) return;
                await rgAwardCredit(detail.memberId, detail.memberName, detail.amountValue);
            });
            window.addEventListener('gvdg:admin-registration-manual-remove-request', async (event) => {
                const player = event.detail && event.detail.player;
                if (!player || player.id == null || !rgEventId) return;
                await rgRemoveManualPlayer(player);
            });
            window.addEventListener('gvdg:admin-registration-manual-player-add-request', async (event) => {
                await rgAddManualPlayerFromReact(event.detail || {});
            });
            window.addEventListener('gvdg:admin-registration-ctp-winner-request', async (event) => {
                const detail = event.detail || {};
                const ctp = detail.ctp;
                if (!ctp || ctp.id == null || !rgEventId) return;
                const winnerName = String(detail.winnerName || '').trim();
                const winnerMemberId = String(detail.winnerMemberId || '').trim();
                const r = await adminApi('/admin/events/' + rgEventId + '/ctps/' + ctp.id, { method: 'PATCH', body: { winner_name: winnerName || null, winner_member_id: winnerMemberId || null } });
                adminMsg(r.ok ? 'CTP winner set' : 'CTP winner update failed (' + r.status + ')', r.ok);
                if (r.ok) rgLoadCtps();
            });
            window.addEventListener('gvdg:admin-registration-ctp-credit-request', async (event) => {
                const detail = event.detail || {};
                const ctp = detail.ctp;
                if (!ctp || ctp.id == null || !rgEventId) return;
                await rgAwardCtpCredit(ctp, detail.winnerMemberId, detail.winnerName, detail.amountValue);
            });
            window.addEventListener('gvdg:admin-registration-ctp-delete-request', async (event) => {
                const ctp = event.detail && event.detail.ctp;
                if (!ctp || ctp.id == null || !rgEventId) return;
                const r = await adminApi('/admin/events/' + rgEventId + '/ctps/' + ctp.id, { method: 'DELETE' });
                adminMsg(r.ok ? 'CTP deleted' : 'Delete failed (' + r.status + ')', r.ok);
                if (r.ok) rgLoadCtps();
            });
            window.addEventListener('gvdg:admin-course-create-request', async (event) => {
                await adminAddCourseFromReact(event.detail || {});
            });
            window.addEventListener('gvdg:admin-product-inventory-controls-request', async (event) => {
                await adminLoadProducts(event.detail || {});
            });
            window.addEventListener('gvdg:admin-order-controls-request', async (event) => {
                await adminLoadOrders(event.detail || {});
            });
            window.addEventListener('gvdg:admin-scoring-load-events-request', async () => {
                await scLoadEvents();
            });
            window.addEventListener('gvdg:admin-scoring-select-event-request', async (event) => {
                await scSelectEventFromReact(event.detail || {});
            });
            window.addEventListener('gvdg:admin-scoring-start-request', async (event) => {
                await scStartFromReact(event.detail || {});
            });
            window.addEventListener('gvdg:admin-scoring-score-request', async (event) => {
                await scPostScoreFromReact(event.detail || {});
            });
            window.addEventListener('gvdg:admin-scoring-override-request', async (event) => {
                await scApplyOverrideFromReact(event.detail || {});
            });
            window.addEventListener('gvdg:admin-scoring-finalize-request', async () => {
                await scFinalize();
            });
            window.addEventListener('gvdg:admin-scoring-cancel-request', async () => {
                await scCancel();
            });
            refreshOrdersBadge();                          // show the new-order count on load
            setInterval(refreshOrdersBadge, 60000);        // and keep it current while the page is open
            adminLoadEvents();
            adminLoadCourses();
            adminLoadLeagues();
        }

        // Kick off the auth gate on load.
        checkAdminSession();

}
