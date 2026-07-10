import React from "react";

const h = React.createElement;

const PRODUCT_SORT_OPTIONS = [
  ["newest", "Newest first"],
  ["name", "Name A-Z"],
  ["brand", "Brand A-Z"],
  ["type", "Type"],
  ["color", "Color"],
  ["weight", "Weight"],
  ["price_asc", "Price low-high"],
  ["price_desc", "Price high-low"],
  ["stock_asc", "Stock low-high"],
  ["stock_desc", "Stock high-low"],
  ["status", "Status"],
];

const PRODUCT_STATUS_OPTIONS = [
  ["active", "Active"],
  ["inactive", "Archived"],
  ["all", "All items"],
];

const ORDER_STATUS_OPTIONS = [
  ["", "All orders"],
  ["submitted", "Submitted"],
  ["processing", "Processing"],
  ["ready", "Ready for pickup"],
  ["shipped", "Shipped"],
  ["completed", "Completed"],
  ["cancelled", "Cancelled"],
];

let productControlsStateSnapshot = {};
let orderControlsStateSnapshot = {};

function productControlsState() {
  const state = productControlsStateSnapshot;
  return state && typeof state === "object" ? state : {};
}

function orderControlsState() {
  const state = orderControlsStateSnapshot;
  return state && typeof state === "object" ? state : {};
}

function optionValue(value, options, fallback) {
  return options.some(([candidate]) => candidate === value) ? value : fallback;
}

function dispatchRequest(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function setProductControlsState(state) {
  productControlsStateSnapshot = state;
}

function setOrderControlsState(state) {
  orderControlsStateSnapshot = state;
}

export function AdminProductInventoryControls() {
  const initial = productControlsState();
  const [sort, setSort] = React.useState(() => optionValue(initial.sort, PRODUCT_SORT_OPTIONS, "newest"));
  const [status, setStatus] = React.useState(() => optionValue(initial.status, PRODUCT_STATUS_OPTIONS, "active"));

  React.useEffect(() => {
    setProductControlsState({ sort, status });
  }, [sort, status]);

  function requestLoad(nextState) {
    setProductControlsState(nextState);
    dispatchRequest("gvdg:admin-product-inventory-controls-request", nextState);
  }

  function onSortChange(event) {
    const next = optionValue(event.target.value, PRODUCT_SORT_OPTIONS, "newest");
    const nextState = { sort: next, status };
    setSort(next);
    requestLoad(nextState);
  }

  function onStatusChange(event) {
    const next = optionValue(event.target.value, PRODUCT_STATUS_OPTIONS, "active");
    const nextState = { sort, status: next };
    setStatus(next);
    requestLoad(nextState);
  }

  return h("div", {
    "aria-label": "Inventory controls",
    className: "shop-admin-toolbar",
    "data-react-admin-product-inventory-controls": "",
  }, [
    h("label", { htmlFor: "psInvSort", key: "sort" }, [
      "Sort",
      h("select", {
        id: "psInvSort",
        key: "select",
        onChange: onSortChange,
        value: sort,
      }, PRODUCT_SORT_OPTIONS.map(([value, label]) => h("option", { key: value, value }, label))),
    ]),
    h("label", { htmlFor: "psInvStatus", key: "status" }, [
      "Show",
      h("select", {
        id: "psInvStatus",
        key: "select",
        onChange: onStatusChange,
        value: status,
      }, PRODUCT_STATUS_OPTIONS.map(([value, label]) => h("option", { key: value, value }, label))),
    ]),
  ]);
}

export function AdminOrderControls() {
  const initial = orderControlsState();
  const [status, setStatus] = React.useState(() => optionValue(initial.status, ORDER_STATUS_OPTIONS, ""));

  React.useEffect(() => {
    setOrderControlsState({ status });
  }, [status]);

  function requestLoad(nextStatus) {
    const nextState = { status: nextStatus };
    setOrderControlsState(nextState);
    dispatchRequest("gvdg:admin-order-controls-request", nextState);
  }

  function onStatusChange(event) {
    const next = optionValue(event.target.value, ORDER_STATUS_OPTIONS, "");
    setStatus(next);
    requestLoad(next);
  }

  function onRefresh() {
    requestLoad(status);
  }

  return h("div", {
    className: "al-section admin-order-controls",
    "data-react-admin-order-controls": "",
  }, [
    h("label", { htmlFor: "ordStatusFilter", key: "label" }, "Show"),
    h("select", {
      id: "ordStatusFilter",
      key: "select",
      onChange: onStatusChange,
      value: status,
    }, ORDER_STATUS_OPTIONS.map(([value, label]) => h("option", { key: value || "all", value }, label))),
    h("button", { className: "admin-btn", key: "refresh", onClick: onRefresh, type: "button" }, "Refresh"),
  ]);
}
