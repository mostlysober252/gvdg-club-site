import React from "react";

import { request } from "./api.js";
import { memberAlert } from "./member-dialogs.js";

const h = React.createElement;
let paypalSdkPromise = null;

function useLatest(value) {
  const ref = React.useRef(value);
  React.useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}

function loadPaypalSdk(config) {
  if (window.paypal) return Promise.resolve();
  if (paypalSdkPromise) return paypalSdkPromise;
  paypalSdkPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(config.clientId)}&currency=USD&intent=capture`;
    script.onload = resolve;
    script.onerror = () => reject(new Error("paypal_sdk_load_failed"));
    document.head.appendChild(script);
  });
  return paypalSdkPromise;
}

export function PayPalButtons({ eventId, token, paymentsConfig, onReload }) {
  const hostRef = React.useRef(null);
  const eventIdRef = useLatest(eventId);
  const onReloadRef = useLatest(onReload);
  const tokenRef = useLatest(token);
  const [fallback, setFallback] = React.useState("");
  const hostKey = `${paymentsConfig?.clientId || "paypal-disabled"}:${eventId || "event"}`;

  React.useEffect(() => {
    const host = hostRef.current;
    if (!host || !paymentsConfig?.enabled) return undefined;
    let active = true;
    setFallback("");
    loadPaypalSdk(paymentsConfig)
      .then(() => {
        if (!active || !window.paypal) return;
        window.paypal.Buttons({
          style: { layout: "horizontal", height: 36 },
          createOrder: async () => {
            const response = await request(`/events/${encodeURIComponent(eventIdRef.current)}/pay/create-order`, {
              method: "POST",
              token: tokenRef.current,
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || !data.orderId) {
              const message = data.error === "already_paid"
                ? "You're already paid for this event."
                : data.error === "nothing_owed"
                  ? "There's nothing left to pay."
                  : "We couldn't start the payment. Please try again or pay at the event.";
              await memberAlert({ message, title: "Payment could not start" });
              throw new Error(data.error || "create_order_failed");
            }
            return data.orderId;
          },
          onApprove: (data) => request(`/events/${encodeURIComponent(eventIdRef.current)}/pay/capture`, {
            method: "POST",
            token: tokenRef.current,
            body: { orderId: data.orderID },
          }).then((response) => {
            if (response.ok) onReloadRef.current();
            else void memberAlert({
              message: "We could not confirm your payment. Please contact the club.",
              title: "Payment confirmation failed",
            });
          }),
          onError: () => void memberAlert({
            message: "Payment could not be completed. Please try again, or pay at the event.",
            title: "Payment failed",
          }),
        }).render(host);
      })
      .catch(() => setFallback("Online payment is temporarily unavailable - pay at the event."));
    return () => {
      active = false;
    };
  }, [hostKey, paymentsConfig?.clientId, paymentsConfig?.enabled]);

  return h("div", { className: "paypal-buttons" }, [
    fallback ? h("div", { className: "register-fee", key: "fallback", role: "status" }, fallback) : null,
    paymentsConfig?.enabled
      ? h("div", { "data-paypal-button-host": "true", key: hostKey, ref: hostRef })
      : null,
  ]);
}
