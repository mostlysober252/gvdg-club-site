import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const publicPages = [
  'events.html',
  'ryder-cup.html',
  'pro-shop.html',
  'gvdg-blog.html',
];

const removedChromePatterns = [
  /<script src="nav\.js" defer><\/script>/,
  /class="menu-toggle" aria-label="Toggle menu">/,
  /class="theme-icon"/,
  /const themeToggle/,
  /const menuToggle/,
  /themeIcon/,
  /document\.querySelector\(['"]header['"]\)/,
  /☰|✕|🌙|☀️/,
];

test('public content pages mount the shared React page chrome', () => {
  for (const page of publicPages) {
    const html = readFileSync(page, 'utf8');
    assert.match(html, /id="publicReactPageChrome"/, page);
    assert.match(html, /<script type="module" src="public-app\/public-app\.js"><\/script>/, page);
    for (const pattern of removedChromePatterns) {
      assert.doesNotMatch(html, pattern, page);
    }
  }
});

test('public React page chrome owns menu, active link, theme, and scroll state', () => {
  const main = readFileSync('src/public-app/main.js', 'utf8');
  const chrome = readFileSync('src/public-app/page-chrome.js', 'utf8');
  const packageJson = readFileSync('package.json', 'utf8');
  const deploy = readFileSync('scripts/gvdg-deploy.sh', 'utf8');
  const sw = readFileSync('sw.js', 'utf8');

  assert.match(packageJson, /"build:public": "vite build --config vite\.public\.config\.mjs"/);
  assert.match(packageJson, /"build": "npm run build:home && npm run build:public && npm run build:admin && npm run build:tee-sign-preview && npm run build:score && npm run build:members"/);
  assert.ok(existsSync('vite.public.config.mjs'));
  assert.match(main, /createRoot\(pageChromeMount\)\.render\(h\(PublicPageChrome\)\)/);
  assert.match(chrome, /export function PublicPageChrome/);
  assert.match(chrome, /data-react-public-chrome/);
  assert.match(chrome, /aria-expanded/);
  assert.match(chrome, /aria-current/);
  assert.match(chrome, /aria-pressed/);
  assert.match(chrome, /nav-donate/);
  assert.match(chrome, /Menu, MoonStar, Sun, X/);
  assert.match(chrome, /window\.requestAnimationFrame\(update\)/);
  assert.match(chrome, /localStorage\.getItem\("theme"\)/);
  assert.match(chrome, /localStorage\.setItem\("theme", theme\)/);
  assert.match(deploy, /home-app public-app admin-app tee-sign-preview-app members-app score-app/);
  assert.match(sw, /const CACHE = "gvdg-club-v86"/);
  assert.match(sw, /"public-app\/public-app\.js"/);
  assert.doesNotMatch(sw, /"nav\.js"/);
  assert.doesNotMatch(chrome, /innerHTML|insertAdjacentHTML|replaceChildren|document\.createElement|querySelector|classList|textContent\s*=|☰|✕|🌙|☀️/);
});

test('Crotts assistant is rendered by React bundles on app pages', () => {
  const homeHtml = readFileSync('index.html', 'utf8');
  const membersHtml = readFileSync('gvdg-members.html', 'utf8');
  const adminHtml = readFileSync('admin.html', 'utf8');
  const publicMain = readFileSync('src/public-app/main.js', 'utf8');
  const homeMain = readFileSync('src/home-app/main.js', 'utf8');
  const membersMain = readFileSync('src/members-app/main.js', 'utf8');
  const adminMain = readFileSync('src/admin-app/main.js', 'utf8');
  const widget = readFileSync('src/shared/crotts-widget.js', 'utf8');

  for (const page of publicPages) {
    const html = readFileSync(page, 'utf8');
    assert.match(html, /id="crottsReactApp"/, page);
    assert.doesNotMatch(html, /<script src="crotts\.js" defer><\/script>/, page);
  }
  assert.match(homeHtml, /id="crottsReactApp"/);
  assert.match(membersHtml, /id="crottsReactApp"/);
  assert.match(adminHtml, /id="crottsReactApp"/);
  assert.match(adminHtml, /<script type="module" src="admin-app\/admin-app\.js"><\/script>/);
  assert.doesNotMatch(homeHtml, /<script src="crotts\.js" defer><\/script>/);
  assert.doesNotMatch(membersHtml, /<script src="crotts\.js" defer><\/script>/);
  assert.doesNotMatch(adminHtml, /<script src="crotts\.js" defer><\/script>/);
  assert.equal(existsSync('crotts.js'), false);
  assert.match(readFileSync('events.html', 'utf8'), /body\[data-page="events"\]\[data-events-view="detail"\] #crottsReactApp #crotts-fab/);
  assert.match(membersHtml, /\.members-content ~ #crottsReactApp #crotts-fab/);
  assert.match(publicMain, /import \{ CrottsWidget \} from "\.\.\/shared\/crotts-widget\.js"/);
  assert.match(homeMain, /import \{ CrottsWidget \} from "\.\.\/shared\/crotts-widget\.js"/);
  assert.match(membersMain, /import \{ CrottsWidget \} from "\.\.\/shared\/crotts-widget\.js"/);
  assert.match(adminMain, /import \{ CrottsWidget \} from "\.\.\/shared\/crotts-widget\.js"/);
  assert.match(publicMain, /const crottsMount = document\.getElementById\("crottsReactApp"\)/);
  assert.match(homeMain, /const crottsMount = document\.getElementById\("crottsReactApp"\)/);
  assert.match(membersMain, /const crottsMount = document\.getElementById\("crottsReactApp"\)/);
  assert.match(adminMain, /const crottsMount = document\.getElementById\("crottsReactApp"\)/);
  assert.match(publicMain, /createRoot\(crottsMount\)\.render\(h\(CrottsWidget\)\)/);
  assert.match(homeMain, /createRoot\(crottsMount\)\.render\(h\(CrottsWidget\)\)/);
  assert.match(membersMain, /createRoot\(crottsMount\)\.render\(h\(CrottsWidget\)\)/);
  assert.match(adminMain, /createRoot\(crottsMount\)\.render\(h\(CrottsWidget\)\)/);
  assert.match(widget, /export function CrottsWidget/);
  assert.match(widget, /id: "crotts-fab"/);
  assert.match(widget, /id: "crotts-panel"/);
  assert.match(widget, /body\.admin-page #crotts-fab,body\.admin-page #crotts-panel\{display:none\}/);
  assert.match(widget, /\/assistant/);
  assert.match(widget, /MessageCircle, Send, X/);
  assert.doesNotMatch(widget, /innerHTML|insertAdjacentHTML|replaceChildren|document\.createElement|querySelector|classList|textContent\s*=|dangerouslySetInnerHTML|☰|✕|🌙|☀️|🥏|…/);
});

test('Events previous results panel is rendered by the public React bundle', () => {
  const html = readFileSync('events.html', 'utf8');
  const main = readFileSync('src/public-app/main.js', 'utf8');
  const app = readFileSync('src/public-app/events-previous-results-app.js', 'utf8');
  const data = readFileSync('src/public-app/events-hub-data.js', 'utf8');

  assert.match(html, /id="previousResultsSection"/);
  assert.doesNotMatch(html, /gvdg:events-previous-results|__gvdgEventsPreviousResults|function publishPreviousResults/);
  assert.doesNotMatch(html, /function renderPreviousResults|function previousResultCard|previousResultsExpanded|previousResultsVisible/);
  assert.match(main, /createRoot\(eventsPreviousResultsMount\)\.render\(h\(EventsPreviousResultsApp\)\)/);
  assert.match(app, /export function EventsPreviousResultsApp/);
  assert.match(app, /import \{ useEventsPreviousResults \} from "\.\/events-hub-data\.js"/);
  assert.match(data, /export function useEventsPreviousResults\(\)/);
  assert.match(data, /state\.previousResults = previousResults/);
  assert.match(app, /data-react-events-previous-results/);
  assert.match(app, /PREVIOUS_RESULTS_INITIAL = 3/);
  assert.match(app, /PREVIOUS_RESULTS_PAGE_SIZE = 12/);
  assert.match(app, /CalendarDays, ChevronDown, ChevronUp, ExternalLink, Info/);
  assert.match(app, /aria-expanded/);
  assert.match(app, /safeHref/);
  assert.doesNotMatch(app, /innerHTML|insertAdjacentHTML|replaceChildren|document\.createElement|querySelector|classList|textContent\s*=|☰|✕|🌙|☀️|📅|📍/);
});

test('Events hub schedule and club feed are rendered by the public React bundle', () => {
  const html = readFileSync('events.html', 'utf8');
  const main = readFileSync('src/public-app/main.js', 'utf8');
  const app = readFileSync('src/public-app/events-hub-app.js', 'utf8');
  const data = readFileSync('src/public-app/events-hub-data.js', 'utf8');

  assert.match(html, /id="liveNowSection"/);
  assert.match(html, /id="calendarEvents"/);
  assert.match(html, /id="hub"/);
  assert.match(html, /id="clubEventsSection"/);
  assert.doesNotMatch(html, /new CustomEvent\('gvdg:events-hub'|__gvdgEventsHub|function publishHub/);
  assert.doesNotMatch(html, /function groupHeading|function feedList|function eventCard|function section|liveNowEl\.replaceChildren|calendarEl\.appendChild|hubEl\.appendChild|clubEl\.appendChild/);
  assert.match(main, /import \{ installEventsHubController \} from "\.\/events-hub-data\.js"/);
  assert.match(main, /installEventsHubController\(\)/);
  assert.match(main, /createRoot\(eventsLiveNowMount\)\.render\(h\(EventsLiveNowApp\)\)/);
  assert.match(main, /createRoot\(eventsScheduleFeedMount\)\.render\(h\(EventsScheduleFeedApp\)\)/);
  assert.match(main, /createRoot\(eventsUpcomingMount\)\.render\(h\(EventsUpcomingApp\)\)/);
  assert.match(main, /createRoot\(eventsClubFeedMount\)\.render\(h\(EventsClubFeedApp\)\)/);
  assert.match(app, /export function EventsLiveNowApp/);
  assert.match(app, /export function EventsScheduleFeedApp/);
  assert.match(app, /export function EventsUpcomingApp/);
  assert.match(app, /export function EventsClubFeedApp/);
  assert.match(app, /import \{ useEventsHub \} from "\.\/events-hub-data\.js"/);
  assert.match(data, /fetchPublicJson\(api, "\/club-feed"\)/);
  assert.match(data, /fetchPublicJson\(api, `\/events\?limit=\$\{EVENTS_PAGE_LIMIT\}&offset=0`\)/);
  assert.match(data, /publishEventsView\("hub"\)/);
  assert.match(data, /currentEventsView\(\) === "hub"/);
  assert.doesNotMatch(data, /window\.__gvdgEvents/);
  assert.match(app, /data-react-events-hub/);
  assert.match(app, /CalendarDays, ExternalLink, MapPin/);
  assert.match(app, /safeHref/);
  assert.doesNotMatch(app, /innerHTML|insertAdjacentHTML|replaceChildren|document\.createElement|querySelector|classList|textContent\s*=|☰|✕|🌙|☀️|📅|📍|🥏/);
});

test('Events status messages are rendered by the public React bundle', () => {
  const html = readFileSync('events.html', 'utf8');
  const main = readFileSync('src/public-app/main.js', 'utf8');
  const app = readFileSync('src/public-app/events-status-app.js', 'utf8');
  const hubData = readFileSync('src/public-app/events-hub-data.js', 'utf8');

  assert.match(html, /id="status"/);
  assert.doesNotMatch(html, /new CustomEvent\('gvdg:events-status'|function publishStatus\(status\)|showStatus\(message, isError, onRetry\)/);
  assert.match(hubData, /publishEventsStatus\(\{ message: "Loading\.\.\."/);
  assert.match(hubData, /tone: "error"/);
  assert.doesNotMatch(html, /statusEl\.className|statusEl\.replaceChildren|statusEl\.appendChild|document\.createElement|empty-icon', '🥏'/);
  assert.match(main, /const eventsStatusMount = document\.getElementById\("status"\)/);
  assert.match(main, /createRoot\(eventsStatusMount\)\.render\(h\(EventsStatusApp\)\)/);
  assert.match(app, /export function EventsStatusApp/);
  assert.match(app, /currentEventsStatus/);
  assert.doesNotMatch(app, /window\.__gvdgEventsStatus/);
  assert.match(app, /data-react-events-status/);
  assert.match(app, /CircleAlert, Disc3, RefreshCcw/);
  assert.match(app, /role = isError \? "alert" : "status"/);
  assert.doesNotMatch(app, /innerHTML|insertAdjacentHTML|replaceChildren|document\.createElement|querySelector|classList|textContent\s*=|dangerouslySetInnerHTML|☰|✕|🌙|☀️|📅|📍|🥏/);
});

test('Events last-updated line is rendered by the public React bundle', () => {
  const html = readFileSync('events.html', 'utf8');
  const main = readFileSync('src/public-app/main.js', 'utf8');
  const app = readFileSync('src/public-app/events-last-updated-app.js', 'utf8');
  const hubData = readFileSync('src/public-app/events-hub-data.js', 'utf8');

  assert.match(html, /id="eventsLastUpdatedReactApp"/);
  assert.doesNotMatch(html, /new CustomEvent\('gvdg:events-last-updated'|function publishLastUpdated\(updatedAt\)|publishLastUpdated\(new Date\(\)/);
  assert.match(hubData, /publishEventsLastUpdated\(new Date\(\)\)/);
  assert.doesNotMatch(html, /id="lastUpdated"|lastUpdatedEl\.hidden|lastUpdatedEl\.textContent/);
  assert.match(main, /import \{ EventsLastUpdatedApp \} from "\.\/events-last-updated-app\.js"/);
  assert.match(main, /const eventsLastUpdatedMount = document\.getElementById\("eventsLastUpdatedReactApp"\)/);
  assert.match(main, /createRoot\(eventsLastUpdatedMount\)\.render\(h\(EventsLastUpdatedApp\)\)/);
  assert.match(app, /export function EventsLastUpdatedApp/);
  assert.match(app, /currentEventsLastUpdated/);
  assert.doesNotMatch(app, /window\.__gvdgEventsLastUpdated/);
  assert.match(app, /data-react-events-last-updated/);
  assert.match(app, /className: "last-updated"/);
  assert.doesNotMatch(app, /innerHTML|insertAdjacentHTML|replaceChildren|document\.createElement|querySelector|classList|textContent\s*=|dangerouslySetInnerHTML|☰|✕|🌙|☀️|📅|📍|🥏/);
});

test('Events leagues list is rendered by the public React bundle', () => {
  const html = readFileSync('events.html', 'utf8');
  const main = readFileSync('src/public-app/main.js', 'utf8');
  const app = readFileSync('src/public-app/events-leagues-app.js', 'utf8');

  assert.match(html, /id="leaguesSection"/);
  assert.doesNotMatch(html, /new CustomEvent\('gvdg:events-leagues'|publishLeagues\(leagues\)|loadLeaguesList\(\)/);
  assert.doesNotMatch(html, /leaguesEl\.replaceChildren|leaguesEl\.appendChild/);
  assert.match(main, /import \{ EventsLeaguesApp \} from "\.\/events-leagues-app\.js"/);
  assert.match(main, /const eventsLeaguesMount = document\.getElementById\("leaguesSection"\)/);
  assert.match(main, /createRoot\(eventsLeaguesMount\)\.render\(h\(EventsLeaguesApp\)\)/);
  assert.match(app, /export function EventsLeaguesApp/);
  assert.match(app, /import \{ fetchPublicJson, publicApiBase \} from "\.\/public-api\.js"/);
  assert.match(app, /fetchPublicJson\(api, "\/leagues"\)/);
  assert.match(app, /data-react-events-leagues/);
  assert.match(app, /className: "league-card"/);
  assert.match(app, /disabled/);
  assert.match(app, /window\.location\.hash = `#league\/\$\{encodeURIComponent\(league\.id\)\}`/);
  assert.doesNotMatch(app, /innerHTML|insertAdjacentHTML|replaceChildren|document\.createElement|querySelector|classList|textContent\s*=|☰|✕|🌙|☀️|📅|📍|🥏/);
});

test('Events league detail is rendered by the public React bundle', () => {
  const html = readFileSync('events.html', 'utf8');
  const main = readFileSync('src/public-app/main.js', 'utf8');
  const app = readFileSync('src/public-app/events-league-detail-app.js', 'utf8');

  assert.match(html, /id="leagueDetailSection"/);
  assert.doesNotMatch(html, /new CustomEvent\('gvdg:events-league-detail'|publishLeagueDetail\(data\)|loadLeague\(r\.id\)|async function loadLeague\(id\)/);
  assert.doesNotMatch(html, /function renderLeague\(data\)|function scrollTable\(table\)/);
  assert.match(main, /import \{ EventsLeagueDetailApp \} from "\.\/events-league-detail-app\.js"/);
  assert.match(main, /const eventsLeagueDetailMount = document\.getElementById\("leagueDetailSection"\)/);
  assert.match(main, /createRoot\(eventsLeagueDetailMount\)\.render\(h\(EventsLeagueDetailApp\)\)/);
  assert.match(app, /export function EventsLeagueDetailApp/);
  assert.match(app, /import \{ fetchPublicJson, publicApiBase \} from "\.\/public-api\.js"/);
  assert.match(app, /EVENTS_ROUTE_REQUEST_EVENT/);
  assert.match(app, /fetchPublicJson\(api, `\/leagues\/\$\{encodeURIComponent\(routeId\)\}`\)/);
  assert.match(app, /publishEventsView\("league-detail"\)/);
  assert.match(app, /publishEventsStatus\(\{/);
  assert.match(app, /data-react-events-league-detail/);
  assert.match(app, /function TeamStandingsTable/);
  assert.match(app, /function PlayerStandingsTable/);
  assert.match(app, /function LeagueRounds/);
  assert.match(app, /className: "lb-wrap"/);
  assert.match(app, /window\.location\.hash = `#event\/\$\{encodeURIComponent\(id\)\}`/);
  assert.doesNotMatch(app, /innerHTML|insertAdjacentHTML|replaceChildren|document\.createElement|querySelector|classList|textContent\s*=|☰|✕|🌙|☀️|📅|📍|🥏|●/);
});

test('Events event detail is rendered by the public React bundle', () => {
  const html = readFileSync('events.html', 'utf8');
  const main = readFileSync('src/public-app/main.js', 'utf8');
  const app = readFileSync('src/public-app/events-detail-app.js', 'utf8');
  const dataApp = readFileSync('src/public-app/events-detail-data.js', 'utf8');
  const sharedSvg = readFileSync('src/shared/tee-sign-svg.js', 'utf8');

  assert.match(html, /id="detail"/);
  assert.doesNotMatch(html, /new CustomEvent\('gvdg:events-event-detail'|publishEventDetail\(activeEventDetail\)|loadDetail\(r\.id\)|function mountLiveLeaderboard/);
  assert.equal(existsSync('udisc-export.js'), false);
  assert.doesNotMatch(html, /udisc-export\.js|window\.UDiscExport/);
  assert.doesNotMatch(html, /function renderDetail|function renderFinalResults|function renderEventExtras|function renderTeeSigns|function renderStandings|detailEl\.appendChild|detailEl\.replaceChildren/);
  assert.match(main, /import \{ EventsEventDetailApp \} from "\.\/events-detail-app\.js"/);
  assert.match(main, /const eventsEventDetailMount = document\.getElementById\("detail"\)/);
  assert.match(main, /createRoot\(eventsEventDetailMount\)\.render\(h\(EventsEventDetailApp\)\)/);
  assert.match(app, /export function EventsEventDetailApp/);
  assert.match(app, /import \{ useEventsEventDetail \} from "\.\/events-detail-data\.js"/);
  assert.match(dataApp, /export function useEventsEventDetail/);
  assert.match(dataApp, /fetchPublicJson\(api, `\/events\/\$\{encodeURIComponent\(routeId\)\}`\)/);
  assert.match(dataApp, /publishEventsView\("detail"\)/);
  assert.match(dataApp, /function mountLiveLeaderboard/);
  assert.match(app, /data-react-events-event-detail/);
  assert.match(app, /data-react-events-final-results/);
  assert.match(app, /function LivePanel/);
  assert.match(app, /function LiveStandings/);
  assert.match(app, /live-matchplay/);
  assert.match(app, /function FinalResults/);
  assert.match(app, /function EventExtras/);
  assert.match(app, /function TeeSigns/);
  assert.match(app, /function PlayerRoster/);
  assert.match(app, /WeatherStrip/);
  assert.match(app, /import \{ UDiscExportDetails, udiscDeepLink \} from "\.\.\/shared\/udisc-export\.js"/);
  assert.doesNotMatch(app, /function UDiscExportCard|function udiscDeepLink|function scorecardRows/);
  assert.match(app, /import \{ TeeSignSvg \} from "\.\.\/shared\/tee-sign-svg\.js"/);
  assert.match(sharedSvg, /teeSignModel/);
  assert.doesNotMatch(app, /teeSignNode|DOMParser|replaceChildren|appendChild|dangerouslySetInnerHTML/);
  assert.doesNotMatch(sharedSvg, /teeSignNode|DOMParser|replaceChildren|appendChild|dangerouslySetInnerHTML/);
  assert.doesNotMatch(app, /innerHTML|insertAdjacentHTML|document\.createElement|querySelector|classList|textContent\s*=|dangerouslySetInnerHTML|☰|✕|🌙|☀️|📅|📍|🥏|🏆|🪧|✏️|⚑/);
});

test('Events fundraisers and meetings are rendered by the public React bundle', () => {
  const html = readFileSync('events.html', 'utf8');
  const main = readFileSync('src/public-app/main.js', 'utf8');
  const app = readFileSync('src/public-app/events-club-content-app.js', 'utf8');

  assert.match(html, /id="fundraisersSection"/);
  assert.match(html, /id="meetingsSection"/);
  assert.doesNotMatch(html, /new CustomEvent\('gvdg:events-fundraisers'|new CustomEvent\('gvdg:events-meetings'/);
  assert.doesNotMatch(html, /async function loadFundraisers\(\)|async function loadMeetings\(\)|loadFundraisers\(\)|loadMeetings\(\)/);
  assert.doesNotMatch(html, /function safeMd|function appendInline|function shareRow|fundraisersEl\.appendChild|meetingsEl\.appendChild|💚 Donate/);
  assert.match(main, /createRoot\(eventsFundraisersMount\)\.render\(h\(EventsFundraisersApp\)\)/);
  assert.match(main, /createRoot\(eventsMeetingsMount\)\.render\(h\(EventsMeetingsApp\)\)/);
  assert.match(app, /export function EventsFundraisersApp/);
  assert.match(app, /export function EventsMeetingsApp/);
  assert.match(app, /import \{ fetchPublicJson, publicApiBase \} from "\.\/public-api\.js"/);
  assert.match(app, /fetchPublicJson\(api, "\/fundraisers"\)/);
  assert.match(app, /fetchPublicJson\(api, "\/meetings"\)/);
  assert.match(app, /data-react-events-fundraisers/);
  assert.match(app, /data-react-events-meetings/);
  assert.match(app, /import \{ safeExternalUrl \} from "\.\.\/shared\/safe-url\.js"/);
  assert.match(app, /navigator\.clipboard\.writeText\(url\)/);
  assert.match(app, /Heart, Mail/);
  assert.doesNotMatch(app, /innerHTML|insertAdjacentHTML|replaceChildren|document\.createElement|querySelector|classList|textContent\s*=|☰|✕|🌙|☀️|💚/);
});

test('Events registration is rendered by the public React bundle', () => {
  const html = readFileSync('events.html', 'utf8');
  const main = readFileSync('src/public-app/main.js', 'utf8');
  const app = readFileSync('src/public-app/events-registration-app.js', 'utf8');
  const hubData = readFileSync('src/public-app/events-hub-data.js', 'utf8');

  assert.match(html, /id="registerSection"/);
  assert.match(html, /#registerSection \{ margin: 0; padding: 0; background: transparent; border-radius: 0; \}/);
  assert.match(html, /#registerSection \[data-react-events-registration="true"\] \{ background:/);
  assert.doesNotMatch(html, /#registerSection \{ background: .*padding:/);
  assert.doesNotMatch(html, /new CustomEvent\('gvdg:events-registration-refresh'|function loadRegistration\(\)/);
  assert.match(hubData, /const REGISTRATION_REFRESH_EVENT = "gvdg:events-registration-refresh"/);
  assert.match(hubData, /window\.dispatchEvent\(new CustomEvent\(REGISTRATION_REFRESH_EVENT\)\)/);
  assert.doesNotMatch(html, /function regCard|function addonCheckbox|function registrationLiveConfig|registerEl\.appendChild|registerEl\.replaceChildren|alert\(|confirm\(/);
  assert.match(main, /createRoot\(eventsRegistrationMount\)\.render\(h\(EventsRegistrationApp\)\)/);
  assert.match(app, /export function EventsRegistrationApp/);
  assert.match(app, /data-react-events-registration/);
  assert.match(app, /data-react-events-registration-card/);
  assert.match(app, /\/registration\/open/);
  assert.match(app, /\/my-registrations/);
  assert.match(app, /`\/events\/\$\{encodeURIComponent\(event\.id\)\}\/register/);
  assert.match(app, /gvdg_guest_regs/);
  assert.match(app, /Confirm withdraw/);
  assert.match(app, /CalendarDays, CheckCircle2/);
  assert.doesNotMatch(app, /innerHTML|insertAdjacentHTML|replaceChildren|document\.createElement|querySelector|classList|textContent\s*=|☰|✕|🌙|☀️|📅|📍|✅/);
});

test('Blog body coming-soon page is rendered by the public React bundle', () => {
  const html = readFileSync('gvdg-blog.html', 'utf8');
  const body = html.slice(html.indexOf('<body>'));
  const main = readFileSync('src/public-app/main.js', 'utf8');
  const app = readFileSync('src/public-app/blog-app.js', 'utf8');

  assert.match(html, /id="blogReactApp"/);
  assert.match(html, /<body data-page="gvdg-blog">/);
  assert.match(html, /body\[data-page="gvdg-blog"\] #crottsReactApp #crotts-fab/);
  assert.doesNotMatch(body, /<section class="page-hero"|<section class="construction-section"|class="disc-icon"|class="progress-fill"|class="back-btn"/);
  assert.doesNotMatch(html, /🥏/);
  assert.match(main, /import \{ BlogApp \} from "\.\/blog-app\.js"/);
  assert.match(main, /const blogMount = document\.getElementById\("blogReactApp"\)/);
  assert.match(main, /createRoot\(blogMount\)\.render\(h\(BlogApp\)\)/);
  assert.match(app, /export function BlogApp/);
  assert.match(app, /data-react-blog/);
  assert.match(app, /Club Blog/);
  assert.match(app, /construction-heading/);
  assert.match(app, /Coming Soon/);
  assert.match(app, /Disc3, MoveLeft/);
  assert.doesNotMatch(app, /innerHTML|insertAdjacentHTML|replaceChildren|document\.createElement|querySelector|classList|textContent\s*=|dangerouslySetInnerHTML|☰|✕|🌙|☀️|🥏|📅|📍/);
});

test('Ryder Cup body results are rendered by the public React bundle', () => {
  const html = readFileSync('ryder-cup.html', 'utf8');
  const main = readFileSync('src/public-app/main.js', 'utf8');
  const app = readFileSync('src/public-app/ryder-cup-app.js', 'utf8');

  assert.match(html, /id="ryderCupReactApp"/);
  assert.doesNotMatch(html, /id="scoreboard"|id="weeks"|id="status"|id="lastUpdated"|parseMatchGrid|parseRyderWorkbook|parseScoreboard|seedPairNames/);
  assert.match(main, /createRoot\(ryderCupMount\)\.render\(h\(RyderCupApp\)\)/);
  assert.match(app, /export function RyderCupApp/);
  assert.match(app, /data-react-ryder-cup/);
  assert.match(app, /data-react-ryder-scoreboard/);
  assert.match(app, /parseRyderWorkbook/);
  assert.match(app, /parseMatchGrid/);
  assert.match(app, /parseScoreboard/);
  assert.match(app, /seedPairNames/);
  assert.match(app, /events\.html#league\/4/);
  assert.match(app, /window\.setInterval\(\(\) => guardedLoad\(\{ quiet: true \}\), REFRESH_MS\)/);
  assert.match(app, /role: error \? "alert" : "status"/);
  assert.doesNotMatch(app, /innerHTML|insertAdjacentHTML|replaceChildren|document\.createElement|querySelector|classList|textContent\s*=|☰|✕|🌙|☀️|🏆|⚠/);
});

test('Pro Shop body storefront is rendered by the public React bundle', () => {
  const html = readFileSync('pro-shop.html', 'utf8');
  const main = readFileSync('src/public-app/main.js', 'utf8');
  const app = readFileSync('src/public-app/pro-shop-app.js', 'utf8');

  assert.match(html, /id="proShopReactApp"/);
  assert.doesNotMatch(html, /id="productGrid"|id="cartList"|id="checkoutBtn"|id="paypalRedirectBtn"|function renderProducts|function renderCart|LOCAL_AUTH_BASE/);
  assert.match(main, /createRoot\(proShopMount\)\.render\(h\(ProShopApp\)\)/);
  assert.match(app, /export function ProShopApp/);
  assert.match(app, /data-react-pro-shop/);
  assert.match(app, /\/shop\/products\?sort=brand/);
  assert.match(app, /\/shop\/wallet/);
  assert.match(app, /\/shop\/orders/);
  assert.match(app, /\/shop\/paypal-order/);
  assert.match(app, /\/shop\/pay\/create-order/);
  assert.match(app, /\/shop\/pay\/capture/);
  assert.match(app, /\/payments\/config/);
  assert.match(app, /window\.paypal\.Buttons/);
  assert.match(app, /document\.createElement\("script"\)/);
  assert.match(app, /data-paypal-button-host/);
  assert.match(app, /useLatest/);
  assert.doesNotMatch(app, /replaceChildren|innerHTML|insertAdjacentHTML|querySelector|classList|textContent\s*=|☰|✕|🌙|☀️|📦/);
});
