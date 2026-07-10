// Best-effort confirmation email to a GUEST who registers for a club event, with a manage/cancel link
// so they can withdraw from any device (their token otherwise lives only in the browser they used).
// Gated on RESEND_API_KEY (a secret) — a no-op until that's set. Members don't get this (they manage
// via their account, and we don't store member emails). Never throws — callers fire it via waitUntil.
import type { Env } from "./env.js";

const isEmail = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);

export async function notifyRegistration(
  env: Env,
  opts: { to: string; name: string; eventName: string; eventDate?: string | null; manageUrl?: string | null; owedCents?: number },
): Promise<void> {
  const cfg = env as unknown as { RESEND_API_KEY?: string; REGISTER_NOTIFY_FROM?: string; EMAIL_REPLY_TO?: string };
  if (!cfg.RESEND_API_KEY || !opts.to || !isEmail(opts.to)) return; // not configured / no valid recipient
  const from = cfg.REGISTER_NOTIFY_FROM || "GVDG Events <events@gvdgclub.com>";
  const replyTo = cfg.EMAIL_REPLY_TO || "greenvillediscgolf@gmail.com"; // the no-reply sender bounces; route replies to the club

  const lines = [
    `Hi ${opts.name},`,
    "",
    `You're registered for ${opts.eventName}${opts.eventDate ? " (" + opts.eventDate + ")" : ""}. See you on the course!`,
  ];
  if (opts.owedCents && opts.owedCents > 0) lines.push("", `Amount due at the event: $${(opts.owedCents / 100).toFixed(2)}.`);
  if (opts.manageUrl) lines.push("", "Need to make a change? View or cancel your registration here:", opts.manageUrl);
  lines.push("", "— Greenville Disc Golf Club");

  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + cfg.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [opts.to], reply_to: replyTo, subject: `You're registered — ${opts.eventName}`, text: lines.join("\n") }),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    /* best-effort: a registration must never fail because email is down */
  }
}
