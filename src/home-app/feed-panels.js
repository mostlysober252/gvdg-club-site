import React from "react";
import { ChevronDown, ChevronRight, MapPin } from "lucide-react";

import { safeExternalUrl } from "../shared/safe-url.js";
import {
  isClubEvent,
  parseHomepageEventCsv,
  parseHomepageEventDate,
  parseTournamentCsv,
  parseTournamentDate,
} from "../shared/home-feed-parse.js";

const h = React.createElement;
const VISIBLE_LIMIT = 5;
const EVENT_FEED_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTLTq17Bwgy6uW_9pG7dQODTmahv7vjxo9Y5EShHaeQYo9xPB2m7Nf5de8EcZvKgcrTbBLb97msMg4Q/pub?output=csv";
const TOURNAMENT_FEED_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRz6V6BAwII4eoqITz4MW5zmM_3mYJqrtqtZl9xB87lAZgDT1E0Do1r2cp2aa1tvEKWevnPhb2zQu4s/pub?gid=0&single=true&output=csv";
const RYDER_CUP_LEAGUE_URL = "events.html#league/4";
const DISC_GOLF_SCENE_URL = "https://www.discgolfscene.com/tournaments/search?filter%5Blocation%5D%5Bcountry%5D=USA&filter%5Blocation%5D%5Bname%5D=Greenville%2C+NC&filter%5Blocation%5D%5Blatitude%5D=35.589407&filter%5Blocation%5D%5Blongitude%5D=-77.351275&filter%5Blocation%5D%5Bdistance%5D=60&filter%5Blocation%5D%5Bunits%5D=mi&filter%5Bformat%5D%5B0%5D=s&filter%5Bformat%5D%5B1%5D=d&filter%5Bformat%5D%5B2%5D=t";

function icon(Icon, props = {}) {
  return h(Icon, {
    ...props,
    "aria-hidden": "true",
    focusable: "false",
    size: props.size || 16,
    strokeWidth: props.strokeWidth || 2.4,
  });
}

function isRyderCupEvent(event) {
  return /\bryder\s*cup\b/i.test(String(event?.title || ""));
}

function loading(className, spinnerClassName, text) {
  return h("div", { className, role: "status" }, [
    h("div", { className: spinnerClassName, key: "spinner" }),
    h("p", { key: "text" }, text),
  ]);
}

function ToggleButton({ expanded, label, onClick }) {
  return h("button", { className: "toggle-btn" + (expanded ? " expanded" : ""), type: "button", onClick }, [
    h("span", { className: "toggle-text", key: "text" }, expanded ? "Show Less" : label),
    icon(ChevronDown, { className: "toggle-icon", key: "icon", size: 20 }),
  ]);
}

function EventItem({ event, index, visible }) {
  const localUrl = isRyderCupEvent(event) ? RYDER_CUP_LEAGUE_URL : "";
  const url = localUrl || safeExternalUrl(event.url);
  const dateInfo = parseHomepageEventDate(event.date);
  const Tag = url ? "a" : "div";
  const classes = ["event-item", "fade-in", "visible"];
  if (url) classes.push("has-link");
  if (dateInfo.isTBD) classes.push("tbd-event");
  if (!visible) classes.push("hidden-extra");
  const props = { className: classes.join(" "), key: `${event.title}-${event.date}-${index}` };
  if (url) {
    props.href = url;
    if (!localUrl) {
      props.target = "_blank";
      props.rel = "noopener noreferrer";
    }
  }
  return h(Tag, props, [
    h("div", { className: dateInfo.isTBD ? "event-date tbd" : "event-date", key: "date" }, [
      h("div", { className: "event-day", key: "day" }, dateInfo.isTBD ? "TBD" : String(dateInfo.day)),
      dateInfo.isTBD ? null : h("div", { className: "event-month", key: "month" }, dateInfo.month),
    ]),
    h("div", { className: "event-info", key: "info" }, [
      h("h3", { className: "event-title", key: "title" }, event.title),
      h("p", { className: "event-description", key: "description" }, event.description || ""),
    ]),
  ]);
}

function TournamentItem({ tournament, index, visible }) {
  const dateInfo = parseTournamentDate(tournament.date);
  const url = safeExternalUrl(tournament.url);
  const Tag = url ? "a" : "div";
  const props = {
    className: "tournament-item" + (visible ? "" : " hidden-mobile"),
    key: `${tournament.name}-${tournament.date}-${index}`,
  };
  if (url) {
    props.href = url;
    props.target = "_blank";
    props.rel = "noopener";
  }
  return h(Tag, props, [
    h("div", { className: "tournament-date", key: "date" }, [
      h("span", { className: "month", key: "month" }, dateInfo ? dateInfo.month : "TBD"),
      h("span", { className: "day", key: "day" }, dateInfo ? String(dateInfo.day) : "--"),
    ]),
    h("div", { className: "tournament-info", key: "info" }, [
      h("h4", { className: "tournament-name", key: "name" }, tournament.name),
      h("div", { className: "tournament-meta", key: "meta" }, [
        tournament.location
          ? h("span", { className: "tournament-location", key: "location" }, [
              icon(MapPin, { key: "icon", size: 14 }),
              h("span", { key: "text" }, tournament.location),
            ])
          : null,
        tournament.tier ? h("span", { className: "tournament-tier", key: "tier" }, tournament.tier) : null,
      ]),
    ]),
    icon(ChevronRight, { className: "tournament-arrow", key: "arrow" }),
  ]);
}

export function HomeEventsFeed() {
  const [state, setState] = React.useState({ status: "loading", events: [] });
  const [expanded, setExpanded] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    async function load() {
      try {
        const response = await fetch(`${EVENT_FEED_URL}&_cb=${Date.now()}`);
        if (!response.ok) throw new Error("feed_error");
        const events = parseHomepageEventCsv(await response.text())
          .filter((event) => !isClubEvent(event))
          .filter((event) => !parseHomepageEventDate(event.date).isPast)
          .sort((a, b) => parseHomepageEventDate(a.date).dateObj - parseHomepageEventDate(b.date).dateObj);
        if (active) setState({ status: events.length ? "ready" : "empty", events });
      } catch (error) {
        if (active) setState({ status: "error", events: [] });
      }
    }
    load();
    return () => {
      active = false;
    };
  }, []);

  if (state.status === "loading") {
    return h("div", { "data-react-home-events": "loading" }, h("div", { className: "event-list" }, loading("event-loading", "spinner", "Loading events...")));
  }
  if (state.status === "empty" || state.status === "error") {
    const title = state.status === "empty" ? "No Upcoming Events" : "Events Loading...";
    const body = state.status === "empty" ? "Check back soon for new events!" : "Please check back shortly.";
    return h("div", { "data-react-home-events": state.status }, h("div", { className: "event-list" }, h("div", { className: "no-events" }, [
      h("h3", { key: "title" }, title),
      h("p", { key: "body" }, body),
    ])));
  }

  const showToggle = state.events.length > VISIBLE_LIMIT;
  return h("div", { "data-react-home-events": "ready" }, [
    h("div", { className: "event-list" + (expanded ? " expanded" : ""), key: "list" },
      state.events.map((event, index) => h(EventItem, { event, index, visible: expanded || index < VISIBLE_LIMIT, key: `${event.title}-${event.date}-${index}` }))),
    showToggle
      ? h("div", { className: "event-toggle", key: "toggle" },
          h(ToggleButton, { expanded, label: `Show All ${state.events.length} Events`, onClick: () => setExpanded((current) => !current) }))
      : null,
  ]);
}

export function AreaTournamentsFeed() {
  const [state, setState] = React.useState({ status: "loading", tournaments: [] });
  const [expanded, setExpanded] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    async function load() {
      try {
        const response = await fetch(TOURNAMENT_FEED_URL);
        if (!response.ok) throw new Error("feed_error");
        const tournaments = parseTournamentCsv(await response.text());
        if (active) setState({ status: tournaments.length ? "ready" : "empty", tournaments });
      } catch (error) {
        if (active) setState({ status: "error", tournaments: [] });
      }
    }
    load();
    return () => {
      active = false;
    };
  }, []);

  if (state.status === "loading") {
    return h("div", { "data-react-home-tournaments": "loading" }, h("div", { className: "tournament-list" }, loading("tournament-loading", "loading-spinner", "Loading tournaments...")));
  }

  if (state.status === "empty" || state.status === "error") {
    const message = state.status === "empty" ? "No upcoming tournaments found." : "Unable to load tournaments.";
    return h("div", { "data-react-home-tournaments": state.status }, h("div", { className: "tournament-list" }, h("div", { className: "no-tournaments" }, h("p", null, message))));
  }

  const showToggle = state.tournaments.length > VISIBLE_LIMIT;
  return h("div", { "data-react-home-tournaments": "ready" }, [
    h("div", { className: "tournament-list" + (expanded ? " expanded" : ""), key: "list" },
      state.tournaments.map((tournament, index) => h(TournamentItem, { tournament, index, visible: expanded || index < VISIBLE_LIMIT, key: `${tournament.name}-${tournament.date}-${index}` }))),
    showToggle
      ? h("div", { className: "tournament-toggle", key: "toggle" },
          h(ToggleButton, { expanded, label: `Show All ${state.tournaments.length} Tournaments`, onClick: () => setExpanded((current) => !current) }))
      : null,
    h("div", { className: "tournament-footer", key: "footer" },
      h("a", { className: "view-all-link", href: DISC_GOLF_SCENE_URL, target: "_blank", rel: "noopener" }, [
        h("span", { key: "text" }, "View on Disc Golf Scene"),
        icon(ChevronRight, { key: "icon", size: 14 }),
      ])),
  ]);
}
