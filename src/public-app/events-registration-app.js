import React from "react";
import { CalendarDays, CheckCircle2 } from "lucide-react";

import { normalizeEvent, parseEventDate } from "../shared/events-model.js";
import { clientOwed, isDoublesRegistration, parseArray, parseObject } from "../members-app/registration-utils.js";
import { publicApiBase } from "./public-api.js";

const h = React.createElement;
const REGISTRATION_REFRESH_EVENT = "gvdg:events-registration-refresh";
const GUEST_REG_KEY = "gvdg_guest_regs";

function icon(Icon, size = 16) {
  return h(Icon, {
    "aria-hidden": "true",
    focusable: "false",
    size,
    strokeWidth: 2.4,
  });
}

function apiBase() {
  return publicApiBase();
}

function memberToken() {
  try {
    return sessionStorage.getItem("gvdg_member_token") || null;
  } catch {
    return null;
  }
}

function guestRegs() {
  try {
    const parsed = JSON.parse(localStorage.getItem(GUEST_REG_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function setGuestReg(eventId, value) {
  const all = guestRegs();
  if (value) all[eventId] = value;
  else delete all[eventId];
  try {
    localStorage.setItem(GUEST_REG_KEY, JSON.stringify(all));
  } catch {
  }
}

function startOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function eventDateForSort(event) {
  return parseEventDate((event && (event.date || event.starts_at)) || null);
}

function isArchivedClubEvent(raw) {
  const event = normalizeEvent(raw);
  if (event.status === "live") return false;
  if (event.status === "final" || event.status === "cancelled") return true;
  const date = eventDateForSort(event);
  return date ? date < startOfToday() : false;
}

function dollars(cents) {
  return "$" + (Math.round(Number(cents) || 0) / 100).toFixed(2).replace(/\.00$/, "");
}

async function fetchJson(base, path) {
  const response = await fetch(`${base}${path}`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json();
}

async function regApi(base, path, opts = {}) {
  const headers = { Accept: "application/json" };
  if (opts.body) headers["Content-Type"] = "application/json";
  if (opts.token) headers.Authorization = "Bearer " + opts.token;
  return fetch(base + path, {
    method: opts.method || "GET",
    cache: "no-store",
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
}

function eventKey(event, index) {
  return [
    event && event.id,
    event && event.name,
    event && event.date,
    String(index),
  ].filter(Boolean).join("|");
}

function registrationError(response, error) {
  if (response.status === 401 || error.error === "session_expired") {
    return "Your members session expired. Register as a guest below or sign in again on the Members page.";
  }
  if (error.error === "registration_closed") return "Registration is closed for this event.";
  if (error.error === "rate_limited") return "Too many sign-ups from your network. Please try again in a minute.";
  if (error.error === "invalid_division") return "Please pick a valid division.";
  return "Registration could not be completed.";
}

function EventMeta({ event }) {
  if (!event.date) return null;
  return h("div", { className: "event-meta" }, h("div", { className: "meta-row" }, [
    h("span", { className: "meta-icon", key: "icon" }, icon(CalendarDays)),
    h("span", { key: "date" }, String(event.date)),
  ]));
}

function RegisteredCardActions({ api, event, guestReg, myReg, onRefresh, token }) {
  const [confirming, setConfirming] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  async function withdraw() {
    if (!confirming) {
      setError("");
      setConfirming(true);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const path = `/events/${encodeURIComponent(event.id)}/register${guestReg ? `?gt=${encodeURIComponent(guestReg.guestToken)}` : ""}`;
      const response = await regApi(api, path, { method: "DELETE", token: myReg ? token : undefined });
      if (response.ok) {
        if (guestReg) setGuestReg(event.id, null);
        await onRefresh();
        return;
      }
      const body = await response.json().catch(() => ({}));
      setError(body.error === "paid_contact_admin"
        ? "You have already paid. Please contact an admin to withdraw."
        : "Withdraw failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return h(React.Fragment, null, [
    error ? h("div", { className: "register-error", key: "error", role: "alert" }, error) : null,
    confirming
      ? h("div", { className: "register-confirm", key: "confirm" }, [
        h("button", {
          className: "reg-btn secondary",
          disabled: busy,
          key: "confirm",
          onClick: withdraw,
          type: "button",
        }, busy ? "Withdrawing..." : "Confirm withdraw"),
        h("button", {
          className: "reg-btn tertiary",
          disabled: busy,
          key: "cancel",
          onClick: () => {
            setConfirming(false);
            setError("");
          },
          type: "button",
        }, "Cancel"),
      ])
      : h("button", {
        className: "reg-btn secondary",
        disabled: busy,
        key: "withdraw",
        onClick: withdraw,
        type: "button",
      }, "Withdraw"),
  ]);
}

function RegisterForm({ api, event, onRefresh, onSessionExpired, token }) {
  const divisions = React.useMemo(() => parseArray(event.divisions), [event.divisions]);
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [division, setDivision] = React.useState(() => divisions[0] || "");
  const [team, setTeam] = React.useState("");
  const [ctp, setCtp] = React.useState(false);
  const [ace, setAce] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const nameRef = React.useRef(null);
  const doubles = isDoublesRegistration(event);

  React.useEffect(() => {
    setDivision(divisions[0] || "");
  }, [divisions]);

  async function submit() {
    const body = {
      division: divisions.length ? division : null,
      addons: {
        ctp: Boolean(ctp && event.ctp_fee_cents),
        ace: Boolean(ace && event.ace_fee_cents),
      },
    };
    if (doubles) body.team = team.trim();
    if (!token) {
      const trimmedName = name.trim();
      if (!trimmedName) {
        setError("Please enter your name.");
        nameRef.current?.focus();
        return;
      }
      body.name = trimmedName;
      const trimmedEmail = email.trim();
      if (trimmedEmail) body.email = trimmedEmail;
    }

    setBusy(true);
    setError("");
    try {
      const response = await regApi(api, `/events/${encodeURIComponent(event.id)}/register`, {
        method: "POST",
        token: token || undefined,
        body,
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        if (response.status === 401 || payload.error === "session_expired") {
          try {
            sessionStorage.removeItem("gvdg_member_token");
          } catch {
          }
          onSessionExpired();
        }
        setError(registrationError(response, payload));
        return;
      }
      const payload = await response.json().catch(() => ({}));
      if (!token && payload.guestToken) {
        setGuestReg(event.id, {
          addons: body.addons,
          division: body.division,
          guestToken: payload.guestToken,
          name: body.name,
          team: body.team || null,
        });
      }
      await onRefresh();
    } finally {
      setBusy(false);
    }
  }

  return h("div", { className: "register-form" }, [
    !token ? h("input", {
      className: "reg-input",
      key: "name",
      maxLength: 80,
      onChange: (event) => setName(event.target.value),
      placeholder: "Your name",
      ref: nameRef,
      type: "text",
      value: name,
    }) : null,
    !token ? h("input", {
      className: "reg-input",
      key: "email",
      maxLength: 120,
      onChange: (event) => setEmail(event.target.value),
      placeholder: "Email (optional)",
      type: "email",
      value: email,
    }) : null,
    divisions.length ? h("select", {
      className: "reg-input",
      key: "division",
      onChange: (event) => setDivision(event.target.value),
      value: division,
    }, divisions.map((item) => h("option", { key: item, value: item }, item))) : null,
    doubles ? h("input", {
      className: "reg-input",
      "data-register-pair": "team",
      key: "team",
      maxLength: 40,
      onChange: (event) => setTeam(event.target.value),
      placeholder: "Pair label or partner",
      type: "text",
      value: team,
    }) : null,
    event.ctp_fee_cents ? h("label", { className: "register-addon", key: "ctp" }, [
      h("input", {
        checked: ctp,
        key: "input",
        onChange: (event) => setCtp(event.target.checked),
        type: "checkbox",
      }),
      h("span", { key: "label" }, `CTP pot ${dollars(event.ctp_fee_cents)}`),
    ]) : null,
    event.ace_fee_cents ? h("label", { className: "register-addon", key: "ace" }, [
      h("input", {
        checked: ace,
        key: "input",
        onChange: (event) => setAce(event.target.checked),
        type: "checkbox",
      }),
      h("span", { key: "label" }, `Ace pot ${dollars(event.ace_fee_cents)}`),
    ]) : null,
    error ? h("div", { className: "register-error", key: "error", role: "alert" }, error) : null,
    h("button", {
      className: "reg-btn",
      disabled: busy,
      key: "submit",
      onClick: submit,
      type: "button",
    }, busy ? "Registering..." : "Register"),
  ]);
}

function RegistrationCard({ api, event, guestReg, myReg, onRefresh, onSessionExpired, token }) {
  const registered = Boolean(myReg || guestReg);
  const who = myReg
    ? myReg.division ? ` - ${myReg.division}` : ""
    : guestReg && guestReg.name ? ` - ${guestReg.name}` : "";
  const addons = myReg ? parseObject(myReg.addons) : guestReg ? parseObject(guestReg.addons) : {};
  const owed = registered ? clientOwed(event, addons) : 0;

  return h("article", { className: "event-card register-card", "data-react-events-registration-card": "true" }, [
    h("div", { className: "event-card-top", key: "top" },
      h("h3", { className: "event-name" }, event.name || "Event")),
    h(EventMeta, { event, key: "meta" }),
    h("div", { className: "register-fee", key: "fee" },
      `${event.entry_fee_cents ? `${dollars(event.entry_fee_cents)} entry` : "Free entry"}${event.play_format ? ` - ${event.play_format}` : ""}`),
    registered ? h("div", { className: "register-status", key: "status" }, [
      h("span", { className: "meta-icon", key: "icon" }, icon(CheckCircle2)),
      h("span", { key: "text" }, `Registered${who}`),
    ]) : null,
    registered && owed > 0 && !(myReg && myReg.paid_entry)
      ? h("div", { className: "register-fee", key: "owed" },
        `Amount due: ${dollars(owed)} - pay at the event${token ? " or in the Members area." : "."}`)
      : null,
    registered
      ? h(RegisteredCardActions, { api, event, guestReg, key: "actions", myReg, onRefresh, token })
      : h(RegisterForm, { api, event, key: "form", onRefresh, onSessionExpired, token }),
  ]);
}

export function EventsRegistrationApp() {
  const api = React.useMemo(apiBase, []);
  const [events, setEvents] = React.useState([]);
  const [myRegs, setMyRegs] = React.useState({});
  const [guestMap, setGuestMap] = React.useState({});
  const [token, setToken] = React.useState(memberToken);

  const load = React.useCallback(async () => {
    const nextToken = memberToken();
    setToken(nextToken);
    let open = [];
    try {
      const data = await fetchJson(api, "/registration/open");
      open = Array.isArray(data && data.events) ? data.events.filter((event) => !isArchivedClubEvent(event)) : [];
    } catch {
      open = [];
    }
    const registrations = {};
    if (nextToken) {
      try {
        const response = await regApi(api, "/my-registrations", { token: nextToken });
        if (response.ok) {
          const payload = await response.json();
          (payload.registrations || []).forEach((row) => {
            registrations[row.event_id] = row;
          });
        }
      } catch {
      }
    }
    setEvents(open);
    setMyRegs(registrations);
    setGuestMap(guestRegs());
  }, [api]);

  React.useEffect(() => {
    load();
    window.addEventListener(REGISTRATION_REFRESH_EVENT, load);
    return () => window.removeEventListener(REGISTRATION_REFRESH_EVENT, load);
  }, [load]);

  if (!events.length) return null;

  return h("section", { "data-react-events-registration": "true" }, [
    h("div", { className: "events-group-head", key: "head" }, [
      h("h2", { className: "events-section-title", key: "title" }, "Currently Registering"),
      h("p", { className: "events-group-sub", key: "sub" }, "Sign up for upcoming club events - members or guests"),
    ]),
    h("div", { className: "events-grid", key: "grid" }, events.map((event, index) => {
      const id = event && event.id;
      return h(RegistrationCard, {
        api,
        event,
        guestReg: id != null ? guestMap[id] || null : null,
        key: eventKey(event, index),
        myReg: id != null ? myRegs[id] || null : null,
        onRefresh: load,
        onSessionExpired: () => setToken(null),
        token,
      });
    })),
  ]);
}
