import React from "react";

import { currentAdminMessageState } from "./admin-shell-state.js";

const h = React.createElement;

function currentMessage() {
  return currentAdminMessageState();
}

function normalizeMessage(state) {
  const text = typeof state.text === "string" ? state.text : "";
  return {
    text,
    ok: text ? state.ok === true : null,
  };
}

export function AdminMessage() {
  const [message, setMessage] = React.useState(() => normalizeMessage(currentMessage()));

  React.useEffect(() => {
    function update(event) {
      setMessage(normalizeMessage(event.detail && typeof event.detail === "object" ? event.detail : currentMessage()));
    }
    window.addEventListener("gvdg:admin-message", update);
    setMessage(normalizeMessage(currentMessage()));
    return () => window.removeEventListener("gvdg:admin-message", update);
  }, []);

  const hasText = Boolean(message.text);
  const statusClass = hasText ? (message.ok ? " ok" : " err") : "";
  const role = hasText ? (message.ok ? "status" : "alert") : undefined;

  return h("div", {
    className: `admin-msg${statusClass}`,
    "data-react-admin-message": hasText ? (message.ok ? "ok" : "err") : "empty",
    role,
  }, message.text);
}
