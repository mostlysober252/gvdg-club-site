import React from "react";

import { AdminScoringLeaderboard, AdminScoringOverride, AdminScoringScorecard } from "./scoring-scorecard.js";
import { AdminScoringTeeSigns } from "./scoring-tee-signs.js";
import { eventConfig, layoutLabel, normalizeConfig, playableEvents } from "./scoring-model.js";

const h = React.createElement;
const EMPTY_EVENTS_STATE = { events: [], status: "loading" };
const EMPTY_SCORING_STATE = { eventId: "", layouts: [], status: "idle" };

function dispatchRequest(name, detail = {}) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function normalizeEventsState(state) {
  return {
    events: Array.isArray(state.events) ? state.events : [],
    status: state.status === "error" || state.status === "ready" ? state.status : "loading",
  };
}

function normalizeScoringState(state) {
  return {
    ...EMPTY_SCORING_STATE,
    ...(state && typeof state === "object" ? state : {}),
    eventId: state?.eventId == null ? "" : String(state.eventId),
    layouts: Array.isArray(state?.layouts) ? state.layouts : [],
    status: typeof state?.status === "string" ? state.status : "idle",
  };
}

function FormatButtons({ label, name, onChange, options, value }) {
  return h("div", { className: "sc-start-field" }, [
    h("span", { key: "label" }, label),
    h("input", { id: name, key: "input", readOnly: true, type: "hidden", value }),
    h("div", { className: "fmt-btns", id: `${name}Btns`, key: "buttons" }, options.map((option) => h("button", {
      "aria-pressed": String(option.value === value),
      className: "fmt-btn",
      "data-val": option.value,
      key: option.value,
      onClick: () => onChange(option.value),
      type: "button",
    }, option.label))),
  ]);
}

function EventSelector({ eventsState, selectedId }) {
  const events = playableEvents(eventsState.events);
  return h("div", { "data-react-admin-scoring-events": eventsState.status }, [
    h("label", { htmlFor: "scEvent", key: "label" }, "Event"),
    h("select", {
      disabled: eventsState.status === "loading",
      id: "scEvent",
      key: "select",
      onChange: (event) => dispatchRequest("gvdg:admin-scoring-select-event-request", { eventId: event.target.value }),
      value: selectedId,
    }, [
      h("option", { key: "none", value: "" }, eventsState.status === "loading" ? "Loading events..." : "select a scheduled or live event"),
      ...events.map((event) => h("option", { key: event.id, value: event.id }, `${event.name} [${event.status}]${event.date ? ` - ${event.date}` : ""}`)),
    ]),
  ]);
}

function StartControls({ state }) {
  const initialConfig = normalizeConfig(state.config || eventConfig(state.event || {}));
  const [config, setConfig] = React.useState(initialConfig);
  const [layoutId, setLayoutId] = React.useState(state.layoutId == null ? "" : String(state.layoutId));
  const [pending, setPending] = React.useState(false);
  const [validation, setValidation] = React.useState(state.validation || "");

  React.useEffect(() => {
    setConfig(normalizeConfig(state.config || eventConfig(state.event || {})));
    setLayoutId(state.layoutId == null ? "" : String(state.layoutId));
    setValidation(state.validation || "");
    setPending(false);
  }, [state.eventId, state.config, state.layoutId, state.validation]);

  React.useEffect(() => {
    function finish(event) {
      if (event.detail?.kind === "start") setPending(false);
    }
    window.addEventListener("gvdg:admin-scoring-action-result", finish);
    return () => window.removeEventListener("gvdg:admin-scoring-action-result", finish);
  }, []);

  function updateConfig(patch) {
    setConfig((current) => ({ ...current, ...patch }));
    setValidation("");
  }

  function start() {
    const liveScoringConfig = normalizeConfig(config);
    if (liveScoringConfig.scoringStyle === "matchplay") {
      setValidation("Match play requires exactly two score targets per card; start will be blocked if the roster/pairs do not satisfy that.");
    }
    setPending(true);
    dispatchRequest("gvdg:admin-scoring-start-request", {
      eventId: state.eventId,
      layoutId,
      liveScoringConfig,
    });
  }

  return h("div", { "data-react-admin-scoring-start": "ready", id: "scStart", style: { marginTop: "1rem" } }, [
    h("div", { className: "sc-start-grid", key: "grid" }, [
      h("label", { className: "sc-start-field", htmlFor: "scLayout", key: "layout" }, [
        h("span", { key: "label" }, "Layout"),
        h("select", { id: "scLayout", key: "select", onChange: (event) => setLayoutId(event.target.value), value: layoutId }, [
          h("option", { key: "none", value: "" }, "event's current layout"),
          ...state.layouts.map((layout) => h("option", { key: String(layout.id), value: String(layout.id) }, layoutLabel(layout))),
        ]),
      ]),
      h(FormatButtons, {
        key: "group",
        label: "Group",
        name: "scGroupFormat",
        onChange: (value) => updateConfig({ groupFormat: value }),
        options: [{ label: "Singles", value: "singles" }, { label: "Doubles", value: "doubles" }],
        value: config.groupFormat,
      }),
      h(FormatButtons, {
        key: "style",
        label: "Scoring",
        name: "scScoringStyle",
        onChange: (value) => updateConfig({ scoringStyle: value }),
        options: [{ label: "Stroke play", value: "stroke" }, { label: "Match play", value: "matchplay" }],
        value: config.scoringStyle,
      }),
      h("button", { className: "admin-btn", disabled: pending, id: "scStartBtn", key: "start", onClick: start, type: "button" }, pending ? "Starting..." : "Start live scoring"),
    ]),
    h("p", { className: "al-note", id: "scStartValidation", key: "validation", role: validation ? "status" : undefined }, validation),
    h("p", { className: "al-note", key: "note" }, "An event needs a layout with pars to score. Pick one here, or set it on the Layouts tab."),
  ]);
}

function LiveControls({ state }) {
  const snap = state.snap || {};
  return h("div", { "data-react-admin-scoring-live": snap.status || "ready", id: "scLive", style: { marginTop: "1rem" } }, [
    h("h4", { className: "al-h", key: "score-title" }, [
      "Scorecard ",
      h("span", { className: "al-note", key: "note" }, "(enter strokes - saves and pushes live instantly)"),
    ]),
    h(AdminScoringScorecard, { key: "grid", snapshot: snap }),
    h(AdminScoringOverride, { canOverride: state.canOverride === true, key: "override", snapshot: snap }),
    h("h4", { className: "al-h", key: "tee-title", style: { marginTop: "1rem" } }, [
      "Tee signs ",
      h("span", { className: "al-note", key: "note" }, "(official, or unverified candidates awaiting review)"),
    ]),
    h(AdminScoringTeeSigns, { key: "tee-signs", state }),
    h("h4", { className: "al-h", key: "board-title", style: { marginTop: "1rem" } }, "Live leaderboard"),
    h(AdminScoringLeaderboard, { key: "board", snapshot: snap }),
    h("div", { className: "al-row", key: "actions", style: { marginTop: "0.75rem" } }, [
      h("button", { className: "admin-btn danger", id: "scFinalizeBtn", key: "finalize", onClick: () => dispatchRequest("gvdg:admin-scoring-finalize-request"), type: "button" }, "Finalize results"),
      state.canCancel === true ? h("button", { className: "admin-btn secondary", id: "scCancelBtn", key: "cancel", onClick: () => dispatchRequest("gvdg:admin-scoring-cancel-request"), type: "button" }, "Cancel scoring") : null,
      h("span", { className: "al-note", key: "note" }, "Finalize writes results and closes the event. Cancel scraps a mis-started round and returns the event to Scheduled."),
    ]),
  ]);
}

export function AdminScoringPanel() {
  const [eventsState, setEventsState] = React.useState(() => normalizeEventsState(EMPTY_EVENTS_STATE));
  const [state, setState] = React.useState(() => normalizeScoringState(EMPTY_SCORING_STATE));

  React.useEffect(() => {
    function updateEvents(event) {
      setEventsState(normalizeEventsState(event.detail && typeof event.detail === "object" ? event.detail : EMPTY_EVENTS_STATE));
    }
    function updateScoring(event) {
      setState(normalizeScoringState(event.detail && typeof event.detail === "object" ? event.detail : EMPTY_SCORING_STATE));
    }
    window.addEventListener("gvdg:admin-scoring-events-state", updateEvents);
    window.addEventListener("gvdg:admin-scoring-state", updateScoring);
    dispatchRequest("gvdg:admin-scoring-load-events-request");
    return () => {
      window.removeEventListener("gvdg:admin-scoring-events-state", updateEvents);
      window.removeEventListener("gvdg:admin-scoring-state", updateScoring);
    };
  }, []);

  return h("div", { "data-react-admin-scoring": state.status }, [
    h(EventSelector, { eventsState, key: "events", selectedId: state.eventId }),
    state.status === "loading" ? h("p", { className: "al-note", key: "loading", role: "status" }, "Loading live scoring...") : null,
    state.status === "error" ? h("p", { className: "al-note err", key: "error", role: "alert" }, state.message || "Unable to load live scoring.") : null,
    state.status === "start" ? h(StartControls, { key: `start-${state.eventId}`, state }) : null,
    state.status === "live" || state.status === "final" ? h(LiveControls, { key: `live-${state.eventId}`, state }) : null,
  ]);
}
