import { NAME_KEY, TOKEN_KEY, storageGet } from "./api.js";
import { clearAuthError, setAuthBusy, setAuthFormValues, setAuthMode, showAuthError } from "./member-auth-dom.js";
import { applyProfile, memberAuthProfile } from "./member-auth-state.js";
import { passkeysSupported } from "./member-passkeys.js";

let pendingPhoto = null;
const PROFILE_PREVIEW_EVENT = "gvdg:member-profile-preview";

function setProfilePreview(src) {
  window.dispatchEvent(new CustomEvent(PROFILE_PREVIEW_EVENT, {
    detail: { src: src || "" },
  }));
}

function resizeImageFile(file, maxPx) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxPx / Math.max(image.width, image.height));
      const width = Math.max(1, Math.round(image.width * scale));
      const height = Math.max(1, Math.round(image.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) {
        resolve(null);
        return;
      }
      context.drawImage(image, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    image.src = url;
  });
}

function detailString(event, key) {
  const value = event.detail?.[key];
  return typeof value === "string" ? value.trim() : "";
}

export function createProfileController({ api, showLogin, showMembersContent }) {
  function showProfileSetup() {
    const profile = memberAuthProfile();
    setAuthMode("profile", passkeysSupported());
    clearAuthError("profile");
    setAuthFormValues("profile", {
      pdga: profile.pdgaNo || "",
      udisc: profile.udisc || "",
    });
    pendingPhoto = null;
    setProfilePreview(profile.photo || "");
  }

  async function onPhotoChosen(event) {
    const file = event.target?.files?.[0] || event.detail?.files?.[0];
    if (!file) return;
    const dataUrl = await resizeImageFile(file, 256);
    if (!dataUrl || dataUrl.length > 190_000) {
      showAuthError("profile", "That image is too large - please pick a smaller one.");
      return;
    }
    clearAuthError("profile");
    pendingPhoto = dataUrl;
    setProfilePreview(dataUrl);
  }

  async function saveProfile(event) {
    clearAuthError("profile");
    const token = storageGet(TOKEN_KEY);
    if (!token) {
      showLogin();
      return;
    }

    const pdga = detailString(event, "pdga");
    const udisc = detailString(event, "udisc");
    if (pdga && !/^\d+$/.test(pdga)) {
      showAuthError("profile", "PDGA # must be digits only.");
      return;
    }

    const body = { pdgaNo: pdga, udisc };
    if (pendingPhoto) body.photo = pendingPhoto;
    setAuthBusy("profile", "save", true);
    try {
      const response = await api("/profile", { method: "POST", token, body });
      if (response.status === 200) {
        applyProfile(await response.json());
        pendingPhoto = null;
        showMembersContent(storageGet(NAME_KEY));
      } else if (response.status === 409) {
        const data = await response.json().catch(() => ({}));
        showAuthError("profile", `${data.field === "udisc" ? "That UDisc username" : "That PDGA #"} is already linked to another member.`);
      } else {
        showAuthError("profile", "Could not save your profile. Please check the values and try again.");
      }
    } catch {
      showAuthError("profile", "Network error. Please try again.");
    } finally {
      setAuthBusy("profile", "save", false);
    }
  }

  return { onPhotoChosen, saveProfile, showProfileSetup };
}
