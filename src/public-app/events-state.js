export const EVENTS_ROUTE_REQUEST_EVENT = "gvdg:events-route-request";

let eventsRoute = null;
let eventsView = "status";
let eventsStatus = null;
let eventsLastUpdated = { updatedAt: null };

export function currentEventsRoute() {
  return eventsRoute && typeof eventsRoute === "object" ? eventsRoute : null;
}

export function publishEventsRoute(route) {
  eventsRoute = route && typeof route === "object" ? route : null;
  window.dispatchEvent(new CustomEvent(EVENTS_ROUTE_REQUEST_EVENT, {
    detail: { route: eventsRoute },
  }));
}

export function currentEventsView(fallback = "status") {
  return typeof eventsView === "string" && eventsView ? eventsView : fallback;
}

export function publishEventsView(view) {
  eventsView = view;
  window.dispatchEvent(new CustomEvent("gvdg:events-view", {
    detail: { view },
  }));
}

export function currentEventsStatus() {
  return eventsStatus && typeof eventsStatus === "object" ? eventsStatus : null;
}

export function publishEventsStatus(status) {
  eventsStatus = status && typeof status === "object" ? status : null;
  window.dispatchEvent(new CustomEvent("gvdg:events-status", {
    detail: { status: eventsStatus },
  }));
}

export function currentEventsLastUpdated() {
  return eventsLastUpdated && typeof eventsLastUpdated === "object" ? eventsLastUpdated : { updatedAt: null };
}

export function publishEventsLastUpdated(updatedAt) {
  const state = {
    updatedAt: updatedAt
      ? (updatedAt instanceof Date ? updatedAt.toISOString() : String(updatedAt))
      : null,
  };
  eventsLastUpdated = state;
  window.dispatchEvent(new CustomEvent("gvdg:events-last-updated", {
    detail: { state },
  }));
}
