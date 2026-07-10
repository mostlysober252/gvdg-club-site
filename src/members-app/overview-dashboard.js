import React from "react";

import { TOKEN_KEY, storageGet } from "./api.js";
import { ActiveStandingsPanel, LiveScoringPanel, WalletPanel } from "./activity-panels.js";
import { ClubRatings } from "./club-ratings.js";
import { selectDashboardTab } from "./dashboard-shell.js";
import { useMemberContext } from "./member-context.js";
import { PdgaDashboard, usePdgaStats } from "./pdga-dashboard.js";

const h = React.createElement;
const PASSKEY_STATE_EVENT = "gvdg:member-passkey-state";

function ProfileHeader({ context, pdgaPhoto }) {
  const photo = context.photo || pdgaPhoto || null;
  return h("div", { className: "dash-head react-dashboard-head" }, [
    photo ? h("img", { className: "dash-avatar", src: photo, alt: "", key: "avatar" }) : null,
    h("div", { key: "text" }, [
      h("h3", { className: "my-dashboard-title", key: "title" }, "My Player Dashboard"),
      h("div", { className: "react-profile-meta", key: "meta" }, [
        context.name ? h("span", { key: "name" }, context.name) : null,
        context.pdgaNo ? h("span", { key: "pdga" }, `PDGA #${context.pdgaNo}`) : null,
      ].filter(Boolean)),
    ]),
  ]);
}

function DashboardActions() {
  const tabButton = (tab, label, primary = false) => h(
    "button",
    {
      type: "button",
      className: `dashboard-action${primary ? " primary" : ""}`,
      onClick: () => selectDashboardTab(tab),
      key: tab,
    },
    label,
  );

  return h("div", { className: "dashboard-utility-panel react-dashboard-utility", "data-react-dashboard-actions": "ready" }, [
    h("div", { className: "dashboard-actions", key: "actions" }, [
      tabButton("board", "Message board", true),
      tabButton("events", "Register"),
      h("a", { className: "dashboard-action", href: "score.html", key: "score" }, "Live scoring"),
      tabButton("tee", "Tee signs"),
      h("a", { className: "dashboard-action", href: "pro-shop.html", key: "shop" }, "Pro Shop"),
    ]),
  ]);
}

function AccountTools() {
  const [supportsPasskeys, setSupportsPasskeys] = React.useState(false);
  const [passkeyState, setPasskeyState] = React.useState({ busy: false, message: "" });

  React.useEffect(() => {
    setSupportsPasskeys(typeof window.PublicKeyCredential !== "undefined");
  }, []);

  React.useEffect(() => {
    function update(event) {
      setPasskeyState((previous) => ({
        busy: typeof event.detail?.busy === "boolean" ? event.detail.busy : previous.busy,
        message: typeof event.detail?.message === "string" ? event.detail.message : previous.message,
      }));
    }

    window.addEventListener(PASSKEY_STATE_EVENT, update);
    return () => window.removeEventListener(PASSKEY_STATE_EVENT, update);
  }, []);

  function request(eventName) {
    window.dispatchEvent(new CustomEvent(eventName));
  }

  return h("div", { className: "dashboard-utility-panel account-dashboard-utility react-account-tools", "data-react-account-tools": "ready", "aria-label": "Account tools" }, [
    h("div", { className: "passkey-row", key: "row" }, [
      supportsPasskeys
        ? h("button", {
          type: "button",
          className: "passkey-btn",
          "data-react-passkey-action": "add",
          disabled: passkeyState.busy,
          onClick: () => request("gvdg:member-add-passkey-requested"),
          key: "passkey",
        }, passkeyState.busy ? "Adding passkey..." : "Add a passkey")
        : null,
      h("button", {
        type: "button",
        className: "passkey-btn",
        id: "editProfileBtn",
        onClick: () => request("gvdg:member-edit-profile-requested"),
        key: "profile",
      }, "Edit profile"),
      h("span", { className: "passkey-status", "data-react-passkey-status": passkeyState.message ? "message" : "empty", role: "status", "aria-live": "polite", key: "status" }, passkeyState.message),
    ].filter(Boolean)),
  ]);
}

export function MemberOverviewDashboard() {
  const context = useMemberContext();
  const token = storageGet(TOKEN_KEY);
  const pdgaState = usePdgaStats(context.pdgaNo);

  if (!token) return null;

  return h("div", { className: "react-overview-dashboard", "data-react-overview-dashboard": "ready" }, [
    h(ProfileHeader, { context, pdgaPhoto: pdgaState.stats?.photo || null, key: "profile" }),
    h(PdgaDashboard, { pdgaNo: context.pdgaNo, state: pdgaState, key: "pdga" }),
    h(ActiveStandingsPanel, { key: "standings" }),
    h(ClubRatings, { token, key: "ratings" }),
    h(LiveScoringPanel, { token, key: "live-scoring" }),
    h(DashboardActions, { key: "actions" }),
    h(WalletPanel, { token, key: "wallet" }),
    h(AccountTools, { key: "account-tools" }),
  ]);
}
