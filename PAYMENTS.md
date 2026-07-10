# Event payments (PayPal Checkout) — how to turn it on

Members register for events from their dashboard and can pay the **entry fee + add-ons (CTP / ace pot)**.
Out of the box, payments run in **manual mode**: members register and "Amount due — pay at the event",
and an admin ticks the **Paid** box on the roster. This means **zero downtime** — registration and the
paid flag work today, with no PayPal account required.

When the club is ready, switch on **PayPal Checkout** (Smart Buttons). It then auto-activates — members
pay online and get marked paid automatically, verified server-side. **No code change is needed.**

## What "turning it on" means

Payments activate the moment the Worker has **both** PayPal credentials. Nothing else changes.

1. Create a PayPal app at **https://developer.paypal.com** → Apps & Credentials. Use the **Sandbox** app
   first to test, then the **Live** app for real money. Copy the app's **Client ID** and **Secret**.
2. Set them as Worker secrets (the secret never leaves the server; the client id is public):
   ```bash
   cd auth-worker
   npx wrangler secret put PAYPAL_CLIENT_ID
   npx wrangler secret put PAYPAL_SECRET
   ```
   For the shared `gvdgclub.com` dev Worker, include `--env gvdgclub` and keep the values private. For a
   maintainer-owned production Worker, set them on that production environment. You can also add
   `PAYPAL_CLIENT_ID` / `PAYPAL_SECRET` as GitHub Actions secrets; the production Worker workflow syncs
   those two names when it deploys.
3. In `auth-worker/wrangler.toml` set `PAYPAL_ENV = "sandbox"` to test, then `"live"` for production. Deploy.

Deploy shared dev through `./scripts/gvdg-deploy.sh`; deploy maintainer-owned production through the
owner's Worker deploy path. That's it. The members' register cards now show **PayPal buttons** for events with a fee; on payment the
Worker captures the order, **verifies the amount**, and marks the registration paid. Remove the secrets to
fall back to manual mode.

## How it stays safe

- The **Secret never reaches the browser** — only the Worker uses it (OAuth + order capture). The Client ID
  is public by design (it goes in the PayPal SDK URL).
- **The amount is computed and the capture is verified server-side.** The Worker recomputes what the member
  owes (entry + opted-in add-ons) and only marks them paid if PayPal reports `COMPLETED` with a captured
  amount `>=` what's owed. The client is never trusted for the price.
- Re-capturing the same order is **idempotent** (no double-charge / double-credit).
- A free event (no entry fee) needs no payment regardless.

## Admin override stays available

Even with PayPal on, the roster's **Paid** checkbox still works — so an admin can mark someone paid who
paid cash or Venmo at the event. PayPal simply automates the common case.

## What was verified vs. pending your account

Built and tested: amount math, the credential gate (manual vs. PayPal), and the full Worker order
create → capture → verify → mark-paid flow (against a mock PayPal API). **The real PayPal sandbox/live
charge + the on-page PayPal buttons are verified once you add your own credentials** — the devs don't have
access to the club's PayPal account, so that final hop is yours to confirm (it's a credentials swap, no code).
