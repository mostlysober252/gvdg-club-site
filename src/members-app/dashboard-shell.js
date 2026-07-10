import React from "react";

import { readMemberContext } from "./member-context.js";

const h = React.createElement;

export const TABS = [
  { key: "overview", label: "Overview", title: "Player Dashboard" },
  { key: "events", label: "Events", title: "Event Registration" },
  { key: "board", label: "Board", title: "Member Board" },
  { key: "tee", label: "Tee Signs", title: "Tee Sign Capture" },
  { key: "club", label: "Club", title: "GVDG Member Directory" },
];

const DEFAULT_TAB = TABS[0];
const tabKeys = new Set(TABS.map((tab) => tab.key));

function safeTab(value) {
  return tabKeys.has(value) ? value : DEFAULT_TAB.key;
}

function tabTitle(key) {
  return TABS.find((tab) => tab.key === key)?.title || DEFAULT_TAB.title;
}

function initialState() {
  const tab = DEFAULT_TAB.key;
  const context = readMemberContext();
  return { ...context, scrollVersion: 0, tab, title: tabTitle(tab) };
}

function nextState(previous, detail = null) {
  const nextTab = safeTab(detail?.tab || previous.tab || DEFAULT_TAB.key);
  const context = readMemberContext(detail);
  return {
    ...context,
    scrollVersion: detail?.scroll === true ? previous.scrollVersion + 1 : previous.scrollVersion,
    tab: nextTab,
    title: detail?.title || tabTitle(nextTab),
  };
}

export function selectDashboardTab(tab) {
  window.dispatchEvent(new CustomEvent("gvdg:select-dashboard-tab", { detail: { tab } }));
}

export function requestLogout() {
  window.dispatchEvent(new CustomEvent("gvdg:member-logout-requested"));
}

export function MemberDashboardShell() {
  const [state, setState] = React.useState(initialState);
  const shellRef = React.useRef(null);

  React.useEffect(() => {
    document.body.dataset.memberDashboardTab = state.tab;
    return () => {
      if (document.body.dataset.memberDashboardTab === state.tab) delete document.body.dataset.memberDashboardTab;
    };
  }, [state.tab]);

  React.useEffect(() => {
    if (!state.scrollVersion) return;
    shellRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [state.scrollVersion]);

  React.useEffect(() => {
    function update(event) {
      setState((previous) => nextState(previous, event.detail || null));
    }

    window.addEventListener("gvdg:dashboard-tab-selected", update);
    window.addEventListener("gvdg:member-dashboard-ready", update);
    window.addEventListener("gvdg:member-profile-updated", update);
    return () => {
      window.removeEventListener("gvdg:dashboard-tab-selected", update);
      window.removeEventListener("gvdg:member-dashboard-ready", update);
      window.removeEventListener("gvdg:member-profile-updated", update);
    };
  }, []);

  const welcome = state.name ? `Welcome back, ${state.name}!` : "Welcome back!";
  const adminPortal = state.tab === "overview" && state.isAdmin
    ? h(
      "a",
      {
        className: "admin-portal-link react-admin-portal-link",
        "data-react-admin-portal": "ready",
        href: "admin.html",
        id: "adminPortalLink",
        key: "adminPortal",
      },
      "Admin Portal - manage events & courses",
    )
    : null;

  return h("div", { className: "member-dashboard-shell-chrome", "data-member-dashboard-shell": state.tab, ref: shellRef }, [
    h("h2", { className: "section-title", id: "membersReactDashboardTitle", key: "title" }, state.title),
    h(
      "div",
      {
        className: "dash-tabs members-react-tabs",
        role: "tablist",
        "aria-label": "Member dashboard sections",
        key: "tabs",
      },
      TABS.map((tab) => {
        const active = state.tab === tab.key;
        return h(
          "button",
          {
            className: `dash-tab${active ? " active" : ""}`,
            type: "button",
            role: "tab",
            "aria-selected": active ? "true" : "false",
            "data-dtab": tab.key,
            key: tab.key,
            onClick: () => selectDashboardTab(tab.key),
          },
          tab.label,
        );
      }),
    ),
    h(
      "div",
      { className: "welcome-banner react-member-banner", "data-react-member-banner": "ready", key: "welcome" },
      [
        h("div", { className: "welcome-text", key: "text" }, [
          h("strong", { key: "name" }, welcome),
          h("span", { className: "welcome-subtext", key: "subtext" }, "You're viewing the exclusive GVDG member directory."),
        ]),
        h(
          "button",
          {
            className: "logout-btn",
            id: "logoutBtn",
            key: "logout",
            onClick: requestLogout,
            type: "button",
          },
          "Log Out",
        ),
      ],
    ),
    adminPortal,
  ]);
}
