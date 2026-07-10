import React from "react";

import { requestJson } from "./api.js";

const h = React.createElement;

const HTML_ENTITY_MAP = {
  amp: "&",
  apos: "'",
  quot: '"',
  "#039": "'",
};

export function pdgaEventTitle(value) {
  return String(value || "").replace(/&(#\d+|#x[\da-fA-F]+|amp|apos|quot|#039);/g, (match, entity) => {
    if (HTML_ENTITY_MAP[entity]) return HTML_ENTITY_MAP[entity];
    if (entity[0] === "#") {
      const code = entity[1].toLowerCase() === "x"
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10);
      return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return match;
  }).trim();
}

function ratingValue(value) {
  return value == null ? "-" : String(value);
}

function eventMeta(event) {
  return [event.date || "", event.division || ""].filter(Boolean).join(" - ");
}

function eventRatings(event) {
  const ratings = (event.rounds || []).map((round) => round.rating).filter((value) => value != null);
  return ratings.length ? ratings.join(" - ") : "-";
}

function EventRatingRow({ ratings }) {
  const label = ratings === "-" ? "Rating" : "Round ratings";
  return h("div", { className: "dash-event-rating-row", key: "rating-row" }, [
    h("span", { className: "dash-event-rating-label", key: "label" }, label),
    h("span", {
      "aria-label": ratings === "-" ? "Round ratings unavailable" : `Round ratings: ${ratings}`,
      className: "dash-event-ratings",
      key: "ratings",
    }, ratings),
  ]);
}

export function usePdgaStats(pdgaNo) {
  const [state, setState] = React.useState({ status: pdgaNo ? "loading" : "empty", stats: null });

  React.useEffect(() => {
    if (!pdgaNo) {
      setState({ status: "empty", stats: null });
      return undefined;
    }

    const controller = new AbortController();
    setState({ status: "loading", stats: null });
    requestJson(`/pdga-stats?pdga=${encodeURIComponent(pdgaNo)}`, { signal: controller.signal })
      .then((stats) => {
        if (!stats || (stats.official_rating == null && !(Array.isArray(stats.events) && stats.events.length))) {
          setState({ status: "missing", stats: null });
          return;
        }
        setState({ status: "ready", stats });
      })
      .catch((error) => {
        if (error.name !== "AbortError") setState({ status: "error", stats: null });
      });

    return () => controller.abort();
  }, [pdgaNo]);

  return state;
}

function RatingTile({ label, value, delta, live = false }) {
  const props = {
    className: "dash-tile",
  };
  if (live) {
    props["data-react-live-rating"] = "true";
  }
  return h("div", props, [
    h("div", { className: "dash-tile-num", key: "value" }, ratingValue(value)),
    delta ? h("div", { className: "dash-tile-delta", key: "delta" }, delta) : null,
    h("div", { className: "dash-tile-label", key: "label" }, label),
  ]);
}

function RecentEvent({ event }) {
  const ratings = eventRatings(event);
  const title = pdgaEventTitle(event.tournament) || "Event";
  return h("article", { className: "dash-event" }, [
    h("div", { className: "dash-event-main", key: "main" }, [
      h("div", { className: "dash-event-copy", key: "copy" }, [
        h("div", { className: "dash-event-name", key: "name" }, title),
        h("div", { className: "dash-event-date", key: "date" }, eventMeta(event)),
      ]),
      h(EventRatingRow, { ratings, key: "rating-row" }),
    ]),
  ]);
}

export function PdgaDashboard({ pdgaNo, state }) {
  const status = state.status;
  const stats = state.stats;

  if (!pdgaNo) {
    return h(
      "div",
      { className: "react-pdga-dashboard", id: "membersReactRatingPanel", "data-react-pdga-dashboard": "empty" },
      h("div", { className: "react-pdga-status" }, "No PDGA # is linked to your account yet. PDGA ratings and tournament history will appear here once it is."),
    );
  }

  if (status === "loading") {
    return h(
      "div",
      { className: "react-pdga-dashboard", id: "membersReactRatingPanel", "data-react-pdga-dashboard": "loading" },
      h("div", { className: "react-pdga-status" }, "Loading your stats..."),
    );
  }

  if (status === "missing") {
    return h(
      "div",
      { className: "react-pdga-dashboard", id: "membersReactRatingPanel", "data-react-pdga-dashboard": "missing" },
      h("div", { className: "react-pdga-status" }, `We couldn't find live data for PDGA #${pdgaNo} yet. Check back after the next sync.`),
    );
  }

  if (status === "error") {
    return h(
      "div",
      { className: "react-pdga-dashboard", id: "membersReactRatingPanel", "data-react-pdga-dashboard": "error" },
      h("div", { className: "react-pdga-status error" }, "Could not load PDGA stats. Please refresh and try again."),
    );
  }

  const events = Array.isArray(stats?.events) ? stats.events : [];
  const live = stats?.live_rating;
  const official = stats?.official_rating;
  const delta = live != null && official != null
    ? `${live - official >= 0 ? "+" : ""}${live - official} vs official`
    : "";

  return h("div", { className: "react-pdga-dashboard", id: "membersReactRatingPanel", "data-react-pdga-dashboard": "ready" }, [
    h("div", { className: "react-pdga-meta", key: "meta" }, `PDGA #${pdgaNo}`),
    h("div", { className: "dash-rating-row", key: "ratings" }, [
      h(RatingTile, { label: "Live Rating", value: live, delta, live: true, key: "live" }),
      h(RatingTile, { label: "Official", value: official, key: "official" }),
      h(RatingTile, { label: "Peak", value: stats?.peak_rating, key: "peak" }),
      h(RatingTile, { label: "Events", value: stats?.events_count != null ? stats.events_count : events.length, key: "events" }),
    ]),
    events.length ? h("div", { key: "events" }, [
      h("h4", { className: "dash-subtitle", key: "title" }, "Recent Tournaments"),
      h("div", { key: "list" }, events.slice(0, 6).map((event, index) => h(RecentEvent, { event, key: `${event.tournament || "event"}-${event.epoch || index}` }))),
    ]) : null,
  ]);
}
