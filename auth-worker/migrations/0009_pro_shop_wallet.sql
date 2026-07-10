CREATE TABLE store_products (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  category     TEXT NOT NULL DEFAULT 'disc',
  name         TEXT NOT NULL,
  brand        TEXT,
  product_type TEXT,
  color        TEXT,
  weight_g     INTEGER,
  price_cents  INTEGER NOT NULL,
  stock_qty    INTEGER NOT NULL DEFAULT 0,
  image_url    TEXT,
  description  TEXT,
  active       INTEGER NOT NULL DEFAULT 1,
  created_by   TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT
);
CREATE INDEX idx_store_products_active ON store_products(active);
CREATE INDEX idx_store_products_brand ON store_products(brand);
CREATE INDEX idx_store_products_color ON store_products(color);
CREATE INDEX idx_store_products_type ON store_products(product_type);
CREATE INDEX idx_store_products_weight ON store_products(weight_g);

CREATE TABLE store_orders (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id    TEXT NOT NULL,
  member_name  TEXT,
  total_cents  INTEGER NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'store_credit',
  payment_ref  TEXT,
  status       TEXT NOT NULL DEFAULT 'submitted',
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_store_orders_member ON store_orders(member_id);
CREATE UNIQUE INDEX idx_store_orders_payment_ref ON store_orders(payment_ref) WHERE payment_ref IS NOT NULL;

CREATE TABLE store_payment_sessions (
  paypal_order_id TEXT PRIMARY KEY,
  member_id       TEXT NOT NULL,
  member_name     TEXT,
  items_json      TEXT NOT NULL,
  total_cents     INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  captured_at     TEXT
);
CREATE INDEX idx_store_payment_sessions_member ON store_payment_sessions(member_id, created_at DESC);

CREATE TABLE store_order_items (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id         INTEGER NOT NULL REFERENCES store_orders(id) ON DELETE CASCADE,
  product_id       INTEGER NOT NULL REFERENCES store_products(id),
  name_snapshot    TEXT NOT NULL,
  price_cents      INTEGER NOT NULL,
  quantity         INTEGER NOT NULL
);
CREATE INDEX idx_store_order_items_order ON store_order_items(order_id);

CREATE TABLE wallet_transactions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id        TEXT NOT NULL,
  member_name      TEXT,
  amount_cents     INTEGER NOT NULL,
  transaction_type TEXT NOT NULL,
  source           TEXT NOT NULL,
  event_id         INTEGER REFERENCES events(id) ON DELETE SET NULL,
  order_id         INTEGER REFERENCES store_orders(id) ON DELETE SET NULL,
  note             TEXT,
  created_by       TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_wallet_member ON wallet_transactions(member_id, id DESC);
CREATE INDEX idx_wallet_event ON wallet_transactions(event_id);
CREATE INDEX idx_wallet_order ON wallet_transactions(order_id);
