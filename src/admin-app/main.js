import React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

import { AdminDialogs } from "./admin-dialogs.js";
import { AdminAuthGate } from "./auth-gate.js";
import { AdminFundraiserForm, AdminLeagueForm, AdminMeetingForm } from "./club-content-forms.js";
import { AdminFundraisersList, AdminLeaguesList, AdminMeetingsList } from "./club-content-lists.js";
import { AdminCourseForm } from "./course-form.js";
import { AdminCoursesList } from "./courses-list.js";
import { AdminDataArchiveDestinationForm } from "./data-archive-destination-form.js";
import { AdminDataArchiveExportControls } from "./data-archive-export-controls.js";
import { AdminDataArchiveDestinationsList, AdminDataArchiveExportResult } from "./data-archive-destinations-list.js";
import { AdminEventForm } from "./event-form.js";
import { AdminEventsList } from "./events-list.js";
import { AdminImportCandidatesList } from "./import-candidates-list.js";
import { AdminImportControls } from "./import-controls.js";
import { AdminLayoutsManager } from "./layouts-manager.js";
import { AdminMemberForm } from "./member-form.js";
import { AdminMessage } from "./message.js";
import { AdminMembersList, AdminMemberTempPin } from "./members-list.js";
import { AdminNavigation } from "./navigation.js";
import { AdminOrdersList } from "./orders-list.js";
import { AdminPageChrome } from "./page-chrome.js";
import { AdminPaneVisibility } from "./pane-visibility.js";
import { AdminProductForm } from "./product-form.js";
import { AdminProductsList } from "./products-list.js";
import { AdminRegistrationPanel } from "./registration-panel.js";
import { AdminScoringPanel } from "./scoring-panel.js";
import { AdminOrderControls, AdminProductInventoryControls } from "./shop-controls.js";
import { AdminTeeSignReviewControls, AdminTeeSignReviewList } from "./tee-sign-review.js";
import { AdminWalletAdjustmentForm } from "./wallet-form.js";
import { AdminWalletRecentList } from "./wallet-recent-list.js";
import { startAdminController } from "./admin-controller.js";
import { CrottsWidget } from "../shared/crotts-widget.js";

if (import.meta.env.DEV && import.meta.env.VITE_DISABLE_REACT_DEVTOOLS !== "1") {
  void import("react-grab");
  void import("react-scan");
}

const h = React.createElement;

const pageChromeMount = document.getElementById("adminReactPageChromeApp");
if (pageChromeMount) {
  flushSync(() => createRoot(pageChromeMount).render(h(AdminPageChrome)));
}

const authGateMount = document.getElementById("adminAuthGateReactApp");
if (authGateMount) {
  flushSync(() => createRoot(authGateMount).render(h(AdminAuthGate)));
}

const paneVisibilityMount = document.getElementById("adminPaneVisibilityReactApp");
if (paneVisibilityMount) {
  flushSync(() => createRoot(paneVisibilityMount).render(h(AdminPaneVisibility)));
}

const navigationMount = document.getElementById("adminNavigationReactApp");
if (navigationMount) {
  flushSync(() => createRoot(navigationMount).render(h(AdminNavigation)));
}

const messageMount = document.getElementById("adminMessageReactApp");
if (messageMount) {
  flushSync(() => createRoot(messageMount).render(h(AdminMessage)));
}

const dialogsMount = document.getElementById("adminDialogsReactApp");
if (dialogsMount) {
  flushSync(() => createRoot(dialogsMount).render(h(AdminDialogs)));
}

const eventsListMount = document.getElementById("adminEventsListReactApp");
if (eventsListMount) {
  flushSync(() => createRoot(eventsListMount).render(h(AdminEventsList)));
}

const eventFormMount = document.getElementById("adminEventFormReactApp");
if (eventFormMount) {
  flushSync(() => createRoot(eventFormMount).render(h(AdminEventForm)));
}

const importControlsMount = document.getElementById("adminImportControlsReactApp");
if (importControlsMount) {
  flushSync(() => createRoot(importControlsMount).render(h(AdminImportControls)));
}

const importCandidatesMount = document.getElementById("adminImportCandidatesReactApp");
if (importCandidatesMount) {
  flushSync(() => createRoot(importCandidatesMount).render(h(AdminImportCandidatesList)));
}

const coursesListMount = document.getElementById("adminCoursesListReactApp");
if (coursesListMount) {
  flushSync(() => createRoot(coursesListMount).render(h(AdminCoursesList)));
}

const courseFormMount = document.getElementById("adminCourseFormReactApp");
if (courseFormMount) {
  flushSync(() => createRoot(courseFormMount).render(h(AdminCourseForm)));
}

const layoutsMount = document.getElementById("adminLayoutsReactApp");
if (layoutsMount) {
  flushSync(() => createRoot(layoutsMount).render(h(AdminLayoutsManager)));
}

const scoringMount = document.getElementById("adminScoringReactApp");
if (scoringMount) {
  flushSync(() => createRoot(scoringMount).render(h(AdminScoringPanel)));
}

const teeSignReviewControlsMount = document.getElementById("adminTeeSignReviewControlsReactApp");
if (teeSignReviewControlsMount) {
  flushSync(() => createRoot(teeSignReviewControlsMount).render(h(AdminTeeSignReviewControls)));
}

const teeSignReviewMount = document.getElementById("adminTeeSignReviewReactApp");
if (teeSignReviewMount) {
  flushSync(() => createRoot(teeSignReviewMount).render(h(AdminTeeSignReviewList)));
}

const leagueFormMount = document.getElementById("adminLeagueFormReactApp");
if (leagueFormMount) {
  flushSync(() => createRoot(leagueFormMount).render(h(AdminLeagueForm)));
}

const leaguesListMount = document.getElementById("adminLeaguesListReactApp");
if (leaguesListMount) {
  flushSync(() => createRoot(leaguesListMount).render(h(AdminLeaguesList)));
}

const fundraiserFormMount = document.getElementById("adminFundraiserFormReactApp");
if (fundraiserFormMount) {
  flushSync(() => createRoot(fundraiserFormMount).render(h(AdminFundraiserForm)));
}

const fundraisersListMount = document.getElementById("adminFundraisersListReactApp");
if (fundraisersListMount) {
  flushSync(() => createRoot(fundraisersListMount).render(h(AdminFundraisersList)));
}

const meetingFormMount = document.getElementById("adminMeetingFormReactApp");
if (meetingFormMount) {
  flushSync(() => createRoot(meetingFormMount).render(h(AdminMeetingForm)));
}

const meetingsListMount = document.getElementById("adminMeetingsListReactApp");
if (meetingsListMount) {
  flushSync(() => createRoot(meetingsListMount).render(h(AdminMeetingsList)));
}

const membersListMount = document.getElementById("adminMembersListReactApp");
if (membersListMount) {
  flushSync(() => createRoot(membersListMount).render(h(AdminMembersList)));
}

const memberFormMount = document.getElementById("adminMemberFormReactApp");
if (memberFormMount) {
  flushSync(() => createRoot(memberFormMount).render(h(AdminMemberForm)));
}

const memberTempPinMount = document.getElementById("adminMemberTempPinReactApp");
if (memberTempPinMount) {
  flushSync(() => createRoot(memberTempPinMount).render(h(AdminMemberTempPin)));
}

const productsListMount = document.getElementById("adminProductsListReactApp");
if (productsListMount) {
  flushSync(() => createRoot(productsListMount).render(h(AdminProductsList)));
}

const productFormMount = document.getElementById("adminProductFormReactApp");
if (productFormMount) {
  flushSync(() => createRoot(productFormMount).render(h(AdminProductForm)));
}

const productInventoryControlsMount = document.getElementById("adminProductInventoryControlsReactApp");
if (productInventoryControlsMount) {
  flushSync(() => createRoot(productInventoryControlsMount).render(h(AdminProductInventoryControls)));
}

const orderControlsMount = document.getElementById("adminOrderControlsReactApp");
if (orderControlsMount) {
  flushSync(() => createRoot(orderControlsMount).render(h(AdminOrderControls)));
}

const ordersListMount = document.getElementById("adminOrdersListReactApp");
if (ordersListMount) {
  flushSync(() => createRoot(ordersListMount).render(h(AdminOrdersList)));
}

const walletRecentMount = document.getElementById("adminWalletRecentReactApp");
if (walletRecentMount) {
  flushSync(() => createRoot(walletRecentMount).render(h(AdminWalletRecentList)));
}

const walletFormMount = document.getElementById("adminWalletFormReactApp");
if (walletFormMount) {
  flushSync(() => createRoot(walletFormMount).render(h(AdminWalletAdjustmentForm)));
}

const dataArchiveDestinationFormMount = document.getElementById("adminDataArchiveDestinationFormReactApp");
if (dataArchiveDestinationFormMount) {
  flushSync(() => createRoot(dataArchiveDestinationFormMount).render(h(AdminDataArchiveDestinationForm)));
}

const dataArchiveDestinationsMount = document.getElementById("adminDataArchiveDestinationsReactApp");
if (dataArchiveDestinationsMount) {
  flushSync(() => createRoot(dataArchiveDestinationsMount).render(h(AdminDataArchiveDestinationsList)));
}

const dataArchiveExportControlsMount = document.getElementById("adminDataArchiveExportControlsReactApp");
if (dataArchiveExportControlsMount) {
  flushSync(() => createRoot(dataArchiveExportControlsMount).render(h(AdminDataArchiveExportControls)));
}

const dataArchiveExportResultMount = document.getElementById("adminDataArchiveExportResultReactApp");
if (dataArchiveExportResultMount) {
  flushSync(() => createRoot(dataArchiveExportResultMount).render(h(AdminDataArchiveExportResult)));
}

const registrationMount = document.getElementById("adminRegistrationReactApp");
if (registrationMount) {
  flushSync(() => createRoot(registrationMount).render(h(AdminRegistrationPanel)));
}

const crottsMount = document.getElementById("crottsReactApp");
if (crottsMount) {
  flushSync(() => createRoot(crottsMount).render(h(CrottsWidget)));
}

startAdminController();
