import React from "react";

import { useDataArchiveDestinationsState } from "./data-archive-destinations-store.js";

const h = React.createElement;

const DEFAULT_FORM = {
  destinationId: "",
  dryRun: false,
  from: "",
  includeCasualRounds: true,
  includeEventConfig: true,
  includeEventPlayers: true,
  includeResults: true,
  test: false,
  to: "",
};

function dispatchRequest(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function exportPayload(form) {
  const body = {
    dry_run: form.dryRun,
    from: form.from || null,
    includeCasualRounds: form.includeCasualRounds,
    includeEventConfig: form.includeEventConfig,
    includeEventPlayers: form.includeEventPlayers,
    includeResults: form.includeResults,
    test: form.test,
    to: form.to || null,
  };
  if (form.destinationId) body.endpoint_id = Number(form.destinationId);
  return body;
}

function checkboxField({ checked, id, label, onChange }) {
  return h("label", { className: "register-addon", htmlFor: id }, [
    h("input", { checked, id, key: "input", onChange, type: "checkbox" }),
    ` ${label}`,
  ]);
}

export function AdminDataArchiveExportControls() {
  const destinationsState = useDataArchiveDestinationsState();
  const [form, setForm] = React.useState(DEFAULT_FORM);
  const [busy, setBusy] = React.useState(false);
  const requestCounter = React.useRef(0);
  const currentRequest = React.useRef("");
  const userSelectedDestination = React.useRef(false);
  const destinations = destinationsState.destinations;

  React.useEffect(() => {
    setForm((current) => {
      if (userSelectedDestination.current && current.destinationId && destinations.some((destination) => destination.id === current.destinationId)) {
        return current;
      }
      userSelectedDestination.current = false;
      const active = destinations.find((destination) => destination.isActive);
      const destinationId = active ? active.id : "";
      return current.destinationId === destinationId ? current : { ...current, destinationId };
    });
  }, [destinations]);

  React.useEffect(() => {
    function updateRun(event) {
      const detail = event.detail && typeof event.detail === "object" ? event.detail : {};
      if (!detail.requestId || detail.requestId !== currentRequest.current) return;
      currentRequest.current = "";
      setBusy(false);
    }
    window.addEventListener("gvdg:admin-data-archive-export-run-result", updateRun);
    return () => window.removeEventListener("gvdg:admin-data-archive-export-run-result", updateRun);
  }, []);

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateDestination(value) {
    userSelectedDestination.current = true;
    updateField("destinationId", value);
  }

  function submit() {
    const requestId = `data-archive-export-run-${requestCounter.current += 1}`;
    currentRequest.current = requestId;
    setBusy(true);
    dispatchRequest("gvdg:admin-data-archive-export-run-request", { body: exportPayload(form), requestId });
  }

  return h("div", {
    className: "admin-form",
    "data-react-admin-data-archive-export-controls": "ready",
  }, [
    h("div", { key: "from" }, [
      h("label", { htmlFor: "dxExportFrom", key: "label" }, "From date"),
      h("input", {
        id: "dxExportFrom",
        key: "input",
        onChange: (event) => updateField("from", event.target.value),
        type: "date",
        value: form.from,
      }),
    ]),
    h("div", { key: "to" }, [
      h("label", { htmlFor: "dxExportTo", key: "label" }, "To date"),
      h("input", {
        id: "dxExportTo",
        key: "input",
        onChange: (event) => updateField("to", event.target.value),
        type: "date",
        value: form.to,
      }),
    ]),
    h("div", { key: "destination" }, [
      h("label", { htmlFor: "dxExportDestination", key: "label" }, "Destination"),
      h("select", {
        id: "dxExportDestination",
        key: "select",
        onChange: (event) => updateDestination(event.target.value),
        value: form.destinationId,
      }, [
        h("option", { key: "download", value: "" }, "Download only (no endpoint)"),
        ...destinations.map((destination) => h("option", { key: destination.id, value: destination.id },
          `${destination.label} (${destination.endpointUrl})${destination.isActive ? " (active)" : ""}`)),
      ]),
    ]),
    h("div", { className: "al-row", key: "includes", style: { marginTop: "0.6rem" } }, [
      checkboxField({
        checked: form.includeEventPlayers,
        id: "dxIncludeEventPlayers",
        label: "Include event players",
        onChange: (event) => updateField("includeEventPlayers", event.target.checked),
      }),
      checkboxField({
        checked: form.includeResults,
        id: "dxIncludeResults",
        label: "Include results",
        onChange: (event) => updateField("includeResults", event.target.checked),
      }),
      checkboxField({
        checked: form.includeCasualRounds,
        id: "dxIncludeCasualRounds",
        label: "Include casual rounds",
        onChange: (event) => updateField("includeCasualRounds", event.target.checked),
      }),
      checkboxField({
        checked: form.includeEventConfig,
        id: "dxIncludeEventConfig",
        label: "Include event config",
        onChange: (event) => updateField("includeEventConfig", event.target.checked),
      }),
    ]),
    h("div", { className: "al-row", key: "modes", style: { marginTop: "0.4rem" } }, [
      checkboxField({
        checked: form.dryRun,
        id: "dxDryRun",
        label: "Dry run (download JSON)",
        onChange: (event) => updateField("dryRun", event.target.checked),
      }),
      checkboxField({
        checked: form.test,
        id: "dxTest",
        label: "Test destination ping",
        onChange: (event) => updateField("test", event.target.checked),
      }),
    ]),
    h("div", { className: "admin-form-actions", key: "actions", style: { marginTop: "0.6rem" } }, [
      h("button", {
        className: "admin-btn",
        disabled: busy,
        id: "dxRunExport",
        onClick: submit,
        type: "button",
      }, busy ? "Running..." : "Run export"),
    ]),
  ]);
}
