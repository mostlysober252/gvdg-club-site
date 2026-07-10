import React from "react";

import { adminConfirm } from "./admin-dialogs.js";

const h = React.createElement;

const EMPTY_LEAGUES_STATE = { leagues: [] };
const EMPTY_FUNDRAISERS_STATE = { fundraisers: [] };
const EMPTY_MEETINGS_STATE = { meetings: [] };

function objectOrEmpty(value) {
  return value && typeof value === "object" ? value : {};
}

function dispatchRequest(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function normalizeId(value) {
  return value == null ? "" : String(value);
}

function normalizeText(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function normalizeLeague(league) {
  const source = objectOrEmpty(league);
  return {
    source,
    id: normalizeId(source.id),
    name: normalizeText(source.name, "Untitled league"),
    season: normalizeText(source.season),
    format: normalizeText(source.format),
  };
}

function leagueText(league) {
  return `${league.name}${league.season ? ` · ${league.season}` : ""}${league.format ? ` · ${league.format}` : ""}`;
}

function normalizeFundraiser(fundraiser) {
  const source = objectOrEmpty(fundraiser);
  const status = normalizeText(source.status, "active") || "active";
  return {
    source,
    id: normalizeId(source.id),
    title: normalizeText(source.title, "Untitled fundraiser"),
    status,
    goalCents: source.goal_cents,
  };
}

function fundraiserGoalText(fundraiser) {
  return fundraiser.goalCents != null ? ` · goal $${Number(fundraiser.goalCents) / 100}` : "";
}

function normalizeMeeting(meeting) {
  const source = objectOrEmpty(meeting);
  return {
    source,
    id: normalizeId(source.id),
    date: normalizeText(source.date),
    title: normalizeText(source.title, "Untitled meeting"),
  };
}

function normalizeLeaguesState(state) {
  return {
    leagues: Array.isArray(state.leagues) ? state.leagues.map(normalizeLeague) : [],
  };
}

function normalizeFundraisersState(state) {
  return {
    fundraisers: Array.isArray(state.fundraisers) ? state.fundraisers.map(normalizeFundraiser) : [],
  };
}

function normalizeMeetingsState(state) {
  return {
    meetings: Array.isArray(state.meetings) ? state.meetings.map(normalizeMeeting) : [],
  };
}

function EmptyNote({ children, marker }) {
  return h("p", { className: "al-note", "data-react-admin-club-list": marker, role: "status" }, children);
}

export function AdminLeaguesList() {
  const [state, setState] = React.useState(() => normalizeLeaguesState(EMPTY_LEAGUES_STATE));

  React.useEffect(() => {
    function update(event) {
      setState(normalizeLeaguesState(event.detail && typeof event.detail === "object" ? event.detail : EMPTY_LEAGUES_STATE));
    }
    window.addEventListener("gvdg:admin-leagues-list", update);
    return () => window.removeEventListener("gvdg:admin-leagues-list", update);
  }, []);

  if (!state.leagues.length) return h(EmptyNote, { marker: "leagues-empty" }, "No leagues yet.");

  return h("div", { "data-react-admin-club-list": "leagues-ready" }, state.leagues.map((league, index) => (
    h("div", { className: "admin-evrow", key: league.id || `${league.name}-${index}` }, [
      h("span", { className: "ev-name", key: "name" }, leagueText(league)),
      h("button", {
        className: "admin-btn danger",
        key: "delete",
        onClick: async () => {
          const confirmed = await adminConfirm({
            title: "Delete league",
            message: `Delete league "${league.name}"?`,
            confirmText: "Delete",
            danger: true,
          });
          if (!confirmed) return;
          dispatchRequest("gvdg:admin-league-delete-request", { league: league.source });
        },
        type: "button",
      }, "Delete"),
    ])
  )));
}

export function AdminFundraisersList() {
  const [state, setState] = React.useState(() => normalizeFundraisersState(EMPTY_FUNDRAISERS_STATE));

  React.useEffect(() => {
    function update(event) {
      setState(normalizeFundraisersState(event.detail && typeof event.detail === "object" ? event.detail : EMPTY_FUNDRAISERS_STATE));
    }
    window.addEventListener("gvdg:admin-fundraisers-list", update);
    return () => window.removeEventListener("gvdg:admin-fundraisers-list", update);
  }, []);

  if (!state.fundraisers.length) return h(EmptyNote, { marker: "fundraisers-empty" }, "No fundraisers yet.");

  return h("div", { "data-react-admin-club-list": "fundraisers-ready" }, state.fundraisers.map((fundraiser, index) => {
    const nextStatus = fundraiser.status === "active" ? "closed" : "active";
    const actionLabel = fundraiser.status === "active" ? "Close" : "Reopen";
    return h("div", { className: "admin-evrow", key: fundraiser.id || `${fundraiser.title}-${index}` }, [
      h("span", { className: "ev-name", key: "name" }, `${fundraiser.title} [${fundraiser.status}]${fundraiserGoalText(fundraiser)}`),
      h("button", {
        className: "admin-btn secondary",
        key: "status",
        onClick: async () => {
          const confirmed = await adminConfirm({
            title: `${actionLabel} fundraiser`,
            message: `${actionLabel} fundraiser "${fundraiser.title}"?`,
            confirmText: actionLabel,
          });
          if (!confirmed) return;
          dispatchRequest("gvdg:admin-fundraiser-status-request", { fundraiser: fundraiser.source, status: nextStatus });
        },
        type: "button",
      }, actionLabel),
      h("button", {
        className: "admin-btn danger",
        key: "delete",
        onClick: async () => {
          const confirmed = await adminConfirm({
            title: "Delete fundraiser",
            message: `Delete fundraiser "${fundraiser.title}"?`,
            confirmText: "Delete",
            danger: true,
          });
          if (!confirmed) return;
          dispatchRequest("gvdg:admin-fundraiser-delete-request", { fundraiser: fundraiser.source });
        },
        type: "button",
      }, "Delete"),
    ]);
  }));
}

export function AdminMeetingsList() {
  const [state, setState] = React.useState(() => normalizeMeetingsState(EMPTY_MEETINGS_STATE));

  React.useEffect(() => {
    function update(event) {
      setState(normalizeMeetingsState(event.detail && typeof event.detail === "object" ? event.detail : EMPTY_MEETINGS_STATE));
    }
    window.addEventListener("gvdg:admin-meetings-list", update);
    return () => window.removeEventListener("gvdg:admin-meetings-list", update);
  }, []);

  if (!state.meetings.length) return h(EmptyNote, { marker: "meetings-empty" }, "No meetings yet.");

  return h("div", { "data-react-admin-club-list": "meetings-ready" }, state.meetings.map((meeting, index) => (
    h("div", { className: "admin-evrow", key: meeting.id || `${meeting.date}-${meeting.title}-${index}` }, [
      h("span", { className: "ev-name", key: "name" }, `${meeting.date || ""} · ${meeting.title}`),
      h("button", {
        className: "admin-btn danger",
        key: "delete",
        onClick: async () => {
          const confirmed = await adminConfirm({
            title: "Delete meeting",
            message: `Delete meeting "${meeting.title}"?`,
            confirmText: "Delete",
            danger: true,
          });
          if (!confirmed) return;
          dispatchRequest("gvdg:admin-meeting-delete-request", { meeting: meeting.source });
        },
        type: "button",
      }, "Delete"),
    ])
  )));
}
