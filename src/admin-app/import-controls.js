import React from "react";

const h = React.createElement;

function dispatchRequest(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function resultDetail(event) {
  return event.detail && typeof event.detail === "object" ? event.detail : {};
}

export function AdminImportControls() {
  const [csvText, setCsvText] = React.useState("");
  const [busyDgs, setBusyDgs] = React.useState(false);
  const [busyCsv, setBusyCsv] = React.useState(false);
  const dgsRequest = React.useRef("");
  const csvRequest = React.useRef("");
  const requestCounter = React.useRef(0);

  React.useEffect(() => {
    function updateDgs(event) {
      const detail = resultDetail(event);
      if (!detail.requestId || detail.requestId !== dgsRequest.current) return;
      setBusyDgs(false);
      dgsRequest.current = "";
    }
    function updateCsv(event) {
      const detail = resultDetail(event);
      if (!detail.requestId || detail.requestId !== csvRequest.current) return;
      setBusyCsv(false);
      csvRequest.current = "";
    }
    window.addEventListener("gvdg:admin-dgs-import-result", updateDgs);
    window.addEventListener("gvdg:admin-csv-import-result", updateCsv);
    return () => {
      window.removeEventListener("gvdg:admin-dgs-import-result", updateDgs);
      window.removeEventListener("gvdg:admin-csv-import-result", updateCsv);
    };
  }, []);

  function requestDgsImport() {
    const requestId = `dgs-import-${requestCounter.current += 1}`;
    dgsRequest.current = requestId;
    setBusyDgs(true);
    dispatchRequest("gvdg:admin-dgs-import-request", { requestId });
  }

  function requestCsvImport() {
    const requestId = `csv-import-${requestCounter.current += 1}`;
    const valid = Boolean(csvText.trim());
    csvRequest.current = requestId;
    setBusyCsv(true);
    dispatchRequest("gvdg:admin-csv-import-request", { csv: csvText, requestId, valid });
    if (!valid) setBusyCsv(false);
  }

  return h("div", { "data-react-admin-import-controls": "ready" }, [
    h("p", { className: "dash-note", key: "note" }, [
      "Import candidates appear below; click ",
      h("em", { key: "em" }, "Create"),
      " to add an event.",
    ]),
    h("button", {
      className: "admin-btn secondary",
      disabled: busyDgs,
      id: "dgsImportBtn",
      key: "dgs",
      onClick: requestDgsImport,
      type: "button",
    }, busyDgs ? "Importing..." : "Import from DiscGolfScene feed"),
    h("div", { className: "admin-import-csv", key: "csv" }, [
      h("label", { htmlFor: "csvImportText", key: "label" }, "Paste CSV (header: name,date,type,format)"),
      h("textarea", {
        id: "csvImportText",
        key: "textarea",
        onChange: (event) => setCsvText(event.target.value),
        placeholder: "name,date,type,format\nFall Open,2026-09-12,tournament,stroke",
        rows: 4,
        value: csvText,
      }),
      h("button", {
        className: "admin-btn secondary",
        disabled: busyCsv,
        id: "csvImportBtn",
        key: "button",
        onClick: requestCsvImport,
        type: "button",
      }, busyCsv ? "Previewing..." : "Preview CSV"),
    ]),
  ]);
}
