import { describe, expect, it } from "vitest";
import { createWalletDebitOnce } from "../src/wallet-idempotency.js";
import type { D1Like } from "../src/db.js";

type Row = Record<string, unknown>;

// Minimal in-memory wallet store that enforces the UNIQUE(idempotency_key) index and evaluates the atomic
// INSERT..SELECT..WHERE balance guard the real D1 runs — enough to exercise createWalletDebitOnce's dedup
// and balance paths deterministically (which the route-level mock can't, since it can't raise a real
// unique violation).
function walletDb(seed: Row[] = []) {
  const rows: Row[] = [...seed];
  let nextId = 100;
  const balance = (memberId: string) => rows.filter((r) => r.member_id === memberId).reduce((sum, r) => sum + Number(r.amount_cents), 0);
  const db: D1Like = {
    prepare(sql: string) {
      let bound: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) { bound = args; return stmt; },
        all: async () => ({ results: [] as Row[], success: true }),
        first: async <T = Row>() => {
          if (/SELECT \* FROM wallet_transactions WHERE idempotency_key/i.test(sql)) {
            return (rows.find((r) => r.idempotency_key === bound[0]) ?? null) as T | null;
          }
          if (/INSERT INTO wallet_transactions/i.test(sql)) {
            // binds: member_id, member_name, amount, type, source, event_id, order_id, note, created_by, key, member_id(for SUM), amount(for +?>=0)
            const [member_id, member_name, amount_cents, transaction_type, source, event_id, order_id, note, created_by, idempotency_key, sumMember, guardAmount] = bound;
            if (rows.some((r) => r.idempotency_key === idempotency_key)) throw new Error("D1_ERROR: UNIQUE constraint failed: wallet_transactions.idempotency_key");
            if (balance(String(sumMember)) + Number(guardAmount) < 0) return null; // WHERE balance guard failed
            const row: Row = { id: nextId++, member_id, member_name, amount_cents, transaction_type, source, event_id, order_id, note, created_by, idempotency_key };
            rows.push(row);
            return row as T;
          }
          return null;
        },
        run: async () => ({ results: [] as Row[], success: true, meta: { changes: 0 } }),
      };
      return stmt;
    },
  } as unknown as D1Like;
  return { db, rows, balance: () => balance("m_jane") };
}

const debit = (key: string, orderId: number, amount = -3600) => ({
  member_id: "m_jane",
  member_name: "Jane",
  amount_cents: amount,
  transaction_type: "debit",
  source: "store_purchase",
  order_id: orderId,
  note: "Pro shop order #" + orderId,
  idempotency_key: key,
});

describe("createWalletDebitOnce", () => {
  it("debits once and reports created:true", async () => {
    const { db, balance } = walletDb([{ member_id: "m_jane", amount_cents: 5000, source: "event_payout" }]);
    const r = await createWalletDebitOnce(db, debit("k1", 101));
    expect(r).toMatchObject({ ok: true, created: true });
    expect(balance()).toBe(1400);
  });

  it("is idempotent on a sequential retry with the same key (no second charge)", async () => {
    const { db, balance } = walletDb([{ member_id: "m_jane", amount_cents: 5000, source: "event_payout" }]);
    const first = await createWalletDebitOnce(db, debit("k1", 101));
    const second = await createWalletDebitOnce(db, debit("k1", 101));
    expect(first).toMatchObject({ ok: true, created: true });
    expect(second).toMatchObject({ ok: true, created: false });
    expect(balance()).toBe(1400); // charged once
  });

  it("with matchOrderId:false, a same-key debit carrying a DIFFERENT order_id dedups to the winner (not a conflict)", async () => {
    const { db, balance } = walletDb([{ member_id: "m_jane", amount_cents: 5000, source: "event_payout" }]);
    const winner = await createWalletDebitOnce(db, debit("k1", 101), { matchOrderId: false });
    const loser = await createWalletDebitOnce(db, debit("k1", 102), { matchOrderId: false }); // racing attempt, its own order id
    expect(winner).toMatchObject({ ok: true, created: true });
    expect(loser.ok).toBe(true);
    expect(loser).toMatchObject({ created: false });
    if (loser.ok) expect(Number((loser.transaction as Row).order_id)).toBe(101); // the winner's order
    expect(balance()).toBe(1400); // still one charge
  });

  it("with the default (matchOrderId:true), a same-key debit with a different order_id is a conflict", async () => {
    const { db } = walletDb([{ member_id: "m_jane", amount_cents: 5000, source: "event_payout" }]);
    await createWalletDebitOnce(db, debit("k1", 101));
    const conflict = await createWalletDebitOnce(db, debit("k1", 102));
    expect(conflict).toEqual({ ok: false, error: "idempotency_key_conflict" });
  });

  it("returns insufficient_balance when the wallet can't cover the debit", async () => {
    const { db } = walletDb([{ member_id: "m_jane", amount_cents: 1000, source: "event_payout" }]);
    const r = await createWalletDebitOnce(db, debit("k1", 101, -3600));
    expect(r).toEqual({ ok: false, error: "insufficient_balance" });
  });

  it("re-checks idempotency when the balance guard rejects, so a race loser dedups instead of seeing insufficient funds", async () => {
    // Winner already debited the whole balance under k1 (order 101). Balance is now exactly 0. A racing
    // request re-attempts the same key with its own order 102: the INSERT balance guard fails, but the
    // re-check must find the winner's row and return the idempotent dedup — not insufficient_balance.
    const { db } = walletDb([
      { member_id: "m_jane", amount_cents: 3600, source: "event_payout" },
      { member_id: "m_jane", amount_cents: -3600, transaction_type: "debit", source: "store_purchase", order_id: 101, idempotency_key: "k1" },
    ]);
    const loser = await createWalletDebitOnce(db, debit("k1", 102), { matchOrderId: false });
    expect(loser.ok).toBe(true);
    expect(loser).toMatchObject({ created: false });
    if (loser.ok) expect(Number((loser.transaction as Row).order_id)).toBe(101);
  });
});
