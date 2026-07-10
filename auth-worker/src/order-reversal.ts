// Cancel-and-make-whole for pro-shop orders. Before this existed, admin cancel/delete touched only the
// store_orders row: a paid store-credit order silently KEPT the member's money and never restocked, and
// there was no reversal primitive anywhere in the worker. reverseStoreOrder() is the single un-fulfillment
// path — wired into admin cancel + delete — that restocks and refunds exactly once.
import type { Env } from "./env.js";
import * as shopDb from "./shop-db.js";
import { createWalletCreditOnce } from "./wallet-idempotency.js";

function num(row: Record<string, unknown>, k: string): number {
  const v = row[k];
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}
function str(row: Record<string, unknown>, k: string): string | null {
  const v = row[k];
  return v == null ? null : String(v);
}

export type ReverseResult = {
  readonly ok: true;
  /** true iff THIS call performed the reversal; false if the order was missing or already cancelled. */
  readonly reversed: boolean;
  readonly method: string | null;
  /** store_credit = wallet refunded here; paypal_manual = needs a PayPal Refunds-API refund (capture id
   *  required — tracked separately); none = nothing to refund (paypal_redirect took no money/stock). */
  readonly refund: "store_credit" | "paypal_manual" | "none";
  readonly restocked: number;
};

/**
 * Atomically cancel an order and make the member whole:
 *  1. claim the order (flip to 'cancelled' exactly once — idempotent under concurrent cancel/delete),
 *  2. restock every line for the paths that decremented stock (store_credit + captured paypal; the
 *     paypal_redirect / paypal.me path never decremented stock so it is left alone),
 *  3. refund store-credit orders to the member's wallet via an idempotent credit keyed on the order.
 * A second call (double-click, or cancel-then-delete) is a safe no-op.
 */
export async function reverseStoreOrder(env: Env, orderId: number, opts: { by?: string | null } = {}): Promise<ReverseResult> {
  const claimed = await shopDb.claimStoreOrderReversal(env.DB, orderId);
  if (!claimed) return { ok: true, reversed: false, method: null, refund: "none", restocked: 0 };

  const method = str(claimed, "payment_method");
  const decrementedStock = method === "store_credit" || method === "paypal";
  let restocked = 0;
  if (decrementedStock) {
    for (const item of await shopDb.getStoreOrderItems(env.DB, orderId)) {
      const pid = num(item, "product_id");
      const qty = num(item, "quantity");
      if (pid > 0 && qty > 0) {
        await shopDb.incrementStoreProductStock(env.DB, pid, qty);
        restocked++;
      }
    }
  }

  let refund: ReverseResult["refund"] = "none";
  if (method === "store_credit") {
    const memberId = str(claimed, "member_id");
    const total = num(claimed, "total_cents");
    if (memberId && total > 0) {
      await createWalletCreditOnce(env.DB, {
        member_id: memberId,
        member_name: str(claimed, "member_name"),
        amount_cents: total,
        transaction_type: "refund",
        source: "order_reversal",
        order_id: orderId,
        note: `Refund for cancelled order #${orderId}`,
        created_by: opts.by ?? null,
        idempotency_key: `reverse:order:${orderId}`,
      });
    }
    refund = "store_credit";
  } else if (method === "paypal") {
    refund = "paypal_manual";
  }

  return { ok: true, reversed: true, method, refund, restocked };
}
