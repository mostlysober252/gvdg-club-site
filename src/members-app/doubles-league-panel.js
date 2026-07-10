import React from "react";
import { Trophy, X } from "lucide-react";

import { DOUBLES_LEAGUE_DATA } from "./doubles-league-data.js";

const h = React.createElement;
const PAGE_SIZE = 25;
const TABS = [
  { key: "champions", label: "Champions" },
  { key: "alltime", label: "All-Time Leaders" },
  { key: "seasons", label: "Season Results" },
];
const SORT_COLUMNS = [
  { key: "rank", label: "#" },
  { key: "name", label: "Player" },
  { key: "seasons", label: "Seasons" },
  { key: "points", label: "Total Pts" },
  { key: "best", label: "Best Finish" },
  { key: "wins", label: "Wins" },
  { key: "top3", label: "Top 3" },
  { key: "weeks", label: "Weeks" },
];

function formatNumber(value) {
  return Number.isFinite(Number(value)) ? Math.round(Number(value)).toLocaleString() : "-";
}

function ordinal(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  const suffixes = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${suffixes[(v - 20) % 10] || suffixes[v] || suffixes[0]}`;
}

function rankClass(rank) {
  if (rank === 1) return " gold";
  if (rank === 2) return " silver";
  if (rank === 3) return " bronze";
  return "";
}

function placementClass(placement) {
  if (placement === 1) return "placement-1";
  if (placement === 2) return "placement-2";
  if (placement === 3) return "placement-3";
  return "";
}

function bestFinish(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  if (n === 1) return h("span", { className: "win-badge" }, "1st");
  if (n <= 3) return h("span", { className: "top3-badge" }, ordinal(n));
  return ordinal(n);
}

function QuickStat({ value, label }) {
  return h("div", { className: "doubles-quick-stat" }, [
    h("div", { className: "doubles-quick-stat-val", key: "value" }, value),
    h("div", { className: "doubles-quick-stat-label", key: "label" }, label),
  ]);
}

function ModalStat({ value, label }) {
  return h("div", { className: "player-modal-stat" }, [
    h("div", { className: "player-modal-stat-val", key: "value" }, value),
    h("div", { className: "player-modal-stat-label", key: "label" }, label),
  ]);
}

function statsFor(data) {
  const leaderboard = data.leaderboard || [];
  const seasonOrder = data.seasonOrder || [];
  const totalWeeks = leaderboard.reduce((sum, player) => sum + (player.tw || 0), 0);
  const totalSeasonsPlayed = leaderboard.reduce((sum, player) => sum + (player.ts || 0), 0);
  const avgField = seasonOrder.length ? Math.round(totalSeasonsPlayed / seasonOrder.length) : 0;
  return {
    totalSeasons: seasonOrder.length,
    totalPlayers: leaderboard.length,
    totalWeeks,
    avgField,
  };
}

function ChampionsPanel({ champions }) {
  return h("div", { className: "doubles-panel active", id: "dblPanel-champions", role: "tabpanel" },
    h("div", { className: "champions-banner" }, champions.map((champion) =>
      h("article", { className: "champion-card", key: champion.season }, [
        h(Trophy, { className: "champion-trophy", size: 26, "aria-hidden": "true", key: "icon" }),
        h("div", { className: "champion-season", key: "season" }, champion.season),
        h("div", { className: "champion-name", key: "name" }, champion.name),
        h("div", { className: "champion-points", key: "points" }, `${formatNumber(champion.points)} points`),
      ]),
    )),
  );
}

function sortValue(player, field) {
  switch (field) {
    case "rank":
      return (player.ts || 0) * 10000 + (player.tp || 0);
    case "seasons":
      return player.ts || 0;
    case "points":
      return player.tp || 0;
    case "best":
      return player.bf || 999;
    case "wins":
      return player.w || 0;
    case "top3":
      return player.t3 || 0;
    case "weeks":
      return player.tw || 0;
    default:
      return player.ts || 0;
  }
}

function sortLeaderboard(players, sortField, sortAsc) {
  return [...players].sort((a, b) => {
    if (sortField === "name") {
      return sortAsc
        ? a.n.toLowerCase().localeCompare(b.n.toLowerCase())
        : b.n.toLowerCase().localeCompare(a.n.toLowerCase());
    }
    if (sortField === "best") {
      return sortAsc ? sortValue(b, sortField) - sortValue(a, sortField) : sortValue(a, sortField) - sortValue(b, sortField);
    }
    const diff = sortValue(a, sortField) - sortValue(b, sortField);
    return sortAsc ? diff : -diff;
  });
}

function AllTimePanel({ leaderboard, onPlayerSelect }) {
  const [searchTerm, setSearchTerm] = React.useState("");
  const [displayCount, setDisplayCount] = React.useState(PAGE_SIZE);
  const [sortField, setSortField] = React.useState("seasons");
  const [sortAsc, setSortAsc] = React.useState(false);

  React.useEffect(() => {
    setDisplayCount(PAGE_SIZE);
  }, [searchTerm]);

  const sorted = React.useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return sortLeaderboard(
      leaderboard.filter((player) => !query || player.n.toLowerCase().includes(query)),
      sortField,
      sortAsc,
    );
  }, [leaderboard, searchTerm, sortAsc, sortField]);

  const visible = sorted.slice(0, displayCount);
  const remaining = Math.max(0, sorted.length - displayCount);

  function chooseSort(field) {
    if (field === sortField) setSortAsc((current) => !current);
    else {
      setSortField(field);
      setSortAsc(false);
    }
  }

  return h("div", { className: "doubles-panel active", id: "dblPanel-alltime", role: "tabpanel" }, [
    h("input", {
      type: "search",
      className: "doubles-search-bar",
      placeholder: "Search player name...",
      "aria-label": "Search doubles players",
      value: searchTerm,
      onChange: (event) => setSearchTerm(event.target.value),
      key: "search",
    }),
    h("div", { className: "doubles-table-wrap", key: "table" },
      h("table", { className: "doubles-table" }, [
        h("thead", { key: "head" }, h("tr", null, SORT_COLUMNS.map((column) =>
          h("th", {
            className: sortField === column.key ? "sorted" : "",
            "aria-sort": sortField === column.key ? (sortAsc ? "ascending" : "descending") : "none",
            key: column.key,
          }, h("button", {
            type: "button",
            className: "doubles-sort-btn",
            onClick: () => chooseSort(column.key),
          }, [
            column.label,
            h("span", { className: "sort-arrow", "aria-hidden": "true", key: "arrow" }, sortField === column.key && sortAsc ? "▲" : "▼"),
          ])),
        ))),
        h("tbody", { key: "body" }, visible.length ? visible.map((player, index) =>
          h("tr", {
            className: "clickable-row",
            tabIndex: 0,
            onClick: () => onPlayerSelect(player.n),
            onKeyDown: (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onPlayerSelect(player.n);
              }
            },
            key: player.n,
          }, [
            h("td", { className: `rank-cell${rankClass(index + 1)}`, key: "rank" }, index + 1),
            h("td", { className: "player-name-cell", key: "name" }, [
              player.n,
              player.w > 0 ? h("span", { className: "trophy-icon", title: `${player.w} career wins`, key: "wins" }, [
                h(Trophy, { size: 13, "aria-hidden": "true", key: "icon" }),
                `x${player.w}`,
              ]) : null,
            ]),
            h("td", { className: "highlight-cell", key: "seasons" }, player.ts),
            h("td", { key: "points" }, formatNumber(player.tp)),
            h("td", { key: "best" }, bestFinish(player.bf)),
            h("td", { key: "wins" }, player.w || "-"),
            h("td", { key: "top3" }, player.t3 || "-"),
            h("td", { key: "weeks" }, player.tw || "-"),
          ]),
        ) : h("tr", null, h("td", { colSpan: SORT_COLUMNS.length }, "No players found."))),
      ]),
    ),
    remaining ? h("div", { className: "doubles-load-more-wrap", key: "load" }, h("button", {
      type: "button",
      className: "doubles-load-btn",
      onClick: () => setDisplayCount((count) => count + PAGE_SIZE),
    }, `Show More (${remaining} remaining)`)) : null,
    h("div", { className: "doubles-showing-count", role: "status", "aria-live": "polite", key: "count" },
      `Showing ${Math.min(displayCount, sorted.length)} of ${sorted.length} players`),
  ]);
}

function SeasonPanel({ leaderboard, seasonOrder }) {
  const [currentSeason, setCurrentSeason] = React.useState(() => seasonOrder[seasonOrder.length - 1] || "");
  const seasonPlayers = React.useMemo(() => {
    return leaderboard
      .map((player) => {
        const season = player.ss.find((entry) => entry.season === currentSeason);
        if (!season) return null;
        return {
          name: player.n,
          totalPoints: season.total_points,
          bestPoints: season.best_points,
          placement: season.placement,
          weeks: season.weeks_attended,
          avgScore: season.avg_score,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.placement - b.placement);
  }, [currentSeason, leaderboard]);

  return h("div", { className: "doubles-panel active", id: "dblPanel-seasons", role: "tabpanel" }, [
    h("div", { className: "season-selector", key: "selector" }, seasonOrder.map((season) =>
      h("button", {
        type: "button",
        className: `season-pill${season === currentSeason ? " active" : ""}`,
        "aria-pressed": season === currentSeason ? "true" : "false",
        onClick: () => setCurrentSeason(season),
        key: season,
      }, season),
    )),
    h("div", { className: "doubles-table-wrap", key: "table" },
      h("table", { className: "doubles-table" }, [
        h("thead", { key: "head" }, h("tr", null, ["#", "Player", "Total Pts", "Best Pts", "Weeks", "Avg Score"].map((label) =>
          h("th", { key: label }, label),
        ))),
        h("tbody", { key: "body" }, seasonPlayers.map((player) =>
          h("tr", { key: `${currentSeason}-${player.name}` }, [
            h("td", { className: `rank-cell${rankClass(player.placement)}`, key: "rank" }, player.placement),
            h("td", { className: "player-name-cell", key: "name" }, player.name),
            h("td", { className: "highlight-cell", key: "total" }, formatNumber(player.totalPoints)),
            h("td", { key: "best" }, formatNumber(player.bestPoints)),
            h("td", { key: "weeks" }, player.weeks || "-"),
            h("td", { key: "avg" }, Number.isFinite(Number(player.avgScore)) ? Number(player.avgScore).toFixed(1) : "-"),
          ]),
        )),
      ]),
    ),
  ]);
}

function PlayerModal({ player, seasonOrder, onClose }) {
  React.useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  if (!player) return null;
  const seasons = [...player.ss].sort((a, b) => seasonOrder.indexOf(a.season) - seasonOrder.indexOf(b.season));

  return h("div", {
    className: "player-modal-overlay active",
    role: "presentation",
    onClick: (event) => {
      if (event.currentTarget === event.target) onClose();
    },
  }, h("div", {
    className: "player-modal",
    role: "dialog",
    "aria-modal": "true",
    "aria-labelledby": "doublesPlayerModalTitle",
  }, [
    h("button", { type: "button", className: "player-modal-close", "aria-label": "Close player details", onClick: onClose, key: "close" },
      h(X, { size: 20, "aria-hidden": "true" })),
    h("div", { className: "player-modal-name", id: "doublesPlayerModalTitle", key: "name" }, player.n),
    h("div", { className: "player-modal-subtitle", key: "subtitle" }, `${player.ts} season${player.ts > 1 ? "s" : ""} in GVDG Doubles League`),
    h("div", { className: "player-modal-stats", key: "stats" }, [
      h(ModalStat, { value: formatNumber(player.tp), label: "Career Pts", key: "points" }),
      h(ModalStat, { value: ordinal(player.bf), label: "Best Finish", key: "best" }),
      h(ModalStat, { value: player.w || 0, label: "Wins", key: "wins" }),
      h(ModalStat, { value: player.tw || "-", label: "Weeks", key: "weeks" }),
    ]),
    h("div", { className: "player-modal-seasons-title", key: "history" }, "Season History"),
    h("div", { className: "player-season-row", key: "head" }, [
      h("div", { key: "season" }, "Season"),
      h("div", { key: "points" }, "Points"),
      h("div", { key: "finish" }, "Finish"),
      h("div", { key: "weeks" }, "Weeks"),
    ]),
    seasons.map((season) => h("div", { className: "player-season-row", key: season.season }, [
      h("div", { key: "season" }, season.season),
      h("div", { key: "points" }, formatNumber(season.total_points)),
      h("div", { className: placementClass(season.placement), key: "placement" }, ordinal(season.placement)),
      h("div", { key: "weeks" }, season.weeks_attended || "-"),
    ])),
  ]));
}

export function DoublesLeaguePanel() {
  const data = DOUBLES_LEAGUE_DATA;
  const leaderboard = data.leaderboard || [];
  const seasonOrder = data.seasonOrder || [];
  const [activeTab, setActiveTab] = React.useState("champions");
  const [selectedPlayerName, setSelectedPlayerName] = React.useState("");
  const selectedPlayer = leaderboard.find((player) => player.n === selectedPlayerName) || null;
  const stats = statsFor(data);

  return h("section", {
    className: "doubles-league-container react-doubles-league",
    "data-react-doubles-league": leaderboard.length ? "ready" : "empty",
    "aria-labelledby": "reactDoublesLeagueTitle",
  }, [
    h("h3", { className: "doubles-league-title", id: "reactDoublesLeagueTitle", key: "title" }, "Doubles League Records"),
    h("div", { className: "doubles-quick-stats", key: "stats" }, [
      h(QuickStat, { value: stats.totalSeasons, label: "Seasons Tracked", key: "seasons" }),
      h(QuickStat, { value: stats.totalPlayers, label: "Players All-Time", key: "players" }),
      h(QuickStat, { value: formatNumber(stats.totalWeeks), label: "Weeks of Play", key: "weeks" }),
      h(QuickStat, { value: stats.avgField, label: "Avg Field Size", key: "field" }),
    ]),
    h("div", { className: "doubles-tabs", role: "tablist", "aria-label": "Doubles League Records", key: "tabs" }, TABS.map((tab) =>
      h("button", {
        type: "button",
        className: `doubles-tab${activeTab === tab.key ? " active" : ""}`,
        role: "tab",
        "aria-selected": activeTab === tab.key ? "true" : "false",
        onClick: () => setActiveTab(tab.key),
        key: tab.key,
      }, tab.label),
    )),
    activeTab === "champions" ? h(ChampionsPanel, { champions: data.champions || [], key: "champions" }) : null,
    activeTab === "alltime" ? h(AllTimePanel, { leaderboard, onPlayerSelect: setSelectedPlayerName, key: "alltime" }) : null,
    activeTab === "seasons" ? h(SeasonPanel, { leaderboard, seasonOrder, key: "seasons" }) : null,
    h(PlayerModal, { player: selectedPlayer, seasonOrder, onClose: () => setSelectedPlayerName(""), key: "modal" }),
  ]);
}
