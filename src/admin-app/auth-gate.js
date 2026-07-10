import React from "react";
import { LockKeyhole } from "lucide-react";

import { currentAdminAuthGateState } from "./admin-shell-state.js";

const h = React.createElement;

function currentState() {
  return currentAdminAuthGateState();
}

function gateIcon() {
  return h("div", { className: "gate-icon", key: "icon" },
    h(LockKeyhole, {
      "aria-hidden": "true",
      focusable: "false",
      size: 40,
      strokeWidth: 2.2,
    }));
}

function LoadingState() {
  return h("div", { className: "status-box", role: "status", "data-react-admin-auth-gate": "loading" }, [
    h("div", { className: "spinner", key: "spinner" }),
    h("div", { key: "message" }, "Checking your session..."),
  ]);
}

function GateState({ state }) {
  const message = typeof state.message === "string" && state.message.trim()
    ? state.message
    : "Admin sign-in required.";
  return h("div", { className: "admin-gate", "data-react-admin-auth-gate": "gate" }, [
    gateIcon(),
    h("div", { className: "gate-title", key: "title" }, "Admin"),
    h("p", { className: "gate-msg", key: "message" }, message),
    state.withMembersLink ? h("a", { className: "gate-btn", href: "gvdg-members.html", key: "members" }, "Go to Members page") : null,
  ]);
}

export function AdminAuthGate() {
  const [state, setState] = React.useState(currentState);

  React.useEffect(() => {
    function update(event) {
      setState(event.detail && typeof event.detail === "object" ? event.detail : currentState());
    }
    window.addEventListener("gvdg:admin-auth-gate", update);
    setState(currentState());
    return () => window.removeEventListener("gvdg:admin-auth-gate", update);
  }, []);

  if (state.status === "panel") return null;
  if (state.status === "gate") return h(GateState, { state });
  return h(LoadingState);
}
