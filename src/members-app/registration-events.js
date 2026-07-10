import React from "react";

import { request } from "./api.js";
import { dollars, formatEventDay } from "./format.js";
import { memberAlert, memberConfirm } from "./member-dialogs.js";
import { PayPalButtons } from "./registration-payments.js";
import { clientOwed, eventFromRegistration, eventMeta, isDoublesRegistration, parseArray, parseObject, sortRegistrations } from "./registration-utils.js";

const h = React.createElement;

function EventBadge({ status }) {
  if (status === "live") return h("span", { className: "register-live-badge" }, "LIVE NOW");
  if (status === "final") return h("span", { className: "register-final-badge" }, "Final");
  if (status === "cancelled") return h("span", { className: "register-cancelled-badge" }, "Cancelled");
  return null;
}

function RegisteredEventActions({ event, registration, token, onReload }) {
  const manageable = event.status === "scheduled" || event.status === "live";
  const actions = [];

  if (event.status === "live") {
    actions.push(h("a", { className: "passkey-btn", href: `score.html?event=${encodeURIComponent(event.id)}`, key: "score" }, "Open scorecard"));
  }
  if (manageable && !registration.checked_in) {
    actions.push(h("button", {
      type: "button",
      className: "passkey-btn",
      key: "checkin",
      onClick: async () => {
        const response = await request(`/events/${encodeURIComponent(event.id)}/checkin`, { method: "POST", token });
        if (response.ok) onReload();
        else await memberAlert({
          message: "Check-in failed. Please try again or see an admin.",
          title: "Check-in failed",
        });
      },
    }, "Check in"));
  }
  if (event.status === "scheduled") {
    actions.push(h("button", {
      type: "button",
      className: "board-link danger",
      key: "withdraw",
      onClick: async () => {
        const confirmed = await memberConfirm({
          cancelText: "Stay registered",
          confirmText: "Withdraw",
          message: `Withdraw from ${event.name}?`,
          title: "Withdraw from event?",
          tone: "danger",
        });
        if (!confirmed) return;
        const response = await request(`/events/${encodeURIComponent(event.id)}/register`, { method: "DELETE", token });
        if (response.ok) {
          onReload();
          return;
        }
        const data = await response.json().catch(() => ({}));
        await memberAlert({
          message: data.error === "paid_contact_admin"
            ? "You've already paid. Please contact an admin to withdraw and arrange a refund."
            : data.error === "event_started"
              ? "This event has already started. Please see an admin to withdraw."
              : "Withdraw failed. Please try again.",
          title: "Withdraw failed",
        });
      },
    }, "Withdraw"));
  }
  return actions.length ? h("div", { className: "register-actions" }, actions) : null;
}

function OpenEventForm({ event, token, onReload }) {
  const divisions = parseArray(event.divisions);
  const [division, setDivision] = React.useState(divisions[0] || "");
  const [team, setTeam] = React.useState("");
  const [addons, setAddons] = React.useState({ ctp: false, ace: false });

  async function submit(eventSubmit) {
    eventSubmit.preventDefault();
    const body = {
      division: division || null,
      addons,
    };
    if (isDoublesRegistration(event)) body.team = team.trim();
    const response = await request(`/events/${encodeURIComponent(event.id)}/register`, { method: "POST", token, body });
    if (response.ok) onReload();
    else await memberAlert({
      message: "Registration could not be completed.",
      title: "Registration failed",
    });
  }

  return h("form", { className: "register-form", onSubmit: submit }, [
    divisions.length ? h("select", { value: division, onChange: (change) => setDivision(change.target.value), key: "division" },
      divisions.map((name) => h("option", { value: name, key: name }, name))) : null,
    isDoublesRegistration(event) ? h("input", {
      type: "text",
      placeholder: "Pair label or partner",
      maxLength: 40,
      value: team,
      "data-register-pair": "team",
      onChange: (change) => setTeam(change.target.value),
      key: "team",
    }) : null,
    event.ctp_fee_cents ? h("label", { className: "register-addon", key: "ctp" }, [
      h("input", { type: "checkbox", checked: addons.ctp, onChange: (change) => setAddons({ ...addons, ctp: change.target.checked }) }),
      ` CTP pot ${dollars(event.ctp_fee_cents)}`,
    ]) : null,
    event.ace_fee_cents ? h("label", { className: "register-addon", key: "ace" }, [
      h("input", { type: "checkbox", checked: addons.ace, onChange: (change) => setAddons({ ...addons, ace: change.target.checked }) }),
      ` Ace pot ${dollars(event.ace_fee_cents)}`,
    ]) : null,
    h("button", { type: "submit", className: "passkey-btn", key: "submit" }, "Register"),
  ]);
}

export function EventRegistrationCard({ event, registration, token, paymentsConfig, onReload }) {
  const addons = registration ? parseObject(registration.addons) : {};
  const owed = registration ? clientOwed(event, addons) : 0;
  return h("div", { className: `register-card${event.status === "live" ? " live" : ""}` }, [
    h("div", { className: "register-head", key: "head" }, [
      h("span", { className: "register-name", key: "name" }, event.name || "Event"),
      h(EventBadge, { status: event.status, key: "badge" }),
      event.date ? h("span", { className: "register-date", key: "date" }, formatEventDay(event.date)) : null,
    ]),
    eventMeta(event) ? h("div", { className: "register-fee", key: "meta" }, eventMeta(event)) : null,
    !event._synth ? h("div", { className: "register-fee", key: "fee" }, `${event.entry_fee_cents ? `${dollars(event.entry_fee_cents)} entry` : "Free entry"}${event.play_format ? ` - ${event.play_format}` : ""}`) : null,
    registration && event.status === "cancelled"
      ? h("div", { className: "register-status cancelled", key: "status" }, `This event was cancelled${registration.division ? ` - you were in ${registration.division}` : ""}`)
      : null,
    registration && event.status !== "cancelled"
      ? h("div", { className: "register-status", key: "registered" }, `Registered${registration.division ? ` - ${registration.division}` : ""}${registration.checked_in ? " - checked in" : ""}`)
      : null,
    registration?.paid_entry ? h("div", { className: "register-status", key: "paid" }, "Paid") : null,
    registration && !registration.paid_entry && owed > 0 && paymentsConfig?.enabled
      ? h(React.Fragment, { key: "payment" }, [
        h("div", { className: "register-fee", key: "owed" }, `Amount due: ${dollars(owed)}`),
        h(PayPalButtons, { eventId: event.id, token, paymentsConfig, onReload, key: "paypal" }),
      ])
      : null,
    registration && !registration.paid_entry && owed > 0 && !paymentsConfig?.enabled
      ? h("div", { className: "register-fee", key: "offline" }, `Amount due: ${dollars(owed)} - pay at the event (an admin will mark you paid).`)
      : null,
    registration
      ? h(RegisteredEventActions, { event, registration, token, onReload, key: "actions" })
      : h(OpenEventForm, { event, token, onReload, key: "form" }),
  ]);
}

function Section({ title, children }) {
  return h(React.Fragment, null, [
    h("h4", { className: "register-subhead", key: "title" }, title),
    ...children,
  ]);
}

export function EventRegistrationSections({ events, registrations, token, paymentsConfig, onReload }) {
  const byEvent = new Map(registrations.map((row) => [row.event_id, row]));
  const openById = new Map(events.map((event) => [event.id, event]));
  const openToJoin = events.filter((event) => !byEvent.has(event.id));
  const liveToJoin = openToJoin.filter((event) => event.status === "live");
  const scheduledToJoin = openToJoin.filter((event) => event.status !== "live");
  const sections = [];

  if (registrations.length) {
    sections.push(h(Section, { title: "My events", key: "mine" }, sortRegistrations(registrations).map((row) => h(EventRegistrationCard, {
      event: openById.get(row.event_id) || eventFromRegistration(row),
      registration: row,
      token,
      paymentsConfig,
      onReload,
      key: `registered-${row.event_id}`,
    }))));
  }
  if (liveToJoin.length) {
    sections.push(h(Section, { title: "Live now", key: "live" }, liveToJoin.map((event) => h(EventRegistrationCard, { event, token, paymentsConfig, onReload, key: `live-${event.id}` }))));
  }
  if (scheduledToJoin.length) {
    sections.push(h(Section, { title: "Open for registration", key: "open" }, scheduledToJoin.map((event) => h(EventRegistrationCard, { event, token, paymentsConfig, onReload, key: `open-${event.id}` }))));
  }
  return sections;
}
