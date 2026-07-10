import type { Env } from "./env.js";
import type { D1Like } from "./db.js";
import * as shopDb from "./shop-db.js";
import { requireAuth } from "./authz.js";
import { getMember } from "./roster.js";
import { paypalBase, createOrder as ppCreateOrder, captureOrder as ppCaptureOrder, isCaptureSettled } from "./payments.js";
import { notifyNewOrder } from "./order-notify.js";
import { kvRateLimited } from "./kv-rate-limit.js";
import { clientIp, json, readJson } from "./http.js";
import { asInt, asStr } from "./input.js";
import { createWalletDebitOnce, findWalletTransactionByIdempotencyKey } from "./wallet-idempotency.js";

type CartItem = {
  productId: number;
  quantity: number;
};

type StoreOrderLine = {
  product_id: number;
  name_snapshot: string;
  price_cents: number;
  quantity: number;
};

type PricedCart =
  | { ok: true; total: number; lines: StoreOrderLine[] }
  | { ok: false; status: number; body: Record<string, unknown> };

function isRecord(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

function rowNumber(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  return typeof value === "number" ? value : Number(value || 0);
}

function rowText(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value : "";
}

// Who may act on a PayPal session/order: a "guest" row is open (the PayPal payment verification is the
// real control), a member's row only by that logged-in member.
function buyerMatches(rowMemberId: string, auth: { sub: string } | null): boolean {
  if (rowMemberId === "guest") return true;
  return !!auth && auth.sub === rowMemberId;
}

// A checkout caller may see their order, but not admin-only fields. The guest path has no per-caller
// auth, so never echo notes/tracking a third party holding the orderId could read.
function safeOrder(row: unknown): unknown {
  if (!row || typeof row !== "object") return row;
  const o: Record<string, unknown> = { ...(row as Record<string, unknown>) };
  delete o.admin_note;
  delete o.tracking_carrier;
  delete o.tracking_number;
  return o;
}

function cartItems(body: Record<string, unknown> | null): CartItem[] | null {
  if (!Array.isArray(body?.items)) return null;
  const merged = new Map<number, number>();
  for (const raw of body.items) {
    if (!isRecord(raw)) return null;
    const productId = asInt(raw.product_id);
    const quantity = asInt(raw.quantity);
    if (productId == null || quantity == null || quantity < 1 || quantity > 20) return null;
    merged.set(productId, (merged.get(productId) ?? 0) + quantity);
  }
  if (merged.size > 50) return null; // bound the cart so a huge id list can't overflow the SQL IN(...) params
  const items = Array.from(merged.entries()).map(([productId, quantity]) => ({ productId, quantity }));
  return items.length ? items : null;
}

function productListOptions(request: Request): shopDb.StoreProductListOptions {
  const p = new URL(request.url).searchParams;
  const weight = asInt(p.get("weight"));
  return {
    active: true,
    q: asStr(p.get("q"), 80) ?? undefined,
    brand: asStr(p.get("brand"), 80) ?? undefined,
    color: asStr(p.get("color"), 60) ?? undefined,
    product_type: asStr(p.get("type"), 60) ?? undefined,
    weight_g: weight ?? undefined,
    sort: p.get("sort") ?? undefined,
  };
}

async function priceCart(database: D1Like, items: CartItem[]): Promise<PricedCart> {
  const products = await shopDb.getStoreProductsByIds(database, items.map((item) => item.productId));
  const byId = new Map(products.map((product) => [rowNumber(product, "id"), product]));
  let total = 0;
  const lines: StoreOrderLine[] = [];
  for (const item of items) {
    const product = byId.get(item.productId);
    if (!product || rowNumber(product, "active") !== 1) return { ok: false, status: 409, body: { error: "product_unavailable", product_id: item.productId } };
    const stock = rowNumber(product, "stock_qty");
    if (stock < item.quantity) return { ok: false, status: 409, body: { error: "insufficient_stock", product_id: item.productId } };
    const price = rowNumber(product, "price_cents");
    total += price * item.quantity;
    lines.push({ product_id: item.productId, name_snapshot: rowText(product, "name"), price_cents: price, quantity: item.quantity });
  }
  if (total <= 0) return { ok: false, status: 400, body: { error: "invalid_order" } };
  return { ok: true, total, lines };
}

function parseStoredLines(value: unknown): StoreOrderLine[] | null {
  if (typeof value !== "string") return null;
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { return null; }
  if (!Array.isArray(parsed) || !parsed.length) return null;
  const lines: StoreOrderLine[] = [];
  for (const raw of parsed) {
    if (!isRecord(raw)) return null;
    const productId = asInt(raw.product_id);
    const quantity = asInt(raw.quantity);
    const price = asInt(raw.price_cents);
    const name = rowText(raw, "name_snapshot");
    if (productId == null || quantity == null || price == null || quantity < 1 || !name) return null;
    lines.push({ product_id: productId, name_snapshot: name, price_cents: price, quantity });
  }
  return lines;
}

async function validateStoredStock(database: D1Like, lines: StoreOrderLine[]): Promise<{ ok: true } | { ok: false; status: number; body: Record<string, unknown> }> {
  const products = await shopDb.getStoreProductsByIds(database, lines.map((line) => line.product_id));
  const byId = new Map(products.map((product) => [rowNumber(product, "id"), product]));
  for (const line of lines) {
    const product = byId.get(line.product_id);
    if (!product || rowNumber(product, "active") !== 1) return { ok: false, status: 409, body: { error: "product_unavailable", product_id: line.product_id } };
    if (rowNumber(product, "stock_qty") < line.quantity) return { ok: false, status: 409, body: { error: "insufficient_stock", product_id: line.product_id } };
  }
  return { ok: true };
}

async function submitStoreOrder(
  env: Env,
  ctx: ExecutionContext | undefined,
  memberId: string,
  memberName: string,
  total: number,
  lines: StoreOrderLine[],
  payment: { method: string; ref?: string | null },
  notify = true, // store-credit defers the club email until the debit succeeds (see checkout); PayPal notifies here
): Promise<{ ok: true; order: unknown; orderId: number } | { ok: false; status: number; body: Record<string, unknown> }> {
  const order = await shopDb.createStoreOrder(env.DB, { member_id: memberId, member_name: memberName, total_cents: total, payment_method: payment.method, payment_ref: payment.ref ?? null });
  const orderId = isRecord(order) ? rowNumber(order, "id") : 0;
  if (!orderId) return { ok: false, status: 500, body: { error: "order_failed" } };
  const stocked = await shopDb.addStoreOrderLinesAndDecrementStock(env.DB, orderId, lines);
  if (!stocked) {
    await shopDb.deleteStoreOrder(env.DB, orderId);
    return { ok: false, status: 409, body: { error: "insufficient_stock" } };
  }
  // New-order email to the club if configured (the admin Orders tab always shows it). Fire-and-forget.
  if (notify) ctx?.waitUntil(notifyNewOrder(env, order, lines));
  return { ok: true, order, orderId };
}

export async function handleClubShop(
  request: Request,
  env: Env,
  origin: string | null,
  method: string,
  seg: string[],
  ctx?: ExecutionContext,
): Promise<Response | null> {
  if (seg[0] !== "shop") return null;

  if (method === "GET" && seg[1] === "products") {
    return json({ products: await shopDb.listStoreProducts(env.DB, productListOptions(request)) }, 200, origin);
  }

  // PayPal.me checkout — open to ANYONE (members or guests). Records a pending order so the admin can
  // fulfill it, then the client redirects to paypal.me/greenvillediscgolf. Stock is NOT decremented:
  // payment lands in PayPal and is reconciled by the admin (mark paid / shipped from the Orders tab).
  if (method === "POST" && seg[1] === "paypal-order") {
    if (await kvRateLimited(env, "ppintent:" + clientIp(request), 10, 60)) return json({ error: "rate_limited" }, 429, origin);
    const body = (await readJson(request)) ?? {};
    const items = cartItems(body);
    if (!items) return json({ error: "invalid_order" }, 400, origin);
    const auth = await requireAuth(request, env); // optional — a logged-in member gets their identity
    let buyerId = "guest";
    let buyerName = asStr(body.name, 80) ?? "";
    if (auth) { const m = await getMember(env.ROSTER, auth.sub); if (m) { buyerId = m.memberId; buyerName = m.name; } }
    if (!buyerName) return json({ error: "name_required" }, 400, origin);
    const priced = await priceCart(env.DB, items);
    if (!priced.ok) return json(priced.body, priced.status, origin);
    const order = await shopDb.createStoreOrder(env.DB, { member_id: buyerId, member_name: buyerName, total_cents: priced.total, payment_method: "paypal_redirect", payment_ref: null });
    const orderId = isRecord(order) ? rowNumber(order, "id") : 0;
    if (!orderId) return json({ error: "order_failed" }, 500, origin);
    for (const line of priced.lines) {
      await shopDb.createStoreOrderItem(env.DB, { order_id: orderId, product_id: line.product_id, name_snapshot: line.name_snapshot, price_cents: line.price_cents, quantity: line.quantity });
    }
    const contact = asStr(body.contact, 120);
    if (contact) await shopDb.updateStoreOrderFulfillment(env.DB, orderId, { admin_note: "Contact: " + contact });
    // No email here: this path is unauthenticated and payment isn't confirmed (paypal.me reconcile-later),
    // so an email per call would be a spam/flood vector. The admin sees it in the in-app Orders tab; the
    // new-order email fires only for PAID orders (store credit / captured PayPal) via submitStoreOrder.
    return json({ orderId, amount_cents: priced.total }, 201, origin);
  }

  // PayPal Checkout with AUTOMATIC confirmation — active whenever PAYPAL_CLIENT_ID/SECRET are set, for
  // members AND guests. create-order prices the cart and opens a PayPal order; capture verifies the
  // payment server-side (status COMPLETED + amount >= total) before the order is recorded and stock
  // decremented. This supersedes the paypal.me redirect above once credentials are configured.
  if (method === "POST" && seg[1] === "pay" && seg[2] === "create-order") {
    if (!(env.PAYPAL_CLIENT_ID && env.PAYPAL_SECRET)) return json({ error: "payments_not_configured" }, 503, origin);
    if (await kvRateLimited(env, "ppcreate:" + clientIp(request), 15, 60)) return json({ error: "rate_limited" }, 429, origin);
    const body = (await readJson(request)) ?? {};
    const items = cartItems(body);
    if (!items) return json({ error: "invalid_order" }, 400, origin);
    const auth = await requireAuth(request, env);
    let buyerId = "guest";
    let buyerName = asStr(body.name, 80) ?? "";
    if (auth) { const m = await getMember(env.ROSTER, auth.sub); if (m) { buyerId = m.memberId; buyerName = m.name; } }
    if (!buyerName) return json({ error: "name_required" }, 400, origin);
    const priced = await priceCart(env.DB, items);
    if (!priced.ok) return json(priced.body, priced.status, origin);
    const creds = { clientId: env.PAYPAL_CLIENT_ID, secret: env.PAYPAL_SECRET, base: paypalBase(env.PAYPAL_ENV, env.PAYPAL_API_BASE) };
    try {
      const orderId = await ppCreateOrder(creds, priced.total, "GVDG pro shop order");
      await shopDb.createStorePaymentSession(env.DB, { paypal_order_id: orderId, member_id: buyerId, member_name: buyerName, items_json: JSON.stringify(priced.lines), total_cents: priced.total });
      return json({ orderId }, 200, origin);
    } catch (e) {
      return json({ error: "paypal_error" }, 502, origin);
    }
  }

  if (method === "POST" && seg[1] === "pay" && seg[2] === "capture") {
    if (!(env.PAYPAL_CLIENT_ID && env.PAYPAL_SECRET)) return json({ error: "payments_not_configured" }, 503, origin);
    if (await kvRateLimited(env, "ppcapture:" + clientIp(request), 20, 60)) return json({ error: "rate_limited" }, 429, origin);
    const body = (await readJson(request)) ?? {};
    const orderId = rowText(body, "orderId");
    if (!orderId) return json({ error: "invalid_request" }, 400, origin);
    const auth = await requireAuth(request, env);
    const balanceFor = async () => (auth ? shopDb.walletBalance(env.DB, auth.sub) : 0);
    const existingOrder = await shopDb.getStoreOrderByPaymentRef(env.DB, orderId); // idempotent: already captured
    if (existingOrder) {
      if (!buyerMatches(rowText(existingOrder, "member_id"), auth)) return json({ error: "forbidden" }, 403, origin);
      return json({ order: safeOrder(existingOrder), balance_cents: await balanceFor() }, 200, origin);
    }
    const session = await shopDb.getStorePaymentSession(env.DB, orderId);
    if (!session) return json({ error: "payment_session_not_found" }, 404, origin);
    if (!buyerMatches(rowText(session, "member_id"), auth)) return json({ error: "forbidden" }, 403, origin);
    const lines = parseStoredLines(session.items_json);
    const total = rowNumber(session, "total_cents");
    if (!lines || total <= 0) return json({ error: "invalid_payment_session" }, 400, origin);
    if (rowText(session, "status") === "captured") return json({ error: "capture_in_progress" }, 409, origin);
    const stock = await validateStoredStock(env.DB, lines);
    if (!stock.ok) return json(stock.body, stock.status, origin);
    const creds = { clientId: env.PAYPAL_CLIENT_ID, secret: env.PAYPAL_SECRET, base: paypalBase(env.PAYPAL_ENV, env.PAYPAL_API_BASE) };
    try {
      const cap = await ppCaptureOrder(creds, orderId);
      // Require the ORDER and the CAPTURE itself to be COMPLETED in the expected currency — a COMPLETED
      // order can still carry a PENDING eCheck/bank capture (unsettled funds) that must not be fulfilled.
      if (!isCaptureSettled(cap, total)) {
        return json({ error: "payment_incomplete" }, 402, origin);
      }
      const afterCaptureOrder = await shopDb.getStoreOrderByPaymentRef(env.DB, orderId);
      if (afterCaptureOrder) {
        if (!buyerMatches(rowText(afterCaptureOrder, "member_id"), auth)) return json({ error: "forbidden" }, 403, origin);
        return json({ order: safeOrder(afterCaptureOrder), balance_cents: await balanceFor() }, 200, origin);
      }
      const submitted = await submitStoreOrder(env, ctx, rowText(session, "member_id"), rowText(session, "member_name"), total, lines, { method: "paypal", ref: orderId });
      if (!submitted.ok) return json(submitted.body, submitted.status, origin);
      await shopDb.markStorePaymentSessionCaptured(env.DB, orderId);
      return json({ order: safeOrder(submitted.order), balance_cents: await balanceFor() }, 201, origin);
    } catch (e) {
      return json({ error: "paypal_error" }, 502, origin);
    }
  }

  const claims = await requireAuth(request, env);
  if (!claims) return json({ error: "unauthorized" }, 401, origin);
  const member = await getMember(env.ROSTER, claims.sub);
  if (!member) return json({ error: "unauthorized" }, 401, origin);

  if (method === "GET" && seg[1] === "wallet") {
    const [balance, transactions, orders] = await Promise.all([
      shopDb.walletBalance(env.DB, claims.sub),
      shopDb.listWalletTransactions(env.DB, claims.sub),
      shopDb.listStoreOrders(env.DB, claims.sub),
    ]);
    return json({ balance_cents: balance, transactions, orders }, 200, origin);
  }

  if (method === "POST" && seg[1] === "orders") {
    const body = (await readJson(request)) ?? {};
    const items = cartItems(body);
    if (!items) return json({ error: "invalid_order" }, 400, origin);
    // A client idempotency key makes the WHOLE checkout idempotent: a retried/double-submitted request with
    // the same key returns the original order + debit instead of charging twice. Optional — without it the
    // debit is still atomic per order (can't overdraw), but a double-submit isn't deduped.
    const idemKey = asStr(body.idempotency_key, 160);
    const debitKey = idemKey ? "store_order:" + claims.sub + ":" + idemKey : null;
    if (debitKey) {
      const prior = await findWalletTransactionByIdempotencyKey(env.DB, debitKey);
      if (prior) {
        const priorOrderId = asInt((prior as Record<string, unknown>).order_id) ?? 0;
        const priorOrder = priorOrderId ? await shopDb.getStoreOrderById(env.DB, priorOrderId) : null;
        return json({ order: priorOrder, transaction: prior, balance_cents: await shopDb.walletBalance(env.DB, claims.sub) }, 200, origin);
      }
    }
    const priced = await priceCart(env.DB, items);
    if (!priced.ok) return json(priced.body, priced.status, origin);
    // Early, friendly balance check so the common "too short" case is a clean 402 without creating an order.
    // It is NOT the safety guarantee — the atomic debit below is.
    const balance = await shopDb.walletBalance(env.DB, claims.sub);
    if (balance < priced.total) return json({ error: "insufficient_store_credit", balance_cents: balance, total_cents: priced.total }, 402, origin);
    const submitted = await submitStoreOrder(env, ctx, claims.sub, member.name, priced.total, priced.lines, { method: "store_credit" }, false); // defer the club email until the debit lands
    if (!submitted.ok) return json(submitted.body, submitted.status, origin);
    // Atomic, idempotent debit: balance-checked INSIDE the INSERT so two concurrent debits can never
    // overdraw the wallet (the fix for the old check-then-debit race). matchOrderId:false — the key
    // identifies the purchase, and a deduped concurrent attempt legitimately carries a different order_id.
    const debit = await createWalletDebitOnce(
      env.DB,
      {
        member_id: claims.sub,
        member_name: member.name,
        amount_cents: -priced.total,
        transaction_type: "debit",
        source: "store_purchase",
        order_id: submitted.orderId,
        note: "Pro shop order #" + submitted.orderId,
        idempotency_key: debitKey ?? "store_order:" + submitted.orderId,
      },
      { matchOrderId: false },
    );
    // Roll the just-created order back (delete + restore stock) whenever the debit didn't create a fresh
    // charge for THIS order — insufficient funds, a key conflict, or a dedup to a concurrent winner — so the
    // member is never left with an unpaid order or stock they didn't pay for.
    const rollback = async () => {
      await shopDb.deleteStoreOrder(env.DB, submitted.orderId);
      for (const line of priced.lines) await shopDb.incrementStoreProductStock(env.DB, line.product_id, line.quantity);
    };
    if (!debit.ok) {
      await rollback();
      const balanceNow = await shopDb.walletBalance(env.DB, claims.sub);
      if (debit.error === "insufficient_balance") return json({ error: "insufficient_store_credit", balance_cents: balanceNow, total_cents: priced.total }, 402, origin);
      return json({ error: "order_failed" }, 409, origin);
    }
    if (!debit.created) {
      // Deduped to a concurrent same-key winner: drop our duplicate order, return the one that was paid for.
      await rollback();
      const priorOrderId = asInt((debit.transaction as Record<string, unknown>).order_id) ?? 0;
      const priorOrder = priorOrderId ? await shopDb.getStoreOrderById(env.DB, priorOrderId) : submitted.order;
      return json({ order: priorOrder, transaction: debit.transaction, balance_cents: await shopDb.walletBalance(env.DB, claims.sub) }, 200, origin);
    }
    // Debit succeeded and this order is the real charge — NOW notify the club (rolled-back orders never do).
    ctx?.waitUntil(notifyNewOrder(env, submitted.order, priced.lines));
    return json({ order: submitted.order, transaction: debit.transaction, balance_cents: await shopDb.walletBalance(env.DB, claims.sub) }, 201, origin);
  }

  return json({ error: "not_found" }, 404, origin);
}
