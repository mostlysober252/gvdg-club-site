import React from "react";

const h = React.createElement;

const EMPTY_STATE = {
  config: null,
  configStatus: "idle",
  events: [],
  selectedEventId: null,
  status: "loading",
};

const FORMATS = [
  ["", "format..."],
  ["singles", "Singles"],
  ["doubles", "Doubles"],
  ["teams", "Teams"],
];

let registrationControlsStateSnapshot = EMPTY_STATE;

function objectOrEmpty(value) {
  return value && typeof value === "object" ? value : {};
}

function normalizeText(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function normalizeStatus(value, fallback = "ready") {
  return value === "loading" || value === "error" || value === "idle" || value === "ready" ? value : fallback;
}

function selectedIdValue(value) {
  return value == null || value === "" ? "" : String(value);
}

function currentControlsState() {
  const state = registrationControlsStateSnapshot;
  return state && typeof state === "object" ? state : EMPTY_STATE;
}

function setCurrentControlsState(state) {
  registrationControlsStateSnapshot = state && typeof state === "object" ? state : EMPTY_STATE;
}

function normalizeEvent(event) {
  const source = objectOrEmpty(event);
  const id = selectedIdValue(source.id);
  const name = normalizeText(source.name, "Event") || "Event";
  const status = normalizeText(source.status);
  return {
    id,
    label: status ? `${name} [${status}]` : name,
    source,
    status,
  };
}

function normalizeControlsState(state) {
  return {
    config: state.config && typeof state.config === "object" ? state.config : null,
    configStatus: normalizeStatus(state.configStatus, "idle"),
    events: Array.isArray(state.events) ? state.events.map(normalizeEvent).filter((event) => event.id) : [],
    selectedEventId: selectedIdValue(state.selectedEventId),
    status: normalizeStatus(state.status),
  };
}

function divisionsText(value) {
  if (Array.isArray(value)) return value.map(String).join(", ");
  if (typeof value !== "string") return "";
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).join(", ") : value;
  } catch (error) {
    return value;
  }
}

function dollarsFromCents(value) {
  if (value == null || value === "") return "";
  const cents = Number(value);
  return Number.isFinite(cents) ? String(cents / 100) : "";
}

function dollarsToCents(value) {
  const amount = Number.parseFloat(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : null;
}

function formFromConfig(config) {
  const cfg = objectOrEmpty(config);
  return {
    aceFee: dollarsFromCents(cfg.ace_fee_cents),
    ctpFee: dollarsFromCents(cfg.ctp_fee_cents),
    divisions: divisionsText(cfg.divisions),
    entryFee: dollarsFromCents(cfg.entry_fee_cents),
    playFormat: normalizeText(cfg.play_format),
    registrationOpen: Boolean(cfg.registration_open),
  };
}

function requestId(prefix) {
  return `${prefix}-${Date.now()}`;
}

function dispatchRequest(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

export function useAdminRegistrationControlsState() {
  const [state, setState] = React.useState(() => normalizeControlsState(currentControlsState()));

  React.useEffect(() => {
    function update(event) {
      const next = event.detail && typeof event.detail === "object" ? event.detail : currentControlsState();
      setCurrentControlsState(next);
      setState(normalizeControlsState(next));
    }
    window.addEventListener("gvdg:admin-registration-controls", update);
    setState(normalizeControlsState(currentControlsState()));
    return () => window.removeEventListener("gvdg:admin-registration-controls", update);
  }, []);

  return state;
}

function EventSelector({ state }) {
  return h("div", { "data-react-admin-registration-controls": state.status }, [
    h("label", { htmlFor: "rgEvent", key: "label" }, "Event"),
    h("select", {
      disabled: state.status === "loading",
      id: "rgEvent",
      key: "select",
      onChange: (event) => dispatchRequest("gvdg:admin-registration-event-select-request", { eventId: event.target.value || null }),
      value: state.selectedEventId,
    }, [
      h("option", { key: "empty", value: "" }, "- select an event -"),
      ...state.events.map((event) => h("option", { key: event.id, value: event.id }, event.label)),
    ]),
    state.status === "loading" ? h("p", { className: "al-note", key: "loading", role: "status" }, "Loading registration events...") : null,
    state.status === "error" ? h("p", { className: "al-note err", key: "error", role: "alert" }, "Unable to load registration events.") : null,
  ]);
}

function SettingsForm({ state }) {
  const [form, setForm] = React.useState(() => formFromConfig(state.config));
  const [pendingRequest, setPendingRequest] = React.useState("");

  React.useEffect(() => {
    setForm(formFromConfig(state.config));
    setPendingRequest("");
  }, [state.selectedEventId, state.config]);

  React.useEffect(() => {
    if (!pendingRequest) return undefined;
    function update(event) {
      if (event.detail?.requestId !== pendingRequest) return;
      setPendingRequest("");
    }
    window.addEventListener("gvdg:admin-registration-config-save-result", update);
    return () => window.removeEventListener("gvdg:admin-registration-config-save-result", update);
  }, [pendingRequest]);

  function setField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function submit(event) {
    event.preventDefault();
    if (pendingRequest) return;
    const id = requestId("registration-config");
    setPendingRequest(id);
    dispatchRequest("gvdg:admin-registration-config-save-request", {
      body: {
        ace_fee_cents: dollarsToCents(form.aceFee),
        ctp_fee_cents: dollarsToCents(form.ctpFee),
        divisions: form.divisions.split(",").map((item) => item.trim()).filter(Boolean),
        entry_fee_cents: dollarsToCents(form.entryFee),
        play_format: form.playFormat || null,
        registration_open: form.registrationOpen,
      },
      requestId: id,
      valid: true,
    });
  }

  const busy = Boolean(pendingRequest);
  const disabled = busy || state.configStatus === "loading";

  return h("div", { className: "al-section", "data-react-admin-registration-settings": state.configStatus }, [
    h("h4", { className: "al-h", key: "title" }, "Registration settings"),
    state.configStatus === "loading" ? h("p", { className: "al-note", key: "loading", role: "status" }, "Loading registration settings...") : null,
    state.configStatus === "error" ? h("p", { className: "al-note err", key: "error", role: "alert" }, "Unable to load saved settings.") : null,
    h("form", { key: "form", onSubmit: submit }, [
      h("label", { className: "register-addon", htmlFor: "rgOpen", key: "open" }, [
        h("input", {
          checked: form.registrationOpen,
          disabled,
          id: "rgOpen",
          onChange: (event) => setField("registrationOpen", event.target.checked),
          type: "checkbox",
        }),
        " Registration open",
      ]),
      h("div", { className: "al-row", key: "fees", style: { marginTop: "0.5rem" } }, [
        h("label", { key: "entry" }, ["Entry $", h("input", { disabled, id: "rgEntry", min: "0", onChange: (event) => setField("entryFee", event.target.value), size: 5, step: "1", type: "number", value: form.entryFee })]),
        h("label", { key: "ctp" }, ["CTP $", h("input", { disabled, id: "rgCtp", min: "0", onChange: (event) => setField("ctpFee", event.target.value), size: 5, step: "1", type: "number", value: form.ctpFee })]),
        h("label", { key: "ace" }, ["Ace $", h("input", { disabled, id: "rgAce", min: "0", onChange: (event) => setField("aceFee", event.target.value), size: 5, step: "1", type: "number", value: form.aceFee })]),
        h("select", { disabled, id: "rgFormat", key: "format", onChange: (event) => setField("playFormat", event.target.value), value: form.playFormat }, FORMATS.map(([value, label]) => h("option", { key: value || "empty", value }, label))),
      ]),
      h("div", { className: "al-row", key: "divisions", style: { marginTop: "0.5rem" } }, h("label", null, [
        "Divisions (comma-separated)",
        h("input", { disabled, id: "rgDivisions", maxLength: 400, onChange: (event) => setField("divisions", event.target.value), placeholder: "MA1, MA40, FA1, Rec", size: 40, value: form.divisions }),
      ])),
      h("button", { className: "admin-btn", disabled: busy, key: "submit", style: { marginTop: "0.5rem" }, type: "submit" }, busy ? "Saving..." : "Save settings"),
    ]),
  ]);
}

export function AdminRegistrationControls({ state }) {
  const controlsState = state || useAdminRegistrationControlsState();
  return h(React.Fragment, null, [
    h(EventSelector, { key: "event", state: controlsState }),
    controlsState.selectedEventId ? h(SettingsForm, { key: "settings", state: controlsState }) : null,
  ]);
}
