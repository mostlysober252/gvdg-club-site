const DEFAULT_AUTH_GATE_STATE = { status: "loading" };
const DEFAULT_ACTIVE_TAB = "events";
const DEFAULT_MESSAGE_STATE = { text: "", ok: null };

let adminAuthGateState = DEFAULT_AUTH_GATE_STATE;
let adminActiveTab = DEFAULT_ACTIVE_TAB;
let adminMessageState = DEFAULT_MESSAGE_STATE;
let adminOrdersBadgeCount = 0;

function normalizedAuthGateState(state) {
  return state && typeof state === "object" ? state : DEFAULT_AUTH_GATE_STATE;
}

function normalizedTab(tab) {
  return typeof tab === "string" && tab ? tab : DEFAULT_ACTIVE_TAB;
}

function normalizedMessageState(state) {
  const source = state && typeof state === "object" ? state : DEFAULT_MESSAGE_STATE;
  const text = typeof source.text === "string" ? source.text : "";
  return {
    text,
    ok: text ? source.ok === true : null,
  };
}

function normalizedCount(count) {
  const value = Number(count || 0);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

export function currentAdminAuthGateState() {
  return adminAuthGateState;
}

export function publishAdminAuthGateState(state) {
  adminAuthGateState = normalizedAuthGateState(state);
  window.dispatchEvent(new CustomEvent("gvdg:admin-auth-gate", { detail: adminAuthGateState }));
  return adminAuthGateState;
}

export function currentAdminActiveTab() {
  return adminActiveTab;
}

export function publishAdminActiveTab(tab) {
  adminActiveTab = normalizedTab(tab);
  window.dispatchEvent(new CustomEvent("gvdg:admin-active-tab", { detail: { tab: adminActiveTab } }));
  return adminActiveTab;
}

export function currentAdminMessageState() {
  return adminMessageState;
}

export function publishAdminMessageState(state) {
  adminMessageState = normalizedMessageState(state);
  window.dispatchEvent(new CustomEvent("gvdg:admin-message", { detail: adminMessageState }));
  return adminMessageState;
}

export function currentAdminOrdersBadgeCount() {
  return adminOrdersBadgeCount;
}

export function publishAdminOrdersBadgeCount(count) {
  adminOrdersBadgeCount = normalizedCount(count);
  window.dispatchEvent(new CustomEvent("gvdg:admin-orders-badge", { detail: { count: adminOrdersBadgeCount } }));
  return adminOrdersBadgeCount;
}
