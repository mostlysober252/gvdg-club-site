import React from "react";

import { adminJson } from "./admin-api.js";
import { currentAdminActiveTab, currentAdminAuthGateState } from "./admin-shell-state.js";

const STATE_EVENT = "gvdg:admin-data-archive-destinations-state";
const EMPTY_STATE = { status: "idle", destinations: [] };
const REFRESH_RESULT_EVENTS = [
  "gvdg:admin-data-archive-destination-save-result",
  "gvdg:admin-data-archive-destination-activate-result",
  "gvdg:admin-data-archive-destination-delete-result",
];

let destinationsState = EMPTY_STATE;
let loadPromise = null;

function objectOrEmpty(value) {
  return value && typeof value === "object" ? value : {};
}

function normalizeText(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function normalizeDataArchiveDestination(destination) {
  const outer = objectOrEmpty(destination);
  const source = objectOrEmpty(outer.source || destination);
  const id = source.id == null ? "" : String(source.id);
  const label = normalizeText(source.label, id ? `Endpoint ${id}` : "Endpoint");
  return {
    source,
    authHeader: normalizeText(source.auth_header || outer.authHeader, "(no auth header)") || "(no auth header)",
    authPrefix: normalizeText(source.auth_prefix || outer.authPrefix, "(no auth prefix)") || "(no auth prefix)",
    endpointUrl: normalizeText(source.endpoint_url || outer.endpointUrl),
    hasAuthToken: source.hasAuthToken === true || source.has_auth_token === true || outer.hasAuthToken === true,
    id,
    isActive: Number(source.is_active) === 1 || source.is_active === true || outer.isActive === true,
    label,
  };
}

function normalizeState(state) {
  const source = objectOrEmpty(state);
  const status = source.status === "idle" || source.status === "loading" || source.status === "error"
    ? source.status
    : "ready";
  return {
    destinations: Array.isArray(source.destinations) ? source.destinations.map(normalizeDataArchiveDestination) : [],
    status,
  };
}

function publishDataArchiveDestinationsState(state) {
  destinationsState = normalizeState(state);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(STATE_EVENT, { detail: destinationsState }));
  }
  return destinationsState;
}

function shouldLoadDataArchiveDestinations() {
  return currentAdminAuthGateState().status === "panel" && currentAdminActiveTab() === "data-archive";
}

export function currentDataArchiveDestinationsState() {
  return destinationsState;
}

export function refreshDataArchiveDestinations() {
  if (loadPromise) return loadPromise;
  publishDataArchiveDestinationsState({ status: "loading", destinations: destinationsState.destinations });
  loadPromise = adminJson("/admin/export/endpoints")
    .then((data) => publishDataArchiveDestinationsState({ status: "ready", destinations: data?.destinations }))
    .catch(() => publishDataArchiveDestinationsState({ status: "error", destinations: [] }))
    .finally(() => {
      loadPromise = null;
    });
  return loadPromise;
}

export function ensureDataArchiveDestinationsLoaded() {
  if (destinationsState.status === "idle" || destinationsState.status === "error") {
    return refreshDataArchiveDestinations();
  }
  return loadPromise || Promise.resolve(destinationsState);
}

export function useDataArchiveDestinationsState() {
  const [state, setState] = React.useState(() => currentDataArchiveDestinationsState());

  React.useEffect(() => {
    function updateState(event) {
      const next = event.detail && typeof event.detail === "object" ? event.detail : currentDataArchiveDestinationsState();
      setState(normalizeState(next));
    }
    window.addEventListener(STATE_EVENT, updateState);
    setState(currentDataArchiveDestinationsState());
    return () => window.removeEventListener(STATE_EVENT, updateState);
  }, []);

  React.useEffect(() => {
    function loadIfVisible() {
      if (shouldLoadDataArchiveDestinations()) ensureDataArchiveDestinationsLoaded();
    }
    function refreshAfterMutation(event) {
      if (event.detail?.ok === true && shouldLoadDataArchiveDestinations()) refreshDataArchiveDestinations();
    }

    window.addEventListener("gvdg:admin-auth-gate", loadIfVisible);
    window.addEventListener("gvdg:admin-active-tab", loadIfVisible);
    REFRESH_RESULT_EVENTS.forEach((eventName) => window.addEventListener(eventName, refreshAfterMutation));
    loadIfVisible();
    return () => {
      window.removeEventListener("gvdg:admin-auth-gate", loadIfVisible);
      window.removeEventListener("gvdg:admin-active-tab", loadIfVisible);
      REFRESH_RESULT_EVENTS.forEach((eventName) => window.removeEventListener(eventName, refreshAfterMutation));
    };
  }, []);

  return state;
}
