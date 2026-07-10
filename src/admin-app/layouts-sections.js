import React from "react";

import { adminConfirm } from "./admin-dialogs.js";
import { normalizeLayout, normalizePosition, parseNumber } from "./layouts-model.js";

const h = React.createElement;

function dispatchRequest(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function nextRequestId(prefix, ref) {
  ref.current += 1;
  return `${prefix}-${ref.current}`;
}

export function AdminLayoutUdiscImport({ courseId, onApply }) {
  const [url, setUrl] = React.useState("");
  const [result, setResult] = React.useState({ message: "", layouts: [] });
  const [busy, setBusy] = React.useState(false);
  const requestCounter = React.useRef(0);
  const currentRequest = React.useRef({ id: "", layout: null, type: "" });

  React.useEffect(() => {
    setResult({ message: "", layouts: [] });
    setBusy(false);
    currentRequest.current = { id: "", layout: null, type: "" };
  }, [courseId]);

  React.useEffect(() => {
    function update(event) {
      const detail = event.detail && typeof event.detail === "object" ? event.detail : {};
      if (!detail.requestId || detail.requestId !== currentRequest.current.id) return;
      setBusy(false);
      if (currentRequest.current.type === "fetch") {
        setResult({ message: detail.message || "", layouts: Array.isArray(detail.layouts) ? detail.layouts : [] });
      }
      if (currentRequest.current.type === "apply" && detail.ok === true) {
        onApply(detail.layout || currentRequest.current.layout);
      }
    }
    window.addEventListener("gvdg:admin-course-layouts-action-result", update);
    return () => window.removeEventListener("gvdg:admin-course-layouts-action-result", update);
  }, [onApply]);

  function fetchLayouts() {
    const requestId = nextRequestId("layout-udisc-fetch", requestCounter);
    currentRequest.current = { id: requestId, layout: null, type: "fetch" };
    setBusy(true);
    dispatchRequest("gvdg:admin-course-layout-udisc-fetch-request", { courseId, requestId, url: url.trim() });
  }

  function applyLayout(layout) {
    const requestId = nextRequestId("layout-udisc-apply", requestCounter);
    currentRequest.current = { id: requestId, layout, type: "apply" };
    setBusy(true);
    dispatchRequest("gvdg:admin-course-layout-udisc-apply-request", { courseId, layout, requestId });
  }

  return h("div", { className: "al-section", "data-react-admin-layout-udisc": "" }, [
    h("h4", { className: "al-h", key: "title" }, [
      "Import layout from UDisc ",
      h("span", { className: "al-note", key: "note" }, "(best effort - review before saving)"),
    ]),
    h("div", { className: "al-row", key: "controls" }, [
      h("input", {
        id: "alUdiscUrl",
        key: "url",
        maxLength: 1000,
        onChange: (event) => setUrl(event.target.value),
        placeholder: "https://udisc.com/courses/...",
        type: "url",
        value: url,
      }),
      h("button", { className: "admin-btn secondary", disabled: busy, id: "alUdiscBtn", key: "fetch", onClick: fetchLayouts, type: "button" }, busy ? "Working..." : "Fetch"),
    ]),
    h("div", { className: "al-note", id: "alUdiscResult", key: "result", role: result.message ? "status" : undefined }, [
      result.message ? h("div", { key: "message" }, result.message) : null,
      ...result.layouts.map((layout, index) => {
        const holes = Array.isArray(layout.holes) ? layout.holes : [];
        const totalPar = holes.reduce((sum, hole) => sum + (Number(hole?.par) || 0), 0);
        const label = `${layout.name || "Layout"} - ${holes.length} holes, par ${totalPar}`;
        return h("div", { className: "admin-evrow", key: `${label}-${index}` }, [
          h("span", { className: "ev-name", key: "label" }, label),
          h("button", { className: "admin-btn secondary", disabled: busy, key: "apply", onClick: () => applyLayout(layout), type: "button" }, "Apply"),
        ]);
      }),
    ]),
  ]);
}

export function AdminLayoutPositionPool({ courseId, pool }) {
  const [form, setForm] = React.useState({ kind: "tee", label: "", lat: "", lng: "" });
  const [busy, setBusy] = React.useState(false);
  const requestCounter = React.useRef(0);
  const currentRequest = React.useRef("");
  const positions = pool.map(normalizePosition);

  React.useEffect(() => {
    function update(event) {
      const detail = event.detail && typeof event.detail === "object" ? event.detail : {};
      if (!detail.requestId || detail.requestId !== currentRequest.current) return;
      setBusy(false);
      if (detail.ok === true) setForm({ kind: "tee", label: "", lat: "", lng: "" });
    }
    window.addEventListener("gvdg:admin-course-layouts-action-result", update);
    return () => window.removeEventListener("gvdg:admin-course-layouts-action-result", update);
  }, []);

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function addPosition() {
    const requestId = nextRequestId("layout-position-add", requestCounter);
    currentRequest.current = requestId;
    setBusy(true);
    dispatchRequest("gvdg:admin-course-layout-position-add-request", {
      body: { kind: form.kind, label: form.label.trim(), lat: parseNumber(form.lat), lng: parseNumber(form.lng) },
      courseId,
      requestId,
    });
  }

  async function deletePosition(position) {
    const confirmed = await adminConfirm({
      title: "Delete tee or target",
      message: "Delete this tee/target position?",
      confirmText: "Delete",
      danger: true,
    });
    if (!confirmed) return;
    dispatchRequest("gvdg:admin-course-layout-position-delete-request", { courseId, position: position.source });
  }

  return h("div", { className: "al-section", "data-react-admin-layout-pool": "" }, [
    h("h4", { className: "al-h", key: "title" }, [
      "Tee and target pool ",
      h("span", { className: "al-note", key: "note" }, "(Safari mode links any of these)"),
    ]),
    h("div", { className: "al-note", id: "alPoolList", key: "pool", role: !positions.length ? "status" : undefined }, positions.length ? positions.map((position) => (
      h("span", { className: "al-poolitem", key: position.id || `${position.kind}-${position.label}` }, [
        `${position.kind}: ${position.label}${position.lat == null ? " (no GPS)" : ""}`,
        h("button", { key: "remove", onClick: () => deletePosition(position), title: "Remove", type: "button" }, "Remove"),
      ])
    )) : "No positions yet - add tees/targets or import from UDisc."),
    h("div", { className: "al-row", key: "form" }, [
      h("select", { id: "alPosKind", key: "kind", onChange: (event) => updateField("kind", event.target.value), value: form.kind }, [
        h("option", { key: "tee", value: "tee" }, "Tee pad"),
        h("option", { key: "target", value: "target" }, "Target"),
      ]),
      h("input", { id: "alPosLabel", key: "label", maxLength: 80, onChange: (event) => updateField("label", event.target.value), placeholder: "Label e.g. Hole 5 (Blue)", value: form.label }),
      h("input", { id: "alPosLat", inputMode: "decimal", key: "lat", onChange: (event) => updateField("lat", event.target.value), placeholder: "lat", size: 8, value: form.lat }),
      h("input", { id: "alPosLng", inputMode: "decimal", key: "lng", onChange: (event) => updateField("lng", event.target.value), placeholder: "lng", size: 8, value: form.lng }),
      h("button", { className: "admin-btn secondary", disabled: busy, id: "alPosAddBtn", key: "add", onClick: addPosition, type: "button" }, busy ? "Adding..." : "Add"),
    ]),
  ]);
}

export function AdminLayoutsList({ layouts, onEdit }) {
  const normalized = layouts.map(normalizeLayout);

  async function deleteLayout(layout) {
    const confirmed = await adminConfirm({
      title: "Delete layout",
      message: `Delete layout "${layout.name}"?`,
      confirmText: "Delete",
      danger: true,
    });
    if (!confirmed) return;
    dispatchRequest("gvdg:admin-course-layout-delete-request", { layout: layout.source });
  }

  return h("div", { className: "al-section", "data-react-admin-layouts-list": "" }, [
    h("h4", { className: "al-h", key: "title" }, "Existing layouts"),
    h("div", { className: "al-note", id: "alLayoutsList", key: "list", role: !normalized.length ? "status" : undefined }, normalized.length ? normalized.map((layout) => {
      const totalPar = layout.totalPar == null ? "?" : layout.totalPar;
      return h("div", { className: "admin-evrow", key: layout.key }, [
        h("span", { className: "ev-name", key: "name" }, `${layout.name} - ${layout.holes.length} holes, par ${totalPar}`),
        h("button", { className: "admin-btn secondary", key: "edit", onClick: () => onEdit(layout), type: "button" }, "Edit"),
        h("button", { className: "admin-btn danger", key: "delete", onClick: () => deleteLayout(layout), type: "button" }, "Delete"),
      ]);
    }) : "None yet."),
  ]);
}
