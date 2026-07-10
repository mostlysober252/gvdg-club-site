import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function eventsHubDataSource() {
  return readFileSync('src/public-app/events-hub-data.js', 'utf8');
}

test('public Events page pins Live Now to the top section, above the schedule feed', () => {
  const html = readFileSync('events.html', 'utf8');
  const source = eventsHubDataSource();
  const app = readFileSync('src/public-app/events-hub-app.js', 'utf8');
  assert.ok(html.indexOf('id="liveNowSection"') < html.indexOf('id="calendarEvents"'), 'Live Now mount should remain above the schedule feed mount');
  assert.match(source, /function publishLoadedHub\(feed, events, courseIndex\)/);
  assert.match(source, /live: live\.map\(\(event\) => eventHubItem\(event, courseIndex\)\)/);
  assert.match(source, /feedEvents: feedEvents\.map\(feedHubItem\)/);
  assert.match(app, /export function EventsLiveNowApp/);
  assert.match(app, /export function EventsScheduleFeedApp/);
  assert.match(app, /Live Now/);
  assert.doesNotMatch(source, /appendChild\(section\('Live Now'|appendChild\(feedList\(feedEvents\)|calendarEl\.appendChild|hubEl\.appendChild/);
});

test('public Events page hides past events behind previous results', () => {
  const source = readFileSync('events.html', 'utf8');
  const data = eventsHubDataSource();
  const app = readFileSync('src/public-app/events-previous-results-app.js', 'utf8');
  assert.match(data, /function splitFeedByDate\(items\)/);
  assert.match(data, /function isArchivedClubEvent\(raw\)/);
  assert.match(data, /state\.previousResults = previousResults/);
  assert.match(app, /useEventsPreviousResults/);
  assert.doesNotMatch(source, /function publishPreviousResults\(results\)|gvdg:events-previous-results|__gvdgEventsPreviousResults/);
  assert.doesNotMatch(source, /function renderPreviousResults\(results\)/);
  assert.doesNotMatch(source, /function previousResultCard\(item\)/);
  assert.match(app, /See previous results/);
  assert.match(app, /Hide previous results/);
  assert.match(app, /previous-results-toggle/);
  assert.doesNotMatch(source, /function renderPastSection\(past\)/);
  assert.doesNotMatch(source, /past-toggle/);
  assert.doesNotMatch(source, /function renderArchiveCta\(archivedCount\)/);
  assert.doesNotMatch(source, /archive-cta/);
  assert.equal(source.includes("hubEl.appendChild(section('Club-scored — Past'"), false, 'past events should not render inline in the hub');
  // Casual posting/joining moved to the member dashboard — no Events-page signpost remains.
  assert.doesNotMatch(source, /function renderCasualCta\(\)/);
  assert.doesNotMatch(source, /casualCta/);
  assert.doesNotMatch(source, /casual-cta/);
  assert.doesNotMatch(source, /async function loadCasualRounds\(\)/);
});

test('public Events page parses feed dates before archiving rows', () => {
  const source = eventsHubDataSource();
  assert.match(source, /function feedDateInfo\(item\)/);
  assert.match(source, /Number\(item\?\.epoch\)/);
  assert.match(source, /parseHomepageEventDate\(String\(item\?\.date \|\| ""\)\)/);
  assert.match(source, /function isPastFeedItem\(item\)/);
  assert.match(source, /isPastFeedItem\(item\) \? archived : active/);
});

test('public Events previous results include load more and show less controls', () => {
  const source = eventsHubDataSource();
  const app = readFileSync('src/public-app/events-previous-results-app.js', 'utf8');
  assert.match(app, /const PREVIOUS_RESULTS_INITIAL = 3/);
  assert.match(app, /const PREVIOUS_RESULTS_PAGE_SIZE = 12/);
  assert.match(app, /Load more/);
  assert.match(app, /Show less/);
  assert.match(app, /setVisible\(PREVIOUS_RESULTS_INITIAL\)/);
  assert.match(source, /previousResultTime\(b\) - previousResultTime\(a\)/);
});

test('public Events club content fetches fundraisers and meetings in React', () => {
  const source = readFileSync('events.html', 'utf8');
  const app = readFileSync('src/public-app/events-club-content-app.js', 'utf8');

  assert.doesNotMatch(source, /async function loadFundraisers\(\)|async function loadMeetings\(\)/);
  assert.doesNotMatch(source, /window\.__gvdgEventsFundraisers|window\.__gvdgEventsMeetings/);
  assert.doesNotMatch(source, /new CustomEvent\('gvdg:events-fundraisers'|new CustomEvent\('gvdg:events-meetings'/);
  assert.doesNotMatch(source, /loadFundraisers\(\)|loadMeetings\(\)/);
  assert.doesNotMatch(source, /function safeMd|function appendInline|function shareRow/);
  assert.doesNotMatch(source, /fundraisersEl\.appendChild|meetingsEl\.appendChild|💚 Donate/);
  assert.match(app, /export function EventsFundraisersApp/);
  assert.match(app, /export function EventsMeetingsApp/);
  assert.match(app, /fetchPublicJson\(api, "\/fundraisers"\)/);
  assert.match(app, /fetchPublicJson\(api, "\/meetings"\)/);
  assert.match(app, /fundraiser\.status === "active"/);
  assert.match(app, /data-react-events-fundraisers/);
  assert.match(app, /data-react-events-meetings/);
  assert.match(app, /MarkdownBody/);
  assert.match(app, /ShareRow/);
});

test('public Events hub schedule and club feed publish to React', () => {
  const source = readFileSync('events.html', 'utf8');
  const main = readFileSync('src/public-app/main.js', 'utf8');
  const app = readFileSync('src/public-app/events-hub-app.js', 'utf8');
  const data = eventsHubDataSource();

  assert.doesNotMatch(source, /function publishHub\(hub\)|new CustomEvent\('gvdg:events-hub'|window\.__gvdgEventsHub/);
  assert.doesNotMatch(source, /function eventHubItem\(raw\)|function feedHubItem\(item\)|fetchJson\('\/club-feed'\)|fetchJson\('\/events\?limit=/);
  assert.match(data, /function eventHubItem\(raw, courseIndex\)/);
  assert.match(data, /function feedHubItem\(item\)/);
  assert.match(data, /fetchPublicJson\(api, "\/club-feed"\)/);
  assert.match(data, /fetchPublicJson\(api, `\/events\?limit=\$\{EVENTS_PAGE_LIMIT\}&offset=0`\)/);
  assert.match(data, /hasMainContent: Boolean\(feedEvents\.length \|\| live\.length \|\| upcoming\.length\)/);
  assert.match(data, /export function installEventsHubController\(\)/);
  assert.match(data, /export function useEventsHub\(\)/);
  assert.match(main, /import \{ installEventsHubController \} from "\.\/events-hub-data\.js"/);
  assert.match(main, /installEventsHubController\(\)/);
  assert.doesNotMatch(source, /function groupHeading|function feedList|function eventCard|function section/);
  assert.doesNotMatch(source, /liveNowEl\.replaceChildren|calendarEl\.replaceChildren|hubEl\.replaceChildren|clubEl\.replaceChildren|calendarEl\.appendChild|hubEl\.appendChild|clubEl\.appendChild/);
  assert.match(main, /createRoot\(eventsLiveNowMount\)\.render\(h\(EventsLiveNowApp\)\)/);
  assert.match(main, /createRoot\(eventsScheduleFeedMount\)\.render\(h\(EventsScheduleFeedApp\)\)/);
  assert.match(main, /createRoot\(eventsUpcomingMount\)\.render\(h\(EventsUpcomingApp\)\)/);
  assert.match(main, /createRoot\(eventsClubFeedMount\)\.render\(h\(EventsClubFeedApp\)\)/);
  assert.match(app, /export function EventsLiveNowApp/);
  assert.match(app, /export function EventsScheduleFeedApp/);
  assert.match(app, /export function EventsUpcomingApp/);
  assert.match(app, /export function EventsClubFeedApp/);
  assert.match(app, /data-react-events-hub/);
  assert.match(app, /CalendarDays, ExternalLink, MapPin/);
  assert.doesNotMatch(app, /innerHTML|insertAdjacentHTML|replaceChildren|document\.createElement|querySelector|classList|textContent\s*=|☰|✕|🌙|☀️|📅|📍|🥏/);
});

test('public Events status messages publish to React', () => {
  const source = readFileSync('events.html', 'utf8');
  const main = readFileSync('src/public-app/main.js', 'utf8');
  const app = readFileSync('src/public-app/events-status-app.js', 'utf8');
  const hubData = eventsHubDataSource();

  assert.match(source, /id="status"/);
  assert.doesNotMatch(source, /function publishStatus\(status\)|new CustomEvent\('gvdg:events-status'|showStatus\(message, isError, onRetry\)/);
  assert.match(hubData, /publishEventsStatus\(\{ message: "Loading\.\.\."/);
  assert.match(hubData, /tone: "error"/);
  assert.doesNotMatch(source, /statusEl\.className|statusEl\.replaceChildren|statusEl\.appendChild|document\.createElement|addEventListener|empty-icon', '🥏'/);
  assert.match(main, /import \{ EventsStatusApp \} from "\.\/events-status-app\.js"/);
  assert.match(main, /const eventsStatusMount = document\.getElementById\("status"\)/);
  assert.match(main, /createRoot\(eventsStatusMount\)\.render\(h\(EventsStatusApp\)\)/);
  assert.match(app, /export function EventsStatusApp/);
  assert.match(app, /data-react-events-status/);
  assert.match(app, /Disc3/);
  assert.match(app, /RefreshCcw/);
  assert.doesNotMatch(app, /innerHTML|insertAdjacentHTML|replaceChildren|document\.createElement|querySelector|classList|textContent\s*=|dangerouslySetInnerHTML|☰|✕|🌙|☀️|📅|📍|🥏/);
});

test('public Events route visibility is controlled by React state and body attributes', () => {
  const source = readFileSync('events.html', 'utf8');
  const main = readFileSync('src/public-app/main.js', 'utf8');
  const controller = readFileSync('src/public-app/events-view-controller.js', 'utf8');
  const eventsState = readFileSync('src/public-app/events-state.js', 'utf8');
  const hubData = eventsHubDataSource();

  assert.match(source, /<body data-api-base="" data-page="events" data-events-view="status">/);
  assert.match(source, /id="eventsViewControllerReactApp"/);
  assert.match(source, /\.events-route \{ display: none; \}/);
  assert.match(source, /body\[data-events-view="status"\] #status/);
  assert.match(source, /body\[data-events-view="hub"\] #liveNowSection/);
  assert.match(source, /body\[data-events-view="league-detail"\] #leagueDetailSection/);
  assert.match(source, /body\[data-events-view="detail"\] #detail \{ display: block; \}/);
  assert.match(source, /body\[data-page="events"\]\[data-events-view="detail"\] #crottsReactApp #crotts-fab/);
  assert.doesNotMatch(source, /id="(?:liveNowSection|registerSection|calendarEvents|hub|previousResultsSection|leaguesSection|clubEventsSection|fundraisersSection|meetingsSection|leagueDetailSection|detail)" hidden/);
  assert.doesNotMatch(source, /function setView\(which\)|function startRefresh\(\)|function stopRefresh\(\)|window\.addEventListener\('gvdg:events-route-request'/);
  assert.match(hubData, /function startRefresh\(\)/);
  assert.match(hubData, /currentEventsView\(\) === "hub"/);
  assert.match(hubData, /EVENTS_ROUTE_REQUEST_EVENT/);
  assert.doesNotMatch(hubData, /hubEl\.hidden|style\.display|classList/);
  assert.match(main, /import \{ EventsViewController, installEventsRouteController \} from "\.\/events-view-controller\.js"/);
  assert.match(main, /const eventsViewControllerMount = document\.getElementById\("eventsViewControllerReactApp"\)/);
  assert.match(main, /installEventsRouteController\(\)/);
  assert.match(main, /createRoot\(eventsViewControllerMount\)\.render\(h\(EventsViewController\)\)/);
  assert.match(controller, /export function EventsViewController/);
  assert.match(controller, /currentEventsView/);
  assert.match(controller, /publishEventsRoute/);
  assert.match(controller, /gvdg:events-view/);
  assert.match(controller, /document\.body\.dataset\.eventsView = view/);
  assert.doesNotMatch(controller, /window\.__gvdgEvents/);
  assert.doesNotMatch(controller, /innerHTML|insertAdjacentHTML|replaceChildren|document\.createElement|querySelector|classList|textContent\s*=|style\.display|hidden|☰|✕|🌙|☀️|📅|📍|🥏/);
});

test('public Events hash routing is owned by the public React bundle', () => {
  const source = readFileSync('events.html', 'utf8');
  const main = readFileSync('src/public-app/main.js', 'utf8');
  const controller = readFileSync('src/public-app/events-view-controller.js', 'utf8');
  const eventsState = readFileSync('src/public-app/events-state.js', 'utf8');
  const hubData = eventsHubDataSource();

  assert.doesNotMatch(source, /function requestCurrentRoute\(\)|new CustomEvent\('gvdg:events-route-refresh'|function handleRouteRequest\(event\)|window\.addEventListener\('gvdg:events-route-request'/);
  assert.match(hubData, /const ROUTE_REFRESH_EVENT = "gvdg:events-route-refresh"/);
  assert.match(hubData, /function handleRouteRequest\(event\)/);
  assert.match(hubData, /route\?\.view === "event" \|\| route\?\.view === "league"/);
  assert.match(hubData, /route\?\.view === "manage"/);
  assert.match(hubData, /applyManage\(route\.id, route\.token\)/);
  assert.doesNotMatch(source, /function parseHash\(\)|window\.addEventListener\('hashchange'|window\.location\.hash \|\| ''|decodeURIComponent\(m\[1\]\)/);
  assert.match(main, /installEventsRouteController\(\)/);
  assert.match(eventsState, /export const EVENTS_ROUTE_REQUEST_EVENT = "gvdg:events-route-request"/);
  assert.match(eventsState, /function publishEventsRoute\(route\)/);
  assert.match(eventsState, /window\.dispatchEvent\(new CustomEvent\(EVENTS_ROUTE_REQUEST_EVENT/);
  assert.doesNotMatch(eventsState, /window\.__gvdgEvents/);
  assert.match(controller, /const ROUTE_REFRESH_EVENT = "gvdg:events-route-refresh"/);
  assert.match(controller, /function parseEventsHash\(hash\)/);
  assert.match(controller, /window\.location\.hash \|\| ""/);
  assert.match(controller, /window\.addEventListener\("hashchange", publishRoute\)/);
  assert.match(controller, /window\.addEventListener\(ROUTE_REFRESH_EVENT, publishRoute\)/);
  assert.match(controller, /publishEventsRoute\(route\)/);
  assert.doesNotMatch(controller, /window\.dispatchEvent\(new CustomEvent\(ROUTE_REQUEST_EVENT/);
});

test('public Events last-updated line publishes to React', () => {
  const source = readFileSync('events.html', 'utf8');
  const main = readFileSync('src/public-app/main.js', 'utf8');
  const app = readFileSync('src/public-app/events-last-updated-app.js', 'utf8');
  const hubData = eventsHubDataSource();
  const leagueApp = readFileSync('src/public-app/events-league-detail-app.js', 'utf8');
  const detailData = readFileSync('src/public-app/events-detail-data.js', 'utf8');

  assert.match(source, /id="eventsLastUpdatedReactApp"/);
  assert.doesNotMatch(source, /function publishLastUpdated\(updatedAt\)|window\.__gvdgEventsLastUpdated = state|gvdg:events-last-updated|publishLastUpdated\(new Date\(\)/);
  assert.match(hubData, /publishEventsLastUpdated\(new Date\(\)\)/);
  assert.match(hubData, /publishEventsLastUpdated\(null\)/);
  assert.match(leagueApp, /publishEventsLastUpdated\(null\)/);
  assert.match(detailData, /publishEventsLastUpdated\(null\)/);
  assert.doesNotMatch(source, /id="lastUpdated"|lastUpdatedEl\.hidden|lastUpdatedEl\.textContent/);
  assert.match(main, /import \{ EventsLastUpdatedApp \} from "\.\/events-last-updated-app\.js"/);
  assert.match(main, /const eventsLastUpdatedMount = document\.getElementById\("eventsLastUpdatedReactApp"\)/);
  assert.match(main, /createRoot\(eventsLastUpdatedMount\)\.render\(h\(EventsLastUpdatedApp\)\)/);
  assert.match(app, /export function EventsLastUpdatedApp/);
  assert.match(app, /data-react-events-last-updated/);
  assert.match(app, /role: "status"/);
  assert.doesNotMatch(app, /innerHTML|insertAdjacentHTML|replaceChildren|document\.createElement|querySelector|classList|textContent\s*=|dangerouslySetInnerHTML|☰|✕|🌙|☀️|📅|📍|🥏/);
});

test('public Events leagues list fetches in React', () => {
  const source = readFileSync('events.html', 'utf8');
  const main = readFileSync('src/public-app/main.js', 'utf8');
  const app = readFileSync('src/public-app/events-leagues-app.js', 'utf8');

  assert.doesNotMatch(source, /function publishLeagues\(leagues\)|async function loadLeaguesList\(\)|new CustomEvent\('gvdg:events-leagues'/);
  assert.doesNotMatch(source, /window\.__gvdgEventsLeagues|loadLeaguesList\(\)/);
  assert.match(main, /createRoot\(eventsLeaguesMount\)\.render\(h\(EventsLeaguesApp\)\)/);
  assert.match(app, /export function EventsLeaguesApp/);
  assert.match(app, /fetchPublicJson\(api, "\/leagues"\)/);
  assert.match(app, /data-react-events-leagues/);
  assert.match(app, /Leagues & Standings/);
  assert.match(app, /window\.location\.hash = `#league\/\$\{encodeURIComponent\(league\.id\)\}`/);
  assert.doesNotMatch(app, /innerHTML|insertAdjacentHTML|replaceChildren|document\.createElement|querySelector|classList|textContent\s*=|☰|✕|🌙|☀️|📅|📍|🥏/);
});

test('public Events league detail keeps standings tables scroll-contained', () => {
  const source = readFileSync('events.html', 'utf8');
  const main = readFileSync('src/public-app/main.js', 'utf8');
  const app = readFileSync('src/public-app/events-league-detail-app.js', 'utf8');

  assert.match(source, /id="leagueDetailSection"/);
  assert.doesNotMatch(source, /function publishLeagueDetail\(data\)|async function loadLeague\(id\)|new CustomEvent\('gvdg:events-league-detail'/);
  assert.doesNotMatch(source, /window\.__gvdgEventsLeagueDetail|fetchJson\(`\/leagues\/\$\{encodeURIComponent\(id\)\}`\)|loadLeague\(r\.id\)/);
  assert.doesNotMatch(source, /leagueDetailEl\.hidden = which !== 'league-detail'/);
  assert.match(eventsHubDataSource(), /route\?\.view === "event" \|\| route\?\.view === "league"/);
  assert.doesNotMatch(source, /teardownLive\(\)|function teardownLive/);
  assert.doesNotMatch(source, /function renderLeague\(data\)|function scrollTable\(table\)/);
  assert.match(main, /import \{ EventsLeagueDetailApp \} from "\.\/events-league-detail-app\.js"/);
  assert.match(main, /createRoot\(eventsLeagueDetailMount\)\.render\(h\(EventsLeagueDetailApp\)\)/);
  assert.match(app, /export function EventsLeagueDetailApp/);
  assert.match(app, /EVENTS_ROUTE_REQUEST_EVENT/);
  assert.match(app, /fetchPublicJson\(api, `\/leagues\/\$\{encodeURIComponent\(routeId\)\}`\)/);
  assert.match(app, /publishEventsStatus\(\{/);
  assert.match(app, /publishEventsView\("league-detail"\)/);
  assert.match(app, /data-react-events-league-detail/);
  assert.match(app, /function TeamStandingsTable/);
  assert.match(app, /function PlayerStandingsTable/);
  assert.match(app, /function LeagueRounds/);
  assert.match(app, /className: "lb-wrap"/);
  assert.match(app, /window\.location\.hash = `#event\/\$\{encodeURIComponent\(id\)\}`/);
  assert.doesNotMatch(app, /innerHTML|insertAdjacentHTML|replaceChildren|document\.createElement|querySelector|classList|textContent\s*=|☰|✕|🌙|☀️|📅|📍|🥏|●/);
});

test('public Events event detail fetches in React', () => {
  const source = readFileSync('events.html', 'utf8');
  const main = readFileSync('src/public-app/main.js', 'utf8');
  const app = readFileSync('src/public-app/events-detail-app.js', 'utf8');
  const dataApp = readFileSync('src/public-app/events-detail-data.js', 'utf8');
  const sharedSvg = readFileSync('src/shared/tee-sign-svg.js', 'utf8');

  assert.doesNotMatch(source, /function publishEventDetail\(data\)|new CustomEvent\('gvdg:events-event-detail'|function updateEventDetail\(seq, patch\)|async function loadDetail\(id\)/);
  assert.doesNotMatch(source, /function mountLiveLeaderboard|function fetchFinalResults|function fetchEventExtrasData|function fetchTeeSignsData|activeEventDetail|loadDetail\(r\.id\)/);
  assert.doesNotMatch(source, /udisc-export\.js|window\.UDiscExport/);
  assert.doesNotMatch(source, /function renderDetail|function renderFinalResults|function renderEventExtras|function renderTeeSigns|function renderStandings|function renderLiveSnapshot/);
  assert.match(eventsHubDataSource(), /route\?\.view === "event" \|\| route\?\.view === "league"/);
  assert.match(main, /createRoot\(eventsEventDetailMount\)\.render\(h\(EventsEventDetailApp\)\)/);
  assert.match(app, /export function EventsEventDetailApp/);
  assert.match(app, /import \{ useEventsEventDetail \} from "\.\/events-detail-data\.js"/);
  assert.match(dataApp, /export function useEventsEventDetail/);
  assert.match(dataApp, /EVENTS_ROUTE_REQUEST_EVENT/);
  assert.match(dataApp, /fetchPublicJson\(api, `\/events\/\$\{encodeURIComponent\(routeId\)\}`\)/);
  assert.match(dataApp, /publishEventsStatus\(\{ message: "Loading event\.\.\."/);
  assert.match(dataApp, /publishEventsView\("detail"\)/);
  assert.match(dataApp, /publishEventsLastUpdated\(null\)/);
  assert.match(dataApp, /function mountLiveLeaderboard/);
  assert.match(dataApp, /function fetchFinalResults/);
  assert.match(dataApp, /function fetchEventExtrasData/);
  assert.match(dataApp, /function fetchTeeSignsData/);
  assert.match(dataApp, /from "\.\.\/shared\/matchplay-colors\.js"/);
  assert.match(dataApp, /holeWinners/);
  assert.match(dataApp, /playersFromResults/);
  assert.match(dataApp, /guestRegs\(\)\[event\.id\]/);
  assert.doesNotMatch(app + dataApp, /gvdg:events-event-detail|__gvdgEventsEventDetail/);
  assert.match(app, /data-react-events-event-detail/);
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
  assert.match(sharedSvg, /from "\.\/tee-sign-model\.js"/);
  assert.match(sharedSvg, /teeSignModel/);
  assert.doesNotMatch(app, /teeSignNode|DOMParser|replaceChildren|appendChild|dangerouslySetInnerHTML/);
  assert.doesNotMatch(sharedSvg, /teeSignNode|DOMParser|replaceChildren|appendChild|dangerouslySetInnerHTML/);
  assert.doesNotMatch(app, /innerHTML|insertAdjacentHTML|document\.createElement|querySelector|classList|textContent\s*=|dangerouslySetInnerHTML|☰|✕|🌙|☀️|📅|📍|🥏|🏆|🪧|✏️|⚑/);
});

test('public registration cards post pair label only for doubles config', () => {
  const source = readFileSync('events.html', 'utf8');
  const hubData = eventsHubDataSource();
  const app = readFileSync('src/public-app/events-registration-app.js', 'utf8');
  const utils = readFileSync('src/members-app/registration-utils.js', 'utf8');

  assert.doesNotMatch(source, /function loadRegistration\(\)|gvdg:events-registration-refresh/);
  assert.match(hubData, /const REGISTRATION_REFRESH_EVENT = "gvdg:events-registration-refresh"/);
  assert.match(hubData, /window\.dispatchEvent\(new CustomEvent\(REGISTRATION_REFRESH_EVENT\)\)/);
  assert.doesNotMatch(source, /function regCard|function addonCheckbox|function registrationLiveConfig|function clientOwed/);
  assert.doesNotMatch(source, /registerEl\.replaceChildren|registerEl\.appendChild|document\.createElement\('input'\)|pairInput\.setAttribute|alert\(|confirm\(/);
  assert.match(app, /export function EventsRegistrationApp/);
  assert.match(app, /data-react-events-registration/);
  assert.match(app, /data-react-events-registration-card/);
  assert.match(app, /REGISTRATION_REFRESH_EVENT = "gvdg:events-registration-refresh"/);
  assert.match(app, /isDoublesRegistration\(event\)/);
  assert.match(app, /"data-register-pair": "team"/);
  assert.match(app, /body\.team = team\.trim\(\)/);
  assert.match(app, /addons: body\.addons/);
  assert.match(app, /guestReg \? parseObject\(guestReg\.addons\) : \{\}/);
  assert.match(app, /Currently Registering/);
  assert.match(app, /Confirm withdraw/);
  assert.match(utils, /function registrationLiveConfig\(event\)/);
  assert.match(utils, /event\.liveScoringConfig \|\| event\.live_scoring_config/);
  assert.match(utils, /raw == null && event\.play_format === "doubles"/);
});

test('Ryder Cup schedule cards link to the league route', () => {
  const eventsSource = eventsHubDataSource();
  const homeSource = readFileSync('src/home-app/feed-panels.js', 'utf8');
  const ryderSource = readFileSync('src/public-app/ryder-cup-app.js', 'utf8');
  assert.match(eventsSource, /const RYDER_CUP_LEAGUE_ID = "4"/);
  assert.match(eventsSource, /function ryderCupFeedHash\(item\)/);
  assert.match(eventsSource, /function ryderCupEventHash\(event\)/);
  assert.match(eventsSource, /League \/ Results/);
  assert.match(homeSource, /const RYDER_CUP_LEAGUE_URL = "events\.html#league\/4"/);
  assert.match(ryderSource, /events\.html#league\/4/);
});

test('archive subdomain redirect is not part of the Events page flow', () => {
  const eventsSource = readFileSync('events.html', 'utf8');
  const archiveSource = readFileSync('archive.html', 'utf8');
  const indexSource = readFileSync('index.html', 'utf8');
  assert.doesNotMatch(eventsSource, /ARCHIVE_BASE_URL/);
  assert.doesNotMatch(eventsSource, /archive\.html/);
  assert.doesNotMatch(indexSource, /archive\.gvdgclub\.com/);
  assert.match(archiveSource, /events\.html#previousResultsSection/);
  assert.doesNotMatch(archiveSource, /<script|location\.replace|document\./);
  assert.doesNotMatch(archiveSource, /const INITIAL_VISIBLE = 3/);
});
