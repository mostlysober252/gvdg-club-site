import React from "react";
import { Camera, KeyRound, LockKeyhole } from "lucide-react";

const h = React.createElement;

function request(eventName, detail = {}) {
  window.dispatchEvent(new CustomEvent(eventName, { detail }));
}

function FormGroup({ label, htmlFor, hint, children }) {
  return h("div", { className: "form-group" }, [
    h("label", { className: "form-label", htmlFor, key: "label" }, label),
    children,
    hint ? h("p", { className: "form-hint", key: "hint" }, hint) : null,
  ]);
}

export function AuthIcon() {
  return h("div", { className: "login-icon", "aria-hidden": "true" }, h(LockKeyhole, { size: 56, strokeWidth: 1.8 }));
}

function IconLabel({ icon, text }) {
  return h("span", { className: "auth-icon-label" }, [icon, h("span", { key: "text" }, text)]);
}

function ErrorMessage({ form, state }) {
  return h("div", {
    className: `login-error${state.error ? " show" : ""}`,
    "data-react-auth-error": form,
    "data-react-auth-error-state": state.error ? "shown" : "empty",
    role: state.error ? "alert" : undefined,
    "aria-live": "polite",
  }, state.error);
}

export function LoginForm({ active, supportsPasskeys, state, onValuesChange }) {
  const identifier = state.values.identifier || "";
  const pin = state.values.pin || "";
  const busy = Boolean(state.busyAction);
  const loginBusy = state.busyAction === "login";
  const passkeyBusy = state.busyAction === "passkey";

  return h("form", {
    className: "login-form",
    id: "loginForm",
    autoComplete: "on",
    hidden: !active,
    onSubmit: (event) => {
      event.preventDefault();
      request("gvdg:member-login-requested", { identifier, pin });
    },
  }, [
    h(FormGroup, {
      label: "PDGA # or UDisc Username",
      htmlFor: "identifierInput",
      hint: "Whichever you registered with the club",
      key: "identifier",
    }, h("input", {
      type: "text",
      className: "form-input",
      id: "identifierInput",
      name: "identifier",
      autoComplete: "username",
      placeholder: "12345 or UDisc handle",
      value: identifier,
      onChange: (event) => onValuesChange("login", { identifier: event.target.value }),
    })),
    h(FormGroup, {
      label: "PIN",
      htmlFor: "pinInput",
      hint: "New members: use the temporary PIN from an admin",
      key: "pin",
    }, h("input", {
      type: "password",
      className: "form-input",
      id: "pinInput",
      name: "pin",
      inputMode: "numeric",
      autoComplete: "current-password",
      maxLength: 4,
      placeholder: "4-digit PIN",
      value: pin,
      onChange: (event) => onValuesChange("login", { pin: event.target.value }),
    })),
    h("button", { type: "submit", className: "login-btn", disabled: busy, "data-react-auth-action": "login", key: "login" }, loginBusy ? "Please wait..." : "Log In"),
    h(ErrorMessage, { form: "login", state, key: "error" }),
    supportsPasskeys ? h("div", { className: "login-divider", key: "divider" }, h("span", null, "or")) : null,
    supportsPasskeys
      ? h("button", {
        type: "button",
        className: "login-btn login-btn-secondary",
        disabled: busy,
        "data-react-auth-action": "passkey",
        onClick: () => request("gvdg:member-passkey-login-requested"),
        key: "passkey",
      }, passkeyBusy ? "Please wait..." : h(IconLabel, { icon: h(KeyRound, { size: 17, strokeWidth: 2.2, key: "icon" }), text: "Log in with a passkey" }))
      : null,
  ].filter(Boolean));
}

export function PinChangeForm({ active, state, onValuesChange }) {
  const newPin = state.values.newPin || "";
  const confirmPin = state.values.confirmPin || "";
  const newPinRef = React.useRef(null);

  React.useEffect(() => {
    if (active) newPinRef.current?.focus();
  }, [active]);

  return h("form", {
    className: "login-form",
    id: "pinChangeForm",
    autoComplete: "on",
    hidden: !active,
    onSubmit: (event) => {
      event.preventDefault();
      request("gvdg:member-pin-change-requested", { newPin, confirmPin });
    },
  }, [
    h("p", { className: "login-subtitle", key: "copy" }, "You're using a temporary PIN. Choose your own to continue."),
    h(FormGroup, { label: "New PIN", htmlFor: "newPinInput", key: "new-pin" }, h("input", {
      type: "password",
      className: "form-input",
      id: "newPinInput",
      name: "new-pin",
      inputMode: "numeric",
      autoComplete: "new-password",
      maxLength: 4,
      placeholder: "Choose a 4-digit PIN",
      ref: newPinRef,
      value: newPin,
      onChange: (event) => onValuesChange("pin", { newPin: event.target.value }),
    })),
    h(FormGroup, { label: "Confirm PIN", htmlFor: "confirmPinInput", key: "confirm-pin" }, h("input", {
      type: "password",
      className: "form-input",
      id: "confirmPinInput",
      name: "confirm-pin",
      inputMode: "numeric",
      autoComplete: "new-password",
      maxLength: 4,
      placeholder: "Re-enter your PIN",
      value: confirmPin,
      onChange: (event) => onValuesChange("pin", { confirmPin: event.target.value }),
    })),
    h("button", { type: "submit", className: "login-btn", disabled: Boolean(state.busyAction), "data-react-auth-action": "pin", key: "save" }, state.busyAction === "pin" ? "Please wait..." : "Save PIN & Continue"),
    h(ErrorMessage, { form: "pin", state, key: "error" }),
  ]);
}

export function ProfileForm({ active, state, onValuesChange }) {
  const [previewSrc, setPreviewSrc] = React.useState("");
  const pdga = state.values.pdga || "";
  const udisc = state.values.udisc || "";

  React.useEffect(() => {
    function update(event) {
      setPreviewSrc(typeof event.detail?.src === "string" ? event.detail.src : "");
    }

    window.addEventListener("gvdg:member-profile-preview", update);
    return () => window.removeEventListener("gvdg:member-profile-preview", update);
  }, []);

  return h("form", {
    className: "login-form",
    id: "profileForm",
    autoComplete: "on",
    hidden: !active,
    onSubmit: (event) => {
      event.preventDefault();
      request("gvdg:member-profile-save-requested", { pdga, udisc });
    },
  }, [
    h("p", { className: "login-subtitle", key: "copy" }, "Add your details so your ratings, stats and photo show up. All optional - you can do this later."),
    h("div", { className: "profile-photo-row", key: "photo" }, [
      h("img", { className: "profile-photo-preview", "data-react-profile-preview": previewSrc ? "ready" : "empty", src: previewSrc || undefined, hidden: !previewSrc, alt: "Profile photo preview", key: "preview" }),
      h("label", { className: "passkey-btn", htmlFor: "photoInput", key: "label" }, h(IconLabel, {
        icon: h(Camera, { size: 17, strokeWidth: 2.2, key: "icon" }),
        text: "Add / change photo",
      })),
      h("input", {
        type: "file",
        id: "photoInput",
        accept: "image/png,image/jpeg,image/webp",
        hidden: true,
        onChange: (event) => request("gvdg:member-profile-photo-chosen", { files: event.target.files }),
        key: "input",
      }),
    ]),
    h(FormGroup, { label: "PDGA # (optional)", htmlFor: "profilePdgaInput", key: "pdga" }, h("input", {
      type: "text",
      className: "form-input",
      id: "profilePdgaInput",
      inputMode: "numeric",
      placeholder: "e.g. 167210",
      value: pdga,
      onChange: (event) => onValuesChange("profile", { pdga: event.target.value }),
    })),
    h(FormGroup, { label: "UDisc username (optional)", htmlFor: "profileUdiscInput", key: "udisc" }, h("input", {
      type: "text",
      className: "form-input",
      id: "profileUdiscInput",
      placeholder: "your UDisc handle",
      value: udisc,
      onChange: (event) => onValuesChange("profile", { udisc: event.target.value }),
    })),
    h("button", { type: "submit", className: "login-btn", disabled: Boolean(state.busyAction), "data-react-auth-action": "profile-save", key: "save" }, state.busyAction === "save" ? "Please wait..." : "Save & Continue"),
    h("button", {
      type: "button",
      className: "login-btn login-btn-secondary",
      onClick: () => request("gvdg:member-profile-skip-requested"),
      key: "skip",
    }, "Skip for now"),
    h(ErrorMessage, { form: "profile", state, key: "error" }),
  ]);
}
