import React from "react";
import { CircleAlert, Disc3, RefreshCcw } from "lucide-react";

import { currentEventsStatus } from "./events-state.js";

const h = React.createElement;
const STATUS_EVENT = "gvdg:events-status";

function icon(Icon, size = 34) {
  return h(Icon, {
    "aria-hidden": "true",
    focusable: "false",
    size,
    strokeWidth: 2.3,
  });
}

function defaultStatus() {
  return { message: "Loading...", retry: null, tone: "loading" };
}

function publishedStatus() {
  const status = currentEventsStatus();
  return status && typeof status === "object" ? status : defaultStatus();
}

function normalizeStatus(status) {
  const next = status && typeof status === "object" ? status : defaultStatus();
  const tone = ["empty", "error", "loading"].includes(next.tone) ? next.tone : "loading";
  return {
    message: next.message == null || next.message === "" ? defaultStatus().message : String(next.message),
    retry: typeof next.retry === "function" ? next.retry : null,
    tone,
  };
}

function useEventsStatus() {
  const [status, setStatus] = React.useState(() => normalizeStatus(publishedStatus()));

  React.useEffect(() => {
    function update(event) {
      const next = event.detail && event.detail.status ? event.detail.status : publishedStatus();
      setStatus(normalizeStatus(next));
    }
    window.addEventListener(STATUS_EVENT, update);
    update({ detail: { status: publishedStatus() } });
    return () => window.removeEventListener(STATUS_EVENT, update);
  }, []);

  return status;
}

export function EventsStatusApp() {
  const status = useEventsStatus();
  const isError = status.tone === "error";
  const isEmpty = status.tone === "empty";
  const role = isError ? "alert" : "status";

  return h("div", {
    className: `status-box${isError ? " error" : ""}`,
    "data-react-events-status": status.tone,
    role,
  }, [
    status.tone === "loading" ? h("div", { className: "spinner", key: "spinner" }) : null,
    isEmpty ? h("div", { className: "empty-icon", key: "empty-icon" }, icon(Disc3, 42)) : null,
    isError ? h("div", { className: "empty-icon", key: "error-icon" }, icon(CircleAlert, 40)) : null,
    h("div", { className: "status-message", key: "message" }, status.message),
    isError
      ? h("button", {
        className: "retry-btn",
        key: "retry",
        onClick: () => {
          if (status.retry) status.retry();
        },
        type: "button",
      }, [
        icon(RefreshCcw, 15),
        h("span", { key: "text" }, "Retry"),
      ])
      : null,
  ]);
}
