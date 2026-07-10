import React from "react";

import {
  bucketEvents,
  buildCourseIndex,
  eventCourseSummary,
  formatEventDate,
  normalizeEvent,
  parseEventDate,
  statusLabel,
  typeLabel,
} from "../shared/events-model.js";
import { parseHomepageEventDate } from "../shared/home-feed-parse.js";
import {
  currentEventsRoute,
  currentEventsView,
  EVENTS_ROUTE_REQUEST_EVENT,
  publishEventsLastUpdated,
  publishEventsStatus,
  publishEventsView,
} from "./events-state.js";
import { fetchPublicJson, publicApiBase } from "./public-api.js";

const EMPTY_HUB = { feedClub: [], feedEvents: [], hasMainContent: false, live: [], upcoming: [] };
const EVENTS_PAGE_LIMIT = 2000;
const GUEST_REG_KEY = "gvdg_guest_regs";
const REFRESH_MS = 60 * 1000;
const REGISTRATION_REFRESH_EVENT = "gvdg:events-registration-refresh";
const ROUTE_REFRESH_EVENT = "gvdg:events-route-refresh";
const RYDER_CUP_LEAGUE_ID = "4";

const state = {
  courseData: null,
  hub: EMPTY_HUB,
  installed: false,
  loading: false,
  previousResults: [],
  refreshTimer: null,
};

const hubSubscribers = new Set();
const previousResultsSubscribers = new Set();

function subscribeHub(callback) {
  hubSubscribers.add(callback);
  return () => hubSubscribers.delete(callback);
}

function subscribePreviousResults(callback) {
  previousResultsSubscribers.add(callback);
  return () => previousResultsSubscribers.delete(callback);
}

function notifyHub() {
  hubSubscribers.forEach((callback) => callback(state.hub));
}

function notifyPreviousResults() {
  previousResultsSubscribers.forEach((callback) => callback(state.previousResults));
}

function sanitizeUrl(raw) {
  if (!raw) return "";
  try {
    const url = new URL(String(raw), window.location.href);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function isRyderCupName(value) {
  return /\bryder\s*cup\b/i.test(String(value || ""));
}

function leagueHash(id) {
  return `#league/${encodeURIComponent(String(id))}`;
}

function ryderCupLeagueHash() {
  return leagueHash(RYDER_CUP_LEAGUE_ID);
}

function ryderCupFeedHash(item) {
  return isRyderCupName(item?.name) ? ryderCupLeagueHash() : "";
}

function ryderCupEventHash(event) {
  if (!event) return "";
  const leagueId = event.league_id != null ? String(event.league_id) : "";
  if (leagueId && leagueId === RYDER_CUP_LEAGUE_ID) return leagueHash(leagueId);
  return isRyderCupName(event.name) ? ryderCupLeagueHash() : "";
}

function startOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function feedDateInfo(item) {
  const epoch = Number(item?.epoch);
  if (Number.isFinite(epoch) && epoch > 0) {
    const ms = epoch < 100000000000 ? epoch * 1000 : epoch;
    const fromEpoch = new Date(ms);
    if (!Number.isNaN(fromEpoch.getTime())) {
      return { dateObj: fromEpoch, isPast: fromEpoch < startOfToday(), isTBD: false };
    }
  }
  return parseHomepageEventDate(String(item?.date || ""));
}

function isPastFeedItem(item) {
  const info = feedDateInfo(item);
  return !info.isTBD && info.isPast;
}

function eventDateForSort(event) {
  return parseEventDate((event && (event.date || event.starts_at)) || null);
}

function isArchivedClubEvent(raw) {
  const event = normalizeEvent(raw);
  if (event.status === "live") return false;
  if (event.status === "final" || event.status === "cancelled") return true;
  const date = eventDateForSort(event);
  return date ? date < startOfToday() : false;
}

function splitFeedByDate(items) {
  const active = [];
  const archived = [];
  for (const item of items || []) {
    (isPastFeedItem(item) ? archived : active).push(item);
  }
  const byDate = (a, b) => feedDateInfo(a).dateObj - feedDateInfo(b).dateObj;
  active.sort(byDate);
  archived.sort((a, b) => feedDateInfo(b).dateObj - feedDateInfo(a).dateObj);
  return { active, archived };
}

function splitClubEventsByDate(items) {
  const active = [];
  const archived = [];
  for (const raw of items || []) {
    const event = normalizeEvent(raw);
    (isArchivedClubEvent(event) ? archived : active).push(event);
  }
  return { active, archived };
}

function feedResultDateText(item) {
  if (item?.date) return String(item.date);
  const info = feedDateInfo(item);
  if (!info.isTBD && info.dateObj && !Number.isNaN(info.dateObj.getTime())) {
    return info.dateObj.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  }
  return "Date TBD";
}

function previousResultFromFeed(item, category) {
  const info = feedDateInfo(item);
  const leagueTarget = ryderCupFeedHash(item);
  const externalHref = leagueTarget ? "" : sanitizeUrl(item?.url);
  return {
    cta: leagueTarget ? "League / Results" : (externalHref ? "Results / Details" : ""),
    dateObj: info.dateObj,
    dateText: feedResultDateText(item),
    detail: String(item?.detail || ""),
    external: Boolean(externalHref),
    href: leagueTarget || externalHref,
    label: category,
    name: String(item?.name || "Previous result"),
  };
}

function previousResultFromEvent(raw, courseIndex) {
  const event = normalizeEvent(raw);
  const leagueTarget = ryderCupEventHash(event);
  const courseName = eventCourseSummary(courseIndex, event);
  return {
    cta: leagueTarget ? "League / Results" : "View results",
    dateObj: eventDateForSort(event),
    dateText: formatEventDate(event.date || event.starts_at),
    detail: [courseName, statusLabel(event.status)].filter(Boolean).join(" · "),
    external: false,
    href: leagueTarget || `#event/${encodeURIComponent(event.id)}`,
    label: typeLabel(event.type),
    name: event.name,
    status: event.status,
    statusLabel: statusLabel(event.status),
    typeClass: event.type,
  };
}

function previousResultTime(item) {
  return item?.dateObj && !Number.isNaN(item.dateObj.getTime()) ? item.dateObj.getTime() : 0;
}

function eventHubItem(raw, courseIndex) {
  const event = normalizeEvent(raw);
  const leagueTarget = ryderCupEventHash(event);
  return {
    courseName: eventCourseSummary(courseIndex, event),
    dateText: formatEventDate(event.date),
    href: leagueTarget || `#event/${encodeURIComponent(event.id)}`,
    id: event.id,
    name: event.name,
    status: event.status,
    statusLabel: statusLabel(event.status),
    typeClass: event.type,
    typeLabel: typeLabel(event.type),
  };
}

function feedHubItem(item) {
  const leagueTarget = ryderCupFeedHash(item);
  const externalHref = leagueTarget ? "" : sanitizeUrl(item?.url);
  return {
    cta: leagueTarget ? "League / Results" : (externalHref ? "Register / Details" : ""),
    dateText: item?.date ? String(item.date) : "TBD",
    detail: String(item?.detail || ""),
    external: Boolean(externalHref),
    href: leagueTarget || externalHref,
    name: String(item?.name || "Event"),
  };
}

async function loadCourseData(api) {
  if (!state.courseData || state.courseData.api !== api) {
    state.courseData = {
      api,
      promise: fetchPublicJson(api, "/courses")
        .then((data) => {
          const courses = Array.isArray(data?.courses) ? data.courses : [];
          return { courses, index: buildCourseIndex(courses) };
        })
        .catch(() => ({ courses: [], index: new Map() })),
    };
  }
  return state.courseData.promise;
}

function publishLoadedHub(feed, events, courseIndex) {
  const { active: feedEvents, archived: feedArchived } = splitFeedByDate(feed?.events || []);
  const { active: feedClub, archived: feedClubArchived } = splitFeedByDate(feed?.clubEvents || []);
  const { active: activeEvents, archived: archivedEvents } = splitClubEventsByDate(events || []);
  const { live, upcoming } = bucketEvents(activeEvents);
  const previousResults = [
    ...archivedEvents.map((event) => previousResultFromEvent(event, courseIndex)),
    ...feedArchived.map((item) => previousResultFromFeed(item, "Event")),
    ...feedClubArchived.map((item) => previousResultFromFeed(item, "Club Event")),
  ].sort((a, b) => previousResultTime(b) - previousResultTime(a));

  state.hub = {
    feedClub: feedClub.map(feedHubItem),
    feedEvents: feedEvents.map(feedHubItem),
    hasMainContent: Boolean(feedEvents.length || live.length || upcoming.length),
    live: live.map((event) => eventHubItem(event, courseIndex)),
    upcoming: upcoming.map((event) => eventHubItem(event, courseIndex)),
  };
  state.previousResults = previousResults;
  notifyHub();
  notifyPreviousResults();
  publishEventsView("hub");
  publishEventsLastUpdated(new Date());
  window.dispatchEvent(new CustomEvent(REGISTRATION_REFRESH_EVENT));
}

async function loadHub({ quiet = false } = {}) {
  if (state.loading) return;
  state.loading = true;
  const api = publicApiBase();
  if (!quiet) {
    publishEventsView("status");
    publishEventsStatus({ message: "Loading...", retry: null, tone: "loading" });
  }
  try {
    const courseData = await loadCourseData(api);
    const [feed, eventsData] = await Promise.all([
      fetchPublicJson(api, "/club-feed").catch(() => ({ events: [], clubEvents: [] })),
      fetchPublicJson(api, `/events?limit=${EVENTS_PAGE_LIMIT}&offset=0`).catch(() => ({ events: [] })),
    ]);
    publishLoadedHub(feed, eventsData?.events || [], courseData.index);
  } catch {
    if (!quiet) {
      publishEventsLastUpdated(null);
      publishEventsStatus({
        message: "We couldn't load the calendar right now. Please try again.",
        retry: () => loadHub(),
        tone: "error",
      });
      publishEventsView("status");
    }
  } finally {
    state.loading = false;
  }
}

function startRefresh() {
  stopRefresh();
  state.refreshTimer = window.setInterval(() => {
    if (currentEventsView() === "hub") loadHub({ quiet: true });
  }, REFRESH_MS);
}

function stopRefresh() {
  if (state.refreshTimer) {
    window.clearInterval(state.refreshTimer);
    state.refreshTimer = null;
  }
}

function guestRegs() {
  try {
    const parsed = JSON.parse(localStorage.getItem(GUEST_REG_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function setGuestReg(eventId, value) {
  const all = guestRegs();
  if (value) all[eventId] = value;
  else delete all[eventId];
  try {
    localStorage.setItem(GUEST_REG_KEY, JSON.stringify(all));
  } catch {
  }
}

async function applyManage(eventId, token) {
  const api = publicApiBase();
  try {
    const data = await fetchPublicJson(api, `/events/${encodeURIComponent(eventId)}/registration?gt=${encodeURIComponent(token)}`);
    if (data?.registration) setGuestReg(eventId, { guestToken: token, name: data.registration.name });
  } catch {
  }
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
  window.dispatchEvent(new CustomEvent(REGISTRATION_REFRESH_EVENT));
  window.dispatchEvent(new CustomEvent(ROUTE_REFRESH_EVENT));
}

function handleRouteRequest(event) {
  stopRefresh();
  const route = event?.detail?.route || currentEventsRoute();
  if (route?.view === "event" || route?.view === "league") return;
  if (route?.view === "manage") {
    applyManage(route.id, route.token);
    return;
  }
  loadHub();
  startRefresh();
}

export function installEventsHubController() {
  if (state.installed) return;
  state.installed = true;
  window.addEventListener(EVENTS_ROUTE_REQUEST_EVENT, handleRouteRequest);
  if (currentEventsRoute()) handleRouteRequest({ detail: { route: currentEventsRoute() } });
}

export function useEventsHub() {
  const [hub, setHub] = React.useState(state.hub);
  React.useEffect(() => subscribeHub(setHub), []);
  return hub;
}

export function useEventsPreviousResults() {
  const [results, setResults] = React.useState(state.previousResults);
  React.useEffect(() => subscribePreviousResults(setResults), []);
  return results;
}
