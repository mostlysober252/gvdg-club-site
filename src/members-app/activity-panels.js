import React from "react";

import { RECENT_ROUNDS_KEY, localStorageGet, requestJson } from "./api.js";
import { dollars, formatEventDay, formatToPar } from "./format.js";

const h = React.createElement;

function roundMeta(parts) {
  return parts.filter(Boolean).join(" - ");
}

function walletDate(value) {
  const date = new Date(value || "");
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "America/New_York" });
}

function walletSource(source) {
  if (source === "event_payout") return "Event payout";
  if (source === "store_purchase") return "Pro shop";
  if (source === "manual_adjustment") return "Admin adjustment";
  return "Store credit";
}

function recentCasualRounds() {
  try {
    const rows = JSON.parse(localStorageGet(RECENT_ROUNDS_KEY) || "[]");
    const seen = new Set();
    return (Array.isArray(rows) ? rows : []).map((row) => ({
      code: String(row?.code || "").toUpperCase().replace(/[^A-Z0-9]/g, ""),
      label: String(row?.label || ""),
      updatedAt: Number(row?.updatedAt || 0),
    })).filter((row) => {
      if (!row.code || seen.has(row.code)) return false;
      seen.add(row.code);
      return true;
    }).slice(0, 8);
  } catch {
    return [];
  }
}

async function loadRecentCasualRows(token, signal) {
  const checks = recentCasualRounds().map(async (row) => {
    try {
      const data = await requestJson(`/rounds/${encodeURIComponent(row.code)}/live/mine`, { token, signal });
      const cardmates = Array.isArray(data.cardmates) ? data.cardmates : [];
      if (data.status !== "live" || data.cardId == null || !cardmates.length) return null;
      const names = cardmates.map((player) => player?.name).filter(Boolean).slice(0, 4).join(", ");
      return {
        kind: "round",
        title: row.label || `Casual round ${row.code}`,
        meta: names ? `Card: ${names}` : "Casual card in progress",
        href: `score.html?round=${encodeURIComponent(row.code)}`,
        sort: row.updatedAt || 0,
      };
    } catch {
      return null;
    }
  });
  return (await Promise.all(checks)).filter(Boolean);
}

function LiveRoundCard({ item }) {
  return h("div", { className: "live-round-card" }, [
    h("div", { key: "body" }, [
      h("span", { className: "live-round-badge", key: "badge" }, item.kind === "event" ? "Club event" : "Casual round"),
      h("div", { className: "live-round-title", key: "title" }, item.title),
      item.meta ? h("div", { className: "live-round-meta", key: "meta" }, item.meta) : null,
    ]),
    h("a", { className: "passkey-btn", href: item.href, key: "link" }, "Rejoin scorecard"),
  ]);
}

export function LiveScoringPanel({ token }) {
  const [state, setState] = React.useState({ status: "idle", items: [] });

  React.useEffect(() => {
    if (!token) {
      setState({ status: "idle", items: [] });
      return undefined;
    }
    const controller = new AbortController();
    setState({ status: "loading", items: [] });
    Promise.all([
      requestJson("/my-live-rounds", { token, signal: controller.signal }).catch(() => ({ rounds: [] })),
      loadRecentCasualRows(token, controller.signal),
    ]).then(([events, casualRows]) => {
      const eventRows = (Array.isArray(events.rounds) ? events.rounds : []).map((event) => ({
        kind: "event",
        title: event.name || "Live club event",
        meta: roundMeta([formatEventDay(event.date), event.course_name, event.layout_name, event.division]),
        href: `score.html?event=${encodeURIComponent(event.id)}`,
        sort: Date.parse(event.date || "") || 0,
      }));
      setState({ status: "ready", items: eventRows.concat(casualRows).sort((a, b) => (b.sort || 0) - (a.sort || 0)) });
    }).catch((error) => {
      if (error.name !== "AbortError") setState({ status: "ready", items: [] });
    });
    return () => controller.abort();
  }, [token]);

  if (!token) return null;
  return h("div", { className: "club-board react-live-scoring", "data-react-live-scoring": state.status }, [
    h("h3", { className: "my-dashboard-title", key: "title" }, "Live Scoring"),
    h("div", { className: "live-round-list", key: "list" }, state.items.length
      ? state.items.map((item) => h(LiveRoundCard, { item, key: `${item.kind}-${item.href}` }))
      : h("p", { className: "dash-note" }, "No active scorecards right now.")),
    h("div", { className: "live-round-actions", key: "actions" }, h("a", { className: "passkey-btn", href: "score.html" }, "Start / join a casual round")),
  ]);
}

function WalletLine({ transaction }) {
  const cents = Number(transaction.amount_cents || 0);
  const when = walletDate(transaction.created_at);
  return h("div", { className: "wallet-line" }, [
    h("div", { className: "wallet-line-main", key: "main" }, [
      h("div", { className: "wallet-source", key: "source" }, `${walletSource(transaction.source)}${when ? ` - ${when}` : ""}`),
      transaction.note ? h("div", { className: "wallet-note", key: "note" }, transaction.note) : null,
    ]),
    h("div", { className: `wallet-amount ${cents >= 0 ? "credit" : "debit"}`, key: "amount" }, `${cents >= 0 ? "+" : ""}${dollars(cents)}`),
  ]);
}

export function WalletPanel({ token }) {
  const [state, setState] = React.useState({ status: "idle", wallet: null });

  React.useEffect(() => {
    if (!token) {
      setState({ status: "idle", wallet: null });
      return undefined;
    }
    const controller = new AbortController();
    setState({ status: "loading", wallet: null });
    requestJson("/shop/wallet", { token, signal: controller.signal })
      .then((wallet) => setState({ status: "ready", wallet }))
      .catch((error) => {
        if (error.name !== "AbortError") setState({ status: "error", wallet: null });
      });
    return () => controller.abort();
  }, [token]);

  if (!token || state.status === "error" || !state.wallet) return null;
  const transactions = (Array.isArray(state.wallet.transactions) ? state.wallet.transactions : []).slice(0, 4);
  return h("div", { className: "wallet-panel react-wallet-panel", "data-react-wallet": state.status }, [
    h("div", { key: "balance" }, [
      h("div", { className: "wallet-label", key: "label" }, "Store credit wallet"),
      h("div", { className: "wallet-balance", key: "amount" }, dollars(state.wallet.balance_cents || 0)),
    ]),
    h("a", { className: "dashboard-action primary", href: "pro-shop.html", key: "shop" }, "Shop with credit"),
    h("div", { className: "wallet-ledger", key: "ledger" }, transactions.length
      ? transactions.map((transaction, index) => h(WalletLine, { transaction, key: transaction.id || index }))
      : h("div", { className: "wallet-empty" }, "Event payouts and shop purchases will appear here.")),
  ]);
}

function LeagueCard({ item }) {
  const league = item.league || {};
  const teams = Array.isArray(item.teamStandings) ? item.teamStandings : [];
  const players = Array.isArray(item.standings) ? item.standings : [];
  return h("div", { className: "dash-standings-card" }, [
    h("h4", { className: "dash-subtitle", key: "title" }, `${league.name || "League"}${league.season ? ` - ${league.season}` : ""} - Standings`),
    teams.length ? h("table", { className: "lb-table", key: "teams" }, [
      h("thead", { key: "head" }, h("tr", null, ["Team", "Pts", "W", "T", "L"].map((label) => h("th", { key: label }, label)))),
      h("tbody", { key: "body" }, teams.map((team) => h("tr", { key: team.teamName || team.team }, [
        h("td", { key: "name" }, team.teamName || team.team || "Team"),
        h("td", { key: "points" }, String(team.points)),
        h("td", { key: "wins" }, String(team.wins)),
        h("td", { key: "ties" }, String(team.ties)),
        h("td", { key: "losses" }, String(team.losses)),
      ]))),
    ]) : null,
    players.length ? h("details", { key: "players" }, [
      h("summary", { className: "standings-summary", key: "summary" }, `Player records (${players.length})`),
      h("table", { className: "lb-table", key: "table" }, [
        h("thead", { key: "head" }, h("tr", null, ["Pos", "Player", "Pts", "Played", "Wins"].map((label) => h("th", { key: label }, label)))),
        h("tbody", { key: "body" }, players.map((player, index) => h("tr", { key: `${player.name || "player"}-${index}` }, [
          h("td", { key: "pos" }, String(index + 1)),
          h("td", { key: "name" }, player.name != null ? String(player.name) : "Player"),
          h("td", { key: "points" }, String(player.points)),
          h("td", { key: "events" }, String(player.events)),
          h("td", { key: "wins" }, String(player.wins)),
        ]))),
      ]),
    ]) : null,
  ]);
}

function LiveEventStandings({ event }) {
  const [snapshot, setSnapshot] = React.useState(null);
  React.useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const data = await requestJson(`/events/${encodeURIComponent(event.id)}/live`);
        if (!cancelled) setSnapshot(data);
      } catch {
        if (!cancelled) setSnapshot(null);
      }
    }
    void poll();
    const timer = window.setInterval(poll, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [event.id]);

  const standings = Array.isArray(snapshot?.standings) ? snapshot.standings : [];
  const config = snapshot?.roundConfig || {};
  const matchplay = config.scoringStyle === "matchplay";
  const headings = matchplay
    ? ["Pos", config.groupFormat === "doubles" ? "Team" : "Player", "Thru", "Match"]
    : ["Pos", "Player", "Thru", "Total", "To Par"];
  return h("div", { className: "dash-standings-card" }, [
    h("h4", { className: "dash-subtitle", key: "title" }, [
      `Live - ${event.name || "Event"}`,
      h("a", { href: `events.html#event/${encodeURIComponent(event.id)}`, className: "standings-link", key: "link" }, "Open"),
    ]),
    standings.length ? h("table", { className: "lb-table", key: "table" }, [
      h("thead", { key: "head" }, h("tr", null, headings.map((label) => h("th", { key: label }, label)))),
      h("tbody", { key: "body" }, standings.map((standing, index) => h("tr", { key: `${standing.name || "player"}-${index}` }, [
        h("td", { key: "pos" }, String(index + 1)),
        h("td", { key: "name" }, standing.name != null ? String(standing.name) : "Player"),
        h("td", { key: "thru" }, standing.thru ? String(standing.thru) : "-"),
        matchplay
          ? h("td", { key: "match" }, standing.match?.status || "AS")
          : h("td", { key: "total" }, standing.total != null && standing.thru ? String(standing.total) : "-"),
        matchplay ? null : h("td", { key: "par" }, standing.thru ? formatToPar(standing.toPar) : "-"),
      ]))),
    ]) : h("div", { className: "dash-note", key: "empty" }, "Waiting for the first scores..."),
  ]);
}

export function ActiveStandingsPanel() {
  const [state, setState] = React.useState({ status: "idle", leagues: [], liveEvents: [] });

  React.useEffect(() => {
    const controller = new AbortController();
    requestJson("/leagues/active", { signal: controller.signal })
      .then((data) => setState({
        status: "ready",
        leagues: Array.isArray(data.leagues) ? data.leagues : [],
        liveEvents: Array.isArray(data.liveEvents) ? data.liveEvents : Array.isArray(data.events) ? data.events : [],
      }))
      .catch((error) => {
        if (error.name !== "AbortError") setState({ status: "error", leagues: [], liveEvents: [] });
      });
    return () => controller.abort();
  }, []);

  if (state.status !== "ready" || (!state.leagues.length && !state.liveEvents.length)) return null;
  return h("div", { className: "active-standings react-active-standings", "data-react-active-standings": "ready" }, [
    ...state.liveEvents.map((event) => h(LiveEventStandings, { event, key: `event-${event.id}` })),
    ...state.leagues.map((league, index) => h(LeagueCard, { item: league, key: `league-${league.league?.id || index}` })),
  ]);
}
