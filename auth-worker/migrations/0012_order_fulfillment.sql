-- Pro-shop order fulfillment: tracking + admin notes. `status` already exists on store_orders
-- (submitted | processing | ready | shipped | completed | cancelled). These add shipment tracking
-- and a timestamp for when the status last changed (so the admin Orders view can sort/show it).
ALTER TABLE store_orders ADD COLUMN tracking_carrier   TEXT;
ALTER TABLE store_orders ADD COLUMN tracking_number    TEXT;
ALTER TABLE store_orders ADD COLUMN admin_note         TEXT;
ALTER TABLE store_orders ADD COLUMN status_updated_at  TEXT;
