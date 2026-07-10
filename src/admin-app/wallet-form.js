import React from "react";

const h = React.createElement;

const EMPTY_FORM = {
  amount: "",
  memberId: "",
  note: "",
};

function dispatchRequest(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function dollarsToCents(value) {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
}

function formBody(form) {
  const amount = dollarsToCents(form.amount);
  return {
    body: {
      amount_cents: amount,
      member_id: form.memberId.trim(),
      note: form.note.trim() || null,
    },
    valid: Boolean(form.memberId.trim() && amount != null && amount !== 0),
  };
}

export function AdminWalletAdjustmentForm() {
  const [form, setForm] = React.useState(EMPTY_FORM);
  const [busy, setBusy] = React.useState(false);
  const currentRequest = React.useRef("");
  const requestCounter = React.useRef(0);

  React.useEffect(() => {
    function update(event) {
      const detail = event.detail && typeof event.detail === "object" ? event.detail : {};
      if (!detail.requestId || detail.requestId !== currentRequest.current) return;
      setBusy(false);
      if (detail.ok === true) {
        setForm(EMPTY_FORM);
        currentRequest.current = "";
      }
    }
    window.addEventListener("gvdg:admin-wallet-adjustment-result", update);
    return () => window.removeEventListener("gvdg:admin-wallet-adjustment-result", update);
  }, []);

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function submit(event) {
    event.preventDefault();
    const payload = formBody(form);
    const requestId = `wallet-adjustment-${requestCounter.current += 1}`;
    currentRequest.current = requestId;
    setBusy(true);
    dispatchRequest("gvdg:admin-wallet-adjustment-request", { ...payload, requestId });
    if (!payload.valid) setBusy(false);
  }

  return h("form", {
    className: "admin-form",
    "data-react-admin-wallet-form": "ready",
    id: "adminWalletForm",
    onSubmit: submit,
  }, [
    h("div", { key: "member" }, [
      h("label", { htmlFor: "waMemberId", key: "label" }, "Member"),
      h("input", {
        id: "waMemberId",
        key: "input",
        maxLength: 80,
        onChange: (event) => updateField("memberId", event.target.value),
        placeholder: "Name, PDGA#, or UDisc",
        required: true,
        value: form.memberId,
      }),
    ]),
    h("div", { key: "amount" }, [
      h("label", { htmlFor: "waAmount", key: "label" }, "Adjustment ($)"),
      h("input", {
        id: "waAmount",
        key: "input",
        onChange: (event) => updateField("amount", event.target.value),
        required: true,
        step: "0.01",
        type: "number",
        value: form.amount,
      }),
    ]),
    h("div", { className: "admin-wallet-form-wide", key: "note" }, [
      h("label", { htmlFor: "waNote", key: "label" }, "Note"),
      h("input", {
        id: "waNote",
        key: "input",
        maxLength: 300,
        onChange: (event) => updateField("note", event.target.value),
        placeholder: "League payout, correction, volunteer credit",
        value: form.note,
      }),
    ]),
    h("button", { className: "admin-btn", disabled: busy, key: "submit", type: "submit" }, busy ? "Posting..." : "Post wallet adjustment"),
  ]);
}
