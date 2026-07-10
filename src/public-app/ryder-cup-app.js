import React from "react";

import { parseMatchGrid, parseRyderWorkbook, parseScoreboard, seedPairNames } from "../../ryder-cup.js";

const h = React.createElement;

const SHEET_ID = "1PSP5bZaG-db04YeREGjQHzlQlLT6QT97np7WBbEGq5I";
const REFRESH_MS = 3 * 60 * 1000;
const ROSTER_SEPARATOR = " \u00b7 ";
const UNPLAYED_MARK = "\u2014";

function gvizUrl(gid) {
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${gid}`;
}

function config() {
  const data = document.body.dataset;
  return {
    gridCsvUrl: (data.gridCsv || "").trim() || gvizUrl("2109671762"),
    scoreboardCsvUrl: (data.scoreboardCsv || "").trim() || gvizUrl("932426467"),
    workbookUrl: (data.workbookUrl || "").trim() ||
      `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=xlsx&id=${SHEET_ID}`,
  };
}

async function fetchCsv(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Sheet request failed (${response.status})`);
  return response.text();
}

async function fetchWorkbook(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Workbook request failed (${response.status})`);
  return response.arrayBuffer();
}

async function fetchRyderData() {
  const urls = config();
  try {
    const workbook = await fetchWorkbook(urls.workbookUrl);
    return await parseRyderWorkbook(workbook);
  } catch {
    const [gridCsv, scoreboardCsv] = await Promise.all([
      fetchCsv(urls.gridCsvUrl),
      fetchCsv(urls.scoreboardCsvUrl),
    ]);
    const { weeks, teamPoints } = parseMatchGrid(gridCsv);
    const scoreboard = parseScoreboard(scoreboardCsv);
    return { weeks, teamPoints, scoreboard };
  }
}

function StatusBox({ onRetry, status }) {
  const error = status === "error";
  return h("div", {
    className: "status-box" + (error ? " error" : ""),
    role: error ? "alert" : "status",
  }, [
    error ? null : h("div", { className: "spinner", key: "spinner" }),
    h("div", { key: "message" }, error
      ? "We couldn't reach the live results sheet right now. Please try again."
      : "Loading the latest results..."),
    error
      ? h("button", { className: "retry-btn", key: "retry", onClick: onRetry, type: "button" }, "Retry")
      : null,
  ]);
}

function TeamPanel({ side, team, teamLabel, teamPoints }) {
  return h("div", { className: `team-panel ${side}` }, [
    h("div", { className: "team-side-label", key: "label" }, teamLabel),
    h("div", { className: "team-name", key: "name" }, team.name),
    h("div", { className: "team-points", key: "points" }, String(teamPoints)),
    h("div", { className: "team-points-label", key: "points-label" }, "Points"),
    team.players.length
      ? h("div", { className: "roster", key: "roster" }, team.players.join(ROSTER_SEPARATOR))
      : null,
  ]);
}

function Scoreboard({ scoreboard, teamPoints }) {
  return h("div", { className: "scoreboard", "data-react-ryder-scoreboard": "true" }, [
    h(TeamPanel, {
      key: "red",
      side: "red",
      team: scoreboard.red,
      teamLabel: "Red Team",
      teamPoints: teamPoints.red,
    }),
    h("div", { className: "vs-divider", key: "divider" }, "VS"),
    h(TeamPanel, {
      key: "blue",
      side: "blue",
      team: scoreboard.blue,
      teamLabel: "Blue Team",
      teamPoints: teamPoints.blue,
    }),
  ]);
}

function MatchResult({ match }) {
  if (match.winner === "tie") {
    return h("div", { className: "match-result" }, h("span", { className: "res-tie" }, "TIE"));
  }
  if (match.winner && !match.score) {
    return h("div", { className: "match-result" }, h("span", { className: "res-winner" }, "WIN"));
  }
  if (match.score) {
    return h("div", { className: "match-result" }, match.score);
  }
  return h("div", { className: "match-result unplayed" }, UNPLAYED_MARK);
}

function PlayerSide({ match, scoreboard, side, week }) {
  const winnerClass = match.winner === side ? " winner" : "";
  if (week.format !== "doubles") {
    return h("div", { className: `player ${side}${winnerClass}` }, match[side] || UNPLAYED_MARK);
  }

  const team = side === "red" ? scoreboard.red : scoreboard.blue;
  const teamLabel = side === "red" ? "Red Team" : "Blue Team";
  const sheetPlayers = Array.isArray(match[`${side}Players`])
    ? match[`${side}Players`].filter((name) => String(name || "").trim())
    : [];
  const names = sheetPlayers.length ? sheetPlayers : seedPairNames(team.players, Array.isArray(match.seeds) ? match.seeds : []);

  return h("div", { className: `player ${side} pair${winnerClass}` }, [
    h("span", { className: "pair-seeds", key: "seeds" }, teamLabel),
    ...(names.length ? names : [match[side] || UNPLAYED_MARK]).map((name, index) =>
      h("span", { className: "pair-name", key: `${name}-${index}` }, name)),
  ]);
}

function WeekSection({ scoreboard, week }) {
  const played = week.matches.filter((match) => (match.score || "").length > 0 || !!match.winner).length;
  return h("section", { className: "week-section" }, [
    h("div", { className: "week-header", key: "head" }, [
      h("h2", { className: "week-title", key: "title" }, week.label || "Week"),
      h("div", { className: "week-meta", key: "meta" }, [
        week.dates ? h("span", { className: "week-date", key: "date" }, week.dates) : null,
        h("span", { className: "week-format", key: "format" }, week.format === "doubles" ? "Doubles" : "Singles"),
        h("span", { className: "week-tally", key: "tally" }, played ? `${played} of ${week.matches.length} played` : "Upcoming"),
      ]),
    ]),
    h("div", { className: "match-grid", key: "grid" }, week.matches.map((match) =>
      h("div", {
        className: "match-card" +
          (week.format === "doubles" ? " doubles" : "") +
          (match.winner && match.winner !== "tie" ? " has-winner" : ""),
        key: `${week.label}-${match.num}`,
      }, [
        h("span", { className: "match-num", key: "num" }, `#${match.num}`),
        h(PlayerSide, { key: "red", match, scoreboard, side: "red", week }),
        h(MatchResult, { key: "result", match }),
        h(PlayerSide, { key: "blue", match, scoreboard, side: "blue", week }),
      ]))),
  ]);
}

function ScoringNote() {
  return h("p", { className: "scoring-note" }, [
    "Players highlighted green match the winners marked green on the live sheet. ",
    "Weeks 2, 3, 5, 6 and 8 are doubles; teammates are shown from the live sheet. ",
    h("span", { key: "scores" }, ["Scores shown as ", h("strong", { key: "strong" }, "A&B"), "; a win is worth 2 points and a tie awards 1 point each."]),
  ]);
}

export function RyderCupApp() {
  const [state, setState] = React.useState({ data: null, lastUpdated: null, status: "loading" });
  const mountedRef = React.useRef(true);

  const load = React.useCallback(async ({ quiet = false } = {}) => {
    if (!quiet && mountedRef.current) setState((current) => ({ ...current, status: "loading" }));
    try {
      const data = await fetchRyderData();
      if (mountedRef.current) setState({ data, lastUpdated: new Date(), status: "ready" });
    } catch {
      if (!quiet && mountedRef.current) setState({ data: null, lastUpdated: null, status: "error" });
    }
  }, []);

  React.useEffect(() => {
    mountedRef.current = true;
    async function guardedLoad(options) {
      await load(options);
    }
    guardedLoad();
    const refreshTimer = window.setInterval(() => guardedLoad({ quiet: true }), REFRESH_MS);
    return () => {
      mountedRef.current = false;
      window.clearInterval(refreshTimer);
    };
  }, [load]);

  const ready = state.status === "ready" && state.data;

  return h("main", { "data-react-ryder-cup": state.status }, [
    h("h1", { className: "page-title", key: "title" }, "Ryder Cup"),
    h("p", { className: "page-subtitle", key: "subtitle" }, "Red vs Blue \u2014 team matchplay"),
    h("p", { className: "league-nav", key: "league-nav" },
      h("a", { className: "back-link", href: "events.html#league/4" }, "View Ryder Cup League standings and events")),
    ready ? h(Scoreboard, { key: "scoreboard", scoreboard: state.data.scoreboard, teamPoints: state.data.teamPoints }) : null,
    ready ? h(ScoringNote, { key: "note" }) : null,
    ready
      ? h("div", { key: "weeks" }, state.data.weeks.length
          ? state.data.weeks.map((week) => h(WeekSection, { key: week.label || String(week.matches.length), scoreboard: state.data.scoreboard, week }))
          : h("p", { className: "status-box" }, "No matchups posted yet."))
      : h(StatusBox, { key: "status", onRetry: () => load(), status: state.status }),
    ready && state.lastUpdated
      ? h("p", { className: "last-updated", key: "updated" },
          "Last updated " + state.lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))
      : null,
    h("div", { key: "back", style: { textAlign: "center" } },
      h("a", { className: "back-link", href: "index.html" }, "\u2190 Back to home")),
  ]);
}
