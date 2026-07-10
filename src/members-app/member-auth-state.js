import { NAME_KEY, PDGA_KEY, storageGet } from "./api.js";
import { setMemberContext } from "./member-context.js";

let memberProfile = {
  isAdmin: false,
  name: null,
  pdgaNo: null,
  photo: null,
  sub: null,
  udisc: null,
};

function storageSet(key, value) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
  }
}

function storageRemove(key) {
  try {
    sessionStorage.removeItem(key);
  } catch {
  }
}

export function memberDashboardContext() {
  return {
    isAdmin: memberProfile.isAdmin === true,
    name: memberProfile.name || storageGet(NAME_KEY) || null,
    pdgaNo: memberProfile.pdgaNo || storageGet(PDGA_KEY) || null,
    photo: memberProfile.photo || null,
    sub: memberProfile.sub || null,
  };
}

export function memberAuthProfile() {
  return { ...memberProfile };
}

export function publishMemberProfile(detail = memberDashboardContext()) {
  const context = setMemberContext(detail);
  window.dispatchEvent(new CustomEvent("gvdg:member-profile-updated", { detail: context }));
}

export function applyProfile(data = {}) {
  memberProfile = {
    isAdmin: data.isAdmin === true,
    name: data.name || memberProfile.name || null,
    pdgaNo: data.pdgaNo || null,
    photo: data.photo || null,
    sub: data.sub || memberProfile.sub || null,
    udisc: data.udisc || null,
  };

  if (data.name) storageSet(NAME_KEY, data.name);
  if (data.pdgaNo) storageSet(PDGA_KEY, data.pdgaNo);
  else storageRemove(PDGA_KEY);

  publishMemberProfile();
}

export function resetMemberProfile() {
  memberProfile = {
    isAdmin: false,
    name: null,
    pdgaNo: null,
    photo: null,
    sub: null,
    udisc: null,
  };
  publishMemberProfile(memberDashboardContext());
}
