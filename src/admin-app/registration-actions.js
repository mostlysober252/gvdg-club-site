import React from "react";

import { adminConfirm } from "./admin-dialogs.js";

const h = React.createElement;

const EMPTY_MEMBER_OPTIONS = { options: [], status: "loading" };
const EMPTY_ACE_POT_STATE = { acePot: null, status: "loading" };

function objectOrEmpty(value) {
  return value && typeof value === "object" ? value : {};
}

function normalizeText(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function dollarsToCents(value) {
  const amount = Number.parseFloat(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

function dollarsFromCents(value) {
  const cents = Number(value);
  return Number.isFinite(cents) ? String(cents / 100) : "";
}

function requestId(prefix) {
  return `${prefix}-${Date.now()}`;
}

function dispatchRequest(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function normalizeMemberOption(option) {
  const source = objectOrEmpty(option);
  const value = normalizeText(source.value || source.member_id);
  return {
    label: normalizeText(source.label || source.name || value),
    value,
  };
}

function normalizeMemberOptionsState(state) {
  return {
    options: Array.isArray(state.options) ? state.options.map(normalizeMemberOption).filter((option) => option.value) : [],
    status: state.status === "error" ? "error" : state.status === "loading" ? "loading" : "ready",
  };
}

function normalizeAcePotState(state) {
  const source = state.acePot || state.ace_pot;
  const acePot = source && typeof source === "object" ? source : null;
  return {
    acePot,
    status: state.status === "error" ? "error" : state.status === "loading" ? "loading" : "ready",
  };
}

export function AdminRegistrationMemberOptions() {
  const [state, setState] = React.useState(() => normalizeMemberOptionsState(EMPTY_MEMBER_OPTIONS));

  React.useEffect(() => {
    function update(event) {
      setState(normalizeMemberOptionsState(event.detail && typeof event.detail === "object" ? event.detail : EMPTY_MEMBER_OPTIONS));
    }
    window.addEventListener("gvdg:admin-registration-member-options", update);
    return () => window.removeEventListener("gvdg:admin-registration-member-options", update);
  }, []);

  return h("datalist", { "data-react-admin-registration-member-options": state.status, id: "rgMemberOptions" }, state.options.map((option) => (
    h("option", { key: option.value, label: option.label, value: option.value })
  )));
}

export function AdminRegistrationAssignControls() {
  const [groupSize, setGroupSize] = React.useState("4");
  const [pendingRequest, setPendingRequest] = React.useState("");

  React.useEffect(() => {
    if (!pendingRequest) return undefined;
    function update(event) {
      if (event.detail?.requestId !== pendingRequest) return;
      setPendingRequest("");
    }
    window.addEventListener("gvdg:admin-registration-assign-result", update);
    return () => window.removeEventListener("gvdg:admin-registration-assign-result", update);
  }, [pendingRequest]);

  function assignCards() {
    if (pendingRequest) return;
    const id = requestId("registration-assign");
    setPendingRequest(id);
    dispatchRequest("gvdg:admin-registration-assign-request", {
      groupSize: Number.parseInt(groupSize, 10) || 4,
      requestId: id,
    });
  }

  return h("div", { className: "al-row", "data-react-admin-registration-assign": "", style: { marginTop: "0.6rem" } }, [
    h("button", { className: "admin-btn secondary", disabled: Boolean(pendingRequest), key: "button", onClick: assignCards, type: "button" }, pendingRequest ? "Assigning..." : "Assign Cards"),
    h("label", { className: "al-note", htmlFor: "rgCardSize", key: "size" }, [
      "Players/Card ",
      h("input", { id: "rgCardSize", min: "1", onChange: (event) => setGroupSize(event.target.value), style: { width: "3rem" }, type: "number", value: groupSize }),
    ]),
  ]);
}

export function AdminRegistrationCtpAddForm() {
  const [form, setForm] = React.useState({ division: "", hole: "", prize: "" });
  const [pendingRequest, setPendingRequest] = React.useState("");

  React.useEffect(() => {
    if (!pendingRequest) return undefined;
    function update(event) {
      if (event.detail?.requestId !== pendingRequest) return;
      setPendingRequest("");
      if (event.detail?.ok === true) setForm({ division: "", hole: "", prize: "" });
    }
    window.addEventListener("gvdg:admin-registration-ctp-add-result", update);
    return () => window.removeEventListener("gvdg:admin-registration-ctp-add-result", update);
  }, [pendingRequest]);

  function setField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function submit(event) {
    event.preventDefault();
    if (pendingRequest) return;
    const id = requestId("registration-ctp");
    const hole = Number.parseInt(form.hole, 10);
    setPendingRequest(id);
    dispatchRequest("gvdg:admin-registration-ctp-add-request", {
      body: { division: form.division.trim() || null, hole, prize: form.prize.trim() || null },
      requestId: id,
      valid: hole >= 1,
    });
  }

  return h("form", { className: "al-row", "data-react-admin-registration-ctp-add": "", onSubmit: submit }, [
    h("label", { key: "hole" }, ["Hole ", h("input", { id: "rgCtpHole", min: "1", onChange: (event) => setField("hole", event.target.value), style: { width: "4rem" }, type: "number", value: form.hole })]),
    h("input", { key: "division", id: "rgCtpDivision", maxLength: 60, onChange: (event) => setField("division", event.target.value), placeholder: "division (optional)", size: 12, value: form.division }),
    h("input", { key: "prize", id: "rgCtpPrize", maxLength: 200, onChange: (event) => setField("prize", event.target.value), placeholder: "prize", size: 16, value: form.prize }),
    h("button", { className: "admin-btn secondary", disabled: Boolean(pendingRequest), key: "submit", type: "submit" }, pendingRequest ? "Adding..." : "Add CTP"),
  ]);
}

export function AdminRegistrationAcePotControls() {
  const [carryover, setCarryover] = React.useState("");
  const [winnerName, setWinnerName] = React.useState("");
  const [pendingRequest, setPendingRequest] = React.useState("");

  React.useEffect(() => {
    function update(event) {
      const state = normalizeAcePotState(event.detail && typeof event.detail === "object" ? event.detail : EMPTY_ACE_POT_STATE);
      setCarryover(state.acePot && state.acePot.carryover_in_cents != null ? dollarsFromCents(state.acePot.carryover_in_cents) : "");
      setWinnerName(state.acePot && state.acePot.winner_name ? normalizeText(state.acePot.winner_name) : "");
    }
    window.addEventListener("gvdg:admin-registration-ace-pot", update);
    return () => window.removeEventListener("gvdg:admin-registration-ace-pot", update);
  }, []);

  React.useEffect(() => {
    if (!pendingRequest) return undefined;
    function update(event) {
      if (event.detail?.requestId !== pendingRequest) return;
      setPendingRequest("");
    }
    window.addEventListener("gvdg:admin-registration-ace-pot-action-result", update);
    return () => window.removeEventListener("gvdg:admin-registration-ace-pot-action-result", update);
  }, [pendingRequest]);

  function sendAction(action, body) {
    if (pendingRequest) return;
    const id = requestId(`registration-ace-${action}`);
    setPendingRequest(id);
    dispatchRequest("gvdg:admin-registration-ace-pot-action-request", { action, body, requestId: id });
  }

  function carryoverCents() {
    return dollarsToCents(carryover);
  }

  async function payOut() {
    const name = winnerName.trim();
    const confirmed = await adminConfirm({
      title: "Pay out ace pot",
      message: `Mark ace pot paid out${name ? ` to ${name}` : ""}? This resolves the ace pot for this event.`,
      confirmText: "Pay out",
    });
    if (!confirmed) return;
    sendAction("payout", { carryover_in_cents: carryoverCents(), status: "paid_out", winner_name: name || null });
  }

  async function carryNext() {
    const confirmed = await adminConfirm({
      title: "Carry ace pot forward",
      message: "Carry this ace pot to the next event? This resolves the ace pot for this event.",
      confirmText: "Carry forward",
    });
    if (!confirmed) return;
    sendAction("carry-next", { carryover_in_cents: carryoverCents(), status: "carried" });
  }

  return h("div", { className: "al-row", "data-react-admin-registration-ace-pot-controls": "", style: { marginTop: "0.5rem" } }, [
    h("label", { key: "carry", htmlFor: "rgAceCarry" }, ["Carryover in $", h("input", { id: "rgAceCarry", min: "0", onChange: (event) => setCarryover(event.target.value), style: { width: "5rem" }, type: "number", value: carryover })]),
    h("button", { className: "admin-btn secondary", disabled: Boolean(pendingRequest), key: "save", onClick: () => sendAction("save", { carryover_in_cents: carryoverCents(), status: "active" }), type: "button" }, pendingRequest ? "Saving..." : "Save carryover"),
    h("input", { id: "rgAceWinner", key: "winner", maxLength: 100, onChange: (event) => setWinnerName(event.target.value), placeholder: "ace winner name", size: 14, value: winnerName }),
    h("button", { className: "admin-btn", disabled: Boolean(pendingRequest), key: "payout", onClick: payOut, type: "button" }, "Pay out"),
    h("button", { className: "admin-btn secondary", disabled: Boolean(pendingRequest), key: "carry-next", onClick: carryNext, type: "button" }, "Carry to next"),
  ]);
}
