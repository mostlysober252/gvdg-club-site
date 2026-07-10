import React from "react";
import { createRoot } from "react-dom/client";
import { UDiscExportDetails } from "../shared/udisc-export.js";

const h = React.createElement;

function standingName(standing) {
  return standing.name + (standing.members && standing.members.length
    ? " · " + standing.members.join(" / ")
    : (standing.division ? " · " + standing.division : ""));
}

function LeaderboardTable({ isDoubles, isMatchplay, relClass, relText, standings }) {
  if (!standings.length) return h("p", { className: "muted" }, "No scores in yet.");
  const resultHead = isMatchplay ? "Match" : "To par";
  return h("table", { className: "lb" }, [
    h("thead", { key: "head" }, h("tr", null, [
      h("th", { key: "rank" }, ""),
      h("th", { key: "name" }, isDoubles ? "Pair" : "Player"),
      h("th", { key: "thru" }, "Thru"),
      h("th", { key: "result" }, resultHead),
    ])),
    h("tbody", { key: "body" }, standings.map((standing, index) =>
      h("tr", { key: standing.targetId || standing.name || index }, [
        h("td", { className: "pos", key: "pos" }, String(index + 1)),
        h("td", { className: "name", key: "name" }, standingName(standing)),
        h("td", { key: "thru" }, String(standing.thru || 0)),
        isMatchplay
          ? h("td", { key: "match" }, standing.match && standing.match.status ? standing.match.status : "AS")
          : h("td", { className: "tp " + relClass(standing.toPar || 0), key: "toPar" }, standing.thru ? relText(standing.toPar || 0) : "E"),
      ]),
    )),
  ]);
}

function FinalizePanel({ blockers, mode, onFinalize, status }) {
  if (status === "final") {
    return h("div", { className: "finalize-card ready" },
      h("p", { className: "finalize-head" }, "Round finished - scores are locked."),
    );
  }

  const ready = blockers.ready;
  return h("div", { className: "finalize-card " + (ready ? "ready" : "blocked") }, [
    h("p", { className: "finalize-head", key: "head" }, ready ? "Your card agrees - ready to finalize" : "Your card is not ready yet"),
    ...blockers.lines.map((line, index) => h("p", { className: "muted finalize-line", key: "line-" + index }, line)),
    mode === "round"
      ? h("button", { className: "btn finish-round-btn", disabled: !ready, key: "finish", type: "button", onClick: onFinalize }, "Finish round")
      : null,
    mode === "round" && !ready
      ? h("p", { className: "muted finish-round-hint", key: "hint" }, "Every member on the card must enter matching scores for every hole before the round can be finished.")
      : null,
  ]);
}

function LeaderboardSheet(props) {
  return h(
    "div",
    {
      className: "overlay",
      onClick: (event) => {
        if (event.target === event.currentTarget) props.onClose();
      },
    },
    h("div", { className: "sheet" }, [
      h("div", { className: "grab", key: "grab" }),
      h("h2", { className: "section", key: "title" }, "Live Leaderboard"),
      h(LeaderboardTable, {
        isDoubles: props.isDoubles,
        isMatchplay: props.isMatchplay,
        key: "table",
        relClass: props.relClass,
        relText: props.relText,
        standings: props.standings,
      }),
      props.exportData ? h("div", { className: "udisc-export-section", key: "udisc" },
        h(UDiscExportDetails, { courseId: props.exportData.courseId, scorecard: props.exportData.scorecard }),
      ) : null,
      h(FinalizePanel, {
        blockers: props.blockers,
        key: "finalize",
        mode: props.mode,
        onFinalize: props.onFinalize,
        status: props.status,
      }),
      h("button", { className: "btn secondary sheet-close", key: "close", type: "button", onClick: props.onClose }, "Close"),
    ]),
  );
}

export function createLeaderboardSheetRenderer() {
  let host = null;
  let root = null;

  function close() {
    if (root) root.render(null);
  }

  function render(props) {
    if (!host) {
      host = document.getElementById("scoreReactLeaderboardSheetApp");
      if (!host) throw new Error("Missing scoreReactLeaderboardSheetApp mount element");
    }
    if (!root) root = createRoot(host);
    root.render(h(LeaderboardSheet, props));
  }

  return { close, render };
}
