import type { D1Like } from "./db.js";
import { isUniqueViolation } from "./input.js";

type WalletTransactionRow = Record<string, unknown>;

export type IdempotentWalletTransactionInput = {
  readonly member_id: string;
  readonly member_name?: string | null;
  readonly amount_cents: number;
  readonly transaction_type: string;
  readonly source: string;
  readonly event_id?: number | null;
  readonly order_id?: number | null;
  readonly note?: string | null;
  readonly created_by?: string | null;
  readonly idempotency_key: string;
};

export type IdempotentWalletTransactionResult =
  | { readonly ok: true; readonly transaction: WalletTransactionRow; readonly created: boolean }
  | { readonly ok: false; readonly error: "idempotency_key_conflict" };

export type WalletTransactionIdempotencyCheck =
  | { readonly ok: true; readonly transaction: WalletTransactionRow | null }
  | { readonly ok: false; readonly error: "idempotency_key_conflict" };

function rowText(row: WalletTransactionRow, key: string): string | null {
  const value = row[key];
  if (value == null) return null;
  return typeof value === "string" ? value : String(value);
}

function rowNumber(row: WalletTransactionRow, key: string): number | null {
  const value = row[key];
  if (value == null) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function nullableNumber(value: number | null | undefined): number | null {
  return value == null ? null : value;
}

function sameNullableNumber(a: number | null, b: number | null): boolean {
  return a === b;
}

// `matchOrderId` false is for callers (store-credit checkout) whose idempotency_key already uniquely
// identifies the purchase and that create a FRESH order per attempt — two racing attempts legitimately
// carry different order_ids, so requiring order_id to match would misclassify the dedup as a conflict.
// amount/member/source are still matched, so a genuine key reuse for a different purchase still conflicts.
function transactionMatchesInput(row: WalletTransactionRow, input: IdempotentWalletTransactionInput, matchOrderId = true): boolean {
  return rowText(row, "member_id") === input.member_id
    && rowNumber(row, "amount_cents") === input.amount_cents
    && rowText(row, "transaction_type") === input.transaction_type
    && rowText(row, "source") === input.source
    && sameNullableNumber(rowNumber(row, "event_id"), nullableNumber(input.event_id))
    && (!matchOrderId || sameNullableNumber(rowNumber(row, "order_id"), nullableNumber(input.order_id)));
}

export async function findWalletTransactionByIdempotencyKey(db: D1Like, key: string): Promise<WalletTransactionRow | null> {
  return db.prepare("SELECT * FROM wallet_transactions WHERE idempotency_key = ?").bind(key).first();
}

function existingResult(row: WalletTransactionRow, input: IdempotentWalletTransactionInput, matchOrderId = true): IdempotentWalletTransactionResult {
  if (!transactionMatchesInput(row, input, matchOrderId)) return { ok: false, error: "idempotency_key_conflict" };
  return { ok: true, transaction: row, created: false };
}

export async function checkWalletTransactionIdempotency(
  db: D1Like,
  input: IdempotentWalletTransactionInput,
  matchOrderId = true,
): Promise<WalletTransactionIdempotencyCheck> {
  const existing = await findWalletTransactionByIdempotencyKey(db, input.idempotency_key);
  if (!existing) return { ok: true, transaction: null };
  if (!transactionMatchesInput(existing, input, matchOrderId)) return { ok: false, error: "idempotency_key_conflict" };
  return { ok: true, transaction: existing };
}

export type WalletDebitResult =
  | { readonly ok: true; readonly transaction: WalletTransactionRow; readonly created: boolean }
  | { readonly ok: false; readonly error: "idempotency_key_conflict" }
  | { readonly ok: false; readonly error: "insufficient_balance" };

/**
 * A debit that is BOTH idempotent (keyed) and ATOMICALLY balance-checked: the row is inserted only if the
 * member's current balance still covers it, evaluated inside the single INSERT..SELECT..WHERE statement.
 * SQLite serializes writers, so two concurrent debits (a double-click or a retried request) can never both
 * pass the check — the wallet cannot be overdrawn and the member cannot be charged past their balance.
 * `amount_cents` MUST be negative (a debit). Returns `insufficient_balance` when the balance no longer
 * covers the debit, so the caller can roll back the order it was paying for.
 *
 * `opts.matchOrderId` (default true) — pass false when the idempotency_key alone identifies the purchase
 * and each attempt creates its own order (store-credit checkout): a concurrent loser then dedups to the
 * winner's row (created:false) instead of being misreported as a key conflict.
 */
export async function createWalletDebitOnce(
  db: D1Like,
  input: IdempotentWalletTransactionInput,
  opts: { readonly matchOrderId?: boolean } = {},
): Promise<WalletDebitResult> {
  const matchOrderId = opts.matchOrderId ?? true;
  const existing = await checkWalletTransactionIdempotency(db, input, matchOrderId);
  if (!existing.ok) return existing;
  if (existing.transaction) return { ok: true, transaction: existing.transaction, created: false };

  try {
    const transaction = await db
      .prepare(
        `INSERT INTO wallet_transactions (member_id, member_name, amount_cents, transaction_type, source, event_id, order_id, note, created_by, idempotency_key)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         WHERE (SELECT COALESCE(SUM(amount_cents), 0) FROM wallet_transactions WHERE member_id = ?) + ? >= 0
         RETURNING *`,
      )
      .bind(
        input.member_id,
        input.member_name ?? null,
        input.amount_cents,
        input.transaction_type,
        input.source,
        input.event_id ?? null,
        input.order_id ?? null,
        input.note ?? null,
        input.created_by ?? null,
        input.idempotency_key,
        input.member_id,
        input.amount_cents,
      )
      .first();
    if (!transaction) {
      // No row inserted: EITHER the balance genuinely can't cover the debit, OR a concurrent same-key debit
      // just committed and consumed the balance between our idempotency pre-check and this INSERT. Re-check
      // by key before declaring insufficient funds, so the race loser gets the idempotent dedup, not a
      // spurious "insufficient balance" for a purchase that actually succeeded.
      const raced = await findWalletTransactionByIdempotencyKey(db, input.idempotency_key);
      if (raced) return existingResult(raced, input, matchOrderId);
      return { ok: false, error: "insufficient_balance" };
    }
    return { ok: true, transaction, created: true };
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    const raced = await findWalletTransactionByIdempotencyKey(db, input.idempotency_key);
    if (!raced) throw e;
    return existingResult(raced, input, matchOrderId);
  }
}

export type WalletCreditResult =
  | { readonly ok: true; readonly transaction: WalletTransactionRow; readonly created: boolean }
  | { readonly ok: false; readonly error: "idempotency_key_conflict" };

/**
 * An idempotent CREDIT (non-negative amount). Mirrors {@link createWalletDebitOnce} but with NO balance
 * guard — a credit can never overdraw — so it is a plain keyed insert that dedups on idempotency_key.
 * Used to refund store credit exactly once when an order is reversed: a double-cancel, or a cancel then
 * delete of the same order, reuses the key and returns the existing row (created:false) instead of
 * granting the refund twice. The club's store-credit liability is otherwise wide open to double-grant.
 */
export async function createWalletCreditOnce(db: D1Like, input: IdempotentWalletTransactionInput): Promise<WalletCreditResult> {
  if (input.amount_cents < 0) throw new Error("createWalletCreditOnce requires a non-negative amount");
  const existing = await checkWalletTransactionIdempotency(db, input);
  if (!existing.ok) return existing;
  if (existing.transaction) return { ok: true, transaction: existing.transaction, created: false };
  try {
    const transaction = await db
      .prepare(
        `INSERT INTO wallet_transactions (member_id, member_name, amount_cents, transaction_type, source, event_id, order_id, note, created_by, idempotency_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING *`,
      )
      .bind(
        input.member_id,
        input.member_name ?? null,
        input.amount_cents,
        input.transaction_type,
        input.source,
        input.event_id ?? null,
        input.order_id ?? null,
        input.note ?? null,
        input.created_by ?? null,
        input.idempotency_key,
      )
      .first();
    if (!transaction) return { ok: false, error: "idempotency_key_conflict" };
    return { ok: true, transaction, created: true };
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    const raced = await findWalletTransactionByIdempotencyKey(db, input.idempotency_key);
    if (!raced) throw e;
    return existingResult(raced, input);
  }
}

