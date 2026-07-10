PRAGMA foreign_keys=off;

CREATE TABLE store_order_items_new (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id         INTEGER NOT NULL REFERENCES store_orders(id) ON DELETE CASCADE,
  product_id       INTEGER REFERENCES store_products(id) ON DELETE SET NULL,
  name_snapshot    TEXT NOT NULL,
  price_cents      INTEGER NOT NULL,
  quantity         INTEGER NOT NULL
);

INSERT INTO store_order_items_new (id, order_id, product_id, name_snapshot, price_cents, quantity)
SELECT id, order_id, product_id, name_snapshot, price_cents, quantity
FROM store_order_items;

DROP TABLE store_order_items;
ALTER TABLE store_order_items_new RENAME TO store_order_items;

CREATE INDEX idx_store_order_items_order ON store_order_items(order_id);
CREATE INDEX idx_store_order_items_product ON store_order_items(product_id);

PRAGMA foreign_keys=on;
