import React from "react";

import { buildCourseIndex, courseNameFor, eventCourseSummary, normalizeEvent } from "../shared/events-model.js";
import { holeWinners, playersFromResults } from "../shared/matchplay-colors.js";
import {
  currentEventsRoute,
  EVENTS_ROUTE_REQUEST_EVENT,
  publishEventsLastUpdated,
  publishEventsStatus,
  publishEventsView,
} from "./events-state.js";
import { fetchPublicJson, publicApiBase } from "./public-api.js";

const GUEST_REG_KEY = "gvdg_guest_regs";
const EMPTY_EXTRAS = { acePot: null, ctps: [], loaded: false };
let courseCache = null;

function eventRouteId(route) {
  return route && route.view === "event" && route.id != null ? String(route.id) : "";
}

function currentEventRouteId() {
  return eventRouteId(currentEventsRoute());
}

function memberToken() {
  try {
    return sessionStorage.getItem("gvdg_member_token") || null;
  } catch {
    return null;
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

async function loadCourseData(api) {
  if (!courseCache || courseCache.api !== api) {
    courseCache = {
      api,
      promise: fetchPublicJson(api, "/courses")
        .then((data) => {
          const courses = Array.isArray(data?.courses) ? data.courses : [];
          return { api, courses, index: buildCourseIndex(courses) };
        })
        .catch(() => ({ api, courses: [], index: new Map() })),
    };
  }
  return courseCache.promise;
}

function eventCourse(courseIndex, event) {
  return event?.course_id ? courseIndex.get(String(event.course_id)) || null : null;
}

function patchDetail(setData, patch) {
  setData((current) => (current ? { ...current, ...patch } : current));
}

async function fetchFinalResults(api, eventId) {
  const data = await fetchPublicJson(api, `/events/${encodeURIComponent(eventId)}/results`).catch(() => null);
  return Array.isArray(data?.results) ? data.results : [];
}

async function fetchEventExtrasData(api, eventId) {
  const [ctps, acePot] = await Promise.all([
    fetchPublicJson(api, `/events/${encodeURIComponent(eventId)}/ctps`).catch(() => null),
    fetchPublicJson(api, `/events/${encodeURIComponent(eventId)}/ace-pot`).catch(() => null),
  ]);
  return {
    acePot: acePot?.ace_pot || null,
    ctps: Array.isArray(ctps?.ctps) ? ctps.ctps : [],
    loaded: true,
  };
}

function parseLayoutHoles(layout) {
  if (!layout) return [];
  if (Array.isArray(layout.holes)) return layout.holes;
  try {
    const holes = JSON.parse(layout.holes || "[]");
    return Array.isArray(holes) ? holes : [];
  } catch {
    return [];
  }
}

async function fetchTeeSignsData(api, courseIndex, event, finalResults) {
  if (!event.course_id) return null;
  const [layoutData, teeSignData] = await Promise.all([
    fetchPublicJson(api, `/courses/${encodeURIComponent(event.course_id)}/layouts`).catch(() => null),
    fetchPublicJson(api, `/courses/${encodeURIComponent(event.course_id)}/tee-signs`).catch(() => null),
  ]);
  const layouts = Array.isArray(layoutData?.layouts) ? layoutData.layouts : [];
  const signs = Array.isArray(teeSignData?.teeSigns) ? teeSignData.teeSigns : [];
  const layout = layouts.find((item) => String(item.id ?? item.layout_id) === event.layout_id) || layouts[0] || null;
  const holes = parseLayoutHoles(layout);
  const officialByHole = new Map();
  signs.forEach((sign) => {
    if (sign && sign.status === "official") officialByHole.set(Number(sign.hole_number), sign.id);
  });

  const holeData = new Map(holes.map((hole) => [Number(hole.hole), hole]));
  const holeNums = new Set([...holeData.keys(), ...officialByHole.keys()]);
  if (!holeNums.size) return null;

  const holeList = [...holeNums].map((hole) => ({ hole }));
  let holeWins = {};
  try {
    if (event.status === "final") {
      holeWins = holeWinners(holeList, playersFromResults(finalResults || []));
    } else {
      const snapshot = await fetchPublicJson(api, `/events/${encodeURIComponent(event.id)}/live`).catch(() => null);
      if (snapshot?.roundConfig?.scoringStyle === "matchplay") {
        holeWins = holeWinners(
          Array.isArray(snapshot.holes) && snapshot.holes.length ? snapshot.holes : holeList,
          snapshot.players || [],
        );
      }
    }
  } catch {
    holeWins = {};
  }

  return {
    courseName: courseNameFor(courseIndex, event.course_id) || "",
    layout: layout ? { id: layout.id ?? layout.layout_id ?? "", name: layout.name || "" } : null,
    holes: [...holeNums].sort((a, b) => a - b).map((holeNumber) => {
      const hole = holeData.get(holeNumber) || { hole: holeNumber };
      return {
        ...hole,
        hole: holeNumber,
        signId: officialByHole.get(holeNumber) ?? null,
        winner: holeWins[holeNumber] || null,
      };
    }),
  };
}

function mountLiveLeaderboard(api, eventId, setData, isActive) {
  const ctx = { done: false, gotWs: false, poll: null, ws: null };
  const setConnection = (text) => {
    if (isActive()) patchDetail(setData, { liveConnection: text });
  };
  const render = (snapshot) => {
    if (!isActive() || ctx.done) return;
    patchDetail(setData, { liveSnapshot: snapshot });
    if (snapshot?.status && snapshot.status !== "live") {
      ctx.done = true;
      if (ctx.poll) clearInterval(ctx.poll);
      ctx.poll = null;
      setConnection("Final");
    }
  };
  const pollOnce = async () => {
    try {
      render(await fetchPublicJson(api, `/events/${encodeURIComponent(eventId)}/live`));
    } catch {
    }
  };
  const startPolling = () => {
    if (!isActive() || ctx.poll || ctx.done) return;
    setConnection("Live (auto-refresh)");
    pollOnce();
    ctx.poll = setInterval(pollOnce, 5000);
  };

  try {
    const ws = new WebSocket(`${api.replace(/^http/, "ws")}/events/${encodeURIComponent(eventId)}/live/ws`);
    ctx.ws = ws;
    ws.onopen = () => {
      ctx.gotWs = true;
      setConnection("Live");
    };
    ws.onmessage = (event) => {
      try {
        render(JSON.parse(event.data));
      } catch {
      }
    };
    ws.onerror = startPolling;
    ws.onclose = startPolling;
    setTimeout(() => {
      if (!ctx.gotWs) startPolling();
    }, 4000);
  } catch {
    startPolling();
  }

  return () => {
    ctx.done = true;
    try {
      if (ctx.ws) ctx.ws.close();
    } catch {
    }
    if (ctx.poll) clearInterval(ctx.poll);
  };
}

export function useEventsEventDetail() {
  const api = React.useMemo(publicApiBase, []);
  const [routeId, setRouteId] = React.useState(currentEventRouteId);
  const [reloadKey, setReloadKey] = React.useState(0);
  const [data, setData] = React.useState(null);

  React.useEffect(() => {
    function update(event) {
      const route = event.detail?.route || currentEventsRoute();
      setRouteId(eventRouteId(route));
    }

    window.addEventListener(EVENTS_ROUTE_REQUEST_EVENT, update);
    update({ detail: { route: currentEventsRoute() } });
    return () => window.removeEventListener(EVENTS_ROUTE_REQUEST_EVENT, update);
  }, []);

  React.useEffect(() => {
    if (!routeId) {
      setData(null);
      return undefined;
    }

    let active = true;
    let cleanupLive = () => {};
    const isActive = () => active;
    const retry = () => setReloadKey((value) => value + 1);

    async function loadEventDetail() {
      publishEventsView("status");
      publishEventsLastUpdated(null);
      publishEventsStatus({ message: "Loading event...", retry: null, tone: "loading" });

      try {
        const courseData = await loadCourseData(api);
        const detail = await fetchPublicJson(api, `/events/${encodeURIComponent(routeId)}`);
        if (!active) return;
        if (!detail?.event) {
          setData(null);
          publishEventsStatus({
            message: "That event could not be found.",
            retry: () => {
              window.location.hash = "";
            },
            tone: "error",
          });
          return;
        }

        const event = normalizeEvent(detail.event);
        const baseDetail = {
          apiBase: api,
          course: eventCourse(courseData.index, event),
          courseSummary: eventCourseSummary(courseData.index, event, true),
          event,
          extras: EMPTY_EXTRAS,
          finalResults: [],
          finalResultsLoaded: event.status !== "final",
          guestReg: guestRegs()[event.id] || null,
          liveConnection: event.status === "live" ? "Connecting" : "",
          liveSnapshot: null,
          memberToken: memberToken(),
          teeSigns: null,
        };

        setData(baseDetail);
        publishEventsView("detail");
        publishEventsLastUpdated(null);
        window.scrollTo(0, 0);

        if (event.status === "live") {
          cleanupLive = mountLiveLeaderboard(api, event.id, setData, isActive);
        }

        const finalResultsPromise = event.status === "final"
          ? fetchFinalResults(api, event.id).then((results) => {
            if (active) patchDetail(setData, { finalResults: results, finalResultsLoaded: true });
            return results;
          })
          : Promise.resolve(null);

        finalResultsPromise
          .then((results) => fetchTeeSignsData(api, courseData.index, event, results))
          .then((teeSigns) => {
            if (active && teeSigns) patchDetail(setData, { teeSigns });
          })
          .catch(() => {});

        fetchEventExtrasData(api, event.id)
          .then((extras) => {
            if (active) patchDetail(setData, { extras });
          })
          .catch(() => {
            if (active) patchDetail(setData, { extras: { ...EMPTY_EXTRAS, loaded: true } });
          });
      } catch {
        if (!active) return;
        setData(null);
        publishEventsStatus({
          message: "We couldn't load that event right now. Please try again.",
          retry,
          tone: "error",
        });
      }
    }

    loadEventDetail();
    return () => {
      active = false;
      cleanupLive();
    };
  }, [api, reloadKey, routeId]);

  return data;
}
