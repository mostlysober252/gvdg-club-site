import React from "react";

import {
  AdminRegistrationAcePotControls,
  AdminRegistrationAssignControls,
  AdminRegistrationCtpAddForm,
  AdminRegistrationMemberOptions,
} from "./registration-actions.js";
import { AdminRegistrationControls, useAdminRegistrationControlsState } from "./registration-controls.js";
import { AdminRegistrationManualPlayerForm } from "./registration-manual-player-form.js";
import { AdminRegistrationRoster } from "./registration-roster.js";
import { AdminRegistrationAcePot, AdminRegistrationCreditsList, AdminRegistrationCtpsList } from "./registration-widgets.js";

const h = React.createElement;

function RegistrationBody() {
  return h("div", { "data-react-admin-registration-panel": "ready", style: { marginTop: "1rem" } }, [
    h(AdminRegistrationRoster, { key: "roster" }),
    h(AdminRegistrationAssignControls, { key: "assign" }),
    h(AdminRegistrationManualPlayerForm, { key: "manual" }),
    h("div", { className: "al-section", key: "ctps", style: { marginTop: "1rem" } }, [
      h("h4", { className: "al-h", key: "title" }, "CTPs (closest to pin)"),
      h(AdminRegistrationMemberOptions, { key: "members" }),
      h(AdminRegistrationCtpAddForm, { key: "form" }),
      h("div", { key: "list", style: { marginTop: "0.5rem" } }, h(AdminRegistrationCtpsList)),
    ]),
    h("div", { className: "al-section", key: "credits" }, [
      h("h4", { className: "al-h", key: "title" }, "Store credit payouts"),
      h("p", { className: "al-note", key: "note" }, "Award credit from registered-player rows or CTP rows, then review the payout ledger here."),
      h("div", { key: "list", style: { marginTop: "0.5rem" } }, h(AdminRegistrationCreditsList)),
    ]),
    h("div", { className: "al-section", key: "ace" }, [
      h("h4", { className: "al-h", key: "title" }, "Ace pot"),
      h(AdminRegistrationAcePot, { key: "summary" }),
      h(AdminRegistrationAcePotControls, { key: "controls" }),
    ]),
  ]);
}

export function AdminRegistrationPanel() {
  const state = useAdminRegistrationControlsState();

  return h(React.Fragment, null, [
    h(AdminRegistrationControls, { key: "controls", state }),
    state.selectedEventId ? h(RegistrationBody, { key: "body" }) : h("p", {
      className: "al-note",
      "data-react-admin-registration-panel": "empty",
      key: "empty",
      style: { marginTop: "0.75rem" },
    }, "Select a scheduled or live event to manage registration."),
  ]);
}
