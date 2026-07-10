import React from "react";
import { ChevronLeft, ChevronRight, CircleDollarSign, Disc3 } from "lucide-react";

import { nextCircularIndex, clampedIndex, useAnimatedCount, useRevealOnce, useSwipe } from "./interaction-hooks.js";

const h = React.createElement;

const HERO_SLIDES = ["Slide 1", "Slide 2", "Slide 3", "Slide 4", "Slide 5"];

const ABOUT_PARAGRAPHS = [
  "Greenville Disc Golf (GVDG) was founded in 2004 when local disc golf enthusiasts came together to prove there was a community passionate about bringing the sport to Eastern North Carolina. What started as a grassroots effort to build a single course has grown into one of the region's most active disc golf organizations.",
  "For over two decades, we've been hosting weekly doubles, monthly tournaments, and our signature annual event, the Down East Players Cup, a PDGA A-tier tournament that draws players from across the region. We're proud to have helped establish Greenville as the 12th best disc golf destination in North Carolina.",
  "Beyond the course, GVDG is committed to giving back. Our scholarship program supports graduating seniors in Pitt County, funded through events like our annual Scholarship Shootout. Whether you're throwing your first disc or competing at the pro level, you'll find your place in our community.",
];

const ABOUT_STATS = [
  { value: 21, label: "Years Strong" },
  { value: 5, label: "Local Courses" },
  { value: 12, label: "NC Ranking" },
  { value: 7, label: "Active Leagues" },
];

const BOARD_MEMBERS = [
  { name: "Max Crotts", role: "Club Officer", icon: Disc3, founder: true },
  { name: "Adam Walter", role: "Treasurer", icon: CircleDollarSign },
  { name: "Jarrett Wallace", role: "Club Officer", icon: Disc3 },
  { name: "Jeff Stelly", role: "Club Officer", icon: Disc3 },
  { name: "TJ Braley", role: "Club Officer", icon: Disc3 },
  { name: "Alex Schwarga", role: "Club Officer", icon: Disc3 },
];

function icon(Icon, props = {}) {
  return h(Icon, {
    ...props,
    "aria-hidden": "true",
    focusable: "false",
    size: props.size || 30,
    strokeWidth: props.strokeWidth || 2.2,
  });
}

function HeroArrow({ className, label, onClick, children }) {
  return h("button", { "aria-label": label, className, onClick, type: "button" }, children);
}

function AboutIndicator({ index, active, onClick }) {
  return h("button", {
    "aria-label": `About slide ${index + 1}`,
    "aria-current": active ? "true" : undefined,
    className: "carousel-indicator" + (active ? " active" : ""),
    "data-slide": String(index),
    onClick,
    type: "button",
  });
}

function heroSlideClass(index, current) {
  return index === current ? "carousel-slide active" : "carousel-slide";
}

function BoardMemberCard({ member }) {
  const className = "board-member-card" + (member.founder ? " founder" : "");
  return h("div", { className }, [
    h("div", { className: "board-member-icon", key: "icon" }, icon(member.icon, { size: 34 })),
    h("div", { className: "board-member-name", key: "name" }, member.name),
    h("div", { className: "board-member-role", key: "role" }, member.role),
  ]);
}

function RevealHeading({ children }) {
  const [ref, visible] = useRevealOnce();
  return h("h2", { className: "section-title fade-in" + (visible ? " visible" : ""), ref }, children);
}

function StatCard({ stat, index }) {
  const [ref, visible] = useRevealOnce({ delay: index * 100, threshold: 0.3 });
  const value = useAnimatedCount(stat.value, visible);
  return h("div", { className: "stat-card" + (visible ? " visible" : ""), ref }, [
    h("div", { className: "stat-number", key: "value" }, String(value)),
    h("div", { className: "stat-label", key: "label" }, stat.label),
  ]);
}

export function HomeHeroSection() {
  const [current, setCurrent] = React.useState(0);
  const [paused, setPaused] = React.useState(false);
  const swipeHandlers = useSwipe((step) => setCurrent((slide) => nextCircularIndex(slide, step, HERO_SLIDES.length)));

  React.useEffect(() => {
    if (paused) return undefined;
    const intervalId = window.setInterval(() => {
      setCurrent((slide) => nextCircularIndex(slide, 1, HERO_SLIDES.length));
    }, 5000);
    return () => window.clearInterval(intervalId);
  }, [paused]);

  return h("section", {
    className: "hero",
    "data-react-home-hero": "ready",
    onMouseEnter: () => setPaused(true),
    onMouseLeave: () => setPaused(false),
    ...swipeHandlers,
  }, [
    h("div", { className: "hero-bg-pattern", key: "pattern" }),
    h("div", { className: "carousel", key: "carousel" },
      HERO_SLIDES.map((label, index) => h("div", {
        "aria-label": label,
        className: heroSlideClass(index, current),
        key: label,
        role: "img",
      }))),
    h(HeroArrow, {
      className: "carousel-arrow carousel-prev",
      key: "previous",
      label: "Previous slide",
      onClick: () => setCurrent((slide) => nextCircularIndex(slide, -1, HERO_SLIDES.length)),
    },
      icon(ChevronLeft, { size: 26, strokeWidth: 2.8 })),
    h(HeroArrow, {
      className: "carousel-arrow carousel-next",
      key: "next",
      label: "Next slide",
      onClick: () => setCurrent((slide) => nextCircularIndex(slide, 1, HERO_SLIDES.length)),
    },
      icon(ChevronRight, { size: 26, strokeWidth: 2.8 })),
    h("div", { className: "carousel-controls", key: "controls" },
      HERO_SLIDES.map((label, index) => h("button", {
        "aria-label": label,
        "aria-current": index === current ? "true" : undefined,
        className: "carousel-dot" + (index === current ? " active" : ""),
        key: label,
        onClick: () => setCurrent(index),
        type: "button",
      }))),
    h("div", { className: "hero-content", key: "content" }, [
      h("h1", { className: "hero-title", key: "title" }, "Greenville Disc Golf Club"),
      h("p", { className: "hero-subtitle", key: "subtitle" }, "Eastern North Carolina's Premier Disc Golf Community"),
      h("a", { className: "cta-button", href: "#membership", key: "cta" }, "Join the Club"),
    ]),
    h("div", { className: "scroll-indicator", key: "scroll", "aria-hidden": "true" }),
  ]);
}

export function HomeAboutSection() {
  const [current, setCurrent] = React.useState(0);
  const slideCount = 2;
  const swipeHandlers = useSwipe((step) => setCurrent((slide) => clampedIndex(slide + step, slideCount)));
  const previousDisabled = current === 0;
  const nextDisabled = current === slideCount - 1;

  return h("div", { "data-react-home-about": "ready" }, [
    h(RevealHeading, { key: "title" }, "About Our Club"),
    h("div", { className: "about-carousel-container", key: "container", ...swipeHandlers },
      h("div", { className: "about-carousel", style: { transform: `translateX(-${current * 100}%)` } }, [
        h("div", { className: "carousel-slide-about", key: "story" },
          h("div", { className: "about-content" }, [
            h("div", { className: "about-text", key: "text" }, ABOUT_PARAGRAPHS.map((paragraph) => h("p", { key: paragraph }, paragraph))),
            h("div", { className: "stats-grid", key: "stats" }, ABOUT_STATS.map((stat, index) => h(StatCard, { index, key: stat.label, stat }))),
          ])),
        h("div", { className: "carousel-slide-about", key: "board" }, [
          h("div", { className: "board-slide-header", key: "header" }, [
            h("h3", { className: "board-slide-title", key: "title" }, "Meet Our Board"),
            h("p", { className: "board-slide-subtitle", key: "subtitle" }, "The people who keep GVDG running"),
          ]),
          h("div", { className: "board-members-grid", key: "members" }, BOARD_MEMBERS.map((member) => h(BoardMemberCard, { member, key: member.name }))),
        ]),
      ])),
    h("div", { className: "about-carousel-nav", key: "nav" }, [
      h("button", {
        "aria-label": "Previous about slide",
        className: "carousel-btn",
        disabled: previousDisabled,
        id: "aboutPrevBtn",
        key: "previous",
        onClick: () => setCurrent((slide) => clampedIndex(slide - 1, slideCount)),
        type: "button",
      },
        icon(ChevronLeft, { size: 26, strokeWidth: 2.8 })),
      h("div", { className: "carousel-indicators", key: "indicators" }, [
        h(AboutIndicator, { active: current === 0, index: 0, key: "story", onClick: () => setCurrent(0) }),
        h(AboutIndicator, { active: current === 1, index: 1, key: "board", onClick: () => setCurrent(1) }),
      ]),
      h("button", {
        "aria-label": "Next about slide",
        className: "carousel-btn",
        disabled: nextDisabled,
        id: "aboutNextBtn",
        key: "next",
        onClick: () => setCurrent((slide) => clampedIndex(slide + 1, slideCount)),
        type: "button",
      },
        icon(ChevronRight, { size: 26, strokeWidth: 2.8 })),
    ]),
  ]);
}
