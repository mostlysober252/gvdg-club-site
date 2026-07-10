import React from "react";

import { adminConfirm } from "./admin-dialogs.js";

const h = React.createElement;

const EMPTY_CTPS_STATE = { status: "loading", ctps: [] };
const EMPTY_CREDITS_STATE = { status: "loading", payouts: [] };
const EMPTY_ACE_POT_STATE = { status: "loading", acePot: null };

function objectOrEmpty(value) {
  return value && typeof value === "object" ? value : {};
}

function normalizeText(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function normalizeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeStatus(value) {
  return value === "loading" || value === "error" ? value : "ready";
}

function dollarsFromCents(cents) {
  const n = Number(cents || 0);
  const abs = Math.abs(n);
  const out = "$" + (abs / 100).toLocaleString(undefined, { minimumFractionDigits: abs % 100 ? 2 : 0 });
  return n < 0 ? "-" + out : out;
}

function dispatchRequest(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function normalizeCtp(ctp) {
  const source = objectOrEmpty(ctp);
  const id = source.id == null ? "" : String(source.id);
  return {
    division: normalizeText(source.division),
    hole: source.hole == null ? "" : String(source.hole),
    id,
    prize: normalizeText(source.prize),
    source,
    winnerMemberId: normalizeText(source.winner_member_id),
    winnerName: normalizeText(source.winner_name),
  };
}

function normalizeCtpsState(state) {
  return {
    ctps: Array.isArray(state.ctps) ? state.ctps.map(normalizeCtp) : [],
    status: normalizeStatus(state.status),
  };
}

function normalizeTransaction(transaction) {
  const source = objectOrEmpty(transaction);
  return {
    amountCents: normalizeNumber(source.amount_cents, 0),
    createdAt: normalizeText(source.created_at),
    memberId: normalizeText(source.member_id),
    memberName: normalizeText(source.member_name),
    note: normalizeText(source.note),
    sourceName: normalizeText(source.source, "wallet") || "wallet",
  };
}

function normalizeCreditsState(state) {
  return {
    payouts: Array.isArray(state.payouts) ? state.payouts.map(normalizeTransaction) : [],
    status: normalizeStatus(state.status),
  };
}

function normalizeAcePot(pot) {
  const source = pot && typeof pot === "object" ? pot : null;
  if (!source) return null;
  return {
    aceFeeCents: normalizeNumber(source.ace_fee_cents, 0),
    carryoverInCents: normalizeNumber(source.carryover_in_cents, 0),
    contributors: normalizeNumber(source.contributors, 0),
    status: normalizeText(source.status, "active") || "active",
    totalCents: normalizeNumber(source.total_cents, 0),
    winnerName: normalizeText(source.winner_name),
  };
}

function normalizeAcePotState(state) {
  return {
    acePot: normalizeAcePot(state.acePot || state.ace_pot),
    status: normalizeStatus(state.status),
  };
}

function ctpTitle(ctp) {
  const parts = [`Hole ${ctp.hole || "?"}`];
  if (ctp.division) parts.push(ctp.division);
  if (ctp.prize) parts.push(ctp.prize);
  if (ctp.winnerName) parts.push(`Winner: ${ctp.winnerName}`);
  return parts.join(" - ");
}

function CtpRow({ ctp }) {
  const [winnerName, setWinnerName] = React.useState(ctp.winnerName);
  const [winnerMemberId, setWinnerMemberId] = React.useState(ctp.winnerMemberId);
  const [amountValue, setAmountValue] = React.useState("");

  React.useEffect(() => {
    setWinnerName(ctp.winnerName);
    setWinnerMemberId(ctp.winnerMemberId);
    setAmountValue("");
  }, [ctp.id, ctp.winnerName, ctp.winnerMemberId]);

  async function requestDelete() {
    const confirmed = await adminConfirm({
      title: "Delete CTP",
      message: `Delete this CTP for hole ${ctp.hole || "?"}?`,
      confirmText: "Delete",
      danger: true,
    });
    if (!confirmed) return;
    dispatchRequest("gvdg:admin-registration-ctp-delete-request", { ctp: ctp.source });
  }

  return h("div", { className: "admin-evrow", "data-admin-registration-ctp-id": ctp.id }, [
    h("span", { className: "ev-name", key: "name" }, ctpTitle(ctp)),
    h("input", {
      "aria-label": `Winner for CTP hole ${ctp.hole || "?"}`,
      key: "winner",
      maxLength: 100,
      onChange: (event) => setWinnerName(event.target.value),
      placeholder: "winner",
      size: 12,
      value: winnerName,
    }),
    h("input", {
      "aria-label": `Winner member id for CTP hole ${ctp.hole || "?"}`,
      key: "member",
      list: "rgMemberOptions",
      maxLength: 64,
      onChange: (event) => setWinnerMemberId(event.target.value),
      placeholder: "member id",
      size: 10,
      value: winnerMemberId,
    }),
    h("button", {
      className: "admin-btn secondary",
      key: "set-winner",
      onClick: () => dispatchRequest("gvdg:admin-registration-ctp-winner-request", {
        ctp: ctp.source,
        winnerMemberId,
        winnerName,
      }),
      type: "button",
    }, "Set winner"),
    h("input", {
      "aria-label": `Store credit amount for CTP hole ${ctp.hole || "?"}`,
      key: "credit",
      min: "0",
      onChange: (event) => setAmountValue(event.target.value),
      placeholder: "$",
      size: 5,
      step: "0.01",
      type: "number",
      value: amountValue,
    }),
    h("button", {
      className: "admin-btn secondary",
      key: "award",
      onClick: () => dispatchRequest("gvdg:admin-registration-ctp-credit-request", {
        amountValue,
        ctp: ctp.source,
        winnerMemberId,
        winnerName,
      }),
      type: "button",
    }, "Award credit"),
    h("button", { className: "admin-btn danger", key: "delete", onClick: requestDelete, type: "button" }, "Delete"),
  ]);
}

function WalletTransactionRow({ transaction, index }) {
  const amountClass = transaction.amountCents >= 0 ? "credit" : "debit";
  const amountText = `${transaction.amountCents >= 0 ? "+" : ""}${dollarsFromCents(transaction.amountCents)}`;
  const title = `${transaction.memberName || transaction.memberId || "Member"} - ${transaction.sourceName}`;
  const meta = [transaction.note, transaction.createdAt].filter(Boolean).join(" - ");

  return h("div", { className: "wallet-row", "data-admin-registration-credit-row": String(index) }, [
    h("div", { key: "left" }, [
      h("strong", { key: "title" }, title),
      h("div", { className: "shop-admin-meta", key: "meta" }, meta),
    ]),
    h("span", { className: amountClass, key: "amount" }, amountText),
  ]);
}

export function AdminRegistrationCtpsList() {
  const [state, setState] = React.useState(() => normalizeCtpsState(EMPTY_CTPS_STATE));

  React.useEffect(() => {
    function update(event) {
      setState(normalizeCtpsState(event.detail && typeof event.detail === "object" ? event.detail : EMPTY_CTPS_STATE));
    }
    window.addEventListener("gvdg:admin-registration-ctps-list", update);
    return () => window.removeEventListener("gvdg:admin-registration-ctps-list", update);
  }, []);

  if (state.status === "loading") {
    return h("p", { className: "al-note", "data-react-admin-registration-ctps": "loading", role: "status" }, "Loading...");
  }

  if (state.status === "error") {
    return h("p", { className: "al-note err", "data-react-admin-registration-ctps": "error", role: "alert" }, "Unable to load CTPs.");
  }

  if (!state.ctps.length) {
    return h("p", { className: "al-note", "data-react-admin-registration-ctps": "empty", role: "status" }, "No CTPs yet.");
  }

  return h("div", { "data-react-admin-registration-ctps": "ready" }, state.ctps.map((ctp, index) => (
    h(CtpRow, { ctp, key: ctp.id || `${ctp.hole}-${index}` })
  )));
}

export function AdminRegistrationCreditsList() {
  const [state, setState] = React.useState(() => normalizeCreditsState(EMPTY_CREDITS_STATE));

  React.useEffect(() => {
    function update(event) {
      setState(normalizeCreditsState(event.detail && typeof event.detail === "object" ? event.detail : EMPTY_CREDITS_STATE));
    }
    window.addEventListener("gvdg:admin-registration-credits-list", update);
    return () => window.removeEventListener("gvdg:admin-registration-credits-list", update);
  }, []);

  if (state.status === "loading") {
    return h("p", { className: "al-note", "data-react-admin-registration-credits": "loading", role: "status" }, "Loading...");
  }

  if (state.status === "error") {
    return h("p", { className: "al-note err", "data-react-admin-registration-credits": "error", role: "alert" }, "Unable to load store credit payouts.");
  }

  if (!state.payouts.length) {
    return h("p", { className: "al-note", "data-react-admin-registration-credits": "empty", role: "status" }, "No store credit payouts yet.");
  }

  return h("div", { className: "wallet-ledger", "data-react-admin-registration-credits": "ready" }, state.payouts.map((transaction, index) => (
    h(WalletTransactionRow, {
      index,
      key: `${transaction.memberId || transaction.memberName || "member"}-${transaction.createdAt || index}-${transaction.amountCents}`,
      transaction,
    })
  )));
}

export function AdminRegistrationAcePot() {
  const [state, setState] = React.useState(() => normalizeAcePotState(EMPTY_ACE_POT_STATE));

  React.useEffect(() => {
    function update(event) {
      setState(normalizeAcePotState(event.detail && typeof event.detail === "object" ? event.detail : EMPTY_ACE_POT_STATE));
    }
    window.addEventListener("gvdg:admin-registration-ace-pot", update);
    return () => window.removeEventListener("gvdg:admin-registration-ace-pot", update);
  }, []);

  if (state.status === "loading") {
    return h("p", { className: "al-note", "data-react-admin-registration-ace-pot": "loading", role: "status" }, "Loading...");
  }

  if (state.status === "error") {
    return h("p", { className: "al-note err", "data-react-admin-registration-ace-pot": "error", role: "alert" }, "Unable to load ace pot.");
  }

  const pot = state.acePot;
  if (!pot) {
    return h("p", { className: "al-note", "data-react-admin-registration-ace-pot": "empty", role: "status" }, "No ace pot data.");
  }

  const summary = [
    `Total pot ${dollarsFromCents(pot.totalCents)}`,
    `carryover ${dollarsFromCents(pot.carryoverInCents)}`,
    `${pot.contributors} paid x ${dollarsFromCents(pot.aceFeeCents)}`,
    `status: ${pot.status}`,
    pot.winnerName ? `Winner: ${pot.winnerName}` : "",
  ].filter(Boolean).join(" - ");

  return h("p", { className: "al-note", "data-react-admin-registration-ace-pot": "ready", role: "status" }, summary);
}
