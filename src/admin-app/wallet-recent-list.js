import React from "react";

import { adminJson } from "./admin-api.js";
import { currentAdminActiveTab, currentAdminAuthGateState } from "./admin-shell-state.js";

const h = React.createElement;

const EMPTY_STATE = { status: "idle", transactions: [] };
const LOADING_STATE = { status: "loading", transactions: [] };

function objectOrEmpty(value) {
  return value && typeof value === "object" ? value : {};
}

function normalizeText(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function normalizeAmount(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function normalizeTransaction(transaction) {
  const source = objectOrEmpty(transaction);
  return {
    amountCents: normalizeAmount(source.amount_cents),
    createdAt: normalizeText(source.created_at),
    memberId: normalizeText(source.member_id),
    memberName: normalizeText(source.member_name),
    note: normalizeText(source.note),
    sourceName: normalizeText(source.source, "wallet") || "wallet",
  };
}

function normalizeState(state) {
  const status = state.status === "idle" || state.status === "loading" || state.status === "error" ? state.status : "ready";
  return {
    status,
    transactions: Array.isArray(state.transactions) ? state.transactions.map(normalizeTransaction) : [],
  };
}

function dollarsFromCents(cents) {
  const n = Number(cents || 0);
  const abs = Math.abs(n);
  const out = "$" + (abs / 100).toLocaleString(undefined, { minimumFractionDigits: abs % 100 ? 2 : 0 });
  return n < 0 ? "-" + out : out;
}

function transactionTitle(transaction) {
  return `${transaction.memberName || transaction.memberId || "Member"} - ${transaction.sourceName}`;
}

function transactionMeta(transaction) {
  return [transaction.note, transaction.createdAt].filter(Boolean).join(" - ");
}

function WalletTransactionRow({ transaction, index }) {
  const amountClass = transaction.amountCents >= 0 ? "credit" : "debit";
  const amountText = `${transaction.amountCents >= 0 ? "+" : ""}${dollarsFromCents(transaction.amountCents)}`;

  return h("div", { className: "wallet-row", "data-admin-wallet-row": String(index) }, [
    h("div", { key: "left" }, [
      h("strong", { key: "title" }, transactionTitle(transaction)),
      h("div", { className: "shop-admin-meta", key: "meta" }, transactionMeta(transaction)),
    ]),
    h("span", { className: amountClass, key: "amount" }, amountText),
  ]);
}

export function AdminWalletRecentList() {
  const [state, setState] = React.useState(() => normalizeState(EMPTY_STATE));
  const [adminReady, setAdminReady] = React.useState(() => currentAdminAuthGateState().status === "panel");
  const [activeTab, setActiveTab] = React.useState(() => currentAdminActiveTab());
  const [refreshCount, setRefreshCount] = React.useState(0);
  const shouldLoad = adminReady && activeTab === "wallets";

  React.useEffect(() => {
    function updateAuth(event) {
      const detail = event.detail && typeof event.detail === "object" ? event.detail : currentAdminAuthGateState();
      setAdminReady(detail.status === "panel");
    }
    function updateTab(event) {
      const tab = event.detail && typeof event.detail.tab === "string" ? event.detail.tab : currentAdminActiveTab();
      setActiveTab(tab);
    }
    function refreshAfterAdjustment(event) {
      if (event.detail?.ok === true) setRefreshCount((count) => count + 1);
    }

    window.addEventListener("gvdg:admin-auth-gate", updateAuth);
    window.addEventListener("gvdg:admin-active-tab", updateTab);
    window.addEventListener("gvdg:admin-wallet-adjustment-result", refreshAfterAdjustment);
    setAdminReady(currentAdminAuthGateState().status === "panel");
    setActiveTab(currentAdminActiveTab());
    return () => {
      window.removeEventListener("gvdg:admin-auth-gate", updateAuth);
      window.removeEventListener("gvdg:admin-active-tab", updateTab);
      window.removeEventListener("gvdg:admin-wallet-adjustment-result", refreshAfterAdjustment);
    };
  }, []);

  React.useEffect(() => {
    if (!shouldLoad) return undefined;
    const controller = new AbortController();
    setState(normalizeState(LOADING_STATE));
    adminJson("/admin/wallets/recent", { signal: controller.signal })
      .then((data) => {
        setState(normalizeState({ status: "ready", transactions: data?.transactions }));
      })
      .catch(() => {
        if (!controller.signal.aborted) setState(normalizeState({ status: "error", transactions: [] }));
      });
    return () => controller.abort();
  }, [shouldLoad, refreshCount]);

  if (state.status === "idle" || state.status === "loading") {
    return h("p", { className: "al-note", "data-react-admin-wallet-recent": "loading", role: "status" }, "Loading...");
  }

  if (state.status === "error") {
    return h("p", { className: "al-note", "data-react-admin-wallet-recent": "error", role: "alert" }, "Wallet activity could not load.");
  }

  if (!state.transactions.length) {
    return h("p", { className: "al-note", "data-react-admin-wallet-recent": "empty", role: "status" }, "No wallet activity yet.");
  }

  return h("div", { className: "wallet-ledger", "data-react-admin-wallet-recent": "ready" }, state.transactions.map((transaction, index) => (
    h(WalletTransactionRow, {
      index,
      key: `${transaction.memberId || transaction.memberName || "member"}-${transaction.createdAt || index}-${transaction.amountCents}`,
      transaction,
    })
  )));
}
