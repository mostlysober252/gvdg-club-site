import React from "react";
import { CalendarDays, ExternalLink, MapPin } from "lucide-react";

import { useEventsHub } from "./events-hub-data.js";

const h = React.createElement;

function icon(Icon, size = 16) {
  return h(Icon, {
    "aria-hidden": "true",
    focusable: "false",
    size,
    strokeWidth: 2.4,
  });
}

function cleanClassName(value) {
  return String(value || "").replace(/[^a-z0-9_-]/gi, "");
}

function safeHref(raw) {
  if (!raw) return "";
  const value = String(raw);
  if (value.startsWith("#")) return value;
  try {
    const url = new URL(value, window.location.href);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function Badge({ className = "", text }) {
  return h("span", { className: `badge ${className}`.trim() }, text || "");
}

function GroupHeading({ sub, title }) {
  return h("div", { className: "events-group-head" }, [
    h("h2", { className: "events-section-title", key: "title" }, title),
    sub ? h("p", { className: "events-group-sub", key: "sub" }, sub) : null,
  ]);
}

function MetaRow({ children, iconNode }) {
  return h("div", { className: "meta-row" }, [
    h("span", { className: "meta-icon", key: "icon" }, iconNode),
    h("span", { key: "text" }, children),
  ]);
}

function eventKey(event, index) {
  return [
    event && event.href,
    event && event.id,
    event && event.name,
    event && event.dateText,
    String(index),
  ].filter(Boolean).join("|");
}

function feedKey(item, index) {
  return [
    item && item.href,
    item && item.name,
    item && item.dateText,
    String(index),
  ].filter(Boolean).join("|");
}

function EventCard({ event }) {
  const href = safeHref(event && event.href);
  const typeClass = cleanClassName(event && event.typeClass);
  const statusClass = cleanClassName(event && event.status);
  const live = event && event.status === "live";
  const tag = href ? "a" : "div";

  return h(tag, { className: `event-card${live ? " live" : ""}`, href: href || undefined }, [
    h("div", { className: "event-card-top", key: "top" }, [
      h("h3", { className: "event-name", key: "name" }, event && event.name ? String(event.name) : "Event"),
      event && event.typeLabel ? h(Badge, {
        className: `type-badge ${typeClass}`,
        key: "type",
        text: String(event.typeLabel),
      }) : null,
    ]),
    h("div", { className: "event-meta", key: "meta" }, [
      h(MetaRow, { iconNode: icon(CalendarDays), key: "date" }, event && event.dateText ? String(event.dateText) : "Date TBD"),
      event && event.courseName
        ? h(MetaRow, { iconNode: icon(MapPin), key: "course" }, String(event.courseName))
        : null,
    ]),
    event && event.statusLabel ? h("div", { className: "event-card-top", key: "status" }, h(Badge, {
      className: `status-badge ${statusClass}`,
      text: String(event.statusLabel),
    })) : null,
  ]);
}

function FeedCard({ item }) {
  const href = safeHref(item && item.href);
  const external = Boolean(item && item.external && href && !href.startsWith("#"));
  const tag = href ? "a" : "div";
  const props = { className: "event-card" };
  if (href) props.href = href;
  if (external) {
    props.target = "_blank";
    props.rel = "noopener noreferrer";
  }

  return h(tag, props, [
    h("div", { className: "event-card-top", key: "top" },
      h("h3", { className: "event-name" }, item && item.name ? String(item.name) : "Event")),
    h("div", { className: "event-meta", key: "meta" }, [
      h(MetaRow, { iconNode: icon(CalendarDays), key: "date" }, item && item.dateText ? String(item.dateText) : "TBD"),
      item && item.detail
        ? h(MetaRow, { iconNode: icon(MapPin), key: "detail" }, String(item.detail))
        : null,
    ]),
    item && item.cta ? h("div", { className: "event-cta", key: "cta" }, [
      String(item.cta),
      external ? h("span", { className: "event-cta-icon", key: "icon" }, icon(ExternalLink, 14)) : null,
    ]) : null,
  ]);
}

function EventSection({ events, hubRegion, live = false, title }) {
  if (!events.length) return null;
  return h("section", { className: `events-section${live ? " live" : ""}`, "data-react-events-hub": hubRegion }, [
    h("div", { className: "events-section-head", key: "head" }, [
      live ? h("span", { className: "live-dot", key: "dot" }) : null,
      h("h2", { className: "events-section-title", key: "title" }, title),
      h("span", { className: "events-section-count", key: "count" }, `${events.length} event${events.length === 1 ? "" : "s"}`),
    ]),
    h("div", { className: "events-grid", key: "grid" }, events.map((event, index) =>
      h(EventCard, { event, key: eventKey(event, index) }))),
  ]);
}

function FeedGrid({ items }) {
  if (!items.length) return null;
  return h("div", { className: "events-grid" }, items.map((item, index) =>
    h(FeedCard, { item, key: feedKey(item, index) })));
}

export function EventsLiveNowApp() {
  const hub = useEventsHub();
  return h(EventSection, { events: hub.live, hubRegion: "live", live: true, title: "Live Now" });
}

export function EventsScheduleFeedApp() {
  const hub = useEventsHub();
  return h("section", { "data-react-events-hub": "schedule" }, [
    h(GroupHeading, { key: "heading", sub: "Disc golf tournaments & league rounds", title: "Events" }),
    h(FeedGrid, { items: hub.feedEvents, key: "feed" }),
    !hub.hasMainContent ? h("p", { className: "events-empty", key: "empty" }, "No tournaments or league rounds are on the schedule right now.") : null,
  ]);
}

export function EventsUpcomingApp() {
  const hub = useEventsHub();
  return h(EventSection, { events: hub.upcoming, hubRegion: "upcoming", title: "Upcoming" });
}

export function EventsClubFeedApp() {
  const hub = useEventsHub();
  return h("section", { "data-react-events-hub": "club" }, [
    h(GroupHeading, { key: "heading", sub: "Fundraisers, meetings & minutes", title: "Club Events" }),
    h(FeedGrid, { items: hub.feedClub, key: "feed" }),
  ]);
}
