import React from "react";

import {
  currentEventsView,
  publishEventsRoute,
} from "./events-state.js";

const VIEW_EVENT = "gvdg:events-view";
const ROUTE_REFRESH_EVENT = "gvdg:events-route-refresh";
const VALID_VIEWS = new Set(["status", "hub", "league-detail", "detail"]);

let routeControllerInstalled = false;

function normalizeView(view) {
  return typeof view === "string" && VALID_VIEWS.has(view) ? view : "status";
}

function currentView() {
  return normalizeView(currentEventsView(document.body.dataset.eventsView));
}

function decodeRoutePart(value) {
  try {
    return decodeURIComponent(value);
  } catch (_error) {
    return value;
  }
}

function parseEventsHash(hash) {
  const value = typeof hash === "string" ? hash : "";
  let match = value.match(/^#event\/(.+)$/);
  if (match) return { view: "event", id: decodeRoutePart(match[1]) };
  match = value.match(/^#league\/(.+)$/);
  if (match) return { view: "league", id: decodeRoutePart(match[1]) };
  match = value.match(/^#manage=(\d+)-([a-f0-9]+)$/i);
  if (match) return { view: "manage", id: match[1], token: match[2] };
  return null;
}

function publishRoute() {
  const route = parseEventsHash(window.location.hash || "");
  publishEventsRoute(route);
}

export function installEventsRouteController() {
  if (routeControllerInstalled) return;
  routeControllerInstalled = true;
  window.addEventListener("hashchange", publishRoute);
  window.addEventListener(ROUTE_REFRESH_EVENT, publishRoute);
  publishRoute();
}

export function EventsViewController() {
  const [view, setView] = React.useState(currentView);

  React.useEffect(() => {
    function update(event) {
      const nextView = event.detail?.view || currentEventsView(document.body.dataset.eventsView);
      setView(normalizeView(nextView));
    }

    window.addEventListener(VIEW_EVENT, update);
    setView(currentView());

    return () => window.removeEventListener(VIEW_EVENT, update);
  }, []);

  React.useEffect(() => {
    document.body.dataset.eventsView = view;
  }, [view]);

  return null;
}
