import { vi } from "vitest";
import worker from "../src/index.js";
import { signSession } from "../src/jwt.js";
import type { Env } from "../src/index.js";

const SECRET = "x".repeat(40);
const ORIGIN = "http://localhost:8080";

const memberRows = {
  "member:m_jane": JSON.stringify({ memberId: "m_jane", name: "Jane", isAdmin: false, pinHash: "x", mustChangePin: false }),
  "member:m_admin": JSON.stringify({ memberId: "m_admin", name: "Admin", isAdmin: true, pinHash: "x", mustChangePin: false }),
};

export type Row = Record<string, unknown>;

type MockState = {
  balanceCents: number;
  eventExists: boolean;
  nextProductId: number;
  nextOrderId: number;
  nextOrderItemId: number;
  nextTransactionId: number;
  products: Row[];
  orders: Row[];
  orderItems: Row[];
  transactions: Row[];
  paymentSessions: Row[];
};

type MockResult = {
  results: Row[];
  success: boolean;
  meta?: {
    changes?: number;
    rows_written?: number;
  };
};

type MockStatement = {
  readonly sql: string;
  readonly args: () => unknown[];
  bind(...args: unknown[]): MockStatement;
  all(): Promise<MockResult>;
  first(): Promise<Row | null>;
  run(): Promise<MockResult>;
};

function kv(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return {
    get: async (k: string) => m.get(k) ?? null,
    put: async (k: string, v: string) => void m.set(k, v),
    delete: async (k: string) => void m.delete(k),
  };
}

function baseProduct(overrides: Row = {}): Row {
  return {
    id: 1,
    category: "disc",
    name: "Roc",
    brand: "Innova",
    product_type: "Midrange",
    color: "Orange",
    weight_g: 177,
    price_cents: 1800,
    stock_qty: 2,
    image_url: "https://example.com/roc.jpg",
    description: "Stable midrange",
    active: 1,
    created_by: "m_admin",
    ...overrides,
  };
}

function stringArg(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function numberArg(value: unknown): number {
  return typeof value === "number" ? value : Number(value || 0);
}

function lowerArg(value: unknown): string {
  return String(value ?? "").toLowerCase();
}

function textValue(row: Row, key: string): string {
  return String(row[key] ?? "").toLowerCase();
}

function productRows(sql: string, args: unknown[], state: MockState): Row[] {
  let rows = [...state.products];
  let argIndex = 0;
  if (/active = \?/i.test(sql)) {
    const active = numberArg(args[argIndex]);
    argIndex += 1;
    rows = rows.filter((p) => numberArg(p.active) === active);
  } else if (/active = 1/i.test(sql)) {
    rows = rows.filter((p) => numberArg(p.active) === 1);
  }
  if (/LOWER\(brand\) = \?/i.test(sql)) {
    const brand = lowerArg(args[argIndex]);
    argIndex += 1;
    rows = rows.filter((p) => textValue(p, "brand") === brand);
  }
  if (/ORDER BY name COLLATE NOCASE/i.test(sql)) return rows.sort((a, b) => textValue(a, "name").localeCompare(textValue(b, "name")));
  if (/ORDER BY stock_qty ASC/i.test(sql)) return rows.sort((a, b) => numberArg(a.stock_qty) - numberArg(b.stock_qty));
  if (/ORDER BY stock_qty DESC/i.test(sql)) return rows.sort((a, b) => numberArg(b.stock_qty) - numberArg(a.stock_qty));
  return rows.sort((a, b) => numberArg(b.id) - numberArg(a.id));
}

function orderRows(sql: string, args: unknown[], state: MockState): Row[] {
  let rows = [...state.orders];
  if (/WHERE status = \?/i.test(sql)) rows = rows.filter((o) => o.status === args[0]);
  return rows.sort((a, b) => numberArg(b.id) - numberArg(a.id));
}

function allRows(sql: string, args: unknown[], state: MockState): Row[] {
  if (/FROM store_products WHERE id IN/i.test(sql)) {
    const ids = new Set(args.map((v) => Number(v)));
    return state.products.filter((p) => ids.has(numberArg(p.id)));
  }
  if (/FROM store_products/i.test(sql)) return productRows(sql, args, state);
  if (/FROM store_order_items WHERE order_id IN/i.test(sql)) {
    const ids = new Set(args.map((v) => Number(v)));
    return state.orderItems.filter((item) => ids.has(numberArg(item.order_id)));
  }
  if (/FROM store_order_items WHERE order_id = \?/i.test(sql)) return state.orderItems.filter((item) => numberArg(item.order_id) === numberArg(args[0]));
  if (/FROM store_orders WHERE member_id/i.test(sql)) return state.orders.filter((o) => o.member_id === args[0]);
  if (/FROM store_orders/i.test(sql)) return orderRows(sql, args, state);
  if (/FROM wallet_transactions WHERE event_id/i.test(sql)) {
    return state.transactions.filter((t) => numberArg(t.event_id) === numberArg(args[0]) && t.source === "event_payout");
  }
  if (/FROM wallet_transactions WHERE member_id/i.test(sql)) return state.transactions.filter((t) => t.member_id === args[0]);
  if (/FROM wallet_transactions ORDER BY/i.test(sql)) return state.transactions;
  if (/FROM event_players WHERE event_id/i.test(sql)) return [];
  return [];
}

function firstRow(sql: string, args: unknown[], state: MockState): Row | null {
  // Anchor to a bare balance SELECT: createWalletDebitOnce's atomic debit is an INSERT..SELECT..WHERE that
  // EMBEDS this same COALESCE(SUM(amount_cents)) as a balance guard — without the anchor it would misroute
  // that INSERT here and never record the debit.
  if (/^\s*SELECT COALESCE\(SUM\(amount_cents\)/i.test(sql)) return { balance_cents: state.balanceCents };
  if (/SELECT \* FROM store_orders WHERE payment_ref/i.test(sql)) return state.orders.find((o) => o.payment_ref === args[0]) ?? null;
  if (/SELECT \* FROM store_orders WHERE id = \?/i.test(sql)) return state.orders.find((o) => numberArg(o.id) === numberArg(args[0])) ?? null;
  // claimStoreOrderReversal: atomic "flip to cancelled ONLY if not already cancelled", returns the row iff it won.
  if (/UPDATE store_orders SET status = 'cancelled'/i.test(sql) && /status != 'cancelled'/i.test(sql)) {
    const row = state.orders.find((o) => numberArg(o.id) === numberArg(args[0]));
    if (!row || row.status === "cancelled") return null;
    row.status = "cancelled";
    return row;
  }
  if (/SELECT \* FROM store_payment_sessions WHERE paypal_order_id/i.test(sql)) return state.paymentSessions.find((session) => session.paypal_order_id === args[0]) ?? null;
  if (/SELECT \* FROM events WHERE id = \?/i.test(sql)) {
    return state.eventExists ? { id: numberArg(args[0]), name: "League Night", date: "2026-06-01", status: "scheduled" } : null;
  }
  if (/SELECT count\(\*\) AS n FROM store_order_items WHERE product_id/i.test(sql)) {
    return { n: state.orderItems.filter((item) => numberArg(item.product_id) === numberArg(args[0])).length };
  }
  if (/INSERT INTO store_products/i.test(sql)) return insertProduct(args, state);
  if (/INSERT INTO wallet_transactions/i.test(sql)) return insertTransaction(args, state);
  if (/INSERT INTO store_orders/i.test(sql)) return insertOrder(args, state);
  if (/INSERT INTO store_order_items/i.test(sql)) return insertOrderItem(args, state);
  if (/INSERT INTO store_payment_sessions/i.test(sql)) return insertPaymentSession(args, state);
  if (/UPDATE store_payment_sessions SET status = 'captured'/i.test(sql)) return capturePaymentSession(args, state);
  if (/SELECT \* FROM store_products WHERE id = \?/i.test(sql)) return state.products.find((p) => numberArg(p.id) === numberArg(args[0])) ?? null;
  if (/UPDATE store_products SET active = 0/i.test(sql)) {
    const row = state.products.find((p) => numberArg(p.id) === numberArg(args[0]));
    if (row) row.active = 0;
    return row ?? null;
  }
  if (/UPDATE store_products SET category=COALESCE/i.test(sql)) {
    const row = state.products.find((p) => numberArg(p.id) === numberArg(args[11]));
    if (!row) return null;
    const fields = ["category", "name", "brand", "product_type", "color", "weight_g", "price_cents", "stock_qty", "image_url", "description", "active"] as const;
    fields.forEach((field, index) => {
      if (args[index] !== null) row[field] = args[index];
    });
    return row;
  }
  if (/UPDATE store_orders SET/i.test(sql)) {
    const id = numberArg(args[args.length - 1]);
    const row = state.orders.find((o) => numberArg(o.id) === id);
    if (!row) return null;
    if (/status = \?/i.test(sql)) row.status = stringArg(args[0]);
    return row;
  }
  if (/DELETE FROM store_orders WHERE id = \?/i.test(sql)) {
    const id = numberArg(args[0]);
    const row = state.orders.find((o) => numberArg(o.id) === id);
    if (!row) return null;
    state.orders = state.orders.filter((o) => numberArg(o.id) !== id);
    state.orderItems = state.orderItems.filter((item) => numberArg(item.order_id) !== id);
    return row;
  }
  return null;
}

function insertProduct(args: unknown[], state: MockState): Row {
  const row = baseProduct({
    id: state.nextProductId++,
    category: stringArg(args[0]) ?? "disc",
    name: stringArg(args[1]) ?? "Product",
    brand: stringArg(args[2]),
    product_type: stringArg(args[3]),
    color: stringArg(args[4]),
    weight_g: args[5] == null ? null : numberArg(args[5]),
    price_cents: numberArg(args[6]),
    stock_qty: numberArg(args[7]),
    image_url: stringArg(args[8]),
    description: stringArg(args[9]),
    active: args[10] == null ? 1 : numberArg(args[10]),
    created_by: stringArg(args[11]),
  });
  state.products.push(row);
  return row;
}

function insertTransaction(args: unknown[], state: MockState): Row {
  const amount = numberArg(args[2]);
  const row: Row = {
    id: state.nextTransactionId++,
    member_id: stringArg(args[0]),
    member_name: stringArg(args[1]),
    amount_cents: amount,
    transaction_type: stringArg(args[3]),
    source: stringArg(args[4]),
    event_id: args[5] == null ? null : numberArg(args[5]),
    order_id: args[6] == null ? null : numberArg(args[6]),
    note: stringArg(args[7]),
    created_by: stringArg(args[8]),
    created_at: "2026-06-01T12:00:00Z",
  };
  state.transactions.unshift(row);
  state.balanceCents += amount;
  return row;
}

function insertOrder(args: unknown[], state: MockState): Row {
  const row: Row = {
    id: state.nextOrderId++,
    member_id: stringArg(args[0]),
    member_name: stringArg(args[1]),
    total_cents: numberArg(args[2]),
    payment_method: stringArg(args[3]) ?? "store_credit",
    payment_ref: stringArg(args[4]),
    status: "submitted",
    created_at: "2026-06-01T12:00:00Z",
  };
  state.orders.unshift(row);
  return row;
}

function insertOrderItem(args: unknown[], state: MockState): Row {
  const row: Row = {
    id: state.nextOrderItemId++,
    order_id: numberArg(args[0]),
    product_id: args[1] == null ? null : numberArg(args[1]),
    name_snapshot: stringArg(args[2]),
    price_cents: numberArg(args[3]),
    quantity: numberArg(args[4]),
  };
  state.orderItems.push(row);
  return row;
}

function insertPaymentSession(args: unknown[], state: MockState): Row {
  const row: Row = {
    paypal_order_id: stringArg(args[0]),
    member_id: stringArg(args[1]),
    member_name: stringArg(args[2]),
    items_json: stringArg(args[3]) ?? "[]",
    total_cents: numberArg(args[4]),
    status: "pending",
    created_at: "2026-06-01T12:00:00Z",
    captured_at: null,
  };
  state.paymentSessions.unshift(row);
  return row;
}

function capturePaymentSession(args: unknown[], state: MockState): Row | null {
  const row = state.paymentSessions.find((session) => session.paypal_order_id === args[0]);
  if (row) {
    row.status = "captured";
    row.captured_at = "2026-06-01T12:05:00Z";
  }
  return row ?? null;
}

function runSql(sql: string, args: unknown[], state: MockState): MockResult {
  if (/UPDATE store_products SET stock_qty = stock_qty \+ \?/i.test(sql)) {
    // restock: incrementStoreProductStock binds (quantity, id)
    const row = state.products.find((p) => numberArg(p.id) === numberArg(args[1]));
    if (row) row.stock_qty = numberArg(row.stock_qty) + numberArg(args[0]);
    const changes = row ? 1 : 0;
    return { results: [], success: true, meta: { changes, rows_written: changes } };
  }
  if (/UPDATE store_products SET stock_qty = stock_qty - \?/i.test(sql)) {
    const row = state.products.find((p) => (
      numberArg(p.id) === numberArg(args[1])
      && numberArg(p.active) === 1
      && numberArg(p.stock_qty) >= numberArg(args[2] ?? args[0])
    ));
    if (row) row.stock_qty = numberArg(row.stock_qty) - numberArg(args[0]);
    const changes = row ? 1 : 0;
    return { results: [], success: true, meta: { changes, rows_written: changes } };
  }
  if (/DELETE FROM store_products WHERE id = \?/i.test(sql)) {
    const id = numberArg(args[0]);
    state.products = state.products.filter((p) => numberArg(p.id) !== id);
    state.orderItems = state.orderItems.map((item) => (numberArg(item.product_id) === id ? { ...item, product_id: null } : item));
  }
  return { results: [], success: true };
}

function cloneRows(rows: Row[]): Row[] {
  return rows.map((row) => ({ ...row }));
}

function snapshotState(state: MockState): MockState {
  return {
    balanceCents: state.balanceCents,
    eventExists: state.eventExists,
    nextProductId: state.nextProductId,
    nextOrderId: state.nextOrderId,
    nextOrderItemId: state.nextOrderItemId,
    nextTransactionId: state.nextTransactionId,
    products: cloneRows(state.products),
    orders: cloneRows(state.orders),
    orderItems: cloneRows(state.orderItems),
    transactions: cloneRows(state.transactions),
    paymentSessions: cloneRows(state.paymentSessions),
  };
}

function restoreState(state: MockState, snapshot: MockState): void {
  state.balanceCents = snapshot.balanceCents;
  state.eventExists = snapshot.eventExists;
  state.nextProductId = snapshot.nextProductId;
  state.nextOrderId = snapshot.nextOrderId;
  state.nextOrderItemId = snapshot.nextOrderItemId;
  state.nextTransactionId = snapshot.nextTransactionId;
  state.products = cloneRows(snapshot.products);
  state.orders = cloneRows(snapshot.orders);
  state.orderItems = cloneRows(snapshot.orderItems);
  state.transactions = cloneRows(snapshot.transactions);
  state.paymentSessions = cloneRows(snapshot.paymentSessions);
}

async function runBatchStatement(stmt: MockStatement, state: MockState): Promise<MockResult> {
  const sql = stmt.sql;
  const args = stmt.args();
  if (/INSERT INTO store_order_items .*SELECT id FROM store_products/i.test(sql)) {
    const product = state.products.find((p) => (
      numberArg(p.id) === numberArg(args[1])
      && numberArg(p.active) === 1
      && numberArg(p.stock_qty) >= numberArg(args[2])
    ));
    if (!product) throw new Error("D1_ERROR: NOT NULL constraint failed: store_order_items.name_snapshot");
    const row = insertOrderItem([args[0], product.id, args[3], args[6], args[7]], state);
    return { results: [row], success: true, meta: { changes: 1, rows_written: 1 } };
  }
  return stmt.run();
}

async function runBatch(statements: readonly MockStatement[], state: MockState): Promise<MockResult[]> {
  const snapshot = snapshotState(state);
  const results: MockResult[] = [];
  try {
    for (const statement of statements) results.push(await runBatchStatement(statement, state));
    return results;
  } catch (error) {
    restoreState(state, snapshot);
    if (error instanceof Error) throw error;
    throw new Error("batch_failed");
  }
}

export function makeDb(overrides: Partial<Pick<MockState, "balanceCents" | "eventExists" | "products">> = {}) {
  const state: MockState = {
    balanceCents: overrides.balanceCents ?? 0,
    eventExists: overrides.eventExists ?? true,
    nextProductId: 2,
    nextOrderId: 10,
    nextOrderItemId: 20,
    nextTransactionId: 30,
    products: overrides.products ?? [baseProduct()],
    orders: [],
    orderItems: [],
    transactions: [],
    paymentSessions: [],
  };
  const db = {
    prepare(sql: string) {
      let bound: unknown[] = [];
      const stmt: MockStatement = {
        sql,
        args: () => bound,
        bind(...args: unknown[]) {
          bound = args;
          return stmt;
        },
        all: async () => ({ results: allRows(sql, bound, state), success: true }),
        first: async () => firstRow(sql, bound, state),
        run: async () => runSql(sql, bound, state),
      };
      return stmt;
    },
    batch: async (statements: MockStatement[]) => runBatch(statements, state),
  };
  return { db: db as unknown as Env["DB"], state };
}

function env(state: ReturnType<typeof makeDb>, extra: Record<string, unknown> = {}) {
  return {
    ROSTER: kv(memberRows),
    RATELIMIT: kv(),
    DB: state.db,
    JWT_SECRET: SECRET,
    SESSION_TTL_SEC: "900",
    ALLOWED_ORIGINS: ORIGIN,
    LIVE: undefined,
    PHOTOS: undefined,
    ...extra,
  } as unknown as Env;
}

export async function token(sub: "m_jane" | "m_admin") {
  return signSession({ sub, mustChangePin: false }, SECRET, 900);
}

export async function call(path: string, method = "GET", bearerToken?: string, body?: unknown, dbState = makeDb(), extra: Record<string, unknown> = {}) {
  const headers: Record<string, string> = { Origin: ORIGIN };
  if (bearerToken) headers.Authorization = "Bearer " + bearerToken;
  if (body) headers["Content-Type"] = "application/json";
  return worker.fetch(
    new Request("https://worker.example" + path, { method, headers, body: body ? JSON.stringify(body) : undefined }),
    env(dbState, extra),
  );
}

export function stubPayPal(captureValue = "18.00", captureStatus = "COMPLETED", orderStatus = captureStatus) {
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
    const u = String(url);
    if (u.includes("/oauth2/token")) return new Response(JSON.stringify({ access_token: "tok" }), { status: 200 });
    if (u.includes("/capture")) return new Response(JSON.stringify({ status: orderStatus, purchase_units: [{ payments: { captures: [{ status: captureStatus, amount: { value: captureValue, currency_code: "USD" } }] } }] }), { status: 200 });
    if (u.includes("/v2/checkout/orders")) return new Response(JSON.stringify({ id: "ORDER123" }), { status: 200 });
    return new Response("{}", { status: 404 });
  }));
}
