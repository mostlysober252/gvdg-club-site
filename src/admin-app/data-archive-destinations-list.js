import React from "react";

import { adminConfirm } from "./admin-dialogs.js";
import { useDataArchiveDestinationsState } from "./data-archive-destinations-store.js";

const h = React.createElement;

const EMPTY_EXPORT_RESULT_STATE = { message: "No export run yet.", ok: null };

function objectOrEmpty(value) {
  return value && typeof value === "object" ? value : {};
}

function normalizeText(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function normalizeExportResultState(state) {
  return {
    download: normalizeDownload(state.download),
    message: normalizeText(state.message, EMPTY_EXPORT_RESULT_STATE.message) || EMPTY_EXPORT_RESULT_STATE.message,
    ok: state.ok === true ? true : state.ok === false ? false : null,
  };
}

function normalizeDownload(download) {
  const source = objectOrEmpty(download);
  const hasContent = typeof source.content === "string";
  const hasData = Object.prototype.hasOwnProperty.call(source, "data");
  if (!hasContent && !hasData) return null;
  return {
    content: hasContent ? source.content : "",
    data: hasData ? source.data : null,
    filename: normalizeText(source.filename, "gvdg-archive.json") || "gvdg-archive.json",
    mimeType: normalizeText(source.mimeType, "application/json;charset=utf-8") || "application/json;charset=utf-8",
  };
}

function serializeDownload(download) {
  if (!download) return "";
  if (download.content) return download.content;
  try {
    return JSON.stringify(download.data, null, 2) || "";
  } catch (error) {
    return String(download.data || "");
  }
}

function dispatchRequest(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function DestinationRow({ destination }) {
  async function requestDelete() {
    const confirmed = await adminConfirm({
      title: "Delete archive destination",
      message: `Delete destination "${destination.label}"?`,
      confirmText: "Delete",
      danger: true,
    });
    if (!confirmed) return;
    dispatchRequest("gvdg:admin-data-archive-destination-delete-request", { destination: destination.source });
  }

  const details = [
    destination.endpointUrl,
    destination.authHeader,
    destination.authPrefix,
    destination.hasAuthToken ? "token: set" : "token: not set",
  ].filter(Boolean).join(" - ");

  return h("div", { className: "admin-evrow", "data-admin-data-archive-destination-id": destination.id }, [
    h("div", { key: "details" }, [
      h("div", { className: "ev-name", key: "label" }, destination.label),
      h("div", { className: "al-note", key: "meta" }, details || "No endpoint details"),
      destination.isActive ? h("span", { className: "admin-msg ok", key: "active" }, "Active default") : null,
    ]),
    h("div", { className: "shop-admin-controls", key: "controls" }, [
      h("button", {
        className: "admin-btn secondary",
        key: "edit",
        onClick: () => dispatchRequest("gvdg:admin-data-archive-destination-edit-request", { destination: destination.source }),
        type: "button",
      }, "Edit"),
      destination.isActive ? null : h("button", {
        className: "admin-btn",
        key: "activate",
        onClick: () => dispatchRequest("gvdg:admin-data-archive-destination-activate-request", { destination: destination.source }),
        type: "button",
      }, "Make active"),
      h("button", {
        className: "admin-btn danger",
        key: "delete",
        onClick: requestDelete,
        type: "button",
      }, "Delete"),
    ]),
  ]);
}

export function AdminDataArchiveDestinationsList() {
  const state = useDataArchiveDestinationsState();

  if (state.status === "idle" || state.status === "loading") {
    return h("p", { className: "al-note", "data-react-admin-data-archive-destinations": "loading", role: "status" }, "Loading...");
  }

  if (state.status === "error") {
    return h("p", { className: "al-note err", "data-react-admin-data-archive-destinations": "error", role: "alert" }, "Unable to load destinations.");
  }

  if (!state.destinations.length) {
    return h("p", { className: "al-note", "data-react-admin-data-archive-destinations": "empty", role: "status" }, "No destinations yet. Add one above to send archived snapshots.");
  }

  return h("div", { "data-react-admin-data-archive-destinations": "ready" }, state.destinations.map((destination, index) => (
    h(DestinationRow, {
      destination,
      key: destination.id || `${destination.label}-${index}`,
    })
  )));
}

export function AdminDataArchiveExportResult() {
  const [state, setState] = React.useState(() => normalizeExportResultState(EMPTY_EXPORT_RESULT_STATE));
  const [downloadLink, setDownloadLink] = React.useState({ filename: "", href: "" });
  const autoDownloadedHref = React.useRef("");
  const downloadLinkRef = React.useRef(null);

  React.useEffect(() => {
    function update(event) {
      setState(normalizeExportResultState(event.detail && typeof event.detail === "object" ? event.detail : EMPTY_EXPORT_RESULT_STATE));
    }
    window.addEventListener("gvdg:admin-data-archive-export-result", update);
    return () => window.removeEventListener("gvdg:admin-data-archive-export-result", update);
  }, []);

  React.useEffect(() => {
    if (!state.download) {
      setDownloadLink({ filename: "", href: "" });
      return undefined;
    }
    const blob = new Blob([serializeDownload(state.download)], { type: state.download.mimeType });
    const href = URL.createObjectURL(blob);
    setDownloadLink({ filename: state.download.filename, href });
    return () => URL.revokeObjectURL(href);
  }, [state.download]);

  React.useEffect(() => {
    if (!downloadLink.href || autoDownloadedHref.current === downloadLink.href) return;
    autoDownloadedHref.current = downloadLink.href;
    if (downloadLinkRef.current) downloadLinkRef.current.click();
  }, [downloadLink.href]);

  const tone = state.ok === false ? "error" : state.ok === true ? "success" : "idle";
  return h("p", {
    className: state.ok === false ? "al-note err" : "al-note",
    "data-react-admin-data-archive-export-result": tone,
    role: state.ok === false ? "alert" : "status",
  }, [
    h("span", { key: "message" }, state.message),
    downloadLink.href ? " " : null,
    downloadLink.href ? h("a", {
      download: downloadLink.filename,
      href: downloadLink.href,
      key: "download",
      ref: downloadLinkRef,
    }, "Download JSON") : null,
  ]);
}
