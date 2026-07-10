import { TOKEN_KEY, authBase, storageGet } from "./api.js";
import { clearAuthError, setAuthBusy, showAuthError } from "./member-auth-dom.js";
import { applyProfile } from "./member-auth-state.js";

const PASSKEY_REFRESH_MS = 170_000;
const PASSKEY_STATE_EVENT = "gvdg:member-passkey-state";

let passkeyPrefetch = null;
let passkeyPrimeTimer = null;
let passkeyVisHooked = false;

export function passkeysSupported() {
  return typeof window.PublicKeyCredential !== "undefined";
}

function setPasskeyState(detail) {
  window.dispatchEvent(new CustomEvent(PASSKEY_STATE_EVENT, { detail }));
}

function b64urlToBuf(value) {
  const source = String(value).replace(/-/g, "+").replace(/_/g, "/");
  const pad = "=".repeat((4 - (source.length % 4)) % 4);
  const bin = atob(source + pad);
  const bytes = new Uint8Array(bin.length);
  for (let index = 0; index < bin.length; index += 1) bytes[index] = bin.charCodeAt(index);
  return bytes.buffer;
}

function bufToB64url(buffer) {
  const bytes = new Uint8Array(buffer);
  let source = "";
  for (const byte of bytes) source += String.fromCharCode(byte);
  return btoa(source).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function createPasskeyController({ api, showMembersContent, showPinChange }) {
  async function enablePasskey() {
    const token = storageGet(TOKEN_KEY);
    if (!token || !passkeysSupported()) return;

    setPasskeyState({ busy: true, message: "" });
    try {
      const optionsResponse = await api("/webauthn/register/options", { method: "POST", token });
      if (!optionsResponse.ok) throw new Error("options");
      const options = await optionsResponse.json();
      options.challenge = b64urlToBuf(options.challenge);
      options.user.id = b64urlToBuf(options.user.id);
      if (options.excludeCredentials) {
        options.excludeCredentials = options.excludeCredentials.map((credential) => ({
          ...credential,
          id: b64urlToBuf(credential.id),
        }));
      }
      const credential = await navigator.credentials.create({ publicKey: options });
      const body = {
        id: credential.id,
        rawId: bufToB64url(credential.rawId),
        response: {
          attestationObject: bufToB64url(credential.response.attestationObject),
          clientDataJSON: bufToB64url(credential.response.clientDataJSON),
          transports: credential.response.getTransports ? credential.response.getTransports() : [],
        },
        type: credential.type,
        clientExtensionResults: credential.getClientExtensionResults ? credential.getClientExtensionResults() : {},
      };
      const verifyResponse = await api("/webauthn/register/verify", { method: "POST", token, body });
      setPasskeyState({
        message: verifyResponse.ok ? "Passkey added - use it to log in next time." : "Could not add passkey. Please try again.",
      });
    } catch (error) {
      setPasskeyState({
        message: error?.name === "NotAllowedError" ? "Passkey setup cancelled." : "Could not add passkey.",
      });
    } finally {
      setPasskeyState({ busy: false });
    }
  }

  async function prefetchPasskey() {
    if (!authBase() || !passkeysSupported()) return;
    if (passkeyPrefetch && Date.now() - passkeyPrefetch.ts < PASSKEY_REFRESH_MS) return;
    try {
      const response = await api("/webauthn/auth/options", { method: "POST" });
      if (!response.ok) return;
      const { flowId, options } = await response.json();
      passkeyPrefetch = { flowId, options, ts: Date.now() };
    } catch {
    }
  }

  function startPasskeyPriming() {
    void prefetchPasskey();
    if (!passkeyPrimeTimer) passkeyPrimeTimer = setInterval(prefetchPasskey, PASSKEY_REFRESH_MS);
    if (passkeyVisHooked) return;
    passkeyVisHooked = true;
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && passkeyPrimeTimer) void prefetchPasskey();
    });
  }

  function stopPasskeyPriming() {
    if (!passkeyPrimeTimer) return;
    clearInterval(passkeyPrimeTimer);
    passkeyPrimeTimer = null;
  }

  async function loginWithPasskey() {
    clearAuthError("login");
    if (!authBase()) {
      showAuthError("login", "Login is not configured yet - contact an admin.");
      return;
    }
    if (!passkeysSupported()) {
      showAuthError("login", "Passkeys are not supported on this device.");
      return;
    }

    setAuthBusy("login", "passkey", true);
    try {
      const prefetched = passkeyPrefetch;
      passkeyPrefetch = null;
      let options;
      let flowId;
      if (prefetched && Date.now() - prefetched.ts < 290_000) {
        options = prefetched.options;
        flowId = prefetched.flowId;
      } else {
        const response = await api("/webauthn/auth/options", { method: "POST" });
        if (!response.ok) throw new Error("options");
        const payload = await response.json();
        options = payload.options;
        flowId = payload.flowId;
      }
      options.challenge = b64urlToBuf(options.challenge);
      if (options.allowCredentials) {
        options.allowCredentials = options.allowCredentials.map((credential) => ({
          ...credential,
          id: b64urlToBuf(credential.id),
        }));
      }
      const assertion = await navigator.credentials.get({ publicKey: options });
      const body = {
        flowId,
        response: {
          id: assertion.id,
          rawId: bufToB64url(assertion.rawId),
          response: {
            authenticatorData: bufToB64url(assertion.response.authenticatorData),
            clientDataJSON: bufToB64url(assertion.response.clientDataJSON),
            signature: bufToB64url(assertion.response.signature),
            userHandle: assertion.response.userHandle ? bufToB64url(assertion.response.userHandle) : undefined,
          },
          type: assertion.type,
          clientExtensionResults: assertion.getClientExtensionResults ? assertion.getClientExtensionResults() : {},
        },
      };
      const verifyResponse = await api("/webauthn/auth/verify", { method: "POST", body });
      if (verifyResponse.status !== 200) {
        showAuthError("login", "Passkey sign-in failed. Use your PIN instead.");
        return;
      }
      const data = await verifyResponse.json();
      sessionStorage.setItem(TOKEN_KEY, data.token);
      applyProfile(data);
      if (data.mustChangePin) showPinChange();
      else showMembersContent(data.name);
    } catch (error) {
      showAuthError("login", error?.name === "NotAllowedError"
        ? "Passkey sign-in cancelled."
        : "Passkey sign-in failed. Use your PIN instead.");
    } finally {
      setAuthBusy("login", "passkey", false);
      void prefetchPasskey();
    }
  }

  return { enablePasskey, loginWithPasskey, startPasskeyPriming, stopPasskeyPriming };
}
