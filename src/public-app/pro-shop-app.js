import React from "react";

import { resolveApiBase } from "../shared/api-base.js";

const h = React.createElement;

const TOKEN_KEY = "gvdg_member_token";
const ORDER_LABELS = {
  submitted: "Order received",
  processing: "Being prepared",
  ready: "Ready for pickup",
  shipped: "Shipped",
  completed: "Completed",
  cancelled: "Cancelled",
};

let paypalSdkPromise = null;

function useLatest(value) {
  const ref = React.useRef(value);
  React.useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}

function currentToken() {
  try {
    return sessionStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

function authBase() {
  return resolveApiBase({ datasetKeys: ["authBase"] });
}

function money(cents) {
  const value = Number(cents || 0);
  const abs = Math.abs(value);
  const amount = "$" + (abs / 100).toLocaleString(undefined, {
    minimumFractionDigits: abs % 100 ? 2 : 0,
  });
  return value < 0 ? "-" + amount : amount;
}

function typeLabel(value) {
  return String(value || "").replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase()) || "Gear";
}

function isActiveProduct(product) {
  return !!product && Number(product.active) === 1;
}

function stockQty(product) {
  return Number(product && product.stock_qty || 0);
}

function isPurchasableProduct(product) {
  return isActiveProduct(product) && stockQty(product) > 0;
}

function productKey(productId) {
  return String(productId);
}

function findProduct(products, productId) {
  return products.find((product) => Number(product.id) === Number(productId));
}

function trackingUrl(carrier, number) {
  if (!number) return "";
  const normalized = String(carrier || "").toLowerCase();
  const encoded = encodeURIComponent(number);
  if (normalized.includes("usps")) return "https://tools.usps.com/go/TrackConfirmAction?tLabels=" + encoded;
  if (normalized.includes("ups")) return "https://www.ups.com/track?tracknum=" + encoded;
  if (normalized.includes("fedex")) return "https://www.fedex.com/fedextrack/?trknbr=" + encoded;
  return "";
}

function loadPayPalSdk(config) {
  if (!config?.enabled) return Promise.resolve(false);
  if (window.paypal) return Promise.resolve(true);
  if (paypalSdkPromise) return paypalSdkPromise;
  paypalSdkPromise = new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = "https://www.paypal.com/sdk/js?client-id=" +
      encodeURIComponent(config.clientId) + "&currency=USD&intent=capture";
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
  return paypalSdkPromise;
}

function requestJson(base, path, { method = "GET", token, body } = {}) {
  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = "Bearer " + token;
  return fetch(base + path, {
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
    headers,
    method,
  });
}

function uniqueValues(products, key) {
  return [...new Set(products
    .map((product) => product[key])
    .filter((value) => value != null && String(value).trim() !== "")
    .map(String))]
    .sort((a, b) => a.localeCompare(b));
}

function note(text) {
  return h("p", { className: "wallet-note" }, text);
}

function OrderCard({ order }) {
  const label = (order.tracking_carrier ? order.tracking_carrier + " " : "") + order.tracking_number;
  const url = trackingUrl(order.tracking_carrier, order.tracking_number);
  return h("div", { className: "my-order" }, [
    h("div", { className: "my-order-head", key: "head" }, [
      h("strong", { key: "num" }, "Order #" + order.id),
      h("span", {
        className: "my-order-status status-" + (order.status || "submitted"),
        key: "status",
      }, ORDER_LABELS[order.status] || order.status || "Order received"),
    ]),
    h("div", { className: "my-order-meta", key: "meta" },
      (order.created_at ? String(order.created_at).split(" ")[0] + " - " : "") + money(order.total_cents)),
    ...(Array.isArray(order.items) ? order.items : []).map((item, index) =>
      h("div", { className: "my-order-item", key: `${item.name_snapshot || "item"}-${index}` },
        (item.quantity || 1) + " x " + item.name_snapshot)),
    order.tracking_number
      ? h("div", { className: "my-order-tracking", key: "tracking" }, url
          ? h("a", { href: url, rel: "noopener noreferrer", target: "_blank" }, "Track: " + label)
          : "Tracking: " + label)
      : null,
  ]);
}

function MyOrders({ orders }) {
  if (!orders.length) return null;
  return h("div", { className: "my-orders-panel", "data-react-pro-shop-orders": "true" }, [
    h("h2", { className: "my-orders-title", key: "title" }, "My orders"),
    h("div", { className: "my-orders-list", key: "list" },
      orders.slice(0, 10).map((order) => h(OrderCard, { key: order.id, order }))),
  ]);
}

function WalletPanel({ wallet }) {
  const signedOut = wallet.status === "signed-out";
  const balance = wallet.status === "ready" ? money(wallet.balanceCents) : signedOut ? "Sign in" : "Loading";
  return h("aside", { className: "wallet-panel" }, [
    h("div", { className: "wallet-label", key: "label" }, "Store credit"),
    h("div", { className: "wallet-balance", key: "balance" }, balance),
    signedOut
      ? h("p", { className: "wallet-note", key: "note" },
          h("a", { href: "gvdg-members.html" }, "Log in on the Members page"),
          " to use your player wallet.")
      : h("p", { className: "wallet-note", key: "note" },
          wallet.status === "error" ? "Wallet details are unavailable right now." : "Available for pro shop purchases."),
  ]);
}

function ProductVisual({ product }) {
  if (product.image_url) {
    return h("img", {
      alt: product.name || "Product image",
      className: "product-img",
      loading: "lazy",
      src: product.image_url,
    });
  }
  return h("div", {
    "aria-label": "No product image available",
    className: "product-fallback",
    role: "img",
  }, (product.brand || product.name || "?").slice(0, 1).toUpperCase());
}

function ProductCard({ onAdd, product }) {
  const purchasable = isPurchasableProduct(product);
  return h("article", { className: "product-card" }, [
    h(ProductVisual, { key: "visual", product }),
    h("div", { className: "product-body", key: "body" }, [
      h("div", { className: "product-name", key: "name" }, product.name || "Product"),
      h("div", { className: "product-meta", key: "meta" }, [
        product.brand,
        typeLabel(product.product_type),
        product.color,
        product.weight_g != null ? product.weight_g + "g" : "",
        stockQty(product) + " in stock",
      ].filter(Boolean).join(" - ")),
      product.description
        ? h("div", { className: "product-meta", key: "description" }, product.description)
        : null,
      h("div", { className: "product-bottom", key: "bottom" }, [
        h("div", { className: "product-price", key: "price" }, money(product.price_cents || 0)),
        h("button", {
          className: "shop-btn",
          disabled: !purchasable,
          key: "add",
          onClick: () => onAdd(product.id),
          type: "button",
        }, purchasable ? "Add" : "Unavailable"),
      ]),
    ]),
  ]);
}

function Filters({ filters, onChange, products }) {
  function select(id, value, values, labeler = (item) => item) {
    return h("select", {
      id,
      onChange: (event) => onChange(id, event.target.value),
      value,
    }, [
      h("option", { key: "all", value: "" }, id === "typeFilter" ? "All types" : id === "weightFilter" ? "All weights" : id === "colorFilter" ? "All colors" : "All brands"),
      ...values.map((item) => h("option", { key: item, value: item }, labeler(item))),
    ]);
  }

  return h("div", { "aria-label": "Shop filters", className: "filters" }, [
    h("input", {
      id: "shopSearch",
      key: "search",
      onChange: (event) => onChange("shopSearch", event.target.value),
      placeholder: "Search shop",
      type: "search",
      value: filters.shopSearch,
    }),
    h(React.Fragment, { key: "brand" }, select("brandFilter", filters.brandFilter, uniqueValues(products, "brand"))),
    h(React.Fragment, { key: "color" }, select("colorFilter", filters.colorFilter, uniqueValues(products, "color"))),
    h(React.Fragment, { key: "weight" }, select("weightFilter", filters.weightFilter, uniqueValues(products, "weight_g"), (value) => value + "g")),
    h(React.Fragment, { key: "type" }, select("typeFilter", filters.typeFilter, uniqueValues(products, "product_type"), typeLabel)),
    h("select", {
      id: "sortSelect",
      key: "sort",
      onChange: (event) => onChange("sortSelect", event.target.value),
      value: filters.sortSelect,
    }, [
      h("option", { key: "brand", value: "brand" }, "Sort by brand"),
      h("option", { key: "color", value: "color" }, "Sort by color"),
      h("option", { key: "weight", value: "weight" }, "Sort by weight"),
      h("option", { key: "type", value: "type" }, "Sort by type"),
      h("option", { key: "price_asc", value: "price_asc" }, "Price low to high"),
      h("option", { key: "price_desc", value: "price_desc" }, "Price high to low"),
    ]),
  ]);
}

function ProductGrid({ onAdd, products, status }) {
  if (status === "loading") {
    return h("div", { className: "product-grid" }, note("Loading shop products..."));
  }
  if (status === "error") {
    return h("div", { className: "product-grid" }, note("The shop could not load. Please try again."));
  }
  return h("div", { className: "product-grid" }, products.length
    ? products.map((product) => h(ProductCard, { key: product.id, onAdd, product }))
    : note("No products match those filters."));
}

function CartRow({ onChange, product, quantity }) {
  return h("div", { className: "cart-row" }, [
    h("div", { key: "info" }, [
      h("div", { className: "cart-name", key: "name" }, product.name || "Product"),
      h("div", { className: "cart-meta", key: "meta" }, quantity + " x " + money(product.price_cents || 0)),
    ]),
    h("div", { className: "cart-actions", key: "actions" }, [
      h("button", {
        "aria-label": "Decrease " + (product.name || "product") + " quantity",
        key: "dec",
        onClick: () => onChange(product.id, -1),
        type: "button",
      }, "-"),
      h("button", {
        "aria-label": "Increase " + (product.name || "product") + " quantity",
        key: "inc",
        onClick: () => onChange(product.id, 1),
        type: "button",
      }, "+"),
    ]),
  ]);
}

function PayPalButtons({ config, createOrder, onApprove, onLoadError, onCancel, onError, signature }) {
  const hostRef = React.useRef(null);
  const createOrderRef = useLatest(createOrder);
  const onApproveRef = useLatest(onApprove);
  const onCancelRef = useLatest(onCancel);
  const onErrorRef = useLatest(onError);
  const onLoadErrorRef = useLatest(onLoadError);
  const hostKey = `${config?.clientId || "paypal-disabled"}:${signature || "empty-cart"}`;

  React.useEffect(() => {
    const host = hostRef.current;
    if (!host || !config?.enabled) return undefined;
    let active = true;
    loadPayPalSdk(config).then((ready) => {
      if (!active) return;
      if (!ready || !window.paypal) {
        onLoadErrorRef.current();
        return;
      }
      window.paypal.Buttons({
        createOrder: (...args) => createOrderRef.current(...args),
        onApprove: (...args) => onApproveRef.current(...args),
        onCancel: (...args) => onCancelRef.current(...args),
        onError: (...args) => onErrorRef.current(...args),
      }).render(host);
    });
    return () => {
      active = false;
    };
  }, [config?.clientId, config?.enabled, hostKey]);

  return h("div", { className: "paypal-wrap", style: { display: "block" } },
    h("div", { "data-paypal-button-host": "true", key: hostKey, ref: hostRef }));
}

export function ProShopApp() {
  const [apiBase] = React.useState(authBase);
  const [token] = React.useState(currentToken);
  const [products, setProducts] = React.useState([]);
  const [productsStatus, setProductsStatus] = React.useState("loading");
  const [wallet, setWallet] = React.useState({
    balanceCents: 0,
    orders: [],
    status: token ? "loading" : "signed-out",
  });
  const [paymentsConfig, setPaymentsConfig] = React.useState(null);
  const [cart, setCart] = React.useState(() => new Map());
  const [filters, setFilters] = React.useState({
    brandFilter: "",
    colorFilter: "",
    shopSearch: "",
    sortSelect: "brand",
    typeFilter: "",
    weightFilter: "",
  });
  const [guest, setGuest] = React.useState({ contact: "", name: "" });
  const [status, setStatus] = React.useState({ message: "", tone: "" });
  const [checkoutPending, setCheckoutPending] = React.useState(false);
  const [paypalPending, setPaypalPending] = React.useState(false);
  const productsRef = React.useRef(products);
  const cartRef = React.useRef(cart);
  const checkoutKeyRef = React.useRef(null);

  const notify = React.useCallback((message, tone = "") => {
    setStatus({ message: message || "", tone: tone || "" });
  }, []);

  const api = React.useCallback((path, options) => requestJson(apiBase, path, options), [apiBase]);

  const pruneCart = React.useCallback((message) => {
    const next = new Map(cartRef.current);
    let changed = false;
    for (const [id, quantity] of Array.from(next.entries())) {
      const product = findProduct(productsRef.current, id);
      if (!isPurchasableProduct(product)) {
        next.delete(id);
        changed = true;
        continue;
      }
      const stock = stockQty(product);
      if (quantity > stock) {
        next.set(id, stock);
        changed = true;
      }
    }
    if (changed) {
      cartRef.current = next;
      setCart(next);
      if (message) notify(message, "error");
    }
    return next;
  }, [notify]);

  const loadProducts = React.useCallback(async () => {
    setProductsStatus("loading");
    try {
      const response = await api("/shop/products?sort=brand");
      const body = response.ok ? await response.json().catch(() => ({})) : {};
      const nextProducts = (body.products || []).filter(isActiveProduct);
      productsRef.current = nextProducts;
      setProducts(nextProducts);
      setProductsStatus("ready");
      pruneCart("One or more cart items are no longer available.");
    } catch {
      setProductsStatus("error");
      notify("Could not load the shop. Please try again.", "error");
    }
  }, [api, notify, pruneCart]);

  const loadWallet = React.useCallback(async () => {
    if (!token) {
      setWallet({ balanceCents: 0, orders: [], status: "signed-out" });
      return;
    }
    setWallet((current) => ({ ...current, status: "loading" }));
    try {
      const response = await api("/shop/wallet", { token });
      if (!response.ok) throw new Error("wallet_failed");
      const body = await response.json();
      setWallet({
        balanceCents: body.balance_cents || 0,
        orders: Array.isArray(body.orders) ? body.orders : [],
        status: "ready",
      });
    } catch {
      setWallet({ balanceCents: 0, orders: [], status: "error" });
    }
  }, [api, token]);

  React.useEffect(() => {
    productsRef.current = products;
    pruneCart("One or more cart items are no longer available.");
  }, [products, pruneCart]);

  React.useEffect(() => {
    cartRef.current = cart;
  }, [cart]);

  React.useEffect(() => {
    loadWallet();
    api("/payments/config")
      .then((response) => response.ok ? response.json() : { enabled: false })
      .then((config) => setPaymentsConfig(config || { enabled: false }))
      .catch(() => setPaymentsConfig({ enabled: false }));
    loadProducts();
  }, [api, loadProducts, loadWallet]);

  const filteredProducts = React.useMemo(() => {
    const q = filters.shopSearch.trim().toLowerCase();
    const list = products.filter((product) => {
      const haystack = [
        product.name,
        product.brand,
        product.color,
        product.product_type,
        product.weight_g != null ? String(product.weight_g) : "",
      ].join(" ").toLowerCase();
      return isPurchasableProduct(product) &&
        (!q || haystack.includes(q)) &&
        (!filters.brandFilter || String(product.brand) === filters.brandFilter) &&
        (!filters.colorFilter || String(product.color) === filters.colorFilter) &&
        (!filters.weightFilter || String(product.weight_g) === filters.weightFilter) &&
        (!filters.typeFilter || String(product.product_type) === filters.typeFilter);
    });
    const byText = (key) => [...list].sort((a, b) =>
      String(a[key] || "").localeCompare(String(b[key] || "")) ||
      String(a.name || "").localeCompare(String(b.name || "")));
    if (filters.sortSelect === "color") return byText("color");
    if (filters.sortSelect === "weight") return [...list].sort((a, b) =>
      (Number(a.weight_g || 9999) - Number(b.weight_g || 9999)) ||
      String(a.name || "").localeCompare(String(b.name || "")));
    if (filters.sortSelect === "type") return byText("product_type");
    if (filters.sortSelect === "price_asc") return [...list].sort((a, b) => Number(a.price_cents || 0) - Number(b.price_cents || 0));
    if (filters.sortSelect === "price_desc") return [...list].sort((a, b) => Number(b.price_cents || 0) - Number(a.price_cents || 0));
    return byText("brand");
  }, [filters, products]);

  const cartEntries = React.useMemo(() => Array.from(cart.entries()).map(([id, quantity]) => ({
    product: findProduct(products, id),
    quantity,
  })).filter((entry) => entry.product), [cart, products]);

  const cartTotal = React.useMemo(() => cartEntries.reduce((total, entry) =>
    total + Number(entry.product.price_cents || 0) * entry.quantity, 0), [cartEntries]);
  const hasCart = cart.size > 0;
  const signedIn = !!token;
  const sdkEnabled = !!(paymentsConfig && paymentsConfig.enabled);
  const cartSignature = React.useMemo(() => JSON.stringify(Array.from(cart.entries())), [cart]);

  function cartItemsPayload(map = cartRef.current) {
    return Array.from(map.entries()).map(([productId, quantity]) => ({
      product_id: Number(productId),
      quantity,
    }));
  }

  function updateFilter(id, value) {
    setFilters((current) => ({ ...current, [id]: value }));
  }

  function addToCart(productId) {
    const product = findProduct(productsRef.current, productId);
    if (!isPurchasableProduct(product)) {
      notify("That product is no longer available.", "error");
      return;
    }
    setCart((current) => {
      const key = productKey(productId);
      const next = new Map(current);
      const quantity = next.get(key) || 0;
      if (quantity >= stockQty(product)) {
        notify("That is all the stock available for this product.", "error");
        return current;
      }
      next.set(key, quantity + 1);
      cartRef.current = next;
      notify("");
      return next;
    });
  }

  function changeQty(productId, delta) {
    const product = findProduct(productsRef.current, productId);
    if (!isPurchasableProduct(product)) {
      setCart((current) => {
        const next = new Map(current);
        next.delete(productKey(productId));
        cartRef.current = next;
        return next;
      });
      notify("That product is no longer available.", "error");
      return;
    }
    setCart((current) => {
      const key = productKey(productId);
      const next = new Map(current);
      const quantity = (next.get(key) || 0) + delta;
      if (quantity <= 0) next.delete(key);
      else if (quantity <= stockQty(product)) next.set(key, quantity);
      else notify("That is all the stock available for this product.", "error");
      cartRef.current = next;
      return next;
    });
  }

  async function payWithPaypal() {
    const current = pruneCart("One or more cart items are no longer available.");
    if (!current.size) {
      notify("Add an item before checking out.", "error");
      return;
    }
    const name = guest.name.trim();
    const contact = guest.contact.trim();
    if (!token && !name) {
      notify("Enter your name so the club can match your PayPal payment to your order.", "error");
      return;
    }
    setPaypalPending(true);
    try {
      const response = await api("/shop/paypal-order", {
        body: { contact: contact || null, items: cartItemsPayload(current), name: name || null },
        method: "POST",
        token: token || undefined,
      });
      const body = await response.json().catch(() => ({}));
      if (response.status === 201 && body.amount_cents != null) {
        notify("Opening PayPal... complete your payment to @greenvillediscgolf to finish the order.", "success");
        window.location.href = "https://www.paypal.com/paypalme/greenvillediscgolf/" + (body.amount_cents / 100).toFixed(2);
      } else if (body.error === "insufficient_stock" || body.error === "product_unavailable") {
        notify("An item is no longer available. Refreshing the shop.", "error");
        await loadProducts();
      } else {
        notify("Could not start PayPal checkout. Please try again.", "error");
      }
    } catch {
      notify("Could not reach the store. Please try again.", "error");
    } finally {
      setPaypalPending(false);
    }
  }

  async function checkout() {
    if (!token) {
      notify("Log in on the Members page before spending store credit.", "error");
      return;
    }
    const current = pruneCart("One or more cart items are no longer available.");
    if (!current.size) {
      notify("Add an item before checking out.", "error");
      return;
    }
    if (!checkoutKeyRef.current) {
      checkoutKeyRef.current = window.crypto && crypto.randomUUID
        ? crypto.randomUUID()
        : String(Date.now()) + "-" + Math.random().toString(36).slice(2);
    }
    setCheckoutPending(true);
    try {
      const response = await api("/shop/orders", {
        body: { idempotency_key: checkoutKeyRef.current, items: cartItemsPayload(current) },
        method: "POST",
        token,
      });
      const body = await response.json().catch(() => ({}));
      if (response.status === 201 || response.status === 200) {
        const empty = new Map();
        cartRef.current = empty;
        setCart(empty);
        checkoutKeyRef.current = null;
        setWallet((currentWallet) => ({ ...currentWallet, balanceCents: body.balance_cents || 0, status: "ready" }));
        notify("Order submitted. The club will have it ready for pickup.", "success");
        await loadProducts();
        await loadWallet();
      } else if (body.error === "insufficient_store_credit") {
        notify("Not enough store credit. Balance: " + money(body.balance_cents || 0) + ", cart: " + money(body.total_cents || 0) + ".", "error");
      } else if (body.error === "insufficient_stock") {
        notify("One item no longer has enough stock. Refreshing inventory.", "error");
        await loadProducts();
      } else if (body.error === "product_unavailable") {
        notify("One item is no longer available. Refreshing inventory.", "error");
        await loadProducts();
      } else {
        notify("Checkout failed. Please try again or see an admin.", "error");
      }
    } catch {
      notify("Network error. Please try again.", "error");
    } finally {
      setCheckoutPending(false);
    }
  }

  const createPayPalOrder = React.useCallback(async () => {
    const current = pruneCart("One or more cart items are no longer available.");
    if (!current.size) {
      notify("Add an item before checking out.", "error");
      throw new Error("empty_cart");
    }
    const name = guest.name.trim();
    if (!token && !name) {
      notify("Enter your name so the club can match your order.", "error");
      throw new Error("name_required");
    }
    const response = await api("/shop/pay/create-order", {
      body: { items: cartItemsPayload(current), name: name || null },
      method: "POST",
      token: token || undefined,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.orderId) {
      if (body.error === "insufficient_stock") notify("One item no longer has enough stock. Refreshing inventory.", "error");
      else if (body.error === "product_unavailable") notify("One item is no longer available. Refreshing inventory.", "error");
      else if (body.error === "name_required") notify("Enter your name to check out.", "error");
      else notify("PayPal checkout could not start. Please try again.", "error");
      if (body.error === "insufficient_stock" || body.error === "product_unavailable") await loadProducts();
      throw new Error(body.error || "paypal_create_failed");
    }
    return body.orderId;
  }, [api, guest.name, loadProducts, notify, pruneCart, token]);

  const approvePayPalOrder = React.useCallback(async (data) => {
    const response = await api("/shop/pay/capture", {
      body: { orderId: data.orderID },
      method: "POST",
      token: token || undefined,
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      const empty = new Map();
      cartRef.current = empty;
      setCart(empty);
      notify("PayPal payment received. The club will have your order ready for pickup.", "success");
      await loadWallet();
      await loadProducts();
      return;
    }
    if (body.error === "insufficient_stock" || body.error === "product_unavailable") {
      notify("One item is no longer available. Refreshing inventory.", "error");
      await loadProducts();
      return;
    }
    notify("PayPal payment could not be confirmed. Please contact the club if you were charged.", "error");
  }, [api, loadProducts, loadWallet, notify, token]);

  return h("main", { "data-react-pro-shop": productsStatus }, [
    h("div", { className: "shop-head", key: "head" }, [
      h("div", { key: "copy" }, [
        h("h1", { className: "page-title", key: "title" }, "Pro Shop"),
        h("p", { className: "page-subtitle", key: "subtitle" },
          "Browse club discs and gear, then spend store credit earned from events or check out with PayPal."),
      ]),
      h(WalletPanel, { key: "wallet", wallet }),
    ]),
    h(MyOrders, { key: "orders", orders: wallet.orders }),
    h("div", { className: "shop-shell", key: "shell" }, [
      h("section", { key: "products" }, [
        h(Filters, { filters, key: "filters", onChange: updateFilter, products }),
        h(ProductGrid, { key: "grid", onAdd: addToCart, products: filteredProducts, status: productsStatus }),
      ]),
      h("aside", { className: "cart", key: "cart" }, [
        h("h2", { key: "title" }, "Cart"),
        h("div", { className: "cart-list", key: "list" }, cartEntries.length
          ? cartEntries.map(({ product, quantity }) => h(CartRow, {
              key: product.id,
              onChange: changeQty,
              product,
              quantity,
            }))
          : note("Your cart is empty.")),
        h("div", { className: "cart-total", key: "total" }, [
          h("span", { key: "label" }, "Total"),
          h("span", { key: "amount" }, money(cartTotal)),
        ]),
        signedIn
          ? h("button", {
              className: "shop-btn",
              disabled: !hasCart || checkoutPending,
              key: "checkout",
              onClick: checkout,
              type: "button",
            }, checkoutPending ? "Submitting..." : "Spend store credit")
          : null,
        signedIn && hasCart ? h("div", { className: "payment-divider", key: "divider", style: { display: "flex" } }, "or") : null,
        !signedIn && hasCart
          ? h("div", { className: "paypal-fields", key: "guest" }, [
              h("input", {
                id: "ppName",
                key: "name",
                maxLength: 80,
                onChange: (event) => setGuest((current) => ({ ...current, name: event.target.value })),
                placeholder: "Your name",
                type: "text",
                value: guest.name,
              }),
              h("input", {
                id: "ppContact",
                key: "contact",
                maxLength: 120,
                onChange: (event) => setGuest((current) => ({ ...current, contact: event.target.value })),
                placeholder: "Email or phone (so we can reach you)",
                type: "text",
                value: guest.contact,
              }),
            ])
          : null,
        !sdkEnabled && hasCart
          ? h("button", {
              className: "shop-btn secondary",
              disabled: !hasCart || paypalPending,
              key: "paypal-redirect",
              onClick: payWithPaypal,
              type: "button",
            }, paypalPending ? "Opening..." : "Pay with PayPal")
          : null,
        sdkEnabled && hasCart
          ? h(PayPalButtons, {
              config: paymentsConfig,
              createOrder: createPayPalOrder,
              key: "paypal-buttons",
              onApprove: approvePayPalOrder,
              onCancel: () => notify("PayPal checkout canceled."),
              onError: () => notify("PayPal checkout was interrupted. Please try again.", "error"),
              onLoadError: () => notify("PayPal could not load. Store credit checkout is still available.", "error"),
              signature: cartSignature,
            })
          : null,
        h("div", {
          "aria-live": "polite",
          className: "shop-status" + (status.tone ? " " + status.tone : ""),
          key: "status",
          role: "status",
        }, status.message),
      ]),
    ]),
  ]);
}
