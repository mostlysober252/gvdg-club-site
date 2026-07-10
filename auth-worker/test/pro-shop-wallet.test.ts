import { afterEach, describe, expect, it, vi } from "vitest";
import { call, makeDb, stubPayPal, token, type Row } from "./pro-shop-fixture.js";

afterEach(() => vi.unstubAllGlobals());

describe("pro shop and player wallets", () => {
  it("lists active shop products publicly", async () => {
    const res = await call("/shop/products?brand=innova&sort=weight");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { products: Row[] };
    expect(body.products[0]?.name).toBe("Roc");
  });

  it("keeps inactive products out of public shop listings even when they have stock", async () => {
    const dbState = makeDb({
      products: [
        { id: 1, category: "disc", name: "Archived Popcorn", brand: "Clash", price_cents: 1000, stock_qty: 1, active: 0 },
        { id: 2, category: "disc", name: "Live Popcorn", brand: "Clash", price_cents: 1000, stock_qty: 3, active: 1 },
      ],
    });
    const res = await call("/shop/products?sort=brand", "GET", undefined, undefined, dbState);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { products: Row[] };
    expect(body.products.map((p) => p.name)).toEqual(["Live Popcorn"]);
  });

  it("allows only admins to create products", async () => {
    const dbState = makeDb();
    const body = { category: "disc", name: "Zone", brand: "Discraft", product_type: "Putter", color: "Blue", weight_g: 174, price_cents: 1900, stock_qty: 4, image_url: "https://example.com/zone.jpg" };
    expect((await call("/admin/shop/products", "POST", await token("m_jane"), body, dbState)).status).toBe(403);
    const res = await call("/admin/shop/products", "POST", await token("m_admin"), body, dbState);
    expect(res.status).toBe(201);
    expect(dbState.state.products.some((p) => p.name === "Zone")).toBe(true);
  });

  it("sorts and filters admin inventory products", async () => {
    const dbState = makeDb({
      products: [
        { id: 1, category: "disc", name: "Roc", brand: "Innova", price_cents: 1800, stock_qty: 2, active: 1 },
        { id: 2, category: "disc", name: "Aviar", brand: "Innova", price_cents: 1200, stock_qty: 5, active: 1 },
        { id: 3, category: "disc", name: "Archived Buzzz", brand: "Discraft", price_cents: 1500, stock_qty: 0, active: 0 },
      ],
    });
    const res = await call("/admin/shop/products?sort=name&status=active", "GET", await token("m_admin"), undefined, dbState);
    expect(res.status).toBe(200);
    const active = (await res.json()) as { products: Row[] };
    expect(active.products.map((p) => p.name)).toEqual(["Aviar", "Roc"]);

    const archivedRes = await call("/admin/shop/products?status=inactive", "GET", await token("m_admin"), undefined, dbState);
    const archived = (await archivedRes.json()) as { products: Row[] };
    expect(archived.products.map((p) => p.name)).toEqual(["Archived Buzzz"]);
  });

  it("removes an admin-deactivated product from the public storefront", async () => {
    const dbState = makeDb({
      products: [{ id: 1, category: "disc", name: "Seasonal Disc", brand: "Mint", price_cents: 1600, stock_qty: 2, active: 1 }],
    });
    const auth = await token("m_admin");
    const patched = await call("/admin/shop/products/1", "PATCH", auth, { active: false }, dbState);
    expect(patched.status).toBe(200);
    expect(dbState.state.products[0]?.active).toBe(0);

    const publicRes = await call("/shop/products", "GET", undefined, undefined, dbState);
    const body = (await publicRes.json()) as { products: Row[] };
    expect(body.products).toHaveLength(0);
  });

  it("deletes unused inventory products", async () => {
    const dbState = makeDb({
      products: [{ id: 7, category: "disc", name: "Unused Disc", brand: "Mint", price_cents: 1600, stock_qty: 1, active: 1 }],
    });
    const res = await call("/admin/shop/products/7", "DELETE", await token("m_admin"), undefined, dbState);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { deleted: boolean; archived: boolean };
    expect(body.deleted).toBe(true);
    expect(body.archived).toBe(false);
    expect(dbState.state.products).toHaveLength(0);
  });

  it("hard-deletes inventory products that are tied to order history", async () => {
    const dbState = makeDb({
      products: [{ id: 8, category: "disc", name: "Ordered Disc", brand: "MVP", price_cents: 1700, stock_qty: 1, active: 1 }],
    });
    dbState.state.orderItems.push({ id: 21, order_id: 10, product_id: 8, name_snapshot: "Ordered Disc", price_cents: 1700, quantity: 1 });
    const res = await call("/admin/shop/products/8", "DELETE", await token("m_admin"), undefined, dbState);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { deleted: boolean; archived?: boolean; reason?: string | null };
    expect(body.deleted).toBe(true);
    expect(body.archived).toBe(false);
    expect(body.reason).toBeNull();
    expect(dbState.state.products).toHaveLength(0);
    expect(dbState.state.orderItems[0]).toMatchObject({ product_id: null, name_snapshot: "Ordered Disc", quantity: 1 });
  });

  it("rejects products with negative price or stock", async () => {
    const dbState = makeDb();
    const auth = await token("m_admin");
    expect((await call("/admin/shop/products", "POST", auth, { name: "Bad Price", price_cents: -100, stock_qty: 1 }, dbState)).status).toBe(400);
    expect((await call("/admin/shop/products", "POST", auth, { name: "Bad Stock", price_cents: 100, stock_qty: -1 }, dbState)).status).toBe(400);
    expect((await call("/admin/shop/products", "POST", auth, { name: "Bad Image", price_cents: 100, image_url: "http://example.com/disc.jpg" }, dbState)).status).toBe(400);
  });

  it("credits store payout prizes from an admin event", async () => {
    const dbState = makeDb({ balanceCents: 200 });
    const res = await call("/admin/events/7/store-credit", "POST", await token("m_admin"), { member_id: "m_jane", amount_cents: 1500, note: "League payout" }, dbState);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { balance_cents: number; payouts: Row[] };
    expect(body.balance_cents).toBe(1700);
    expect(body.payouts[0]?.source).toBe("event_payout");
  });

  it("shows the member wallet balance and ledger", async () => {
    const dbState = makeDb({ balanceCents: 2500 });
    dbState.state.transactions.push({ id: 1, member_id: "m_jane", amount_cents: 2500, source: "event_payout" });
    const res = await call("/shop/wallet", "GET", await token("m_jane"), undefined, dbState);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { balance_cents: number; transactions: Row[] };
    expect(body.balance_cents).toBe(2500);
    expect(body.transactions).toHaveLength(1);
  });

  it("cancels a store-credit order: restocks, refunds the wallet, and marks it cancelled", async () => {
    const dbState = makeDb({ products: [{ id: 1, category: "disc", name: "Roc", brand: "Innova", price_cents: 1800, stock_qty: 5, active: 1 }] });
    dbState.state.orders.push({ id: 10, member_id: "m_jane", member_name: "Jane", total_cents: 1800, payment_method: "store_credit", status: "submitted" });
    dbState.state.orderItems.push({ id: 20, order_id: 10, product_id: 1, name_snapshot: "Roc", price_cents: 1800, quantity: 1 });
    const res = await call("/admin/orders/10", "PATCH", await token("m_admin"), { status: "cancelled" }, dbState);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { reversal: { refund: string; restocked: number } };
    expect(body.reversal).toEqual({ refund: "store_credit", restocked: 1 });
    expect(dbState.state.orders[0]?.status).toBe("cancelled");
    expect(Number(dbState.state.products[0]!.stock_qty)).toBe(6); // restocked +1
    expect(dbState.state.balanceCents).toBe(1800); // wallet refunded
  });

  it("cancelling is idempotent — a second cancel does not double-refund or double-restock", async () => {
    const dbState = makeDb({ products: [{ id: 1, category: "disc", name: "Roc", brand: "Innova", price_cents: 1800, stock_qty: 5, active: 1 }] });
    dbState.state.orders.push({ id: 10, member_id: "m_jane", member_name: "Jane", total_cents: 1800, payment_method: "store_credit", status: "submitted" });
    dbState.state.orderItems.push({ id: 20, order_id: 10, product_id: 1, name_snapshot: "Roc", price_cents: 1800, quantity: 1 });
    await call("/admin/orders/10", "PATCH", await token("m_admin"), { status: "cancelled" }, dbState);
    const second = await call("/admin/orders/10", "PATCH", await token("m_admin"), { status: "cancelled" }, dbState);
    expect(second.status).toBe(200);
    expect((await second.json() as { reversal: { restocked: number } }).reversal.restocked).toBe(0); // no-op
    expect(Number(dbState.state.products[0]!.stock_qty)).toBe(6); // still +1, not +2
    expect(dbState.state.balanceCents).toBe(1800); // still one refund
  });

  it("deletes a paid order: reverses (restock + refund) first, then removes it and its items", async () => {
    const dbState = makeDb({ products: [{ id: 1, category: "disc", name: "Roc", brand: "Innova", price_cents: 1800, stock_qty: 5, active: 1 }] });
    dbState.state.orders.push({ id: 10, member_id: "m_jane", member_name: "Jane", total_cents: 1800, payment_method: "store_credit", status: "submitted" });
    dbState.state.orderItems.push({ id: 20, order_id: 10, product_id: 1, name_snapshot: "Roc", price_cents: 1800, quantity: 1 });
    const res = await call("/admin/orders/10", "DELETE", await token("m_admin"), undefined, dbState);
    expect(res.status).toBe(200);
    expect(dbState.state.orders).toHaveLength(0);
    expect(dbState.state.orderItems).toHaveLength(0);
    expect(Number(dbState.state.products[0]!.stock_qty)).toBe(6); // restocked before delete
    expect(dbState.state.balanceCents).toBe(1800); // refunded before delete
  });

  it("rejects checkout when store credit is short", async () => {
    const dbState = makeDb({ balanceCents: 1000 });
    const res = await call("/shop/orders", "POST", await token("m_jane"), { items: [{ product_id: 1, quantity: 1 }] }, dbState);
    expect(res.status).toBe(402);
  });

  it("rejects inactive products across store-credit and PayPal checkout paths", async () => {
    const dbState = makeDb({
      balanceCents: 5000,
      products: [{ id: 1, category: "disc", name: "Archived Disc", brand: "Clash", price_cents: 1000, stock_qty: 5, active: 0 }],
    });
    const auth = await token("m_jane");

    const storeCredit = await call("/shop/orders", "POST", auth, { items: [{ product_id: 1, quantity: 1 }] }, dbState);
    expect(storeCredit.status).toBe(409);
    expect(await storeCredit.json()).toMatchObject({ error: "product_unavailable", product_id: 1 });

    const paypalRedirect = await call("/shop/paypal-order", "POST", undefined, { items: [{ product_id: 1, quantity: 1 }], name: "Guest Buyer" }, dbState);
    expect(paypalRedirect.status).toBe(409);
    expect(await paypalRedirect.json()).toMatchObject({ error: "product_unavailable", product_id: 1 });

    stubPayPal();
    const paypalCreate = await call(
      "/shop/pay/create-order",
      "POST",
      auth,
      { items: [{ product_id: 1, quantity: 1 }] },
      dbState,
      { PAYPAL_CLIENT_ID: "cid", PAYPAL_SECRET: "sec" },
    );
    expect(paypalCreate.status).toBe(409);
    expect(await paypalCreate.json()).toMatchObject({ error: "product_unavailable", product_id: 1 });
    expect(dbState.state.orders).toHaveLength(0);
    expect(dbState.state.paymentSessions).toHaveLength(0);
  });

  it("spends wallet credit on checkout and decrements stock", async () => {
    const dbState = makeDb({ balanceCents: 5000 });
    const res = await call("/shop/orders", "POST", await token("m_jane"), { items: [{ product_id: 1, quantity: 2 }] }, dbState);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { balance_cents: number };
    expect(body.balance_cents).toBe(1400);
    expect(dbState.state.orders[0]?.total_cents).toBe(3600);
    expect(dbState.state.orderItems[0]?.quantity).toBe(2);
    expect(dbState.state.products[0]?.stock_qty).toBe(0);
    expect(dbState.state.transactions[0]?.source).toBe("store_purchase");
  });

  it("creates a PayPal order from a server-priced cart", async () => {
    stubPayPal();
    const dbState = makeDb({ balanceCents: 0 });
    const res = await call("/shop/pay/create-order", "POST", await token("m_jane"), { items: [{ product_id: 1, quantity: 1 }] }, dbState, { PAYPAL_CLIENT_ID: "cid", PAYPAL_SECRET: "sec" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { orderId: string }).orderId).toBe("ORDER123");
    expect(dbState.state.paymentSessions[0]?.total_cents).toBe(1800);
  });

  it("captures PayPal and submits a shop order without spending wallet credit", async () => {
    stubPayPal();
    const dbState = makeDb({ balanceCents: 0 });
    const extra = { PAYPAL_CLIENT_ID: "cid", PAYPAL_SECRET: "sec" };
    expect((await call("/shop/pay/create-order", "POST", await token("m_jane"), { items: [{ product_id: 1, quantity: 1 }] }, dbState, extra)).status).toBe(200);
    const res = await call("/shop/pay/capture", "POST", await token("m_jane"), { orderId: "ORDER123" }, dbState, extra);
    expect(res.status).toBe(201);
    expect(dbState.state.orders[0]?.payment_method).toBe("paypal");
    expect(dbState.state.orders[0]?.payment_ref).toBe("ORDER123");
    expect(dbState.state.transactions).toHaveLength(0);
    expect(dbState.state.products[0]?.stock_qty).toBe(1);
    expect(dbState.state.paymentSessions[0]?.status).toBe("captured");
  });

  it("revalidates active inventory before capturing a PayPal order", async () => {
    stubPayPal();
    const dbState = makeDb({ balanceCents: 0 });
    const extra = { PAYPAL_CLIENT_ID: "cid", PAYPAL_SECRET: "sec" };
    expect((await call("/shop/pay/create-order", "POST", await token("m_jane"), { items: [{ product_id: 1, quantity: 1 }] }, dbState, extra)).status).toBe(200);
    dbState.state.products[0] = { ...dbState.state.products[0], active: 0 };
    const cap = await call("/shop/pay/capture", "POST", await token("m_jane"), { orderId: "ORDER123" }, dbState, extra);
    expect(cap.status).toBe(409);
    expect(await cap.json()).toMatchObject({ error: "product_unavailable", product_id: 1 });
    expect(dbState.state.orders).toHaveLength(0);
    expect(dbState.state.paymentSessions[0]?.status).toBe("pending");
  });

  it("lets a GUEST (no login) pay via PayPal with a name, and records a guest order", async () => {
    stubPayPal();
    const dbState = makeDb({ balanceCents: 0 });
    const extra = { PAYPAL_CLIENT_ID: "cid", PAYPAL_SECRET: "sec" };
    // a guest must supply a name
    expect((await call("/shop/pay/create-order", "POST", undefined, { items: [{ product_id: 1, quantity: 1 }] }, dbState, extra)).status).toBe(400);
    const created = await call("/shop/pay/create-order", "POST", undefined, { items: [{ product_id: 1, quantity: 1 }], name: "Guest Buyer" }, dbState, extra);
    expect(created.status).toBe(200);
    expect(dbState.state.paymentSessions[0]?.member_id).toBe("guest");
    expect(dbState.state.paymentSessions[0]?.member_name).toBe("Guest Buyer");
    const cap = await call("/shop/pay/capture", "POST", undefined, { orderId: "ORDER123" }, dbState, extra);
    expect(cap.status).toBe(201);
    expect(dbState.state.orders[0]?.member_id).toBe("guest");
    expect(dbState.state.orders[0]?.payment_method).toBe("paypal");
  });

  it("rejects an underpaid PayPal capture (amount < order total)", async () => {
    stubPayPal("0.01"); // PayPal reports a far smaller captured amount than the cart total
    const dbState = makeDb({ balanceCents: 0 });
    const extra = { PAYPAL_CLIENT_ID: "cid", PAYPAL_SECRET: "sec" };
    expect((await call("/shop/pay/create-order", "POST", await token("m_jane"), { items: [{ product_id: 1, quantity: 1 }] }, dbState, extra)).status).toBe(200);
    const cap = await call("/shop/pay/capture", "POST", await token("m_jane"), { orderId: "ORDER123" }, dbState, extra);
    expect(cap.status).toBe(402); // payment_incomplete — no order created
    expect(dbState.state.orders).toHaveLength(0);
  });

  it("rejects a COMPLETED order whose capture is still PENDING (unsettled eCheck)", async () => {
    stubPayPal("18.00", "PENDING", "COMPLETED"); // order COMPLETED but the capture itself is PENDING
    const dbState = makeDb({ balanceCents: 0 });
    const extra = { PAYPAL_CLIENT_ID: "cid", PAYPAL_SECRET: "sec" };
    expect((await call("/shop/pay/create-order", "POST", await token("m_jane"), { items: [{ product_id: 1, quantity: 1 }] }, dbState, extra)).status).toBe(200);
    const cap = await call("/shop/pay/capture", "POST", await token("m_jane"), { orderId: "ORDER123" }, dbState, extra);
    expect(cap.status).toBe(402); // not treated as paid; nothing fulfilled
    expect(dbState.state.orders).toHaveLength(0);
  });
});
