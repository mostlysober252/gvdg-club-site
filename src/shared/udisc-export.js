import React from "react";
import { ExternalLink } from "lucide-react";

const h = React.createElement;

export function udiscDeepLink(courseId) {
  const id = courseId == null ? "" : String(courseId).trim();
  return /^\d{1,20}$/.test(id) ? `https://app.udisc.com/applink/create-scorecard/${id}` : null;
}

export function parseUdiscScorecard(scorecard) {
  let rows = Array.isArray(scorecard) ? scorecard : null;
  if (!rows && typeof scorecard === "string" && scorecard) {
    try {
      const parsed = JSON.parse(scorecard);
      rows = Array.isArray(parsed) ? parsed : null;
    } catch {
      rows = null;
    }
  }
  if (!Array.isArray(rows)) return [];
  return rows.filter((hole) => hole && typeof hole.strokes === "number" && typeof hole.hole === "number");
}

function toParText(value) {
  if (value === 0) return "E";
  return value > 0 ? `+${value}` : String(value);
}

function scorecardTotal(scorecard) {
  return scorecard.reduce(
    (total, hole) => ({
      holes: total.holes + 1,
      strokes: total.strokes + hole.strokes,
      toPar: total.toPar + hole.strokes - (typeof hole.par === "number" ? hole.par : 0),
    }),
    { holes: 0, strokes: 0, toPar: 0 },
  );
}

function actionIcon() {
  return h(ExternalLink, {
    "aria-hidden": "true",
    focusable: "false",
    size: 15,
    strokeWidth: 2.4,
  });
}

export function UDiscExportDetails(props) {
  const scorecard = parseUdiscScorecard(props.scorecard);
  const link = udiscDeepLink(props.courseId);
  if (!link || !scorecard.length) return null;
  const total = scorecardTotal(scorecard);
  const label = props.label || "Add to UDisc";

  return h("details", { className: "udisc-export" }, [
    h("summary", { key: "summary" }, label),
    h(
      "p",
      { className: "udisc-export-note", key: "note" },
      "UDisc has no round import. Open a scorecard on this course, then enter these scores:",
    ),
    h("div", { className: "udisc-export-strip", key: "strip" }, scorecard.map((hole) =>
      h(
        "span",
        {
          className: "udisc-hole",
          key: hole.hole,
          title: `Hole ${hole.hole}${typeof hole.par === "number" ? ` - par ${hole.par}` : ""}`,
        },
        [
          h("b", { key: "hole" }, `H${hole.hole}`),
          h("span", { key: "score" }, String(hole.strokes)),
        ],
      ),
    )),
    h("p", { className: "udisc-export-total", key: "total" }, `Total ${total.strokes} (${toParText(total.toPar)}) - ${total.holes} holes`),
    h("a", { className: "udisc-export-btn", href: link, key: "link", rel: "noopener noreferrer", target: "_blank" }, [
      "Open in UDisc",
      actionIcon(),
    ]),
  ]);
}
