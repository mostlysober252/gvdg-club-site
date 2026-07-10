import React from "react";

import { currentAdminActiveTab, currentAdminAuthGateState } from "./admin-shell-state.js";
import { ADMIN_NAV_GROUPS } from "./navigation.js";

const TAB_IDS = new Set(ADMIN_NAV_GROUPS.flatMap((group) => group.items.map((item) => item.tab)));

function currentPanel() {
  const state = currentAdminAuthGateState();
  return state && state.status === "panel" ? "visible" : "hidden";
}

function normalizeTab(tab) {
  return typeof tab === "string" && TAB_IDS.has(tab) ? tab : "events";
}

function currentTab() {
  return normalizeTab(currentAdminActiveTab());
}

export function AdminPaneVisibility() {
  const [panel, setPanel] = React.useState(currentPanel);
  const [tab, setTab] = React.useState(currentTab);

  React.useEffect(() => {
    function updatePanel(event) {
      const state = event.detail && typeof event.detail === "object" ? event.detail : currentAdminAuthGateState();
      setPanel(state && state.status === "panel" ? "visible" : "hidden");
    }

    function updateTab(event) {
      setTab(normalizeTab(event.detail?.tab));
    }

    window.addEventListener("gvdg:admin-auth-gate", updatePanel);
    window.addEventListener("gvdg:admin-active-tab", updateTab);
    setPanel(currentPanel());
    setTab(currentTab());

    return () => {
      window.removeEventListener("gvdg:admin-auth-gate", updatePanel);
      window.removeEventListener("gvdg:admin-active-tab", updateTab);
    };
  }, []);

  React.useEffect(() => {
    document.body.dataset.adminPanel = panel;
    document.body.dataset.adminTab = tab;
  }, [panel, tab]);

  return null;
}
