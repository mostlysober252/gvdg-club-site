import React from "react";

const h = React.createElement;

const EMPTY_LEAGUE_FORM = {
  format: "",
  name: "",
  season: "",
};

const EMPTY_FUNDRAISER_FORM = {
  body: "",
  goal: "",
  paypalUrl: "",
  title: "",
};

const EMPTY_MEETING_FORM = {
  actionItems: "",
  date: "",
  minutes: "",
  title: "",
};

function dispatchRequest(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function centsFromDollars(value) {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
}

function formField({ children, className, id, label }) {
  return h("div", { className, key: id }, [
    h("label", { htmlFor: id, key: "label" }, label),
    children,
  ]);
}

function useRequestForm(emptyForm, resultEvent) {
  const [form, setForm] = React.useState(emptyForm);
  const [busy, setBusy] = React.useState(false);
  const currentRequest = React.useRef("");
  const requestCounter = React.useRef(0);

  React.useEffect(() => {
    function update(event) {
      const detail = event.detail && typeof event.detail === "object" ? event.detail : {};
      if (!detail.requestId || detail.requestId !== currentRequest.current) return;
      setBusy(false);
      if (detail.ok === true) {
        setForm(emptyForm);
        currentRequest.current = "";
      }
    }
    window.addEventListener(resultEvent, update);
    return () => window.removeEventListener(resultEvent, update);
  }, [emptyForm, resultEvent]);

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function beginRequest(slug, requestEvent, payload) {
    const requestId = `${slug}-${requestCounter.current += 1}`;
    currentRequest.current = requestId;
    setBusy(true);
    dispatchRequest(requestEvent, { ...payload, requestId });
    if (!payload.valid) setBusy(false);
  }

  return { beginRequest, busy, form, updateField };
}

function leaguePayload(form) {
  const name = form.name.trim();
  return {
    body: {
      format: form.format || null,
      name,
      season: form.season.trim() || null,
    },
    labelText: name,
    valid: Boolean(name),
  };
}

function fundraiserPayload(form) {
  const title = form.title.trim();
  return {
    body: {
      body_md: form.body.trim() || null,
      goal_cents: centsFromDollars(form.goal),
      paypal_url: form.paypalUrl.trim() || null,
      status: "active",
      title,
    },
    labelText: title,
    valid: Boolean(title),
  };
}

function meetingPayload(form) {
  const title = form.title.trim();
  return {
    body: {
      action_items: form.actionItems.split("\n").map((item) => item.trim()).filter(Boolean),
      date: form.date,
      minutes_md: form.minutes.trim() || null,
      title,
    },
    labelText: title,
    valid: Boolean(form.date && title),
  };
}

export function AdminLeagueForm() {
  const { beginRequest, busy, form, updateField } = useRequestForm(EMPTY_LEAGUE_FORM, "gvdg:admin-league-create-result");

  function submit(event) {
    event.preventDefault();
    beginRequest("league-create", "gvdg:admin-league-create-request", leaguePayload(form));
  }

  return h("form", {
    className: "admin-form",
    "data-react-admin-league-form": "ready",
    id: "adminLeagueForm",
    onSubmit: submit,
  }, [
    formField({
      id: "lgName",
      label: "League name",
      children: h("input", { id: "lgName", key: "input", maxLength: 120, onChange: (event) => updateField("name", event.target.value), required: true, value: form.name }),
    }),
    formField({
      id: "lgSeason",
      label: "Season",
      children: h("input", { id: "lgSeason", key: "input", maxLength: 40, onChange: (event) => updateField("season", event.target.value), placeholder: "2026", value: form.season }),
    }),
    formField({
      id: "lgFormat",
      label: "Format",
      children: h("select", { id: "lgFormat", key: "input", onChange: (event) => updateField("format", event.target.value), value: form.format }, [
        h("option", { key: "blank", value: "" }, "-"),
        h("option", { key: "doubles", value: "doubles" }, "Doubles"),
        h("option", { key: "stroke", value: "stroke" }, "Singles/Stroke"),
        h("option", { key: "matchplay", value: "matchplay" }, "Matchplay"),
      ]),
    }),
    h("button", { className: "admin-btn", disabled: busy, key: "submit", type: "submit" }, busy ? "Adding..." : "Add league"),
  ]);
}

export function AdminFundraiserForm() {
  const { beginRequest, busy, form, updateField } = useRequestForm(EMPTY_FUNDRAISER_FORM, "gvdg:admin-fundraiser-create-result");

  function submit(event) {
    event.preventDefault();
    beginRequest("fundraiser-create", "gvdg:admin-fundraiser-create-request", fundraiserPayload(form));
  }

  return h("form", {
    className: "admin-form",
    "data-react-admin-fundraiser-form": "ready",
    id: "adminFundraiserForm",
    onSubmit: submit,
  }, [
    formField({
      id: "frTitle",
      label: "Title",
      children: h("input", { id: "frTitle", key: "input", maxLength: 200, onChange: (event) => updateField("title", event.target.value), required: true, value: form.title }),
    }),
    formField({
      id: "frGoal",
      label: "Goal ($)",
      children: h("input", { id: "frGoal", key: "input", min: "0", onChange: (event) => updateField("goal", event.target.value), step: "1", type: "number", value: form.goal }),
    }),
    formField({
      id: "frPaypal",
      label: "PayPal URL (https)",
      children: h("input", { id: "frPaypal", key: "input", maxLength: 1000, onChange: (event) => updateField("paypalUrl", event.target.value), placeholder: "https://paypal.me/greenvillediscgolf", type: "url", value: form.paypalUrl }),
    }),
    formField({
      className: "admin-club-form-wide",
      id: "frBody",
      label: "Description (markdown)",
      children: h("textarea", { id: "frBody", key: "input", onChange: (event) => updateField("body", event.target.value), rows: 4, value: form.body }),
    }),
    h("button", { className: "admin-btn", disabled: busy, key: "submit", type: "submit" }, busy ? "Adding..." : "Add fundraiser"),
  ]);
}

export function AdminMeetingForm() {
  const { beginRequest, busy, form, updateField } = useRequestForm(EMPTY_MEETING_FORM, "gvdg:admin-meeting-create-result");

  function submit(event) {
    event.preventDefault();
    beginRequest("meeting-create", "gvdg:admin-meeting-create-request", meetingPayload(form));
  }

  return h("form", {
    className: "admin-form",
    "data-react-admin-meeting-form": "ready",
    id: "adminMeetingForm",
    onSubmit: submit,
  }, [
    formField({
      id: "mtDate",
      label: "Date",
      children: h("input", { id: "mtDate", key: "input", onChange: (event) => updateField("date", event.target.value), required: true, type: "date", value: form.date }),
    }),
    formField({
      id: "mtTitle",
      label: "Title",
      children: h("input", { id: "mtTitle", key: "input", maxLength: 200, onChange: (event) => updateField("title", event.target.value), required: true, value: form.title }),
    }),
    formField({
      className: "admin-club-form-wide",
      id: "mtMinutes",
      label: "Minutes (markdown)",
      children: h("textarea", { id: "mtMinutes", key: "input", onChange: (event) => updateField("minutes", event.target.value), rows: 5, value: form.minutes }),
    }),
    formField({
      className: "admin-club-form-wide",
      id: "mtActions",
      label: "Action items (one per line)",
      children: h("textarea", { id: "mtActions", key: "input", onChange: (event) => updateField("actionItems", event.target.value), rows: 3, value: form.actionItems }),
    }),
    h("button", { className: "admin-btn", disabled: busy, key: "submit", type: "submit" }, busy ? "Adding..." : "Add meeting"),
  ]);
}
