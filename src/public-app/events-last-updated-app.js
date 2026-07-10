import React from "react";

import { currentEventsLastUpdated } from "./events-state.js";

const h = React.createElement;
const LAST_UPDATED_EVENT = "gvdg:events-last-updated";

function publishedLastUpdated() {
  const state = currentEventsLastUpdated();
  return state && typeof state === "object" ? state : { updatedAt: null };
}

function normalizeLastUpdated(state) {
  const raw = state && typeof state === "object" ? state.updatedAt : null;
  if (!raw) return null;
  const date = raw instanceof Date ? raw : new Date(String(raw));
  return Number.isNaN(date.getTime()) ? null : date;
}

function useEventsLastUpdated() {
  const [updatedAt, setUpdatedAt] = React.useState(() => normalizeLastUpdated(publishedLastUpdated()));

  React.useEffect(() => {
    function update(event) {
      const next = event.detail && event.detail.state ? event.detail.state : publishedLastUpdated();
      setUpdatedAt(normalizeLastUpdated(next));
    }
    window.addEventListener(LAST_UPDATED_EVENT, update);
    update({ detail: { state: publishedLastUpdated() } });
    return () => window.removeEventListener(LAST_UPDATED_EVENT, update);
  }, []);

  return updatedAt;
}

export function EventsLastUpdatedApp() {
  const updatedAt = useEventsLastUpdated();
  if (!updatedAt) return null;

  return h("p", {
    className: "last-updated",
    "data-react-events-last-updated": "ready",
    role: "status",
  }, "Last updated " + updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
}
