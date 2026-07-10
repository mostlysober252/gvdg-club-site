import React from "react";

const h = React.createElement;

const EMPTY_FORM = {
  authHeader: "",
  authPrefix: "",
  authToken: "",
  clearAuthToken: false,
  endpointUrl: "",
  hasAuthToken: false,
  id: "",
  isActive: false,
  label: "",
};

function dispatchRequest(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function textValue(value) {
  return typeof value === "string" ? value : "";
}

function hasStoredAuthToken(destination) {
  return destination.hasAuthToken === true || destination.has_auth_token === true;
}

function formFromDestination(destination) {
  return {
    authHeader: textValue(destination.auth_header),
    authPrefix: textValue(destination.auth_prefix),
    authToken: "",
    clearAuthToken: false,
    endpointUrl: textValue(destination.endpoint_url),
    hasAuthToken: hasStoredAuthToken(destination),
    id: destination.id == null ? "" : String(destination.id),
    isActive: Number(destination.is_active) === 1 || destination.is_active === true,
    label: textValue(destination.label),
  };
}

function tokenPlaceholder(form) {
  if (!form.id) return "Leave blank to keep existing";
  return form.hasAuthToken ? "Leave blank to keep existing token" : "Add a token (optional)";
}

function formBody(form) {
  const label = form.label.trim();
  const endpointUrl = form.endpointUrl.trim();
  const authToken = form.authToken.trim();
  const editing = Boolean(form.id);
  const body = {
    auth_header: form.authHeader.trim() || null,
    auth_prefix: form.authPrefix.trim() || null,
    endpoint_url: endpointUrl,
    is_active: form.isActive,
    label,
  };
  if (authToken) body.auth_token = authToken;
  else if (editing && form.clearAuthToken) body.auth_token = null;
  if (!editing && body.auth_token == null && form.clearAuthToken) body.auth_token = null;

  return {
    body,
    editing,
    endpointId: editing ? Number(form.id) : null,
    labelText: label || `Endpoint ${form.id || ""}`,
    valid: Boolean(label && /^https?:\/\//.test(endpointUrl)),
  };
}

export function AdminDataArchiveDestinationForm() {
  const [form, setForm] = React.useState(EMPTY_FORM);
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState("");
  const formRef = React.useRef(null);
  const currentRequest = React.useRef("");
  const requestCounter = React.useRef(0);

  React.useEffect(() => {
    function edit(event) {
      const detail = event.detail && typeof event.detail === "object" ? event.detail : {};
      const destination = detail.destination && typeof detail.destination === "object" ? detail.destination : null;
      if (!destination) return;
      currentRequest.current = "";
      setBusy(false);
      setNotice("");
      setForm(formFromDestination(destination));
      window.requestAnimationFrame(() => formRef.current?.scrollIntoView({ block: "start" }));
    }
    window.addEventListener("gvdg:admin-data-archive-destination-form-edit", edit);
    return () => window.removeEventListener("gvdg:admin-data-archive-destination-form-edit", edit);
  }, []);

  React.useEffect(() => {
    function update(event) {
      const detail = event.detail && typeof event.detail === "object" ? event.detail : {};
      if (!detail.requestId || detail.requestId !== currentRequest.current) return;
      setBusy(false);
      if (detail.ok === true) {
        setNotice("");
        setForm(EMPTY_FORM);
        currentRequest.current = "";
      } else {
        setNotice(textValue(detail.message) || "Save failed");
      }
    }
    window.addEventListener("gvdg:admin-data-archive-destination-save-result", update);
    return () => window.removeEventListener("gvdg:admin-data-archive-destination-save-result", update);
  }, []);

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function cancelEdit() {
    currentRequest.current = "";
    setBusy(false);
    setNotice("");
    setForm(EMPTY_FORM);
  }

  function submit(event) {
    event.preventDefault();
    setNotice("");
    const payload = formBody(form);
    const requestId = `data-archive-destination-save-${requestCounter.current += 1}`;
    currentRequest.current = requestId;
    setBusy(true);
    dispatchRequest("gvdg:admin-data-archive-destination-save-request", { ...payload, requestId });
    if (!payload.valid) setBusy(false);
  }

  return h("form", {
    className: "admin-form admin-data-archive-destination-form",
    "data-react-admin-data-archive-destination-form": "ready",
    id: "dxEndpointForm",
    onSubmit: submit,
    ref: formRef,
  }, [
    h("input", { id: "dxEndpointId", key: "id", readOnly: true, type: "hidden", value: form.id }),
    h("div", { key: "label" }, [
      h("label", { htmlFor: "dxEndpointLabel", key: "label" }, "Label"),
      h("input", {
        id: "dxEndpointLabel",
        key: "input",
        maxLength: 120,
        onChange: (event) => updateField("label", event.target.value),
        required: true,
        value: form.label,
      }),
    ]),
    h("div", { key: "url" }, [
      h("label", { htmlFor: "dxEndpointUrl", key: "label" }, "Endpoint URL (https)"),
      h("input", {
        id: "dxEndpointUrl",
        key: "input",
        maxLength: 1000,
        onChange: (event) => updateField("endpointUrl", event.target.value),
        required: true,
        type: "url",
        value: form.endpointUrl,
      }),
    ]),
    h("div", { key: "auth-header" }, [
      h("label", { htmlFor: "dxAuthHeader", key: "label" }, "Auth header (optional)"),
      h("input", {
        id: "dxAuthHeader",
        key: "input",
        maxLength: 80,
        onChange: (event) => updateField("authHeader", event.target.value),
        placeholder: "Authorization or X-Api-Key",
        value: form.authHeader,
      }),
    ]),
    h("div", { key: "auth-prefix" }, [
      h("label", { htmlFor: "dxAuthPrefix", key: "label" }, "Auth prefix (optional)"),
      h("input", {
        id: "dxAuthPrefix",
        key: "input",
        maxLength: 40,
        onChange: (event) => updateField("authPrefix", event.target.value),
        placeholder: "Bearer",
        value: form.authPrefix,
      }),
    ]),
    h("div", { key: "auth-token" }, [
      h("label", { htmlFor: "dxAuthToken", key: "label" }, "Auth token (optional)"),
      h("input", {
        autoComplete: "off",
        id: "dxAuthToken",
        key: "input",
        maxLength: 4096,
        onChange: (event) => updateField("authToken", event.target.value),
        placeholder: tokenPlaceholder(form),
        type: "text",
        value: form.authToken,
      }),
    ]),
    h("label", { className: "register-addon admin-data-archive-destination-toggle", htmlFor: "dxAuthTokenClear", key: "clear-token" }, [
      h("input", {
        checked: form.clearAuthToken,
        id: "dxAuthTokenClear",
        key: "input",
        onChange: (event) => updateField("clearAuthToken", event.target.checked),
        type: "checkbox",
      }),
      " Clear auth token",
    ]),
    h("label", { className: "register-addon admin-data-archive-destination-toggle", htmlFor: "dxEndpointActive", key: "active" }, [
      h("input", {
        checked: form.isActive,
        id: "dxEndpointActive",
        key: "input",
        onChange: (event) => updateField("isActive", event.target.checked),
        type: "checkbox",
      }),
      " Use as active destination",
    ]),
    notice ? h("p", { className: "al-note err", key: "notice", role: "alert" }, notice) : null,
    h("div", { className: "admin-form-actions", key: "actions" }, [
      h("button", {
        className: "admin-btn",
        disabled: busy,
        id: "dxEndpointSave",
        key: "save",
        type: "submit",
      }, busy ? "Saving..." : form.id ? "Save destination" : "Add destination"),
      form.id ? h("button", {
        className: "admin-btn secondary",
        disabled: busy,
        id: "dxEndpointCancel",
        key: "cancel",
        onClick: cancelEdit,
        type: "button",
      }, "Cancel edit") : null,
    ]),
  ]);
}
