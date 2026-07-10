import React from "react";
import { ManualPlayerRow, RegistrationRow } from "./registration-roster-rows.js";

const h = React.createElement;

const EMPTY_ROSTER_STATE = { status: "loading", registrations: [], manualPlayers: [] };

function objectOrEmpty(value) {
  return value && typeof value === "object" ? value : {};
}

function normalizeText(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function normalizeStatus(value) {
  return value === "loading" || value === "error" ? value : "ready";
}

function normalizeRegistration(registration) {
  const source = objectOrEmpty(registration);
  const id = source.id == null ? "" : String(source.id);
  return {
    checkedIn: Boolean(source.checked_in),
    division: normalizeText(source.division),
    id,
    memberId: normalizeText(source.member_id),
    name: normalizeText(source.name, "Player") || "Player",
    paidEntry: Boolean(source.paid_entry),
    source,
    startingHole: source.starting_hole == null ? "" : String(source.starting_hole),
    team: normalizeText(source.team),
  };
}

function normalizeManualPlayer(player) {
  const source = objectOrEmpty(player);
  const id = source.id == null ? "" : String(source.id);
  return {
    division: normalizeText(source.division),
    id,
    name: normalizeText(source.name, "Player") || "Player",
    source,
    team: normalizeText(source.team),
  };
}

function normalizeRosterState(state) {
  return {
    manualPlayers: Array.isArray(state.manualPlayers) ? state.manualPlayers.map(normalizeManualPlayer) : [],
    registrations: Array.isArray(state.registrations) ? state.registrations.map(normalizeRegistration) : [],
    status: normalizeStatus(state.status),
  };
}

function RosterTable({ state }) {
  const rows = state.registrations.concat(state.manualPlayers);

  return h("div", { style: { overflowX: "auto" } }, h("table", {
    className: "al-holes",
    "data-react-admin-registration-roster": "ready",
  }, [
    h("thead", { key: "head" }, h("tr", null, ["Player", "Division", "Team", "Start hole", "In?", "Paid?", "Credit"].map((label) => (
      h("th", { key: label }, label)
    )))),
    h("tbody", { key: "body" }, rows.length ? [
      ...state.registrations.map((registration, index) => h(RegistrationRow, {
        key: registration.id || `registration-${index}`,
        registration,
      })),
      ...state.manualPlayers.map((player, index) => h(ManualPlayerRow, {
        key: player.id || `manual-${index}`,
        player,
      })),
    ] : h("tr", null, h("td", { colSpan: 7 }, "No players yet."))),
  ]));
}

export function AdminRegistrationRoster() {
  const [state, setState] = React.useState(() => normalizeRosterState(EMPTY_ROSTER_STATE));

  React.useEffect(() => {
    function update(event) {
      setState(normalizeRosterState(event.detail && typeof event.detail === "object" ? event.detail : EMPTY_ROSTER_STATE));
    }
    window.addEventListener("gvdg:admin-registration-roster", update);
    return () => window.removeEventListener("gvdg:admin-registration-roster", update);
  }, []);

  const count = state.registrations.length + state.manualPlayers.length;
  const title = h("h4", { className: "al-h", key: "title" }, [
    "Registered players (",
    h("span", { key: "count" }, String(count)),
    ") ",
    h("span", { className: "al-note", key: "note" }, "- includes manually-added walk-ons; check in, assign division/team/start hole"),
  ]);

  if (state.status === "loading") {
    return h(React.Fragment, null, [
      title,
      h("p", { className: "al-note", "data-react-admin-registration-roster": "loading", key: "state", role: "status" }, "Loading registered players..."),
    ]);
  }

  if (state.status === "error") {
    return h(React.Fragment, null, [
      title,
      h("p", { className: "al-note err", "data-react-admin-registration-roster": "error", key: "state", role: "alert" }, "Unable to load registered players."),
    ]);
  }

  return h(React.Fragment, null, [
    title,
    h(RosterTable, { key: "table", state }),
  ]);
}
