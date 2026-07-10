import React from "react";

import { adminConfirm } from "./admin-dialogs.js";

const h = React.createElement;

const ORDER_STATUS_LABELS = {
  submitted: "Submitted",
  processing: "Processing",
  ready: "Ready for pickup",
  shipped: "Shipped",
  completed: "Completed",
  cancelled: "Cancelled",
};
const ORDER_STATUSES = Object.keys(ORDER_STATUS_LABELS);
const ORDER_UNFULFILLED = ["submitted", "processing"];
const EMPTY_STATE = { status: "loading", orders: [], filterStatus: "" };

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

function normalizeItem(item) {
  const source = objectOrEmpty(item);
  return {
    name: normalizeText(source.name_snapshot, "Item"),
    priceCents: normalizeNumber(source.price_cents, 0),
    quantity: normalizeNumber(source.quantity, 1) || 1,
  };
}

function normalizeOrder(order) {
  const source = objectOrEmpty(order);
  const id = source.id == null ? "" : String(source.id);
  const status = normalizeText(source.status, "submitted") || "submitted";
  return {
    source,
    createdAt: normalizeText(source.created_at),
    id,
    items: Array.isArray(source.items) ? source.items.map(normalizeItem) : [],
    memberId: normalizeText(source.member_id),
    memberName: normalizeText(source.member_name),
    paymentMethod: normalizeText(source.payment_method),
    status,
    totalCents: normalizeNumber(source.total_cents, 0),
    trackingCarrier: normalizeText(source.tracking_carrier),
    trackingNumber: normalizeText(source.tracking_number),
  };
}

function normalizeState(state) {
  const status = state.status === "loading" || state.status === "error" ? state.status : "ready";
  return {
    filterStatus: normalizeText(state.filterStatus),
    orders: Array.isArray(state.orders) ? state.orders.map(normalizeOrder) : [],
    status,
  };
}

function dispatchRequest(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function dollarsFromCents(cents) {
  const n = Number(cents || 0);
  const abs = Math.abs(n);
  const out = "$" + (abs / 100).toLocaleString(undefined, { minimumFractionDigits: abs % 100 ? 2 : 0 });
  return n < 0 ? "-" + out : out;
}

function requestId(orderId, action) {
  return `${orderId || "order"}-${action}-${Date.now()}`;
}

function orderTitle(order) {
  return `Order #${order.id || "?"} - ${order.memberName || order.memberId || "Member"}`;
}

function orderMeta(order) {
  const status = ORDER_STATUS_LABELS[order.status] || order.status || "submitted";
  return `Placed ${order.createdAt || "?"} - ${status}`;
}

function OrderItems({ items }) {
  if (!items.length) return h("div", { className: "order-items" }, h("div", null, "No line items."));
  return h("div", { className: "order-items" }, items.map((item, index) => (
    h("div", { key: `${item.name}-${index}` }, `${item.quantity} x ${item.name} (${dollarsFromCents(item.priceCents)})`)
  )));
}

function OrderCard({ order }) {
  const safeStatus = ORDER_STATUSES.includes(order.status) ? order.status : "submitted";
  const [status, setStatus] = React.useState(safeStatus);
  const [trackingCarrier, setTrackingCarrier] = React.useState(order.trackingCarrier);
  const [trackingNumber, setTrackingNumber] = React.useState(order.trackingNumber);
  const [pendingRequest, setPendingRequest] = React.useState("");

  React.useEffect(() => {
    setStatus(safeStatus);
    setTrackingCarrier(order.trackingCarrier);
    setTrackingNumber(order.trackingNumber);
    setPendingRequest("");
  }, [order.id, safeStatus, order.trackingCarrier, order.trackingNumber]);

  React.useEffect(() => {
    function update(event) {
      if (event.detail?.requestId === pendingRequest) setPendingRequest("");
    }
    if (!pendingRequest) return undefined;
    window.addEventListener("gvdg:admin-order-action-result", update);
    return () => window.removeEventListener("gvdg:admin-order-action-result", update);
  }, [pendingRequest]);

  function requestSave() {
    const id = requestId(order.id, "save");
    setPendingRequest(id);
    dispatchRequest("gvdg:admin-order-save-request", {
      order: order.source,
      requestId: id,
      status,
      trackingCarrier,
      trackingNumber,
    });
  }

  async function requestCancel() {
    if (order.status === "cancelled") return;
    const confirmed = await adminConfirm({
      title: "Cancel order",
      message: `Cancel order #${order.id || "?"}?`,
      confirmText: "Cancel order",
      danger: true,
    });
    if (!confirmed) return;
    const id = requestId(order.id, "cancel");
    setPendingRequest(id);
    dispatchRequest("gvdg:admin-order-cancel-request", { order: order.source, requestId: id });
  }

  async function requestDelete() {
    const confirmed = await adminConfirm({
      title: "Delete order",
      message: `Delete order #${order.id || "?"}? Order items will be removed from the admin list. Wallet ledger entries remain for accounting.`,
      confirmText: "Delete",
      danger: true,
    });
    if (!confirmed) return;
    const id = requestId(order.id, "delete");
    setPendingRequest(id);
    dispatchRequest("gvdg:admin-order-delete-request", { order: order.source, requestId: id });
  }

  const busy = Boolean(pendingRequest);
  const className = [
    "order-card",
    ORDER_UNFULFILLED.includes(order.status) ? "unfulfilled" : "",
    order.status === "cancelled" ? "cancelled" : "",
  ].filter(Boolean).join(" ");

  return h("div", { className, "data-admin-order-id": order.id }, [
    h("div", { className: "order-head", key: "head" }, [
      h("strong", { key: "title" }, orderTitle(order)),
      h("span", { key: "total" }, `${dollarsFromCents(order.totalCents)} - ${order.paymentMethod || ""}`),
    ]),
    h("div", { className: "shop-admin-meta", key: "meta" }, orderMeta(order)),
    h(OrderItems, { items: order.items, key: "items" }),
    h("div", { className: "order-controls", key: "controls" }, [
      h("div", { key: "status" }, [
        h("label", { htmlFor: `order-status-${order.id}`, key: "label" }, "Status"),
        h("select", {
          disabled: busy,
          id: `order-status-${order.id}`,
          key: "select",
          onChange: (event) => setStatus(event.target.value),
          value: status,
        }, ORDER_STATUSES.map((value) => h("option", { key: value, value }, ORDER_STATUS_LABELS[value]))),
      ]),
      h("div", { key: "carrier" }, [
        h("label", { htmlFor: `order-carrier-${order.id}`, key: "label" }, "Carrier"),
        h("input", {
          disabled: busy,
          id: `order-carrier-${order.id}`,
          key: "input",
          maxLength: 60,
          onChange: (event) => setTrackingCarrier(event.target.value),
          placeholder: "USPS / UPS",
          value: trackingCarrier,
        }),
      ]),
      h("div", { key: "tracking" }, [
        h("label", { htmlFor: `order-tracking-${order.id}`, key: "label" }, "Tracking #"),
        h("input", {
          disabled: busy,
          id: `order-tracking-${order.id}`,
          key: "input",
          maxLength: 120,
          onChange: (event) => setTrackingNumber(event.target.value),
          placeholder: "tracking number",
          value: trackingNumber,
        }),
      ]),
      h("button", { className: "admin-btn", disabled: busy, key: "save", onClick: requestSave, type: "button" }, "Save"),
      h("div", { className: "order-actions", key: "actions" }, [
        h("button", { className: "admin-btn secondary", disabled: busy || order.status === "cancelled", key: "cancel", onClick: requestCancel, type: "button" }, "Cancel"),
        h("button", { className: "admin-btn danger", disabled: busy, key: "delete", onClick: requestDelete, type: "button" }, "Delete"),
      ]),
    ]),
  ]);
}

export function AdminOrdersList() {
  const [state, setState] = React.useState(() => normalizeState(EMPTY_STATE));

  React.useEffect(() => {
    function update(event) {
      setState(normalizeState(event.detail && typeof event.detail === "object" ? event.detail : EMPTY_STATE));
    }
    window.addEventListener("gvdg:admin-orders-list", update);
    return () => window.removeEventListener("gvdg:admin-orders-list", update);
  }, []);

  if (state.status === "loading") {
    return h("p", { className: "al-note", "data-react-admin-orders-list": "loading", role: "status" }, "Loading...");
  }

  if (state.status === "error") {
    return h("p", { className: "al-note err", "data-react-admin-orders-list": "error", role: "alert" }, "Unable to load orders.");
  }

  if (!state.orders.length) {
    return h("p", { className: "al-note", "data-react-admin-orders-list": "empty", role: "status" }, state.filterStatus ? "No orders with that status." : "No orders yet.");
  }

  return h("div", { className: "orders-list", "data-react-admin-orders-list": "ready" }, state.orders.map((order, index) => (
    h(OrderCard, { key: order.id || `${order.memberName}-${index}`, order })
  )));
}
