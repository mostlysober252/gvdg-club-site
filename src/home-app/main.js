import React from "react";
import { createRoot } from "react-dom/client";

import { HomeContactSection, HomeFooter, HomeMembershipSection } from "./community-sections.js";
import { CourseModal } from "./course-modal.js";
import { HomeCoursesApp } from "./courses-app.js";
import { AreaTournamentsFeed, HomeEventsFeed } from "./feed-panels.js";
import { HomeAboutSection, HomeHeroSection } from "./hero-about-app.js";
import { HomePageChrome } from "./page-chrome.js";
import { HomeBackToTop } from "./page-controls.js";
import { CrottsWidget } from "../shared/crotts-widget.js";

if (import.meta.env.DEV && import.meta.env.VITE_DISABLE_REACT_DEVTOOLS !== "1") {
  void import("react-grab");
  void import("react-scan");
}

const h = React.createElement;

const pageChromeMount = document.getElementById("homeReactPageChromeApp");
if (pageChromeMount) {
  createRoot(pageChromeMount).render(h(HomePageChrome));
}

const heroMount = document.getElementById("homeReactHeroApp");
if (heroMount) {
  createRoot(heroMount).render(h(HomeHeroSection));
}

const aboutMount = document.getElementById("homeReactAboutApp");
if (aboutMount) {
  createRoot(aboutMount).render(h(HomeAboutSection));
}

const eventsMount = document.getElementById("homeReactEventsApp");
if (eventsMount) {
  createRoot(eventsMount).render(h(HomeEventsFeed));
}

const tournamentsMount = document.getElementById("homeReactTournamentsApp");
if (tournamentsMount) {
  createRoot(tournamentsMount).render(h(AreaTournamentsFeed));
}

const coursesMount = document.getElementById("homeReactCoursesApp");
if (coursesMount) {
  createRoot(coursesMount).render(h(HomeCoursesApp));
}

const membershipMount = document.getElementById("homeReactMembershipApp");
if (membershipMount) {
  createRoot(membershipMount).render(h(HomeMembershipSection));
}

const contactMount = document.getElementById("homeReactContactApp");
if (contactMount) {
  createRoot(contactMount).render(h(HomeContactSection));
}

const footerMount = document.getElementById("homeReactFooterApp");
if (footerMount) {
  createRoot(footerMount).render(h(HomeFooter));
}

const courseModalMount = document.getElementById("homeReactCourseModalApp");
if (courseModalMount) {
  createRoot(courseModalMount).render(h(CourseModal));
}

const backToTopMount = document.getElementById("homeReactBackToTopApp");
if (backToTopMount) {
  createRoot(backToTopMount).render(h(HomeBackToTop));
}

const crottsMount = document.getElementById("crottsReactApp");
if (crottsMount) {
  createRoot(crottsMount).render(h(CrottsWidget));
}
