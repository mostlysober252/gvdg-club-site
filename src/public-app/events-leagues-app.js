import React from "react";

import { fetchPublicJson, publicApiBase } from "./public-api.js";

const h = React.createElement;

function normalizeLeague(raw) {
  const league = raw && typeof raw === "object" ? raw : {};
  return {
    format: league.format == null ? "" : String(league.format),
    id: league.id == null ? "" : String(league.id),
    name: league.name == null ? "League" : String(league.name),
    season: league.season == null ? "" : String(league.season),
  };
}

function leagueItems(data) {
  return Array.isArray(data && data.leagues) ? data.leagues.map(normalizeLeague) : [];
}

function useEventsLeagues() {
  const api = React.useMemo(publicApiBase, []);
  const [leagues, setLeagues] = React.useState([]);

  React.useEffect(() => {
    let active = true;

    async function loadLeagues() {
      try {
        const data = await fetchPublicJson(api, "/leagues");
        if (active) setLeagues(leagueItems(data));
      } catch {
        if (active) setLeagues([]);
      }
    }

    loadLeagues();
    return () => {
      active = false;
    };
  }, [api]);

  return leagues;
}

function leagueKey(league, index) {
  return [league.id, league.name, league.season, league.format, String(index)].filter(Boolean).join("|");
}

function leagueMeta(league) {
  return [league.season, league.format].filter(Boolean).join(" · ");
}

function LeagueCard({ league }) {
  const meta = leagueMeta(league);
  const disabled = !league.id;

  function openLeague() {
    if (!disabled) window.location.hash = `#league/${encodeURIComponent(league.id)}`;
  }

  return h("button", {
    className: "league-card",
    disabled,
    onClick: openLeague,
    type: "button",
  }, [
    h("span", { className: "league-name", key: "name" }, league.name),
    meta ? h("span", { className: "league-meta", key: "meta" }, meta) : null,
  ]);
}

export function EventsLeaguesApp() {
  const leagues = useEventsLeagues();
  if (!leagues.length) return null;

  return h("section", { "data-react-events-leagues": "true" }, [
    h("h2", { className: "events-section-title", key: "title" }, "Leagues & Standings"),
    h("div", { className: "leagues-grid", key: "grid" }, leagues.map((league, index) =>
      h(LeagueCard, { key: leagueKey(league, index), league }))),
  ]);
}
