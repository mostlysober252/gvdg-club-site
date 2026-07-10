import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('member dashboard React registration panel includes casual round posts', () => {
  const panel = readFileSync('src/members-app/registration-panel.js', 'utf8');
  const casual = readFileSync('src/members-app/registration-casual.js', 'utf8');
  assert.match(panel, /requestJson\("\/casual-rounds"/);
  assert.match(panel, /casualRequests/);
  assert.match(casual, /CasualRoundCard/);
});

test('member dashboard React board panel owns board loading and posting', () => {
  const html = readFileSync('gvdg-members.html', 'utf8');
  const dashboardApp = readFileSync('src/members-app/dashboard-app.js', 'utf8');
  const panel = readFileSync('src/members-app/board-panel.js', 'utf8');
  const markdown = readFileSync('src/members-app/board-markdown.js', 'utf8');
  assert.match(html, /id="membersReactDashboardApp"/);
  assert.match(dashboardApp, /id: "membersReactBoardPanel"/);
  assert.match(html, /#membersReactBoardPanel:not\(:empty\)/);
  assert.doesNotMatch(html, /id="legacyBoardPanel"/);
  assert.doesNotMatch(html, /reactBoardReady/);
  assert.doesNotMatch(html, /async function loadBoard\(/);
  assert.match(panel, /requestJson\("\/board"/);
  assert.match(panel, /request\("\/board", \{ method: "POST"/);
  assert.match(panel, /data-react-board-panel/);
  assert.match(panel, /MarkdownBlocks/);
  assert.ok(markdown.includes('https?:\\/\\/'));
});

test('member dashboard React tee signs panel owns upload and captured sign display', () => {
  const html = readFileSync('gvdg-members.html', 'utf8');
  const dashboardApp = readFileSync('src/members-app/dashboard-app.js', 'utf8');
  const panel = readFileSync('src/members-app/tee-signs-panel.js', 'utf8');
  const utils = readFileSync('src/members-app/tee-signs-utils.js', 'utf8');
  assert.match(html, /id="membersReactDashboardApp"/);
  assert.match(dashboardApp, /id: "membersReactTeeSignsPanel"/);
  assert.match(html, /#membersReactTeeSignsPanel:not\(:empty\)/);
  assert.doesNotMatch(html, /id="legacyTeeSignsPanel"/);
  assert.doesNotMatch(html, /reactTeeSignsReady/);
  assert.doesNotMatch(html, /async function loadTeeSigns\(/);
  assert.doesNotMatch(html, /async function uploadTeeSign\(/);
  assert.match(panel, /requestJson\("\/my-tee-signs"/);
  assert.match(panel, /request\("\/tee-signs", \{ method: "POST"/);
  assert.match(panel, /\/tee-signs\/\$\{encodeURIComponent\(id\)\}\/image/);
  assert.match(panel, /data-react-tee-signs-panel/);
  assert.match(panel, /data-react-tee-file/);
  assert.match(utils, /resizeImageFile/);
  assert.match(utils, /TS_MAX_DATA_URL/);
});

test('member dashboard React club panel owns directory search, filters, load-more, and minutes', () => {
  const html = readFileSync('gvdg-members.html', 'utf8');
  const app = readFileSync('src/members-app/main.js', 'utf8');
  const dashboardApp = readFileSync('src/members-app/dashboard-app.js', 'utf8');
  const router = readFileSync('src/members-app/dashboard-router.js', 'utf8');
  const clubPanel = readFileSync('src/members-app/club-panel.js', 'utf8');
  const data = readFileSync('src/members-app/club-directory-data.js', 'utf8');
  const directory = readFileSync('src/members-app/club-directory-panel.js', 'utf8');
  const doublesData = readFileSync('src/members-app/doubles-league-data.js', 'utf8');
  const doubles = readFileSync('src/members-app/doubles-league-panel.js', 'utf8');
  const minuteData = readFileSync('src/members-app/meeting-minutes-data.js', 'utf8');
  const minutes = readFileSync('src/members-app/meeting-minutes-panel.js', 'utf8');
  assert.match(html, /id="membersReactDashboardApp"/);
  assert.match(dashboardApp, /id: "membersReactClubPanel"/);
  assert.match(html, /body\[data-member-dashboard-tab="club"\] #membersReactClubPanel:not\(:empty\)/);
  assert.doesNotMatch(router, /querySelector|classList|dtab-off/);
  assert.doesNotMatch(html, /id="legacyClubDirectoryPanel"/);
  assert.doesNotMatch(html, /id="legacyMeetingMinutesPanel"/);
  assert.doesNotMatch(html, /id="doublesLeague"/);
  assert.doesNotMatch(html, /GVDG_CLUB_DIRECTORY_DATA/);
  assert.doesNotMatch(html, /gvdg:club-directory-data-ready/);
  assert.doesNotMatch(html, /initMembersPage/);
  assert.doesNotMatch(html, /initDoublesLeague/);
  assert.doesNotMatch(html, /DOUBLES_DATA_EMBEDDED/);
  assert.doesNotMatch(html, /id="doublesTable"/);
  assert.doesNotMatch(html, /id="seasonSelector"/);
  assert.match(app, /createRoot\(dashboardMount\)\.render\(h\(MemberDashboardApp\)\)/);
  assert.doesNotMatch(app, /createRoot\(clubMount\)\.render/);
  assert.doesNotMatch(app, /members-react-(shell|overview|ratings|registration|board|tee-signs|club)-ready|classList/);
  assert.match(data, /export const CLUB_MEMBERS/);
  assert.match(data, /export const CLUB_YEAR_DATA/);
  assert.match(data, /export const CLUB_DIRECTORY_DATA/);
  assert.match(data, /"lastName": "Faison"/);
  assert.match(clubPanel, /data-react-club-panel/);
  assert.match(clubPanel, /clubDirectoryData/);
  assert.match(clubPanel, /DoublesLeaguePanel/);
  assert.match(directory, /data-react-member-directory/);
  assert.match(directory, /Search members by name or PDGA #/);
  assert.match(directory, /PDGA Members/);
  assert.match(directory, /Show More/);
  assert.match(doublesData, /export const DOUBLES_LEAGUE_DATA/);
  assert.match(doublesData, /"seasonOrder"/);
  assert.match(doublesData, /"Summer 2025"/);
  assert.match(doublesData, /"Juan Martinez"/);
  assert.match(doubles, /data-react-doubles-league/);
  assert.match(doubles, /Doubles League Records/);
  assert.match(doubles, /All-Time Leaders/);
  assert.match(doubles, /Season Results/);
  assert.match(doubles, /Search player name/);
  assert.match(minuteData, /export const MEETING_MINUTES/);
  assert.match(minuteData, /January 12, 2026/);
  assert.match(minuteData, /Future Course Improvements - Ayden/);
  assert.match(minutes, /data-react-meeting-minutes/);
  assert.match(minutes, /MEETING_MINUTES/);
  assert.doesNotMatch(minutes, /readMinutesFromLegacyDom/);
  assert.match(minutes, /Download full minutes/);
});

test('member dashboard React registration section stays available for logged-in members', () => {
  const html = readFileSync('gvdg-members.html', 'utf8');
  const dashboardApp = readFileSync('src/members-app/dashboard-app.js', 'utf8');
  const panel = readFileSync('src/members-app/registration-panel.js', 'utf8');
  const casual = readFileSync('src/members-app/registration-casual.js', 'utf8');
  assert.match(html, /id="membersReactDashboardApp"/);
  assert.match(dashboardApp, /id: "membersReactRegistrationPanel"/);
  assert.match(html, /#membersReactRegistrationPanel:not\(:empty\)/);
  assert.doesNotMatch(html, /id="legacyRegisterTitle"/);
  assert.doesNotMatch(html, /id="registerList"/);
  assert.doesNotMatch(html, /async function loadRegister\(/);
  assert.doesNotMatch(html, /id="clubRegister"[^>]*style="display:\s*none;?"/);
  assert.doesNotMatch(panel, /visibleParent|style\.display|getElementById\("clubRegister"\)/);
  assert.match(casual, /data-react-casual-form/);
});

test('member dashboard React registration panel surfaces live events and lists every registered event', () => {
  const events = readFileSync('src/members-app/registration-events.js', 'utf8');
  assert.match(events, /liveToJoin = openToJoin\.filter\(\(event\) => event\.status === "live"\)/);
  assert.match(events, /"Live now"/);
  assert.match(events, /"My events"/); // ALL registrations render, not just the open ones
  assert.match(events, /eventFromRegistration/); // registrations no longer in the open list still render
  assert.match(readFileSync('src/members-app/registration-panel.js', 'utf8'), /requestJson\("\/my-registrations"/);
});

test('member dashboard can post a casual round and jump to a live scorecard', () => {
  const casual = readFileSync('src/members-app/registration-casual.js', 'utf8');
  const events = readFileSync('src/members-app/registration-events.js', 'utf8');
  assert.match(casual, /function CasualRoundForm/);
  assert.match(casual, /request\("\/casual-rounds", \{/);
  assert.match(events, /score\.html\?event=/); // live registered events link to their scorecard
});

test('member dashboard registration cards post pair label only for doubles events', () => {
  const events = readFileSync('src/members-app/registration-events.js', 'utf8');
  const utils = readFileSync('src/members-app/registration-utils.js', 'utf8');
  assert.match(utils, /function registrationLiveConfig\(event\)/);
  assert.match(utils, /event\.liveScoringConfig \|\| event\.live_scoring_config/);
  assert.match(events, /isDoublesRegistration\(event\)/);
  assert.match(events, /"data-register-pair": "team"/);
  assert.match(events, /body\.team = team\.trim\(\)/);
});
