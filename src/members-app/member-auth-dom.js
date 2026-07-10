export function setAuthFormState(form, detail) {
  window.dispatchEvent(new CustomEvent("gvdg:member-auth-form-state", {
    detail: { form, ...detail },
  }));
}

export function showAuthError(form, message) {
  setAuthFormState(form, { error: `Error: ${message}` });
}

export function clearAuthError(form) {
  setAuthFormState(form, { error: "" });
}

export function setAuthBusy(form, action, busy) {
  setAuthFormState(form, { busyAction: busy ? action : "" });
}

export function setAuthFormValues(form, values) {
  setAuthFormState(form, { values });
}

export function setAuthMode(mode, passkeysSupported) {
  window.dispatchEvent(new CustomEvent("gvdg:member-shell-view", {
    detail: { view: "auth" },
  }));
  window.dispatchEvent(new CustomEvent("gvdg:member-auth-mode", {
    detail: { mode, passkeysSupported },
  }));
}

export function showLoginShell(passkeysSupported) {
  setAuthMode("login", passkeysSupported);
  clearAuthError("login");
  clearAuthError("pin");
  clearAuthError("profile");
}

export function showPinChangeShell(passkeysSupported) {
  setAuthMode("pin", passkeysSupported);
  clearAuthError("pin");
}

export function showMembersShell(name) {
  window.dispatchEvent(new CustomEvent("gvdg:member-shell-view", {
    detail: { view: "members" },
  }));
  window.dispatchEvent(new CustomEvent("gvdg:member-passkey-state", {
    detail: { busy: false, message: "" },
  }));
  window.dispatchEvent(new CustomEvent("gvdg:member-dashboard-opened", {
    detail: { name: name || null },
  }));
}
