import React from "react";
import { createRoot } from "react-dom/client";

import { BlogApp } from "./blog-app.js";
import { ProShopApp } from "./pro-shop-app.js";
import { PublicPageChrome } from "./page-chrome.js";
import { RyderCupApp } from "./ryder-cup-app.js";
import { EventsPreviousResultsApp } from "./events-previous-results-app.js";
import { EventsEventDetailApp } from "./events-detail-app.js";
import { EventsFundraisersApp, EventsMeetingsApp } from "./events-club-content-app.js";
import { EventsClubFeedApp, EventsLiveNowApp, EventsScheduleFeedApp, EventsUpcomingApp } from "./events-hub-app.js";
import { installEventsHubController } from "./events-hub-data.js";
import { EventsLastUpdatedApp } from "./events-last-updated-app.js";
import { EventsLeagueDetailApp } from "./events-league-detail-app.js";
import { EventsLeaguesApp } from "./events-leagues-app.js";
import { EventsRegistrationApp } from "./events-registration-app.js";
import { EventsStatusApp } from "./events-status-app.js";
import { EventsViewController, installEventsRouteController } from "./events-view-controller.js";
import { CrottsWidget } from "../shared/crotts-widget.js";

if (import.meta.env.DEV && import.meta.env.VITE_DISABLE_REACT_DEVTOOLS !== "1") {
  import("react-scan").then(({ scan }) => scan({ enabled: true })).catch(() => {});
}

const h = React.createElement;
const pageChromeMount = document.getElementById("publicReactPageChrome");
const blogMount = document.getElementById("blogReactApp");
const proShopMount = document.getElementById("proShopReactApp");
const ryderCupMount = document.getElementById("ryderCupReactApp");
const eventsStatusMount = document.getElementById("status");
const eventsLiveNowMount = document.getElementById("liveNowSection");
const eventsScheduleFeedMount = document.getElementById("calendarEvents");
const eventsUpcomingMount = document.getElementById("hub");
const eventsClubFeedMount = document.getElementById("clubEventsSection");
const eventsRegistrationMount = document.getElementById("registerSection");
const eventsPreviousResultsMount = document.getElementById("previousResultsSection");
const eventsLeaguesMount = document.getElementById("leaguesSection");
const eventsLeagueDetailMount = document.getElementById("leagueDetailSection");
const eventsEventDetailMount = document.getElementById("detail");
const eventsFundraisersMount = document.getElementById("fundraisersSection");
const eventsMeetingsMount = document.getElementById("meetingsSection");
const eventsLastUpdatedMount = document.getElementById("eventsLastUpdatedReactApp");
const eventsViewControllerMount = document.getElementById("eventsViewControllerReactApp");
const crottsMount = document.getElementById("crottsReactApp");

if (pageChromeMount) {
  createRoot(pageChromeMount).render(h(PublicPageChrome));
}

if (ryderCupMount) {
  createRoot(ryderCupMount).render(h(RyderCupApp));
}

if (blogMount) {
  createRoot(blogMount).render(h(BlogApp));
}

if (eventsViewControllerMount) {
  installEventsHubController();
  installEventsRouteController();
  createRoot(eventsViewControllerMount).render(h(EventsViewController));
}

if (eventsStatusMount) {
  createRoot(eventsStatusMount).render(h(EventsStatusApp));
}

if (eventsLiveNowMount) {
  createRoot(eventsLiveNowMount).render(h(EventsLiveNowApp));
}

if (eventsScheduleFeedMount) {
  createRoot(eventsScheduleFeedMount).render(h(EventsScheduleFeedApp));
}

if (eventsUpcomingMount) {
  createRoot(eventsUpcomingMount).render(h(EventsUpcomingApp));
}

if (eventsClubFeedMount) {
  createRoot(eventsClubFeedMount).render(h(EventsClubFeedApp));
}

if (eventsRegistrationMount) {
  createRoot(eventsRegistrationMount).render(h(EventsRegistrationApp));
}

if (eventsPreviousResultsMount) {
  createRoot(eventsPreviousResultsMount).render(h(EventsPreviousResultsApp));
}

if (eventsLeaguesMount) {
  createRoot(eventsLeaguesMount).render(h(EventsLeaguesApp));
}

if (eventsLeagueDetailMount) {
  createRoot(eventsLeagueDetailMount).render(h(EventsLeagueDetailApp));
}

if (eventsEventDetailMount) {
  createRoot(eventsEventDetailMount).render(h(EventsEventDetailApp));
}

if (eventsFundraisersMount) {
  createRoot(eventsFundraisersMount).render(h(EventsFundraisersApp));
}

if (eventsMeetingsMount) {
  createRoot(eventsMeetingsMount).render(h(EventsMeetingsApp));
}

if (eventsLastUpdatedMount) {
  createRoot(eventsLastUpdatedMount).render(h(EventsLastUpdatedApp));
}

if (proShopMount) {
  createRoot(proShopMount).render(h(ProShopApp));
}

if (crottsMount) {
  createRoot(crottsMount).render(h(CrottsWidget));
}
