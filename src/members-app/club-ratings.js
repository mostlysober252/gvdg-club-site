import React from "react";

import { requestJson } from "./api.js";
import { formatRatingDate, formatToPar, plural } from "./format.js";
import { UDiscExportDetails } from "../shared/udisc-export.js";

const h = React.createElement;
const RATING_PAGE_SIZE = 250;
const KINDS = ["competitive", "casual"];

function emptyKind() {
  return { rounds: [], liveRating: null, ratedShown: 0, totalShown: 0, offset: 0, hasMore: false, loading: false };
}

function initialState() {
  return { status: "idle", competitive: emptyKind(), casual: emptyKind() };
}

function ratingValue(value) {
  return value == null ? "-" : String(value);
}

function parseObject(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function matchSummary(round) {
  const match = parseObject(round.match_result);
  if (!match) return null;
  const scoringGroup = parseObject(round.scoring_group);
  const team = scoringGroup?.label ? `${scoringGroup.label} - ` : "";
  const status = match.outcome === "lost" || match.outcome === "trailing"
    ? String(match.status || "").replace(/^won /, "lost ")
    : String(match.status || "");
  return `${team}${status}`;
}

function roundMeta(round) {
  const parts = [];
  const when = formatRatingDate(round.date);
  const match = matchSummary(round);
  if (when) parts.push(when);
  if (match) parts.push(match);
  else if (round.total != null) parts.push(`${round.total} (${formatToPar(round.to_par)})`);
  if (round.round_code) parts.push(`Round ${round.round_code}`);
  return parts.join(" - ");
}

function mergeKind(previous, group, append) {
  const rounds = Array.isArray(group?.rounds) ? group.rounds : [];
  return {
    rounds: append ? previous.rounds.concat(rounds) : rounds,
    liveRating: group?.live_rating ?? null,
    ratedShown: (append ? previous.ratedShown : 0) + (group?.rated_rounds || 0),
    totalShown: (append ? previous.totalShown : 0) + rounds.length,
    offset: (append ? previous.offset : 0) + rounds.length,
    hasMore: rounds.length === RATING_PAGE_SIZE,
    loading: false,
  };
}

function useClubRatings(token) {
  const [state, setState] = React.useState(initialState);
  const stateRef = React.useRef(state);
  React.useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const load = React.useCallback(async ({ appendKind = null } = {}) => {
    if (!token) {
      setState(initialState());
      return;
    }
    const current = stateRef.current;
    const reset = appendKind == null;
    setState((prev) => ({
      ...prev,
      status: "loading",
      competitive: { ...prev.competitive, loading: reset || appendKind === "competitive" },
      casual: { ...prev.casual, loading: reset || appendKind === "casual" },
    }));

    const params = new URLSearchParams({
      competitiveLimit: String((reset || appendKind === "competitive") ? RATING_PAGE_SIZE : 0),
      casualLimit: String((reset || appendKind === "casual") ? RATING_PAGE_SIZE : 0),
      competitiveOffset: String(reset ? 0 : current.competitive.offset),
      casualOffset: String(reset ? 0 : current.casual.offset),
    });

    try {
      const data = await requestJson(`/my-ratings?${params.toString()}`, { token });
      setState((prev) => ({
        status: "ready",
        competitive: appendKind === "casual" ? { ...prev.competitive, loading: false } : mergeKind(prev.competitive, data.competitive, !reset),
        casual: appendKind === "competitive" ? { ...prev.casual, loading: false } : mergeKind(prev.casual, data.casual, !reset),
      }));
    } catch {
      setState((prev) => ({ ...prev, status: "error", competitive: { ...prev.competitive, loading: false }, casual: { ...prev.casual, loading: false } }));
    }
  }, [token]);

  React.useEffect(() => {
    void load();
  }, [load]);

  return { state, loadMore: (kind) => load({ appendKind: kind }) };
}

function RatingRoundRow({ round, kind }) {
  const title = `${round.place != null ? `#${round.place} - ` : ""}${round.label || (kind === "competitive" ? "Competitive round" : "Casual round")}`;
  return h(React.Fragment, null, [
    h("div", { className: "club-rating-row", key: "row" }, [
      h("div", { key: "main" }, [
        h("div", { className: "club-rating-title", key: "title" }, title),
        roundMeta(round) ? h("div", { className: "club-rating-meta", key: "meta" }, roundMeta(round)) : null,
      ]),
      h("div", { className: "club-rating-score", key: "score" }, [
        h("div", { className: "club-rating-score-main", key: "rating" }, ratingValue(round.rating)),
        h("div", { className: "club-rating-score-sub", key: "source" }, round.rating == null ? "Unrated" : round.rating_source === "estimated" ? "Est." : "Rating"),
      ]),
    ]),
    h("div", { className: "club-rating-export", key: "export" },
      h(UDiscExportDetails, { courseId: round.udisc_course_id, scorecard: round.scorecard }),
    ),
  ]);
}

function RatingPanel({ kind, title, group, onLoadMore }) {
  const empty = kind === "competitive" ? "No finalized competitive rounds yet." : "No finalized casual rounds yet.";
  return h("section", { className: "club-rating-panel", "aria-labelledby": `${kind}ReactRatingTitle` }, [
    h("div", { className: "club-rating-head", key: "head" }, [
      h("div", { key: "title" }, [
        h("div", { className: "club-rating-label", id: `${kind}ReactRatingTitle`, key: "label" }, title),
        h("div", { className: "club-rating-count", key: "count" }, `${group.ratedShown} rated ${plural(group.ratedShown, "round", "rounds")} / ${group.totalShown} shown`),
      ]),
      h("div", { className: "club-rating-live", key: "live" }, [
        h("div", { className: "club-rating-number", key: "number" }, ratingValue(group.liveRating)),
        h("div", { className: "club-rating-live-label", key: "label" }, "Live"),
      ]),
    ]),
    h("div", { className: "club-rating-list", key: "list" }, group.rounds.length
      ? group.rounds.map((round, index) => h(RatingRoundRow, { round, kind, key: `${kind}-${round.id || index}` }))
      : h("div", { className: "club-rating-empty" }, empty)),
    group.hasMore || group.loading
      ? h("div", { className: "club-rating-actions", key: "actions" }, h(
        "button",
        { type: "button", className: "club-rating-load-btn", disabled: group.loading, onClick: onLoadMore },
        group.loading ? "Loading..." : `Load more ${kind} rounds`,
      ))
      : null,
  ]);
}

export function ClubRatings({ token }) {
  const { state, loadMore } = useClubRatings(token);
  if (!token || state.status === "error") return null;

  return h("div", { className: "club-ratings react-club-ratings", "data-react-club-ratings": state.status }, [
    h("h4", { className: "dash-subtitle", key: "title" }, "GVDG Round Ratings"),
    h("div", { className: "club-rating-grid", key: "grid" }, KINDS.map((kind) => h(RatingPanel, {
      kind,
      title: kind === "competitive" ? "Competitive" : "Casual",
      group: state[kind],
      onLoadMore: () => loadMore(kind),
      key: kind,
    }))),
  ]);
}
