ALTER TABLE wallet_transactions ADD COLUMN idempotency_key TEXT;

CREATE UNIQUE INDEX idx_wallet_idempotency_key
  ON wallet_transactions(idempotency_key)
  WHERE idempotency_key IS NOT NULL;
