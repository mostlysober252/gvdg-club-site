import React from "react";

import { adminConfirm } from "./admin-dialogs.js";

const h = React.createElement;

const EMPTY_STATE = { status: "loading", products: [], inventoryStatus: "active" };

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

function normalizeProduct(product) {
  const source = objectOrEmpty(product);
  const name = normalizeText(source.name, "Product") || "Product";
  return {
    source,
    active: Number(source.active) === 1 || source.active === true,
    brand: normalizeText(source.brand),
    color: normalizeText(source.color),
    id: source.id == null ? "" : String(source.id),
    imageUrl: normalizeText(source.image_url),
    name,
    priceCents: source.price_cents == null ? null : normalizeNumber(source.price_cents, 0),
    productType: normalizeText(source.product_type),
    stockQty: normalizeNumber(source.stock_qty, 0),
    weightG: source.weight_g == null ? null : normalizeNumber(source.weight_g, 0),
  };
}

function normalizeState(state) {
  return {
    inventoryStatus: normalizeText(state.inventoryStatus, "active") || "active",
    products: Array.isArray(state.products) ? state.products.map(normalizeProduct) : [],
    status: state.status === "loading" ? "loading" : "ready",
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

function priceInputValue(cents) {
  if (cents == null) return "";
  return String(Number(cents) / 100);
}

function productMeta(product, active) {
  return [
    product.brand,
    product.productType,
    product.color,
    product.weightG != null ? `${product.weightG}g` : "",
    product.priceCents != null ? dollarsFromCents(product.priceCents) : "",
    `${product.stockQty || 0} in stock`,
    active ? "active" : "archived",
  ].filter(Boolean).join(" - ") || "No metadata";
}

function ProductThumb({ product }) {
  if (product.imageUrl) {
    return h("img", {
      alt: product.name || "Product image",
      className: "shop-admin-thumb",
      loading: "lazy",
      src: product.imageUrl,
    });
  }

  const fallback = (product.brand || product.name || "?").slice(0, 1).toUpperCase();
  return h("div", { className: "shop-admin-thumb fallback", "aria-label": `${product.name} image placeholder`, role: "img" }, fallback);
}

function ProductRow({ product }) {
  const [priceValue, setPriceValue] = React.useState(() => priceInputValue(product.priceCents));
  const [stockValue, setStockValue] = React.useState(() => String(product.stockQty || 0));
  const [active, setActive] = React.useState(() => product.active);

  React.useEffect(() => {
    setPriceValue(priceInputValue(product.priceCents));
    setStockValue(String(product.stockQty || 0));
    setActive(product.active);
  }, [product.id, product.priceCents, product.stockQty, product.active]);

  function requestSave() {
    dispatchRequest("gvdg:admin-product-save-request", {
      active,
      priceValue,
      product: product.source,
      stockValue,
    });
  }

  async function requestDelete() {
    const confirmed = await adminConfirm({
      title: "Delete product",
      message: `Permanently delete "${product.name || "this product"}"? Past orders keep the item name, price, and quantity, but this product will be removed from inventory.`,
      confirmText: "Delete",
      danger: true,
    });
    if (!confirmed) return;
    dispatchRequest("gvdg:admin-product-delete-request", { product: product.source });
  }

  return h("div", { className: `shop-admin-row${active ? "" : " inactive"}`, "data-admin-product-id": product.id }, [
    h(ProductThumb, { key: "thumb", product }),
    h("div", { key: "info" }, [
      h("div", { className: "ev-name", key: "name" }, product.name),
      h("div", { className: "shop-admin-meta", key: "meta" }, productMeta(product, active)),
    ]),
    h("div", { className: "shop-admin-controls", key: "controls" }, [
      h("input", {
        "aria-label": `Price for ${product.name}`,
        key: "price",
        min: "0",
        onChange: (event) => setPriceValue(event.target.value),
        step: "0.01",
        type: "number",
        value: priceValue,
      }),
      h("input", {
        "aria-label": `Stock for ${product.name}`,
        key: "stock",
        min: "0",
        onChange: (event) => setStockValue(event.target.value),
        step: "1",
        type: "number",
        value: stockValue,
      }),
      h("label", { className: "register-addon", key: "active" }, [
        h("input", {
          checked: active,
          key: "checkbox",
          onChange: (event) => setActive(event.target.checked),
          type: "checkbox",
        }),
        active ? " active" : " archived",
      ]),
      h("button", { className: "admin-btn secondary", key: "save", onClick: requestSave, type: "button" }, "Save"),
      h("button", { className: "admin-btn danger", key: "delete", onClick: requestDelete, type: "button" }, "Delete"),
    ]),
  ]);
}

export function AdminProductsList() {
  const [state, setState] = React.useState(() => normalizeState(EMPTY_STATE));

  React.useEffect(() => {
    function update(event) {
      setState(normalizeState(event.detail && typeof event.detail === "object" ? event.detail : EMPTY_STATE));
    }
    window.addEventListener("gvdg:admin-products-list", update);
    return () => window.removeEventListener("gvdg:admin-products-list", update);
  }, []);

  if (state.status === "loading") {
    return h("p", { className: "al-note", "data-react-admin-products-list": "loading", role: "status" }, "Loading...");
  }

  if (!state.products.length) {
    return h("p", { className: "al-note", "data-react-admin-products-list": "empty", role: "status" }, state.inventoryStatus === "inactive" ? "No archived products." : "No products yet.");
  }

  return h("div", { className: "shop-admin-list", "data-react-admin-products-list": "ready" }, state.products.map((product, index) => (
    h(ProductRow, {
      key: product.id || `${product.name}-${index}`,
      product,
    })
  )));
}
