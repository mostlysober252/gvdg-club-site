import React from "react";
import { AuthIcon, LoginForm, PinChangeForm, ProfileForm } from "./auth-forms.js";

const h = React.createElement;
const SHELL_EVENT = "gvdg:member-shell-view";
const AUTH_FORM_STATE_EVENT = "gvdg:member-auth-form-state";
const AUTH_FORMS = new Set(["login", "pin", "profile"]);
const FORM_VALUES = {
  login: { identifier: "", pin: "" },
  pin: { newPin: "", confirmPin: "" },
  profile: { pdga: "", udisc: "" },
};

function createFormState(form) {
  return { error: "", busyAction: "", values: FORM_VALUES[form] };
}

function mergeFormState(previous, form, changes) {
  const detailValues = changes.values && typeof changes.values === "object" ? changes.values : null;
  return {
    ...previous,
    [form]: {
      error: typeof changes.error === "string" ? changes.error : previous[form].error,
      busyAction: typeof changes.busyAction === "string" ? changes.busyAction : previous[form].busyAction,
      values: detailValues ? { ...previous[form].values, ...detailValues } : previous[form].values,
    },
  };
}

export function MemberAuthGate() {
  const [mode, setMode] = React.useState("login");
  const [shellView, setShellView] = React.useState("auth");
  const [supportsPasskeys, setSupportsPasskeys] = React.useState(false);
  const [formStates, setFormStates] = React.useState({
    login: createFormState("login"),
    pin: createFormState("pin"),
    profile: createFormState("profile"),
  });

  function setFormValues(form, values) {
    if (AUTH_FORMS.has(form)) setFormStates((previous) => mergeFormState(previous, form, { values }));
  }

  React.useEffect(() => {
    document.body.dataset.memberShell = shellView;
    return () => {
      if (document.body.dataset.memberShell === shellView) delete document.body.dataset.memberShell;
    };
  }, [shellView]);

  React.useEffect(() => {
    if (shellView !== "auth") return undefined;
    const frame = window.requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: "auto" }));
    return () => window.cancelAnimationFrame(frame);
  }, [mode, shellView]);

  React.useEffect(() => {
    const supported = typeof window.PublicKeyCredential !== "undefined";
    setSupportsPasskeys(supported);
    window.dispatchEvent(new CustomEvent("gvdg:member-auth-ready", { detail: { mode: "login", passkeysSupported: supported } }));
  }, []);

  React.useEffect(() => {
    function update(event) {
      const nextMode = event.detail?.mode;
      setMode(nextMode === "pin" || nextMode === "profile" ? nextMode : "login");
      setShellView("auth");
      if (typeof event.detail?.passkeysSupported === "boolean") setSupportsPasskeys(event.detail.passkeysSupported);
    }

    window.addEventListener("gvdg:member-auth-mode", update);
    return () => window.removeEventListener("gvdg:member-auth-mode", update);
  }, []);

  React.useEffect(() => {
    function update(event) {
      const form = event.detail?.form;
      if (!AUTH_FORMS.has(form)) return;
      setFormStates((previous) => mergeFormState(previous, form, event.detail || {}));
    }

    window.addEventListener(AUTH_FORM_STATE_EVENT, update);
    return () => window.removeEventListener(AUTH_FORM_STATE_EVENT, update);
  }, []);

  React.useEffect(() => {
    function updateShell(event) {
      setShellView(event.detail?.view === "members" ? "members" : "auth");
    }

    window.addEventListener(SHELL_EVENT, updateShell);
    return () => window.removeEventListener(SHELL_EVENT, updateShell);
  }, []);

  return h("div", { className: "login-card", "data-react-auth-gate": mode }, [
    h(AuthIcon, { key: "icon" }),
    h("h1", { className: "login-title", key: "title" }, "Members Only"),
    h("p", { className: "login-subtitle", key: "subtitle" }, "Log in with your PDGA # or UDisc username and your PIN."),
    h(LoginForm, { active: mode === "login", supportsPasskeys, state: formStates.login, onValuesChange: setFormValues, key: "login" }),
    h(PinChangeForm, { active: mode === "pin", state: formStates.pin, onValuesChange: setFormValues, key: "pin" }),
    h(ProfileForm, { active: mode === "profile", state: formStates.profile, onValuesChange: setFormValues, key: "profile" }),
    h("a", { href: "index.html", className: "back-link", key: "back" }, "Back to main site"),
  ]);
}
