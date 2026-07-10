import React from "react";

import { estimateHole, layoutPayload, newHoleRow, normalizePosition } from "./layouts-model.js";

const h = React.createElement;

function positionsFor(pool, kind, current) {
  const rows = pool.filter((position) => position.kind === kind);
  if (!current?.label || rows.some((position) => position.label === current.label)) return rows;
  return [...rows, { id: `saved-${kind}-${current.label}`, kind, label: `${current.label} (saved)`, lat: current.lat, lng: current.lng, valueLabel: current.label }];
}

function positionValue(position) {
  return position?.valueLabel || position?.label || "";
}

function findPosition({ current, kind, pool, value }) {
  if (!value) return null;
  const options = positionsFor(pool, kind, current);
  const found = options.find((position) => positionValue(position) === value);
  if (!found) return current?.label === value ? current : null;
  return { label: positionValue(found), lat: found.lat, lng: found.lng };
}

function field({ children, id, label }) {
  return h("div", { className: "admin-layout-field", key: id }, [
    h("label", { htmlFor: id, key: "label" }, label),
    children,
  ]);
}

function PositionSelect({ current, kind, onChange, pool, rowKey }) {
  const options = positionsFor(pool, kind, current);
  const id = `al-${kind}-${rowKey}`;
  return h("select", {
    id,
    onChange: (event) => onChange(findPosition({ current, kind, pool, value: event.target.value })),
    value: current?.label || "",
  }, [
    h("option", { key: "none", value: "" }, "none"),
    ...options.map((position) => h("option", { key: position.id || `${kind}-${positionValue(position)}`, value: positionValue(position) }, position.label)),
  ]);
}

function BuilderRow({ index, onRemove, onUpdate, pool, row }) {
  const estimate = estimateHole(row);
  const rowClass = row.verified ? "al-row-verified" : undefined;
  const update = (patch) => onUpdate({ ...row, ...patch });

  return h("tr", { className: rowClass }, [
    h("td", { key: "number" }, String(index + 1)),
    h("td", { key: "par" }, h("input", {
      className: "al-par",
      max: "15",
      min: "1",
      onChange: (event) => update({ par: event.target.value }),
      type: "number",
      value: row.par,
    })),
    h("td", { className: "al-tee", key: "tee" }, h(PositionSelect, {
      current: row.tee,
      kind: "tee",
      onChange: (tee) => update({ tee }),
      pool,
      rowKey: row.key,
    })),
    h("td", { className: "al-target", key: "target" }, h(PositionSelect, {
      current: row.target,
      kind: "target",
      onChange: (target) => update({ target }),
      pool,
      rowKey: row.key,
    })),
    h("td", { key: "manual" }, h("input", {
      className: "al-manual",
      min: "0",
      onChange: (event) => update({ manualDistance: event.target.value }),
      placeholder: "auto",
      type: "number",
      value: row.manualDistance,
    })),
    h("td", { className: "al-est", key: "estimate" }, [
      row.verified ? h("span", { className: "al-verified", key: "verified" }, "verified") : null,
      h("span", { key: "feet" }, estimate.ft == null ? "none" : `${estimate.ft} ft`),
      estimate.source ? h("span", { className: "src", key: "source" }, ` ${estimate.source}`) : null,
    ]),
    h("td", { key: "remove" }, h("button", { className: "al-poolitem", onClick: onRemove, type: "button" }, "Remove")),
  ]);
}

export function AdminLayoutBuilder({ editingId, name, onNameChange, onReset, onRowsChange, onSave, pending, pool, rows }) {
  const normalizedPool = pool.map(normalizePosition);

  function updateRow(index, row) {
    onRowsChange(rows.map((candidate, i) => i === index ? row : candidate));
  }

  function save() {
    onSave({ id: editingId, name, holes: layoutPayload(rows) });
  }

  return h("div", { className: "al-section", "data-react-admin-layout-builder": "" }, [
    h("h4", { className: "al-h", key: "title" }, "Layout builder"),
    h("p", { className: "al-note", key: "note" }, "Link any tee to any target, set par, and override distance when needed."),
    field({
      id: "alName",
      label: "Layout name",
      children: h("input", {
        id: "alName",
        key: "input",
        maxLength: 60,
        onChange: (event) => onNameChange(event.target.value),
        placeholder: "Main / Safari / Blue",
        value: name,
      }),
    }),
    h("div", { key: "table", style: { overflowX: "auto" } }, h("table", { className: "al-holes" }, [
      h("thead", { key: "head" }, h("tr", null, ["#", "Par", "Tee", "Target", "Manual ft", "Est.", ""].map((label) => h("th", { key: label }, label)))),
      h("tbody", { id: "alHoles", key: "body" }, rows.map((row, index) => h(BuilderRow, {
        index,
        key: row.key,
        onRemove: () => onRowsChange(rows.filter((_, i) => i !== index)),
        onUpdate: (next) => updateRow(index, next),
        pool: normalizedPool,
        row,
      }))),
    ])),
    h("div", { className: "al-row", key: "actions" }, [
      h("button", { className: "admin-btn secondary", id: "alAddHole", key: "add", onClick: () => onRowsChange([...rows, newHoleRow(rows.length)]), type: "button" }, "+ Add hole"),
      h("button", { className: "admin-btn", disabled: pending, id: "alSaveLayout", key: "save", onClick: save, type: "button" }, pending ? "Saving..." : editingId ? "Update layout" : "Save layout"),
      editingId ? h("button", { className: "admin-btn secondary", id: "alResetLayout", key: "reset", onClick: onReset, type: "button" }, "New (clear)") : null,
    ]),
  ]);
}
