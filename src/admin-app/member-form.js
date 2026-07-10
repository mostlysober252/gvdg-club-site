import React from "react";

const h = React.createElement;

const EMPTY_FORM = {
  isAdmin: false,
  name: "",
  pdgaNo: "",
  udisc: "",
};

function dispatchRequest(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function formBody(form) {
  const name = form.name.trim();
  const pdgaNo = form.pdgaNo.trim();
  const udisc = form.udisc.trim();
  return {
    body: {
      isAdmin: form.isAdmin,
      name,
      pdgaNo: pdgaNo || null,
      udisc: udisc || null,
    },
    valid: Boolean(name && (pdgaNo || udisc)),
  };
}

export function AdminMemberForm() {
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
    window.addEventListener("gvdg:admin-member-create-result", update);
    return () => window.removeEventListener("gvdg:admin-member-create-result", update);
  }, []);

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function submit(event) {
    event.preventDefault();
    const payload = formBody(form);
    const requestId = `member-create-${requestCounter.current += 1}`;
    currentRequest.current = requestId;
    setBusy(true);
    dispatchRequest("gvdg:admin-member-create-request", { ...payload, requestId });
    if (!payload.valid) setBusy(false);
  }

  return h("form", {
    className: "admin-form",
    "data-react-admin-member-form": "ready",
    id: "adminMemberForm",
    onSubmit: submit,
  }, [
    h("div", { key: "name" }, [
      h("label", { htmlFor: "amName", key: "label" }, "Name"),
      h("input", {
        id: "amName",
        key: "input",
        maxLength: 80,
        onChange: (event) => updateField("name", event.target.value),
        required: true,
        value: form.name,
      }),
    ]),
    h("div", { key: "pdga" }, [
      h("label", { htmlFor: "amPdga", key: "label" }, "PDGA #"),
      h("input", {
        id: "amPdga",
        inputMode: "numeric",
        key: "input",
        maxLength: 12,
        onChange: (event) => updateField("pdgaNo", event.target.value),
        placeholder: "optional if UDisc set",
        value: form.pdgaNo,
      }),
    ]),
    h("div", { key: "udisc" }, [
      h("label", { htmlFor: "amUdisc", key: "label" }, "UDisc username"),
      h("input", {
        id: "amUdisc",
        key: "input",
        maxLength: 50,
        onChange: (event) => updateField("udisc", event.target.value),
        placeholder: "optional if PDGA# set",
        value: form.udisc,
      }),
    ]),
    h("div", { className: "admin-member-form-admin-toggle", key: "admin" }, [
      h("label", { htmlFor: "amAdmin" }, [
        h("input", {
          checked: form.isAdmin,
          id: "amAdmin",
          key: "input",
          onChange: (event) => updateField("isAdmin", event.target.checked),
          type: "checkbox",
        }),
        " Make admin",
      ]),
    ]),
    h("button", { className: "admin-btn", disabled: busy, key: "submit", type: "submit" }, busy ? "Creating..." : "Create & issue temp PIN"),
  ]);
}
