import React from "react";
import { KeyRound } from "lucide-react";

const h = React.createElement;

function icon(Icon) {
  return h(Icon, {
    key: "icon",
    size: 18,
    strokeWidth: 2.4,
    "aria-hidden": "true",
    focusable: "false",
  });
}

function LoginView(props) {
  const [identifier, setIdentifier] = React.useState("");
  const [pin, setPin] = React.useState("");
  const [error, setError] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [passkeyPending, setPasskeyPending] = React.useState(false);

  async function submit(event) {
    event.preventDefault();
    const cleanIdentifier = identifier.trim();
    const cleanPin = pin.trim();
    if (!cleanIdentifier || !cleanPin) {
      setError("Enter your ID and PIN.");
      return;
    }
    setPending(true);
    setError("");
    try {
      const result = await props.onLogin({ identifier: cleanIdentifier, pin: cleanPin });
      if (result && result.ok === false) setError(result.message || "Sign-in failed - try again.");
    } finally {
      setPending(false);
    }
  }

  async function submitPasskey() {
    if (!props.onPasskeyLogin) return;
    setPasskeyPending(true);
    setError("");
    try {
      const result = await props.onPasskeyLogin();
      if (result && result.ok === false) setError(result.message || "Passkey sign-in failed. Use your PIN instead.");
    } finally {
      setPasskeyPending(false);
    }
  }

  return h("div", { className: "card stack" }, [
    h("h2", { className: "section", key: "title" }, "Sign in to keep score"),
    props.message ? h("p", { className: "muted", key: "message" }, props.message) : null,
    h("form", { className: "stack", key: "form", onSubmit: submit }, [
      h("label", { className: "lbl", htmlFor: "idIn", key: "id-label" }, "PDGA # or UDisc username"),
      h("input", {
        autoCapitalize: "none",
        className: "field",
        id: "idIn",
        key: "id-input",
        value: identifier,
        onChange: (event) => setIdentifier(event.target.value),
      }),
      h("label", { className: "lbl", htmlFor: "pinIn", key: "pin-label" }, "PIN"),
      h("input", {
        className: "field",
        id: "pinIn",
        inputMode: "numeric",
        key: "pin-input",
        type: "password",
        value: pin,
        onChange: (event) => setPin(event.target.value),
      }),
      h("p", { className: "muted auth-error", key: "error", role: "alert" }, error),
      h("button", { className: "btn", disabled: pending || passkeyPending, key: "submit", type: "submit" }, pending ? "Signing in..." : "Sign in"),
    ]),
    props.passkeysSupported
      ? h(
          "button",
          { className: "btn secondary", disabled: pending || passkeyPending, key: "passkey", type: "button", onClick: submitPasskey },
          [icon(KeyRound), passkeyPending ? "Checking passkey..." : "Log in with a passkey"],
        )
      : null,
    props.guestAvailable
      ? h("p", { className: "muted center", key: "guest-note" }, "Registered as a guest? You can keep your card without signing in.")
      : null,
    props.guestAvailable
      ? h("button", { className: "btn ghost", key: "guest", type: "button", onClick: props.onGuestContinue }, "Keep score as a guest")
      : null,
    h("p", { className: "muted center return-members", key: "members" },
      h("a", { className: "link", href: props.membersHref || "gvdg-members.html" }, "Return to members"),
    ),
  ]);
}

function SetPinView(props) {
  const [pin, setPin] = React.useState("");
  const [confirmPin, setConfirmPin] = React.useState("");
  const [error, setError] = React.useState("");
  const [pending, setPending] = React.useState(false);

  async function submit(event) {
    event.preventDefault();
    const cleanPin = pin.trim();
    const cleanConfirm = confirmPin.trim();
    if (!/^\d{4}$/.test(cleanPin)) {
      setError("PIN must be exactly 4 digits.");
      return;
    }
    if (cleanPin !== cleanConfirm) {
      setError("PINs don't match.");
      return;
    }
    setPending(true);
    setError("");
    try {
      const result = await props.onSetPin(cleanPin);
      if (result && result.ok === false) setError(result.message || "Could not update PIN - try again.");
    } finally {
      setPending(false);
    }
  }

  return h("form", { className: "card stack", onSubmit: submit }, [
    h("h2", { className: "section", key: "title" }, "Set your PIN"),
    h("p", { className: "muted", key: "message" }, props.message || "Choose a new 4-digit PIN to finish signing in."),
    h("label", { className: "lbl", htmlFor: "newPin", key: "new-label" }, "New 4-digit PIN"),
    h("input", {
      autoComplete: "new-password",
      className: "field",
      id: "newPin",
      inputMode: "numeric",
      key: "new-input",
      maxLength: 4,
      placeholder: "New 4-digit PIN",
      type: "password",
      value: pin,
      onChange: (event) => setPin(event.target.value),
    }),
    h("label", { className: "lbl", htmlFor: "confirmPin", key: "confirm-label" }, "Confirm PIN"),
    h("input", {
      autoComplete: "new-password",
      className: "field",
      id: "confirmPin",
      inputMode: "numeric",
      key: "confirm-input",
      maxLength: 4,
      placeholder: "Confirm PIN",
      type: "password",
      value: confirmPin,
      onChange: (event) => setConfirmPin(event.target.value),
    }),
    h("p", { className: "muted auth-error", key: "error", role: "alert" }, error),
    h("button", { className: "btn", disabled: pending, key: "submit", type: "submit" }, pending ? "Saving..." : "Save PIN & continue"),
  ]);
}

export function ScoreAuthFlow(props) {
  if (props.mode === "setPin") return h(SetPinView, props);
  return h(LoginView, props);
}
