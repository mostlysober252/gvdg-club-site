import React from "react";

import { adminConfirm } from "./admin-dialogs.js";

const h = React.createElement;

const EMPTY_STATE = { status: "loading", members: [], currentMemberId: null };
const EMPTY_TEMP_PIN_STATE = { member: null, tempPin: "" };

function objectOrEmpty(value) {
  return value && typeof value === "object" ? value : {};
}

function normalizeText(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function normalizeMember(member) {
  const source = objectOrEmpty(member);
  const memberId = normalizeText(source.memberId);
  const pdgaNo = normalizeText(source.pdgaNo);
  const udisc = normalizeText(source.udisc);
  const identifier = pdgaNo || udisc || memberId;
  return {
    source,
    identifier,
    isAdmin: source.isAdmin === true,
    memberId,
    mustChangePin: source.mustChangePin === true,
    name: normalizeText(source.name, "Unnamed member"),
  };
}

function normalizeState(state) {
  return {
    currentMemberId: normalizeText(state.currentMemberId) || null,
    members: Array.isArray(state.members) ? state.members.map(normalizeMember) : [],
    status: state.status === "loading" ? "loading" : "ready",
  };
}

function normalizeTempPinState(state) {
  return {
    member: normalizeMember(state.member),
    tempPin: normalizeText(state.tempPin),
  };
}

function dispatchRequest(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function memberSummary(member) {
  const badges = [
    member.identifier || member.memberId || "no id",
    member.isAdmin ? "admin" : "",
    member.mustChangePin ? "PIN not set" : "",
  ].filter(Boolean);
  return `${member.name} - ${badges.join(" - ")}`;
}

function memberPinLabel(member) {
  if (member.source && typeof member.source.pdgaNo === "string" && member.source.pdgaNo) return `PDGA# ${member.source.pdgaNo}`;
  return member.source && typeof member.source.udisc === "string" && member.source.udisc
    ? member.source.udisc
    : member.memberId || member.identifier || "member id unavailable";
}

function AdminMemberRow({ adminCount, currentMemberId, member }) {
  const isLastAdmin = member.isAdmin && adminCount <= 1;
  const isSelf = currentMemberId && currentMemberId === member.memberId;
  const roleLabel = member.isAdmin ? "Remove admin" : "Make admin";
  const roleTitle = isLastAdmin ? "Can't remove the last admin" : undefined;

  async function requestPinReset() {
    const confirmed = await adminConfirm({
      title: "Reissue temporary PIN",
      message: `Issue a new temporary PIN for ${member.name}? Their current PIN stops working.`,
      confirmText: "Reissue PIN",
      danger: true,
    });
    if (!confirmed) return;
    dispatchRequest("gvdg:admin-member-reset-pin-request", { identifier: member.identifier, member: member.source });
  }

  async function requestRoleChange() {
    const promoting = !member.isAdmin;
    const message = promoting
      ? `Grant admin rights to ${member.name}?`
      : isSelf
        ? "Remove your OWN admin access? You'll lose this panel."
        : `Remove admin rights from ${member.name}?`;
    const confirmed = await adminConfirm({
      title: promoting ? "Grant admin rights" : "Remove admin rights",
      message,
      confirmText: promoting ? "Grant admin" : "Remove admin",
      danger: !promoting,
    });
    if (!confirmed) return;
    dispatchRequest("gvdg:admin-member-role-request", { isAdmin: promoting, member: member.source });
  }

  return h("div", { className: "admin-evrow", "data-admin-member-id": member.memberId || member.identifier }, [
    h("span", { className: "ev-name", key: "name" }, memberSummary(member)),
    h("button", {
      className: "admin-btn",
      disabled: !member.identifier,
      key: "pin",
      onClick: requestPinReset,
      type: "button",
    }, "Reissue PIN"),
    h("button", {
      className: "admin-btn",
      disabled: isLastAdmin || !member.memberId,
      key: "role",
      onClick: requestRoleChange,
      title: roleTitle,
      type: "button",
    }, roleLabel),
  ]);
}

export function AdminMemberTempPin() {
  const [state, setState] = React.useState(() => normalizeTempPinState(EMPTY_TEMP_PIN_STATE));
  const [copied, setCopied] = React.useState(false);
  const resetTimer = React.useRef(0);

  React.useEffect(() => {
    function update(event) {
      setState(normalizeTempPinState(event.detail && typeof event.detail === "object" ? event.detail : EMPTY_TEMP_PIN_STATE));
    }
    window.addEventListener("gvdg:admin-member-temp-pin", update);
    return () => window.removeEventListener("gvdg:admin-member-temp-pin", update);
  }, []);

  React.useEffect(() => {
    setCopied(false);
    if (resetTimer.current) window.clearTimeout(resetTimer.current);
    resetTimer.current = 0;
  }, [state.tempPin]);

  React.useEffect(() => () => {
    if (resetTimer.current) window.clearTimeout(resetTimer.current);
  }, []);

  async function copyPin() {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(state.tempPin);
    } catch {}
    setCopied(true);
    if (resetTimer.current) window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(() => setCopied(false), 1200);
  }

  if (!state.tempPin) return null;

  const loginMethod = state.member.source && state.member.source.pdgaNo ? "PDGA#" : "UDisc";
  return h("section", {
    "aria-live": "polite",
    className: "admin-temp-pin",
    "data-react-admin-member-temp-pin": "ready",
    role: "status",
  }, [
    h("div", { className: "admin-temp-pin-title", key: "title" }, `Temporary PIN for ${state.member.name} (${memberPinLabel(state.member)})`),
    h("div", { className: "admin-temp-pin-row", key: "pin-row" }, [
      h("span", { className: "admin-temp-pin-code", key: "pin" }, state.tempPin),
      h("button", { className: "admin-btn", key: "copy", onClick: copyPin, type: "button" }, copied ? "Copied" : "Copy"),
    ]),
    h("div", { className: "admin-temp-pin-note", key: "note" }, `Give this to ${state.member.name}. They log in with their ${loginMethod} and this PIN, then set their own PIN. Shown once.`),
  ]);
}

export function AdminMembersList() {
  const [state, setState] = React.useState(() => normalizeState(EMPTY_STATE));

  React.useEffect(() => {
    function update(event) {
      setState(normalizeState(event.detail && typeof event.detail === "object" ? event.detail : EMPTY_STATE));
    }
    window.addEventListener("gvdg:admin-members-list", update);
    return () => window.removeEventListener("gvdg:admin-members-list", update);
  }, []);

  if (state.status === "loading") {
    return h("p", { className: "al-note", "data-react-admin-members-list": "loading", role: "status" }, "Loading...");
  }

  if (!state.members.length) {
    return h("p", { className: "al-note", "data-react-admin-members-list": "empty", role: "status" }, "No members yet.");
  }

  const adminCount = state.members.filter((member) => member.isAdmin).length;
  return h("div", { "data-react-admin-members-list": "ready" }, state.members.map((member, index) => (
    h(AdminMemberRow, {
      adminCount,
      currentMemberId: state.currentMemberId,
      key: member.memberId || member.identifier || `${member.name}-${index}`,
      member,
    })
  )));
}
