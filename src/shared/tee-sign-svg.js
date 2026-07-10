import React from "react";

import { teeSignModel } from "./tee-sign-model.js";

const h = React.createElement;
const SVG_WIDTH = 320;
const ROW_HEIGHT = 30;
const HEAD_HEIGHT = 96;
const UNKNOWN_HOLE = "\u2014";
const UNKNOWN_PAR = "\u2013";

export function TeeSignSvg({ className = "tee-sign", courseName = "", hole = null, layouts = [] }) {
  const model = teeSignModel({ courseName, hole, layouts });
  const height = HEAD_HEIGHT + Math.max(1, model.layouts.length) * ROW_HEIGHT + 16;
  const holeText = model.hole == null ? UNKNOWN_HOLE : String(model.hole);

  return h("svg", {
    "aria-label": `Tee sign for hole ${holeText}`,
    className,
    height,
    role: "img",
    viewBox: `0 0 ${SVG_WIDTH} ${height}`,
    width: SVG_WIDTH,
  }, [
    h("rect", {
      className: "tee-sign-bg",
      height: height - 2,
      key: "bg",
      rx: 16,
      width: SVG_WIDTH - 2,
      x: 1,
      y: 1,
    }),
    h("text", { className: "tee-sign-hole", key: "hole", x: 16, y: 58 }, holeText),
    h("text", {
      className: "tee-sign-course",
      key: "course",
      textAnchor: "end",
      x: SVG_WIDTH - 16,
      y: 40,
    }, model.courseName),
    h("line", {
      className: "tee-sign-rule",
      key: "rule",
      x1: 16,
      x2: SVG_WIDTH - 16,
      y1: HEAD_HEIGHT - 14,
      y2: HEAD_HEIGHT - 14,
    }),
    ...model.layouts.map((row, index) => {
      const y = HEAD_HEIGHT + index * ROW_HEIGHT;
      const labelX = row.color ? 40 : 16;
      return h("g", { className: "tee-sign-row", key: `${row.label}|${index}` }, [
        row.color
          ? h("rect", {
            fill: row.color,
            height: 16,
            key: "swatch",
            rx: 3,
            stroke: "currentColor",
            strokeOpacity: 0.3,
            width: 16,
            x: 16,
            y: y + 6,
          })
          : null,
        h("text", { className: "tee-sign-label", key: "label", x: labelX, y: y + 19 }, row.label),
        h("text", {
          className: "tee-sign-par",
          key: "par",
          textAnchor: "end",
          x: SVG_WIDTH - 96,
          y: y + 19,
        }, `Par ${row.par == null ? UNKNOWN_PAR : row.par}`),
        h("text", {
          className: "tee-sign-dist",
          key: "dist",
          textAnchor: "end",
          x: SVG_WIDTH - 16,
          y: y + 19,
        }, row.distance_ft == null ? "" : `${row.distance_ft} ft`),
      ]);
    }),
  ]);
}
