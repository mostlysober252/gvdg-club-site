import React from "react";

import { TeeSignSvg } from "../shared/tee-sign-svg.js";
import { parseLayoutHoles } from "./scoring-model.js";

const h = React.createElement;

function objectOrEmpty(value) {
  return value && typeof value === "object" ? value : {};
}

function signIdForHole(signs, holeNumber, status) {
  const found = signs.find((sign) => Number(sign?.hole_number) === Number(holeNumber) && sign.status === status);
  return found?.id == null ? "" : String(found.id);
}

function selectedLayout(layouts, layoutId) {
  return layouts.find((layout) => String(layout?.id) === String(layoutId)) || layouts[0] || null;
}

function holeData(layouts, layoutId) {
  const layout = selectedLayout(layouts, layoutId);
  const rows = new Map();
  parseLayoutHoles(layout).forEach((hole) => rows.set(Number(hole?.hole), hole));
  return { layout, rows };
}

function CandidatePhoto({ authBase, signId, token }) {
  const [src, setSrc] = React.useState("");

  React.useEffect(() => {
    let alive = true;
    let objectUrl = "";
    setSrc("");
    if (!authBase || !signId) return undefined;
    fetch(`${authBase}/tee-signs/${encodeURIComponent(signId)}/image`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }).then((response) => response.ok ? response.blob() : null)
      .then((blob) => {
        if (!blob || !alive) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => {});
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [authBase, signId, token]);

  return h("img", {
    alt: "Candidate tee sign",
    className: "ts-strip-photo",
    loading: "lazy",
    src: src || undefined,
  });
}

function OfficialPhoto({ authBase, holeNumber, signId }) {
  return h("img", {
    alt: `Tee sign hole ${holeNumber}`,
    className: "ts-strip-photo",
    loading: "lazy",
    src: `${authBase}/tee-signs/${encodeURIComponent(signId)}/image`,
  });
}

function TeeSignCard({ authBase, candidateId, hole, layout, officialId, row, token }) {
  const holeNumber = hole.hole;
  const distance = hole.overridden && hole.distance_ft != null ? hole.distance_ft : row?.distance_ft ?? null;
  const layoutName = layout?.name || "Layout";
  const color = row?.color || null;

  return h("div", { className: "ts-strip-card" }, [
    officialId ? h(OfficialPhoto, { authBase, holeNumber, key: "official", signId: officialId }) : null,
    !officialId && candidateId ? h(CandidatePhoto, { authBase, key: "candidate", signId: candidateId, token }) : null,
    !officialId && candidateId ? h("span", { className: "ts-unverified", key: "unverified" }, "unverified") : null,
    !officialId && !candidateId ? h("div", { className: "ts-strip-svg", key: "svg" }, h(TeeSignSvg, {
      courseName: "",
      hole: holeNumber,
      layouts: [{ color, distance_ft: distance, label: layoutName, par: hole.par ?? null }],
    })) : null,
    hole.overridden ? h("span", { className: "ts-temp", key: "temp" }, "temporary") : null,
    h("div", { className: "ts-strip-meta", key: "meta" }, [
      h("span", { className: "ts-strip-hole", key: "hole" }, `H${holeNumber}`),
      ` - Par ${hole.par}${distance != null ? ` - ${distance} ft` : ""}`,
    ]),
  ]);
}

export function AdminScoringTeeSigns({ state }) {
  const snap = objectOrEmpty(state.snap);
  const holes = Array.isArray(snap.holes) ? snap.holes : [];
  const teeSignData = objectOrEmpty(state.teeSignData);
  const authBase = state.authBase || teeSignData.authBase || "";
  const event = objectOrEmpty(state.event);
  const layouts = Array.isArray(teeSignData.layouts) ? teeSignData.layouts : [];
  const signs = Array.isArray(teeSignData.teeSigns) ? teeSignData.teeSigns : [];
  const token = teeSignData.token || "";
  const { layout, rows } = holeData(layouts, event.layout_id || event.layoutId || "");

  if (!holes.length || !authBase) {
    return h("div", { className: "al-note", "data-react-admin-scoring-tee-signs": "empty", role: "status" }, "No tee-sign references for this round.");
  }

  return h("div", { className: "ts-strip", "data-react-admin-scoring-tee-signs": "ready" }, holes.map((hole) => {
    const holeNumber = Number(hole?.hole);
    return h(TeeSignCard, {
      authBase,
      candidateId: signIdForHole(signs, holeNumber, "candidate"),
      hole,
      key: holeNumber,
      layout,
      officialId: signIdForHole(signs, holeNumber, "official"),
      row: rows.get(holeNumber) || {},
      token,
    });
  }));
}
