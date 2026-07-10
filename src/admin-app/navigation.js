import React from "react";

import { currentAdminActiveTab } from "./admin-shell-state.js";
import { AdminOrdersBadge } from "./orders-badge.js";

const h = React.createElement;

export const ADMIN_NAV_GROUPS = [
  {
    label: "Events",
    items: [
      { tab: "events", label: "Events" },
      { tab: "create", label: "New Event" },
      { tab: "import", label: "Import" },
      { tab: "registration", label: "Registration" },
      { tab: "scoring", label: "Live Scoring" },
    ],
  },
  {
    label: "Courses",
    items: [
      { tab: "courses", label: "Courses" },
      { tab: "layouts", label: "Layouts" },
      { tab: "tee-signs", label: "Tee Signs" },
    ],
  },
  {
    label: "Club",
    items: [
      { tab: "leagues-mgmt", label: "Leagues" },
      { tab: "fundraisers", label: "Fundraisers" },
      { tab: "meetings", label: "Meetings" },
    ],
  },
  {
    label: "Shop",
    items: [
      { tab: "shop", label: "Pro Shop" },
      { tab: "orders", label: "Orders", badge: "orders" },
      { tab: "wallets", label: "Wallets" },
    ],
  },
  {
    label: "Members",
    items: [
      { tab: "members", label: "Members" },
    ],
  },
  {
    label: "Data",
    items: [
      { tab: "data-archive", label: "Data archive" },
    ],
  },
];

function initialTab() {
  return currentAdminActiveTab();
}

function tabLabel(item) {
  if (item.badge === "orders") {
    return [item.label, " ", h(AdminOrdersBadge, { key: "badge" })];
  }
  return item.label;
}

function requestTab(tab) {
  window.dispatchEvent(new CustomEvent("gvdg:admin-tab-request", { detail: { tab } }));
}

export function AdminNavigation() {
  const [activeTab, setActiveTab] = React.useState(initialTab);

  React.useEffect(() => {
    function update(event) {
      const tab = event.detail?.tab;
      if (typeof tab === "string" && tab) setActiveTab(tab);
    }
    window.addEventListener("gvdg:admin-active-tab", update);
    setActiveTab(initialTab());
    return () => window.removeEventListener("gvdg:admin-active-tab", update);
  }, []);

  function selectValue(group) {
    return group.items.some((item) => item.tab === activeTab) ? activeTab : "";
  }

  return h(React.Fragment, null, [
    h("div", { className: "admin-mobile-nav", key: "mobile", role: "group", "aria-label": "Admin sections" },
      ADMIN_NAV_GROUPS.map((group) => h("select", {
        "aria-label": `${group.label} section`,
        className: "admin-mnav",
        key: group.label,
        onChange: (event) => {
          if (event.target.value) requestTab(event.target.value);
        },
        value: selectValue(group),
      }, [
        h("option", { disabled: true, hidden: true, key: "placeholder", value: "" }, group.label),
        ...group.items.map((item) => h("option", { key: item.tab, value: item.tab }, item.label)),
      ]))),
    h("nav", { "aria-label": "Admin sections", className: "admin-sidebar", key: "sidebar" },
      ADMIN_NAV_GROUPS.flatMap((group) => [
        h("div", { className: "admin-navgroup", key: `${group.label}-group` }, group.label),
        ...group.items.map((item) => {
          const active = item.tab === activeTab;
          return h("button", {
            "aria-current": active ? "page" : undefined,
            className: active ? "admin-tab active" : "admin-tab",
            "data-atab": item.tab,
            key: item.tab,
            onClick: () => requestTab(item.tab),
            type: "button",
          }, tabLabel(item));
        }),
      ])),
  ]);
}
