import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const removedMemberFallbacks = [
  /id="dashTabs"/,
  /id="legacyDashboardHead"/,
  /id="legacyPdgaDashboard"/,
  /id="legacyDashboardActions"/,
  /id="legacyRegisterTitle"/,
  /id="registerList"/,
  /id="legacyBoardPanel"/,
  /id="legacyTeeSignsPanel"/,
  /id="clubRatings"/,
  /id="clubWallet"/,
  /id="liveScoring"/,
  /id="clubMeetings"/,
  /async function loadDashboard\(/,
  /async function loadRegister\(/,
  /async function loadBoard\(/,
  /async function loadTeeSigns\(/,
  /async function loadMeetings\(/,
  /async function uploadTeeSign\(/,
  /function renderPayPal\(/,
  /async function submitPost\(/,
  /function renderEvents\(/,
  /function mdRender\(/,
  /const DASH_TABS/,
  /function selectDashTab/,
  /function revealDashboardSections/,
  /Member auth backed by the Cloudflare Worker/,
  /const TOKEN_KEY = 'gvdg_member_token'/,
  /function memberDashboardContext/,
  /function publishMemberProfile/,
  /function handleLogin/,
  /async function checkSession/,
  /function showProfileSetup/,
  /function b64urlToBuf/,
  /window\.addEventListener\('gvdg:member-login-requested'/,
  /document\.querySelector\('\.menu-toggle'\)\.addEventListener/,
  /<script src="nav\.js" defer><\/script>/,
  /<span class="theme-icon">/,
];

function assertNoLegacyMemberFallbacks(html) {
  removedMemberFallbacks.forEach((pattern) => assert.doesNotMatch(html, pattern));
}

test('member dashboard mounts a React-owned dashboard app without legacy fallbacks', () => {
  const html = readFileSync('gvdg-members.html', 'utf8');
  const app = readFileSync('src/members-app/main.js', 'utf8');
  const api = readFileSync('src/members-app/api.js', 'utf8');
  const authGate = readFileSync('src/members-app/auth-gate.js', 'utf8');
  const authForms = readFileSync('src/members-app/auth-forms.js', 'utf8');
  const authController = readFileSync('src/members-app/member-auth-controller.js', 'utf8');
  const authDom = readFileSync('src/members-app/member-auth-dom.js', 'utf8');
  const authState = readFileSync('src/members-app/member-auth-state.js', 'utf8');
  const memberContext = readFileSync('src/members-app/member-context.js', 'utf8');
  const passkeys = readFileSync('src/members-app/member-passkeys.js', 'utf8');
  const profile = readFileSync('src/members-app/member-profile-controller.js', 'utf8');
  const pageChrome = readFileSync('src/members-app/page-chrome.js', 'utf8');
  const dashboardApp = readFileSync('src/members-app/dashboard-app.js', 'utf8');
  const shell = readFileSync('src/members-app/dashboard-shell.js', 'utf8');
  const router = readFileSync('src/members-app/dashboard-router.js', 'utf8');
  const dialogs = readFileSync('src/members-app/member-dialogs.js', 'utf8');
  const overview = readFileSync('src/members-app/overview-dashboard.js', 'utf8');
  const pdga = readFileSync('src/members-app/pdga-dashboard.js', 'utf8');
  const ratings = readFileSync('src/members-app/club-ratings.js', 'utf8');
  const udiscExport = readFileSync('src/shared/udisc-export.js', 'utf8');
  const activity = readFileSync('src/members-app/activity-panels.js', 'utf8');
  const registration = readFileSync('src/members-app/registration-panel.js', 'utf8');
  const registrationEvents = readFileSync('src/members-app/registration-events.js', 'utf8');
  const registrationCasual = readFileSync('src/members-app/registration-casual.js', 'utf8');
  const registrationPayments = readFileSync('src/members-app/registration-payments.js', 'utf8');
  const board = readFileSync('src/members-app/board-panel.js', 'utf8');
  const teeSigns = readFileSync('src/members-app/tee-signs-panel.js', 'utf8');
  const club = readFileSync('src/members-app/club-panel.js', 'utf8');
  assert.match(html, /id="membersReactPageChrome"/);
  assert.match(html, /id="membersReactAuthGate"/);
  assert.match(html, /id="membersReactDashboardApp"/);
  assert.match(html, /id="membersReactDialogsApp"/);
  assert.match(html, /<body data-auth-base="">/);
  assert.match(html, /<div class="login-gate" id="membersReactAuthGate"><\/div>/);
  assert.match(html, /<div class="members-content">/);
  assert.doesNotMatch(html, /id="loginGate"/);
  assert.doesNotMatch(html, /id="membersContent"/);
  assert.doesNotMatch(html, /<div id="membersReactDashboardShell"/);
  assert.doesNotMatch(html, /<div id="membersReactOverviewPanel"/);
  assert.doesNotMatch(html, /<div id="membersReactRegistrationPanel"/);
  assert.doesNotMatch(html, /<div id="membersReactBoardPanel"/);
  assert.doesNotMatch(html, /<div id="membersReactTeeSignsPanel"/);
  assert.doesNotMatch(html, /<div id="membersReactClubPanel"/);
  assert.doesNotMatch(html, /id="memberSectionTitle"/);
  assert.doesNotMatch(html, /id="myDashboard"[^>]*style="display:\s*none;?"/);
  assert.doesNotMatch(html, /id="clubRegister"[^>]*style="display:\s*none;?"/);
  assert.doesNotMatch(html, /id="clubBoard"[^>]*style="display:\s*none;?"/);
  assert.doesNotMatch(html, /id="teeCapture"[^>]*style="display:\s*none;?"/);
  assert.doesNotMatch(html, /id="loginForm"/);
  assert.doesNotMatch(html, /id="pinChangeForm"/);
  assert.doesNotMatch(html, /id="profileForm"/);
  assert.doesNotMatch(html, /id="loginError"/);
  assert.doesNotMatch(html, /id="pinChangeError"/);
  assert.doesNotMatch(html, /id="profileError"/);
  assert.doesNotMatch(html, /id="loginBtn"/);
  assert.doesNotMatch(html, /id="setPinBtn"/);
  assert.doesNotMatch(html, /id="profileSaveBtn"/);
  assert.doesNotMatch(html, /id="profileSkipBtn"/);
  assert.doesNotMatch(html, /id="profilePhotoPreview"/);
  assert.doesNotMatch(html, /id="photoInput"/);
  assert.doesNotMatch(html, /id="passkeyBtn"/);
  assert.doesNotMatch(html, /id="passkeyRow"/);
  assert.doesNotMatch(html, /id="enablePasskeyBtn"/);
  assert.doesNotMatch(html, /id="passkeyStatus"/);
  assert.doesNotMatch(html, /id="editProfileBtn"/);
  assert.doesNotMatch(html, /<div class="welcome-banner"/);
  assert.doesNotMatch(html, /id="logoutBtn"/);
  assert.doesNotMatch(html, /id="adminPortalLink"/);
  assert.doesNotMatch(html, /overview: \['#adminPortalLink'/);
  assert.doesNotMatch(html, /const DASH_TABS/);
  assert.doesNotMatch(html, /function selectDashTab/);
  assert.doesNotMatch(html, /function revealDashboardSections/);
  assert.doesNotMatch(html, /gvdg:member-login-requested/);
  assert.doesNotMatch(html, /gvdg:member-profile-updated/);
  assert.doesNotMatch(html, /gvdg:member-dashboard-opened/);
  assert.doesNotMatch(html, /<header>[\s\S]*class="menu-toggle"/);
  assert.doesNotMatch(html, /<ul class="nav-links" id="navLinks"><\/ul>/);
  assert.doesNotMatch(html, /☰|🌙|☀️/);
  assert.match(html, /body\[data-member-shell="members"\] \.members-content \{ display: block; \}/);
  assert.match(html, /body\[data-member-shell="members"\] \.login-gate \{ display: none; \}/);
  assert.match(html, /#membersReactDashboardApp:not\(:empty\)/);
  assert.match(html, /#membersReactDashboardShell:not\(:empty\)/);
  assert.match(html, /#membersReactTeeSignsPanel:not\(:empty\)/);
  assert.match(html, /body\[data-member-dashboard-tab="events"\] #clubRegister/);
  assert.match(html, /body\[data-member-dashboard-tab="club"\] #membersReactClubPanel:not\(:empty\)/);
  assert.doesNotMatch(html, /\.members-content\.active/);
  assert.doesNotMatch(html, /#membersContent/);
  assert.doesNotMatch(html, /\.dtab-off/);
  assert.doesNotMatch(html, /members-react-(shell|overview|ratings|registration|board|tee-signs|club)-ready/);
  assertNoLegacyMemberFallbacks(html);
  assert.match(html, /<script type="module" src="members-app\/members-app\.js"><\/script>/);
  assert.doesNotMatch(html, /matchplay-colors\.js/);
  assert.match(app, /createRoot\(pageChromeMount\)\.render\(h\(MemberPageChrome\)\)/);
  assert.match(app, /createRoot\(authMount\)\.render/);
  assert.match(app, /MemberDialogs/);
  assert.match(app, /const dialogMount = document\.getElementById\("membersReactDialogsApp"\)/);
  assert.match(app, /createRoot\(dialogMount\)\.render\(h\(MemberDialogs\)\)/);
  assert.doesNotMatch(app, /installMemberPageChrome/);
  assert.doesNotMatch(app, /document\.createElement|document\.body\.appendChild/);
  assert.doesNotMatch(app, /members-react-auth-ready/);
  assert.match(app, /installMemberAuthController\(\)/);
  assert.match(app, /installDashboardRouter\(\)/);
  assert.match(app, /const dashboardMount = document\.getElementById\("membersReactDashboardApp"\)/);
  assert.match(app, /createRoot\(dashboardMount\)\.render\(h\(MemberDashboardApp\)\)/);
  assert.doesNotMatch(app, /const (shellMount|overviewMount|registrationMount|boardMount|teeSignsMount|clubMount) =/);
  assert.match(api, /import \{ resolveApiBase \} from "\.\.\/shared\/api-base\.js"/);
  assert.match(api, /resolveApiBase\(\{ datasetKeys: \["authBase"\] \}\)/);
  assert.doesNotMatch(api, /getElementById\("loginGate"\)|loginGate/);
  assert.match(dashboardApp, /export function MemberDashboardApp\(\)/);
  assert.match(dashboardApp, /MemberDashboardShell/);
  assert.match(dashboardApp, /MemberOverviewDashboard/);
  assert.match(dashboardApp, /MemberRegistrationPanel/);
  assert.match(dashboardApp, /MemberBoardPanel/);
  assert.match(dashboardApp, /MemberTeeSignsPanel/);
  assert.match(dashboardApp, /MemberClubPanel/);
  assert.match(dashboardApp, /id: "membersReactDashboardShell"/);
  assert.match(dashboardApp, /id: "membersReactOverviewPanel"/);
  assert.match(dashboardApp, /id: "membersReactRegistrationPanel"/);
  assert.match(dashboardApp, /id: "membersReactBoardPanel"/);
  assert.match(dashboardApp, /id: "membersReactTeeSignsPanel"/);
  assert.match(dashboardApp, /id: "membersReactClubPanel"/);
  assert.doesNotMatch(app, /members-react-(shell|overview|ratings|registration|board|tee-signs|club)-ready/);
  assert.doesNotMatch(app, /classList/);
  assert.match(authGate, /data-react-auth-gate/);
  assert.match(authGate, /LoginForm/);
  assert.match(authGate, /PinChangeForm/);
  assert.match(authGate, /ProfileForm/);
  assert.match(authGate, /values: FORM_VALUES\[form\]/);
  assert.match(authGate, /setFormValues/);
  assert.match(authGate, /onValuesChange: setFormValues/);
  assert.match(authGate, /gvdg:member-auth-form-state/);
  assert.match(authGate, /values: detailValues/);
  assert.match(authGate, /busyAction/);
  assert.doesNotMatch(authGate, /id: "loginError"|id: "pinChangeError"|id: "profileError"/);
  assert.doesNotMatch(authGate, /id: "loginBtn"|id: "passkeyBtn"|id: "setPinBtn"|id: "profileSaveBtn"/);
  assert.doesNotMatch(authGate, /profilePhotoPreview/);
  assert.match(authGate, /gvdg:member-auth-ready/);
  assert.match(authGate, /gvdg:member-shell-view/);
  assert.match(authGate, /document\.body\.dataset\.memberShell/);
  assert.match(authGate, /requestAnimationFrame\(\(\) => window\.scrollTo/);
  assert.match(authForms, /id: "loginForm"/);
  assert.match(authForms, /id: "pinChangeForm"/);
  assert.match(authForms, /id: "profileForm"/);
  assert.match(authForms, /data-react-auth-error/);
  assert.match(authForms, /data-react-auth-action/);
  assert.match(authForms, /busyAction/);
  assert.match(authForms, /value: identifier/);
  assert.match(authForms, /value: pin/);
  assert.match(authForms, /value: newPin/);
  assert.match(authForms, /value: confirmPin/);
  assert.match(authForms, /value: pdga/);
  assert.match(authForms, /value: udisc/);
  assert.match(authForms, /onValuesChange\("login", \{ identifier: event\.target\.value \}\)/);
  assert.match(authForms, /onValuesChange\("login", \{ pin: event\.target\.value \}\)/);
  assert.match(authForms, /onValuesChange\("pin", \{ newPin: event\.target\.value \}\)/);
  assert.match(authForms, /onValuesChange\("pin", \{ confirmPin: event\.target\.value \}\)/);
  assert.match(authForms, /onValuesChange\("profile", \{ pdga: event\.target\.value \}\)/);
  assert.match(authForms, /onValuesChange\("profile", \{ udisc: event\.target\.value \}\)/);
  assert.match(authForms, /request\("gvdg:member-login-requested", \{ identifier, pin \}\)/);
  assert.match(authForms, /request\("gvdg:member-pin-change-requested", \{ newPin, confirmPin \}\)/);
  assert.match(authForms, /request\("gvdg:member-profile-save-requested", \{ pdga, udisc \}\)/);
  assert.match(authForms, /gvdg:member-profile-photo-chosen/);
  assert.match(authForms, /gvdg:member-passkey-login-requested/);
  assert.match(authForms, /data-react-profile-preview/);
  assert.match(authForms, /gvdg:member-profile-preview/);
  assert.match(authForms, /id: "photoInput"/);
  assert.doesNotMatch(authForms, /id: "loginError"|id: "pinChangeError"|id: "profileError"/);
  assert.doesNotMatch(authForms, /id: "loginBtn"|id: "passkeyBtn"|id: "setPinBtn"|id: "profileSaveBtn"|id: "profileSkipBtn"/);
  assert.doesNotMatch(authForms, /profilePhotoPreview/);
  assert.match(authController, /data\.mustChangePin/);
  assert.match(authController, /request\(path, options\)/);
  assert.match(authController, /\/login/);
  assert.match(authController, /\/set-pin/);
  assert.match(authController, /\/me/);
  assert.match(authController, /gvdg:member-login-requested/);
  assert.match(authController, /gvdg:member-pin-change-requested/);
  assert.match(authController, /gvdg:member-profile-save-requested/);
  assert.match(authController, /gvdg:member-profile-photo-chosen/);
  assert.match(authController, /gvdg:member-passkey-login-requested/);
  assert.match(authController, /gvdg:member-add-passkey-requested/);
  assert.match(authController, /gvdg:member-edit-profile-requested/);
  assert.match(authController, /gvdg:member-logout-requested/);
  assert.match(authController, /gvdg:member-auth-ready/);
  assert.match(authController, /detailString\(event, "identifier"\)/);
  assert.match(authController, /detailString\(event, "pin"\)/);
  assert.match(authController, /detailString\(event, "newPin"\)/);
  assert.match(authController, /detailString\(event, "confirmPin"\)/);
  assert.match(authController, /setAuthFormValues\("login", \{ pin: "" \}\)/);
  assert.match(authController, /setAuthFormValues\("pin", \{ newPin: "", confirmPin: "" \}\)/);
  assert.doesNotMatch(authController, /byId|getElementById|identifierInput|pinInput|newPinInput|confirmPinInput|\.value/);
  assert.match(authDom, /gvdg:member-auth-mode/);
  assert.match(authDom, /gvdg:member-shell-view/);
  assert.match(authDom, /gvdg:member-auth-form-state/);
  assert.match(authDom, /gvdg:member-passkey-state/);
  assert.match(authDom, /gvdg:member-dashboard-opened/);
  assert.match(authDom, /setAuthFormValues/);
  assert.doesNotMatch(authDom, /byId|getElementById|requestAnimationFrame|loginGate|membersContent|style\.display|classList|textContent\s*=|showError|clearError|setBusy/);
  assert.match(authState, /gvdg:member-profile-updated/);
  assert.match(authState, /setMemberContext/);
  assert.match(memberContext, /let memberContext = \{\}/);
  assert.match(memberContext, /export function setMemberContext/);
  assert.doesNotMatch(`${authState}\n${memberContext}\n${router}`, /GVDG_MEMBER_DASHBOARD_CONTEXT|GVDG_MEMBER_DASHBOARD_ROUTER_READY/);
  assert.match(passkeys, /\/webauthn\/register\/options/);
  assert.match(passkeys, /\/webauthn\/auth\/verify/);
  assert.match(passkeys, /navigator\.credentials\.get/);
  assert.match(passkeys, /gvdg:member-passkey-state/);
  assert.match(passkeys, /gvdg:member-auth-form-state|showAuthError/);
  assert.doesNotMatch(passkeys, /loginGate|style\.display|passkeyStatus|enablePasskeyBtn|loginError|passkeyBtn|textContent\s*=|setBusy|showError|clearError/);
  assert.match(profile, /\/profile/);
  assert.match(profile, /gvdg:member-profile-preview/);
  assert.match(profile, /gvdg:member-auth-form-state|showAuthError/);
  assert.match(profile, /setAuthFormValues\("profile"/);
  assert.match(profile, /detailString\(event, "pdga"\)/);
  assert.match(profile, /detailString\(event, "udisc"\)/);
  assert.doesNotMatch(profile, /byId|getElementById|profilePdgaInput|profileUdiscInput|\.value/);
  assert.doesNotMatch(profile, /loginGate|membersContent|classList\.remove\("active"\)|gate\.style|content\?|profilePhotoPreview|profileError|profileSaveBtn|style\.display|textContent\s*=|setBusy|showError|clearError/);
  assert.match(pageChrome, /export function MemberPageChrome\(\)/);
  assert.match(pageChrome, /data-react-page-chrome/);
  assert.match(pageChrome, /aria-current/);
  assert.match(pageChrome, /aria-expanded/);
  assert.match(pageChrome, /nav-donate/);
  assert.match(pageChrome, /localStorageGet\("theme"\)/);
  assert.match(pageChrome, /Menu, Moon, Sun, X/);
  assert.doesNotMatch(pageChrome, /querySelector|addEventListener|classList|textContent\s*=|installMemberPageChrome/);
  assert.doesNotMatch(pageChrome, /☰|🌙|☀️/);
  assert.match(shell, /data-react-member-banner/);
  assert.match(shell, /data-react-admin-portal/);
  assert.match(shell, /id: "logoutBtn"/);
  assert.match(shell, /id: "adminPortalLink"/);
  assert.match(shell, /readMemberContext/);
  assert.match(shell, /gvdg:member-profile-updated/);
  assert.match(shell, /gvdg:member-logout-requested/);
  assert.match(shell, /document\.body\.dataset\.memberDashboardTab/);
  assert.match(shell, /scrollIntoView/);
  assert.doesNotMatch(shell, /memberSectionTitle|getElementById/);
  assert.match(router, /gvdg:select-dashboard-tab[\s\S]*gvdg:member-dashboard-opened/);
  assert.match(router, /gvdg:dashboard-tab-selected[\s\S]*gvdg:member-dashboard-ready/);
  assert.doesNotMatch(router, /memberSectionTitle|textContent\s*=|querySelector|classList|getElementById|dtab-off|style\.display|revealDashboardSections/);
  assert.match(dialogs, /export function MemberDialogs\(\)/);
  assert.match(dialogs, /export function memberAlert\(options\)/);
  assert.match(dialogs, /export function memberConfirm\(options\)/);
  assert.match(dialogs, /role: "dialog"/);
  assert.match(dialogs, /aria-modal/);
  assert.match(overview, /data-react-overview-dashboard/);
  assert.match(overview, /data-react-dashboard-actions/);
  assert.match(overview, /data-react-account-tools/);
  assert.match(overview, /data-react-passkey-action/);
  assert.match(overview, /data-react-passkey-status/);
  assert.match(overview, /gvdg:member-passkey-state/);
  assert.match(overview, /disabled: passkeyState\.busy/);
  assert.doesNotMatch(overview, /enablePasskeyBtn|passkeyStatus/);
  assert.match(overview, /id: "editProfileBtn"/);
  assert.match(overview, /gvdg:member-add-passkey-requested/);
  assert.match(overview, /gvdg:member-edit-profile-requested/);
  assert.match(pdga, /id: "membersReactRatingPanel"/);
  assert.match(pdga, /data-react-pdga-dashboard/);
  assert.match(pdga, /data-react-live-rating/);
  assert.match(pdga, /\/pdga-stats\?pdga=/);
  assert.match(pdga, /className: "dash-event-main"/);
  assert.match(pdga, /export function pdgaEventTitle\(value\)/);
  assert.match(pdga, /pdgaEventTitle\(event\.tournament\) \|\| "Event"/);
  assert.doesNotMatch(pdga, /dangerouslySetInnerHTML|innerHTML/);
  assert.match(pdga, /className: "dash-event-main"[\s\S]*className: "dash-event-copy"[\s\S]*h\(EventRatingRow, \{ ratings/);
  assert.match(pdga, /function EventRatingRow\(\{ ratings \}\)[\s\S]*className: "dash-event-rating-row"[\s\S]*className: "dash-event-rating-label"[\s\S]*className: "dash-event-ratings"/);
  assert.match(html, /\.dash-event \{ display: grid; grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(html, /\.dash-event \{[^}]*grid-auto-flow: row/);
  assert.doesNotMatch(html, /\.dash-event \{[^}]*justify-content: space-between/);
  assert.match(html, /\.dash-event-main \{[^}]*display: grid; grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(html, /\.dash-event-copy \{[^}]*display: grid; grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(html, /\.dash-event-rating-row \{[^}]*grid-column: 1 \/ -1/);
  assert.match(html, /\.dash-event-rating-row \{[^}]*display: grid; grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(html, /\.dash-event-rating-row \{[^}]*width: 100%/);
  assert.match(html, /\.dash-event-rating-row \{[^}]*border-top: 1px solid var\(--border-color\)/);
  assert.match(html, /\.dash-event-rating-label \{[^}]*text-transform: uppercase/);
  assert.match(html, /\.dash-event-ratings \{[^}]*display: inline-flex/);
  assert.match(html, /\.dash-event-ratings \{[^}]*justify-self: start/);
  assert.match(html, /\.dash-event-ratings \{[^}]*background: var\(--bg-tertiary\)/);
  assert.match(pdga, /Round ratings:/);
  assert.match(ratings, /\/my-ratings\?/);
  assert.match(ratings, /data-react-club-ratings/);
  assert.match(ratings, /UDiscExportDetails/);
  assert.match(udiscExport, /export function UDiscExportDetails\(props\)/);
  assert.match(udiscExport, /export function udiscDeepLink\(courseId\)/);
  assert.match(udiscExport, /export function parseUdiscScorecard\(scorecard\)/);
  assert.match(udiscExport, /ExternalLink/);
  assert.equal(existsSync('udisc-export.js'), false);
  assert.doesNotMatch(html, /udisc-export\.js/);
  assert.doesNotMatch(ratings, /window\.UDiscExport/);
  assert.doesNotMatch(ratings, /replaceChildren/);
  assert.doesNotMatch(ratings, /appendChild\(node\)/);
  assert.match(activity, /\/my-live-rounds/);
  assert.match(activity, /\/shop\/wallet/);
  assert.match(activity, /\/leagues\/active/);
  assert.match(activity, /data-react-live-scoring/);
  assert.match(activity, /data-react-wallet/);
  assert.match(registration, /data-react-registration-panel/);
  assert.match(registration, /EventRegistrationSections/);
  assert.match(registration, /CasualRoundsSection/);
  assert.doesNotMatch(registration, /visibleParent|style\.display|getElementById\("clubRegister"\)/);
  assert.doesNotMatch(registrationEvents, /window\.alert|window\.confirm/);
  assert.match(registrationEvents, /memberAlert/);
  assert.match(registrationEvents, /memberConfirm/);
  assert.doesNotMatch(registrationCasual, /window\.alert|window\.confirm/);
  assert.match(registrationCasual, /memberAlert/);
  assert.match(registrationCasual, /memberConfirm/);
  assert.doesNotMatch(registrationPayments, /window\.alert|window\.confirm/);
  assert.match(registrationPayments, /memberAlert/);
  assert.match(registrationPayments, /data-paypal-button-host/);
  assert.match(registrationPayments, /useLatest/);
  assert.doesNotMatch(registrationPayments, /replaceChildren/);
  assert.match(board, /data-react-board-panel/);
  assert.doesNotMatch(board, /visibleParent|style\.display|getElementById\("clubBoard"\)/);
  assert.doesNotMatch(board, /window\.alert|window\.confirm/);
  assert.match(board, /memberConfirm/);
  assert.match(teeSigns, /data-react-tee-signs-panel/);
  assert.doesNotMatch(teeSigns, /visibleParent|style\.display|getElementById\("teeCapture"\)/);
  assert.match(club, /data-react-club-panel/);
});

test('PDGA event titles decode common HTML entities without innerHTML', async () => {
  const { pdgaEventTitle } = await import(new URL('../src/members-app/pdga-dashboard.js', import.meta.url));

  assert.equal(pdgaEventTitle('2026 Ayden Founders&#039; Day Classic'), "2026 Ayden Founders' Day Classic");
  assert.equal(pdgaEventTitle('CEP Charity &amp; Rated'), 'CEP Charity & Rated');
  assert.equal(pdgaEventTitle('Hex &#x26; Flex'), 'Hex & Flex');
});
