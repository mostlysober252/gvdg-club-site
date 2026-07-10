import React from "react";

import { adminConfirm } from "./admin-dialogs.js";

const h = React.createElement;

const REVIEW_STATUSES = [
  ["candidate", "Awaiting review"],
  ["official", "Official"],
  ["rejected", "Rejected"],
];

const EMPTY_STATE = {
  authBase: "",
  courses: [],
  layoutsByCourse: {},
  queueStatus: "candidate",
  signs: [],
  status: "loading",
};

let teeSignReviewControlsStateSnapshot = {};

function objectOrEmpty(value) {
  return value && typeof value === "object" ? value : {};
}

function normalizeText(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function normalizeStatus(value) {
  return REVIEW_STATUSES.some(([status]) => status === value) ? value : "candidate";
}

function currentControlsState() {
  const state = teeSignReviewControlsStateSnapshot;
  return state && typeof state === "object" ? state : {};
}

function setCurrentControlsState(state) {
  teeSignReviewControlsStateSnapshot = state;
}

function dispatchRequest(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function normalizeSign(sign, index) {
  const source = objectOrEmpty(sign);
  const id = source.id == null ? "" : String(source.id);
  return {
    courseId: source.course_id == null ? "" : String(source.course_id),
    createdAt: normalizeText(source.created_at),
    extractSource: normalizeText(source.extract_source),
    holeNumber: source.hole_number == null ? "?" : String(source.hole_number),
    id,
    key: id || `tee-sign-${index}`,
    source,
    status: normalizeText(source.status, "candidate") || "candidate",
    suggestedRows: Array.isArray(source.suggestedRows) ? source.suggestedRows : [],
    uploadedBy: normalizeText(source.uploaded_by),
  };
}

function normalizeState(state) {
  const source = objectOrEmpty(state);
  return {
    authBase: normalizeText(source.authBase),
    courses: Array.isArray(source.courses) ? source.courses : [],
    layoutsByCourse: objectOrEmpty(source.layoutsByCourse),
    queueStatus: normalizeStatus(source.queueStatus),
    signs: Array.isArray(source.signs) ? source.signs.map(normalizeSign) : [],
    status: source.status === "loading" || source.status === "error" ? source.status : "ready",
  };
}

function courseName(courses, courseId) {
  const course = courses.find((row) => String(objectOrEmpty(row).id) === String(courseId));
  return normalizeText(objectOrEmpty(course).name, courseId ? `Course #${courseId}` : "Course");
}

function layoutsFor(state, courseId) {
  const layouts = state.layoutsByCourse[String(courseId)];
  return Array.isArray(layouts) ? layouts : [];
}

function rowFromSeed(seed, index) {
  const source = objectOrEmpty(seed);
  const hasLayout = source.layoutId != null;
  return {
    color: normalizeText(source.color),
    distanceFt: source.distance_ft == null ? "" : String(source.distance_ft),
    key: `${index}-${source.layoutId ?? source.label ?? source.suggestedLayoutName ?? "new"}`,
    layoutId: hasLayout ? String(source.layoutId) : "__new__",
    newLayoutName: hasLayout ? "" : normalizeText(source.suggestedLayoutName || source.label, "Main") || "Main",
    par: source.par == null ? "3" : String(source.par),
    target: normalizeText(source.target),
    tee: normalizeText(source.tee),
  };
}

function defaultRows(sign) {
  const seeds = sign.suggestedRows.length ? sign.suggestedRows : [{ suggestedLayoutName: "Main", par: 3 }];
  return seeds.map(rowFromSeed);
}

function rowsPayload(rows) {
  return rows.map((row) => {
    const par = parseInt(row.par, 10);
    const dist = parseInt(row.distanceFt, 10);
    if (!(par >= 1 && par <= 15)) return null;
    const body = {
      color: row.color.trim() || null,
      distance_ft: Number.isFinite(dist) && dist > 0 ? dist : null,
      par,
      target: row.target.trim() || null,
      tee: row.tee.trim() || null,
    };
    if (row.layoutId && row.layoutId !== "__new__") body.layoutId = Number(row.layoutId);
    else body.newLayoutName = row.newLayoutName.trim() || "Main";
    return body;
  }).filter(Boolean);
}

function TeeSignPhoto({ authBase, sign }) {
  const [src, setSrc] = React.useState("");

  React.useEffect(() => {
    let alive = true;
    let objectUrl = "";
    setSrc("");
    if (!authBase || !sign.id) return undefined;
    if (sign.status === "official") {
      setSrc(`${authBase}/tee-signs/${encodeURIComponent(sign.id)}/image`);
      return undefined;
    }
    if (sign.status !== "candidate") return undefined;
    const token = sessionStorage.getItem("gvdg_member_token");
    fetch(`${authBase}/tee-signs/${encodeURIComponent(sign.id)}/image`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }).then((response) => response.ok ? response.blob() : null)
      .then((blob) => {
        if (!blob || !alive) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      }).catch(() => {});
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [authBase, sign.id, sign.status]);

  return h("img", {
    alt: `Tee sign for hole ${sign.holeNumber}`,
    className: "ts-review-photo",
    loading: "lazy",
    src: src || undefined,
  });
}

function TeeSignReviewRow({ layouts, onChange, onRemove, row }) {
  const newLayoutDisabled = row.layoutId !== "__new__";
  const field = (name, label, control) => h("div", { key: name }, [
    h("label", { htmlFor: `ts-${name}-${row.key}`, key: "label" }, label),
    control,
  ]);
  const update = (patch) => onChange({ ...row, ...patch });

  return h("div", { className: "ts-review-row" }, [
    field("layout", "Layout", h("select", {
      className: "ts-layout",
      id: `ts-layout-${row.key}`,
      onChange: (event) => update({ layoutId: event.target.value }),
      value: row.layoutId,
    }, [
      ...layouts.map((layout) => h("option", { key: String(layout.id), value: String(layout.id) }, normalizeText(layout.name, `Layout #${layout.id}`))),
      h("option", { key: "__new__", value: "__new__" }, "+ New layout"),
    ])),
    field("new-layout", "New name", h("input", { className: "ts-new-layout", disabled: newLayoutDisabled, id: `ts-new-layout-${row.key}`, maxLength: 80, onChange: (event) => update({ newLayoutName: event.target.value }), placeholder: "Layout name", value: row.newLayoutName })),
    field("par", "Par", h("input", { className: "ts-par", id: `ts-par-${row.key}`, max: "15", min: "1", onChange: (event) => update({ par: event.target.value }), type: "number", value: row.par })),
    field("distance", "Feet", h("input", { className: "ts-distance", id: `ts-distance-${row.key}`, min: "0", onChange: (event) => update({ distanceFt: event.target.value }), placeholder: "ft", type: "number", value: row.distanceFt })),
    field("tee", "Tee", h("input", { className: "ts-tee", id: `ts-tee-${row.key}`, maxLength: 80, onChange: (event) => update({ tee: event.target.value }), placeholder: "Tee", value: row.tee })),
    field("target", "Target", h("input", { className: "ts-target", id: `ts-target-${row.key}`, maxLength: 80, onChange: (event) => update({ target: event.target.value }), placeholder: "Target", value: row.target })),
    field("color", "Color", h("input", { className: "ts-color", id: `ts-color-${row.key}`, maxLength: 24, onChange: (event) => update({ color: event.target.value }), placeholder: "Color", value: row.color })),
    h("button", { className: "admin-btn danger", onClick: onRemove, type: "button" }, "Remove"),
  ]);
}

function TeeSignReviewCard({ state, sign }) {
  const [rows, setRows] = React.useState(() => defaultRows(sign));
  const [pending, setPending] = React.useState("");
  const requestCounter = React.useRef(0);
  const layouts = layoutsFor(state, sign.courseId);

  React.useEffect(() => {
    setRows(defaultRows(sign));
    setPending("");
  }, [sign.key, sign.suggestedRows]);

  React.useEffect(() => {
    function update(event) {
      if (event.detail?.requestId === pending) setPending("");
    }
    if (!pending) return undefined;
    window.addEventListener("gvdg:admin-tee-sign-review-action-result", update);
    return () => window.removeEventListener("gvdg:admin-tee-sign-review-action-result", update);
  }, [pending]);

  function request(name, extra = {}) {
    const requestId = `${sign.key}-${requestCounter.current += 1}`;
    setPending(requestId);
    dispatchRequest(name, { requestId, sign: sign.source, ...extra });
  }

  function updateRow(index, row) {
    setRows((current) => current.map((candidate, i) => i === index ? row : candidate));
  }

  async function rejectSign() {
    const confirmed = await adminConfirm({
      title: "Reject tee sign",
      message: `Reject tee sign for hole ${sign.holeNumber}? The stored image will be removed.`,
      confirmText: "Reject",
      danger: true,
    });
    if (confirmed) request("gvdg:admin-tee-sign-review-reject-request");
  }

  async function deleteSign() {
    const confirmed = await adminConfirm({
      title: "Delete tee sign",
      message: `Delete tee sign #${sign.id}?`,
      confirmText: "Delete",
      danger: true,
    });
    if (confirmed) request("gvdg:admin-tee-sign-review-delete-request");
  }

  const meta = [
    sign.uploadedBy ? `Uploaded by ${sign.uploadedBy}` : "",
    sign.createdAt,
    sign.extractSource ? `Vision: ${sign.extractSource}` : "",
  ].filter(Boolean).join(" - ") || "No metadata";
  const busy = Boolean(pending);

  return h("div", { className: "ts-review-card" }, [
    h("div", { className: "ts-review-media", key: "media" }, h(TeeSignPhoto, { authBase: state.authBase, sign })),
    h("div", { className: "ts-review-body", key: "body" }, [
      h("div", { className: "ts-review-head", key: "head" }, [
        h("div", { className: "ts-review-title", key: "title" }, `${courseName(state.courses, sign.courseId)} - Hole ${sign.holeNumber}`),
        h("span", { className: `admin-badge ${sign.status}`, key: "status" }, sign.status),
      ]),
      h("div", { className: "ts-review-meta", key: "meta" }, meta),
      h("div", { className: "ts-review-rows", key: "rows" }, rows.map((row, index) => h(TeeSignReviewRow, {
        key: row.key,
        layouts,
        onChange: (next) => updateRow(index, next),
        onRemove: () => setRows((current) => current.filter((_, i) => i !== index)),
        row,
      }))),
      h("div", { className: "ts-review-actions", key: "actions" }, [
        h("button", { className: "admin-btn secondary", disabled: busy, key: "add", onClick: () => setRows((current) => [...current, rowFromSeed({ suggestedLayoutName: "Main", par: 3 }, current.length)]), type: "button" }, "+ Row"),
        sign.status === "rejected" ? null : h("button", { className: "admin-btn", disabled: busy, key: "approve", onClick: () => request("gvdg:admin-tee-sign-review-approve-request", { rows: rowsPayload(rows) }), type: "button" }, pending ? "Working..." : sign.status === "official" ? "Apply rows" : "Approve"),
        sign.status === "rejected" ? null : h("button", { className: "admin-btn secondary", disabled: busy, key: "extract", onClick: () => request("gvdg:admin-tee-sign-review-extract-request"), type: "button" }, "Re-run vision"),
        sign.status === "rejected" ? null : h("button", { className: "admin-btn danger", disabled: busy, key: "reject", onClick: rejectSign, type: "button" }, "Reject"),
        h("button", { className: "admin-btn danger", disabled: busy, key: "delete", onClick: deleteSign, type: "button" }, "Delete"),
      ]),
    ]),
  ]);
}

export function AdminTeeSignReviewControls() {
  const initial = currentControlsState();
  const [status, setStatus] = React.useState(() => normalizeStatus(initial.status));
  React.useEffect(() => { setCurrentControlsState({ status }); }, [status]);

  function requestLoad(nextStatus) {
    const next = { status: normalizeStatus(nextStatus) };
    setCurrentControlsState(next);
    dispatchRequest("gvdg:admin-tee-sign-review-controls-request", next);
  }

  return h("div", { className: "al-section ts-review-toolbar", "data-react-admin-tee-sign-review-controls": "" }, [
    h("label", { htmlFor: "tsStatusFilter", key: "label" }, "Show"),
    h("select", { id: "tsStatusFilter", key: "select", onChange: (event) => { setStatus(event.target.value); requestLoad(event.target.value); }, value: status }, REVIEW_STATUSES.map(([value, label]) => h("option", { key: value, value }, label))),
    h("button", { className: "admin-btn", id: "tsRefresh", key: "refresh", onClick: () => requestLoad(status), type: "button" }, "Refresh"),
  ]);
}

export function AdminTeeSignReviewList() {
  const [state, setState] = React.useState(() => normalizeState(EMPTY_STATE));
  React.useEffect(() => {
    function update(event) {
      setState(normalizeState(event.detail && typeof event.detail === "object" ? event.detail : EMPTY_STATE));
    }
    window.addEventListener("gvdg:admin-tee-sign-review", update);
    return () => window.removeEventListener("gvdg:admin-tee-sign-review", update);
  }, []);

  if (state.status === "loading") return h("div", { className: "ts-review-list", "data-react-admin-tee-sign-review": "loading", role: "status" }, "Loading...");
  if (state.status === "error") return h("div", { className: "ts-review-empty", "data-react-admin-tee-sign-review": "error", role: "alert" }, "Could not load tee signs.");
  if (!state.signs.length) return h("div", { className: "ts-review-empty", "data-react-admin-tee-sign-review": "empty", role: "status" }, "No tee signs in this queue.");
  return h("div", { className: "ts-review-list", "data-react-admin-tee-sign-review": "ready" }, state.signs.map((sign) => h(TeeSignReviewCard, { key: sign.key, sign, state })));
}
