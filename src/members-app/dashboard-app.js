import React from "react";

import { MemberBoardPanel } from "./board-panel.js";
import { MemberClubPanel } from "./club-panel.js";
import { MemberDashboardShell } from "./dashboard-shell.js";
import { MemberOverviewDashboard } from "./overview-dashboard.js";
import { MemberRegistrationPanel } from "./registration-panel.js";
import { MemberTeeSignsPanel } from "./tee-signs-panel.js";

const h = React.createElement;

export function MemberDashboardApp() {
  return h(React.Fragment, null, [
    h("div", { id: "membersReactDashboardShell", key: "shell" }, h(MemberDashboardShell)),
    h("div", { className: "my-dashboard", id: "myDashboard", key: "overview" }, [
      h("div", { id: "membersReactOverviewPanel", key: "mount" }, h(MemberOverviewDashboard)),
    ]),
    h("div", { className: "club-register", id: "clubRegister", key: "registration" }, [
      h("div", { id: "membersReactRegistrationPanel", key: "mount" }, h(MemberRegistrationPanel)),
    ]),
    h("div", { className: "club-board", id: "clubBoard", key: "board" }, [
      h("div", { id: "membersReactBoardPanel", key: "mount" }, h(MemberBoardPanel)),
    ]),
    h("div", { className: "tee-capture", id: "teeCapture", key: "tee" }, [
      h("div", { id: "membersReactTeeSignsPanel", key: "mount" }, h(MemberTeeSignsPanel)),
    ]),
    h("div", { id: "membersReactClubPanel", key: "club" }, h(MemberClubPanel)),
  ]);
}
