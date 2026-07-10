import { NAME_KEY, PDGA_KEY, TOKEN_KEY, authBase, request, storageGet } from "./api.js";
import { clearAuthError, setAuthBusy, setAuthFormValues, showAuthError, showLoginShell, showMembersShell, showPinChangeShell } from "./member-auth-dom.js";
import { applyProfile, memberDashboardContext, resetMemberProfile } from "./member-auth-state.js";
import { createPasskeyController, passkeysSupported } from "./member-passkeys.js";
import { createProfileController } from "./member-profile-controller.js";

let installed = false;
let sessionExpiredShown = false;

function storageRemove(key) {
  try {
    sessionStorage.removeItem(key);
  } catch {
  }
}

function storageSet(key, value) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
  }
}

function detailString(event, key) {
  const value = event.detail?.[key];
  return typeof value === "string" ? value.trim() : "";
}

export function installMemberAuthController() {
  if (installed) return;
  installed = true;

  let passkeys;
  let profile;

  function handleSessionExpired() {
    if (sessionExpiredShown) return;
    sessionExpiredShown = true;
    storageRemove(TOKEN_KEY);
    showLogin();
    showAuthError("login", "Your session expired - please sign in again.");
    setTimeout(() => {
      sessionExpiredShown = false;
    }, 4000);
  }

  async function api(path, options = {}) {
    const response = await request(path, options);
    if (response.status === 401 && options.token) handleSessionExpired();
    return response;
  }

  function showLogin() {
    showLoginShell(passkeysSupported());
    if (passkeysSupported()) passkeys.startPasskeyPriming();
  }

  function showPinChange() {
    showPinChangeShell(passkeysSupported());
  }

  function showMembersContent(name) {
    passkeys.stopPasskeyPriming();
    const context = memberDashboardContext();
    showMembersShell(name || context.name || null);
  }

  function logout() {
    storageRemove(TOKEN_KEY);
    storageRemove(NAME_KEY);
    storageRemove(PDGA_KEY);
    resetMemberProfile();
    setAuthFormValues("login", { pin: "" });
    showLogin();
  }

  async function handleLogin(event) {
    const identifier = detailString(event, "identifier");
    const pin = detailString(event, "pin");
    clearAuthError("login");
    if (!authBase()) {
      showAuthError("login", "Login is not configured yet - contact an admin.");
      return;
    }
    if (!identifier || !pin) {
      showAuthError("login", "Enter your PDGA #/UDisc and PIN.");
      return;
    }

    setAuthBusy("login", "login", true);
    try {
      const response = await api("/login", { method: "POST", body: { identifier, pin } });
      if (response.status === 200) {
        const data = await response.json();
        storageSet(TOKEN_KEY, data.token);
        applyProfile(data);
        setAuthFormValues("login", { pin: "" });
        if (data.mustChangePin) showPinChange();
        else showMembersContent(data.name);
      } else if (response.status === 423) {
        const data = await response.json().catch(() => ({}));
        const minutes = Math.ceil((data.retryAfterSec || 900) / 60);
        showAuthError("login", `Too many attempts. Try again in ~${minutes} min.`);
      } else if (response.status === 401) {
        showAuthError("login", "Invalid PDGA #/UDisc or PIN.");
      } else {
        showAuthError("login", "Something went wrong. Please try again.");
      }
    } catch {
      showAuthError("login", "Network error. Please check your connection.");
    } finally {
      setAuthBusy("login", "login", false);
    }
  }

  async function handleSetPin(event) {
    const newPin = detailString(event, "newPin");
    const confirmPin = detailString(event, "confirmPin");
    clearAuthError("pin");
    if (!/^\d{4}$/.test(newPin)) {
      showAuthError("pin", "PIN must be exactly 4 digits.");
      return;
    }
    if (newPin !== confirmPin) {
      showAuthError("pin", "PINs do not match.");
      return;
    }

    const token = storageGet(TOKEN_KEY);
    if (!token) {
      showLogin();
      return;
    }

    setAuthBusy("pin", "pin", true);
    try {
      const response = await api("/set-pin", { method: "POST", token, body: { newPin } });
      if (response.status === 200) {
        const data = await response.json();
        storageSet(TOKEN_KEY, data.token);
        setAuthFormValues("pin", { newPin: "", confirmPin: "" });
        profile.showProfileSetup();
      } else if (response.status === 401) {
        showLogin();
      } else {
        showAuthError("pin", "Could not update PIN. Please try again.");
      }
    } catch {
      showAuthError("pin", "Network error. Please try again.");
    } finally {
      setAuthBusy("pin", "pin", false);
    }
  }

  async function checkSession() {
    const token = storageGet(TOKEN_KEY);
    if (!token || !authBase()) {
      showLogin();
      return;
    }
    try {
      const response = await api("/me", { token });
      if (response.status === 200) {
        const data = await response.json();
        applyProfile(data);
        if (data.mustChangePin) showPinChange();
        else showMembersContent(data.name || storageGet(NAME_KEY));
      } else {
        logout();
      }
    } catch {
      showLogin();
    }
  }

  passkeys = createPasskeyController({ api, showMembersContent, showPinChange });
  profile = createProfileController({ api, showLogin, showMembersContent });

  window.addEventListener("gvdg:member-login-requested", handleLogin);
  window.addEventListener("gvdg:member-pin-change-requested", handleSetPin);
  window.addEventListener("gvdg:member-profile-save-requested", profile.saveProfile);
  window.addEventListener("gvdg:member-profile-skip-requested", () => showMembersContent(storageGet(NAME_KEY)));
  window.addEventListener("gvdg:member-profile-photo-chosen", profile.onPhotoChosen);
  window.addEventListener("gvdg:member-passkey-login-requested", passkeys.loginWithPasskey);
  window.addEventListener("gvdg:member-add-passkey-requested", passkeys.enablePasskey);
  window.addEventListener("gvdg:member-edit-profile-requested", profile.showProfileSetup);
  window.addEventListener("gvdg:member-logout-requested", logout);
  window.addEventListener("gvdg:member-auth-ready", checkSession, { once: true });
}
