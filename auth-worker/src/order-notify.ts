// Best-effort email notification to the club when a pro-shop order is placed. The admin always sees
// orders in-app (Orders tab); this adds a push to the club inbox IF email is configured. Sending is
// gated on RESEND_API_KEY (a secret) + ORDER_NOTIFY_EMAIL — until those are set it's a no-op, so the
// in-app flow works on its own. Never throws / never blocks an order (callers fire it via waitUntil).
//
// To enable email:
//   wrangler secret put RESEND_API_KEY --env staging        (a Resend API key — resend.com)
//   set ORDER_NOTIFY_EMAIL + ORDER_NOTIFY_FROM in wrangler.toml [env.staging.vars]
//     (ORDER_NOTIFY_FROM must be on a Resend-verified domain, e.g. "GVDG Pro Shop <shop@yourdomain>")

import type { Env } from "./env.js";

interface NotifyLine { name_snapshot: string; quantity: number; price_cents: number }

const dollars = (c: unknown) => "$" + ((typeof c === "number" ? c : 0) / 100).toFixed(2);

export async function notifyNewOrder(env: Env, order: unknown, lines: NotifyLine[]): Promise<void> {
  const cfg = env as unknown as { ORDER_NOTIFY_EMAIL?: string; ORDER_NOTIFY_FROM?: string; RESEND_API_KEY?: string; EMAIL_REPLY_TO?: string };
  if (!cfg.RESEND_API_KEY || !cfg.ORDER_NOTIFY_EMAIL) return; // email not configured — in-app only

  const o = (order ?? {}) as Record<string, unknown>;
  const items = lines.map((l) => `  ${l.quantity} x ${l.name_snapshot} (${dollars(l.price_cents)})`).join("\n");
  const total = dollars(o.total_cents);
  const text =
    `New pro-shop order #${o.id} from ${o.member_name ?? "a member"} (paid via ${o.payment_method ?? "store credit"}).\n\n` +
    `Items:\n${items}\n\nTotal: ${total}\n\nUpdate status & tracking in the admin → Orders tab.`;

  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + cfg.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: cfg.ORDER_NOTIFY_FROM || "GVDG Pro Shop <onboarding@resend.dev>",
        to: [cfg.ORDER_NOTIFY_EMAIL],
        reply_to: cfg.EMAIL_REPLY_TO || "greenvillediscgolf@gmail.com",
        subject: `New pro-shop order #${o.id} — ${total}`,
        text,
      }),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    /* best-effort: an order must never fail because email is down */
  }
}
