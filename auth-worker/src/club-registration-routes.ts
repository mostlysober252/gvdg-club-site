import type { Env } from "./env.js";
import * as db from "./db.js";
import { requireAuth } from "./authz.js";
import { getMember } from "./roster.js";
import { computeOwed, paypalBase, createOrder as ppCreateOrder, captureOrder as ppCaptureOrder, isCaptureSettled, type CaptureResult, type OwedConfig } from "./payments.js";
import { clientIp, json, readJson } from "./http.js";
import { kvRateLimited } from "./kv-rate-limit.js";
import { notifyRegistration } from "./register-notify.js";
import { asInt, asStr } from "./input.js";
import { deadlinePassed } from "./event-deadlines.js";

const GUEST_REGISTER_IP_LIMIT = 15; // guest sign-ups per IP per minute

/** A guest manages their own registration with a random token (returned at register time): member_id
 *  is "g_<token>". Read it from ?gt= (GET/DELETE) or the JSON body (POST). Members use their JWT sub. */
function guestMemberId(request: Request, body?: Record<string, unknown> | null): string | null {
  const fromQuery = asStr(new URL(request.url).searchParams.get("gt") ?? undefined, 64);
  const fromBody = body ? asStr(body.guestToken, 64) : null;
  const t = fromQuery || fromBody;
  return t ? "g_" + t : null;
}
function genGuestToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function handleClubRegistration(
  request: Request,
  env: Env,
  origin: string | null,
  method: string,
  seg: string[],
  ctx?: ExecutionContext,
): Promise<Response | null> {
  if (seg[0] !== "events" || !(seg[2] === "registration" || seg[2] === "register" || seg[2] === "checkin" || seg[2] === "pay")) return null;
  const eid = asInt(seg[1]);
  if (eid == null) return json({ error: "not_found" }, 404, origin);
  // Auth is OPTIONAL: members act via their JWT, guests via a registration token. Only `pay` requires a member.
  const claims = await requireAuth(request, env);
  // A present-but-invalid bearer token is an EXPIRED session, not a guest — say so (so the UI re-prompts
  // login) instead of silently falling through to the name-required guest path (the old confusing error).
  if (!claims && (request.headers.get("authorization") || "").toLowerCase().startsWith("bearer ")) {
    return json({ error: "session_expired" }, 401, origin);
  }

  if (seg[2] === "pay" && method === "POST") {
    if (!claims) return json({ error: "unauthorized" }, 401, origin);
    if (!(env.PAYPAL_CLIENT_ID && env.PAYPAL_SECRET)) return json({ error: "payments_not_configured" }, 503, origin);
    const reg = (await db.getMyRegistration(env.DB, eid, claims.sub)) as { id: number; addons?: string; paid_entry?: number; payment_ref?: string } | null;
    if (!reg) return json({ error: "not_registered" }, 400, origin);
    const cfg = (await db.getEventConfig(env.DB, eid)) as { entry_fee_cents?: number; ctp_fee_cents?: number; ace_fee_cents?: number } | null;
    let addons: { ctp?: boolean; ace?: boolean } = {};
    try { addons = JSON.parse(reg.addons || "{}"); } catch { addons = {}; }
    const owed = computeOwed(cfg ?? {}, addons);
    if (owed <= 0) return json({ error: "nothing_owed" }, 400, origin);
    const creds = { clientId: env.PAYPAL_CLIENT_ID, secret: env.PAYPAL_SECRET, base: paypalBase(env.PAYPAL_ENV, env.PAYPAL_API_BASE) };
    try {
      if (seg[3] === "create-order") {
        if (reg.paid_entry === 1) return json({ error: "already_paid" }, 409, origin);
        const orderId = await ppCreateOrder(creds, owed, "GVDG event entry");
        return json({ orderId }, 200, origin);
      }
      if (seg[3] === "capture") {
        const b = (await readJson(request)) ?? {};
        const orderId = asStr(b.orderId, 100);
        if (!orderId) return json({ error: "invalid_request" }, 400, origin);
        if (reg.paid_entry === 1) {
          return reg.payment_ref === orderId ? json({ registration: reg }, 200, origin) : json({ error: "already_paid" }, 409, origin);
        }
        // Reserve this registration for exactly one order id BEFORE charging PayPal, so two
        // concurrently-approved orders can't both capture and double-charge the member.
        if (!(await db.reserveCapture(env.DB, reg.id, orderId))) {
          return json({ error: "capture_in_progress" }, 409, origin);
        }
        let cap: CaptureResult;
        try {
          cap = await ppCaptureOrder(creds, orderId);
        } catch (e) {
          await db.releaseCapture(env.DB, reg.id, orderId);
          throw e;
        }
        // Same settled-funds gate as the pro-shop path: reject unsettled (PENDING eCheck) or
        // wrong-currency captures so a registration is never marked PAID on money that may not clear.
        if (!isCaptureSettled(cap, owed)) {
          await db.releaseCapture(env.DB, reg.id, orderId);
          return json({ error: "payment_incomplete" }, 402, origin);
        }
        const updated = await db.markRegistrationPaid(env.DB, reg.id, orderId, cap.amountCents);
        return json({ registration: updated ?? (await db.getRegistration(env.DB, reg.id)) }, 200, origin);
      }
    } catch (e) {
      return json({ error: "paypal_error", reason: String(e instanceof Error ? e.message : e) }, 502, origin);
    }
    return json({ error: "not_found" }, 404, origin);
  }

  if (seg[2] === "registration" && method === "GET") {
    const memberId = claims ? claims.sub : guestMemberId(request);
    const registration = memberId ? await db.getMyRegistration(env.DB, eid, memberId) : null;
    return json({ config: await db.getEventConfig(env.DB, eid), registration }, 200, origin);
  }
  if (seg[2] === "register" && method === "POST") {
    const status = await db.getEventStatus(env.DB, eid);
    if (status !== "scheduled" && status !== "live") return json({ error: "registration_closed" }, 403, origin);
    const cfg = (await db.getEventConfig(env.DB, eid)) as { registration_open?: number; divisions?: string } | null;
    if (!cfg || cfg.registration_open !== 1) return json({ error: "registration_closed" }, 403, origin);
    const b = (await readJson(request)) ?? {};
    const division = asStr(b.division, 60);
    let divs: string[] = [];
    try { divs = JSON.parse(cfg.divisions || "[]"); } catch { divs = []; }
    if (division && divs.length && !divs.includes(division)) return json({ error: "invalid_division" }, 400, origin);

    // Resolve who is registering: a signed-in member, or a guest (name required; gets a token to manage it).
    let memberId: string, name: string, email: string | null = null, guestToken: string | null = null;
    if (claims) {
      memberId = claims.sub;
      name = (await getMember(env.ROSTER, claims.sub))?.name ?? "Member";
    } else {
      if (await kvRateLimited(env, "evreg:" + clientIp(request), GUEST_REGISTER_IP_LIMIT, 60)) return json({ error: "rate_limited" }, 429, origin);
      name = asStr(b.name, 80) ?? "";
      if (!name) return json({ error: "name_required" }, 400, origin);
      email = asStr(b.email, 120);
      guestToken = asStr(b.guestToken, 64) || genGuestToken(); // reuse the token to edit an existing guest reg
      memberId = "g_" + guestToken;
    }

    const addons = b.addons && typeof b.addons === "object" ? JSON.stringify({ ctp: !!(b.addons as Record<string, unknown>).ctp, ace: !!(b.addons as Record<string, unknown>).ace }) : null;
    // Once entry is paid, a re-registration must not silently add a paid add-on (ace pot / CTP) that was
    // never charged — that would put the registrant into a real-cash pool for free. Block any change that
    // raises the amount owed above what was actually captured (removing add-ons / editing division is fine).
    const existing = (await db.getMyRegistration(env.DB, eid, memberId)) as { paid_entry?: number; amount_paid_cents?: number } | null;
    if (existing?.paid_entry === 1) {
      const owedNow = computeOwed(cfg as unknown as OwedConfig, addons ? (JSON.parse(addons) as { ctp?: boolean; ace?: boolean }) : {});
      if (owedNow > (existing.amount_paid_cents ?? 0)) return json({ error: "paid_addons_locked" }, 409, origin);
    }
    if (!existing) {
      // A passed registration deadline closes NEW sign-ups; an existing registrant can still edit/withdraw.
      const sched = (await db.getEventSchedule(env.DB, eid)) as { registration_deadline?: string | null } | null;
      if (deadlinePassed(sched?.registration_deadline)) return json({ error: "registration_closed" }, 403, origin);
    }
    const row = await db.registerForEvent(env.DB, { event_id: eid, member_id: memberId, name, division, team: asStr(b.team, 40), addons, email });
    // Email a guest (who gave an address) a confirmation + manage/cancel link so they can withdraw from
    // any device. Members manage via their account; this is a no-op unless RESEND_API_KEY is configured.
    if (guestToken && email) {
      const ev = (await db.getEvent(env.DB, eid)) as { name?: string; date?: string | null } | null;
      const owedCents = computeOwed(cfg as unknown as OwedConfig, addons ? (JSON.parse(addons) as { ctp?: boolean; ace?: boolean }) : {});
      const manageUrl = origin ? `${origin}/events.html#manage=${eid}-${guestToken}` : null;
      ctx?.waitUntil(notifyRegistration(env, { to: email, name, eventName: ev?.name ?? "your event", eventDate: ev?.date ?? null, manageUrl, owedCents }));
    }
    return json(guestToken ? { registration: row, guestToken } : { registration: row }, 201, origin);
  }
  if (seg[2] === "register" && method === "DELETE") {
    const memberId = claims ? claims.sub : guestMemberId(request);
    if (!memberId) return json({ error: "unauthorized" }, 401, origin);
    const reg = (await db.getMyRegistration(env.DB, eid, memberId)) as { paid_entry?: number } | null;
    if (reg?.paid_entry === 1) return json({ error: "paid_contact_admin" }, 403, origin);
    // No self-withdraw once the event has started or finished — deleting the registration mid-round would
    // desync the registration roster from live scoring / final results. An admin must handle those cases.
    const status = await db.getEventStatus(env.DB, eid);
    if (status === "live" || status === "final") return json({ error: "event_started" }, 409, origin);
    await db.withdrawRegistration(env.DB, eid, memberId);
    return json({ ok: true }, 200, origin);
  }
  if (seg[2] === "checkin" && method === "POST") {
    const b = (await readJson(request)) ?? {};
    const memberId = claims ? claims.sub : guestMemberId(request, b);
    if (!memberId) return json({ error: "unauthorized" }, 401, origin);
    const sched = (await db.getEventSchedule(env.DB, eid)) as { checkin_deadline?: string | null } | null;
    if (deadlinePassed(sched?.checkin_deadline)) return json({ error: "checkin_closed" }, 403, origin);
    const row = await db.setCheckedIn(env.DB, eid, memberId, true);
    return row ? json({ registration: row }, 200, origin) : json({ error: "not_registered" }, 404, origin);
  }
  return json({ error: "not_found" }, 404, origin);
}
