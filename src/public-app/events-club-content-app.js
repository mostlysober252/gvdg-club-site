import React from "react";
import { Check, Copy, ExternalLink, Heart, Mail } from "lucide-react";

import { fetchPublicJson, publicApiBase } from "./public-api.js";
import { safeExternalUrl } from "../shared/safe-url.js";

const h = React.createElement;
const DONATION_FALLBACK = "https://paypal.me/greenvillediscgolf";

function icon(Icon, size = 15) {
  return h(Icon, {
    "aria-hidden": "true",
    focusable: "false",
    size,
    strokeWidth: 2.4,
  });
}

function currency(cents) {
  return "$" + (Math.round(Number(cents) || 0) / 100).toLocaleString(undefined, {
    maximumFractionDigits: 0,
  });
}

function fundraiserKey(item, index) {
  return [
    item && item.id,
    item && item.title,
    item && item.paypal_url,
    String(index),
  ].filter(Boolean).join("|");
}

function meetingKey(item, index) {
  return [
    item && item.id,
    item && item.title,
    item && item.date,
    String(index),
  ].filter(Boolean).join("|");
}

function inlineNodes(text, keyPrefix) {
  const nodes = [];
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let last = 0;
  let match;
  let index = 0;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    if (match[1] != null) {
      nodes.push(h("strong", { key: `${keyPrefix}-strong-${index}` }, match[1]));
    } else {
      const href = safeExternalUrl(match[3]);
      nodes.push(h("a", {
        href,
        key: `${keyPrefix}-link-${index}`,
        rel: "noopener noreferrer",
        target: "_blank",
      }, match[2]));
    }
    last = re.lastIndex;
    index += 1;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function MarkdownBody({ children }) {
  const markdown = String(children || "");
  const blocks = markdown.split(/\n\s*\n/).filter((block) => block.trim() !== "");
  if (!blocks.length) return null;

  return h("div", { className: "fundraiser-body" }, blocks.map((block, blockIndex) => {
    const lines = block.split("\n").filter((line) => line.trim() !== "");
    if (!lines.length) return null;
    if (lines.every((line) => /^\s*-\s+/.test(line))) {
      return h("ul", { key: `block-${blockIndex}` }, lines.map((line, lineIndex) =>
        h("li", { key: `li-${lineIndex}` }, inlineNodes(line.replace(/^\s*-\s+/, ""), `b${blockIndex}-li${lineIndex}`))));
    }
    if (/^#{1,3}\s+/.test(lines[0])) {
      return h(React.Fragment, { key: `block-${blockIndex}` }, [
        h("h4", { key: "head" }, inlineNodes(lines[0].replace(/^#{1,3}\s+/, ""), `b${blockIndex}-head`)),
        lines.length > 1
          ? h("p", { key: "body" }, inlineNodes(lines.slice(1).join("\n"), `b${blockIndex}-body`))
          : null,
      ]);
    }
    return h("p", { key: `block-${blockIndex}` }, lines.flatMap((line, lineIndex) => {
      const parts = inlineNodes(line, `b${blockIndex}-line${lineIndex}`);
      return lineIndex ? [h("br", { key: `br-${lineIndex}` }), ...parts] : parts;
    }));
  }));
}

function ShareRow({ title, url }) {
  const [copied, setCopied] = React.useState("idle");
  const encodedUrl = encodeURIComponent(url);
  const encodedTitle = encodeURIComponent(`Support ${title} - Greenville Disc Golf Club`);
  const copyLabel = copied === "ok" ? "Copied" : copied === "err" ? "Copy failed" : "Copy link";

  React.useEffect(() => {
    if (copied === "idle") return undefined;
    const timer = window.setTimeout(() => setCopied("idle"), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied("ok");
    } catch {
      setCopied("err");
    }
  }

  return h("div", { className: "fr-share" }, [
    h("span", { className: "fr-share-label", key: "label" }, "Share:"),
    h("a", {
      className: "fr-share-btn fb",
      href: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
      key: "facebook",
      rel: "noopener noreferrer",
      target: "_blank",
    }, "Facebook"),
    h("a", {
      className: "fr-share-btn tw",
      href: `https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedTitle}`,
      key: "x",
      rel: "noopener noreferrer",
      target: "_blank",
    }, "X"),
    h("a", {
      className: "fr-share-btn em",
      href: `mailto:?subject=${encodedTitle}&body=${encodedTitle}%0A%0A${encodedUrl}`,
      key: "email",
    }, [icon(Mail), "Email"]),
    h("button", {
      className: "fr-share-btn copy",
      key: "copy",
      onClick: copyUrl,
      type: "button",
    }, [icon(copied === "ok" ? Check : Copy), copyLabel]),
  ]);
}

function FundraiserCard({ fundraiser }) {
  const title = String(fundraiser && fundraiser.title ? fundraiser.title : "Fundraiser");
  const goal = Number(fundraiser && fundraiser.goal_cents) || 0;
  const raised = Number(fundraiser && fundraiser.raised_cents) || 0;
  const pct = goal > 0 ? Math.max(0, Math.min(100, Math.round((raised / goal) * 100))) : 0;
  const donationUrl = safeExternalUrl(fundraiser && fundraiser.paypal_url) || DONATION_FALLBACK;

  return h("article", { className: "fundraiser-card", "data-react-events-fundraiser": "true" }, [
    h("h3", { className: "fundraiser-title", key: "title" }, title),
    goal > 0 ? h("div", { className: "fr-bar", key: "bar" },
      h("div", { className: "fr-bar-fill", style: { width: `${pct}%` } })) : null,
    goal > 0 ? h("div", { className: "fr-progress", key: "progress" },
      `${currency(raised)} of ${currency(goal)} (${pct}%)`) : null,
    fundraiser && fundraiser.body_md
      ? h(MarkdownBody, { key: "body" }, fundraiser.body_md)
      : null,
    h("a", {
      className: "donate-btn",
      href: donationUrl,
      key: "donate",
      rel: "noopener noreferrer",
      target: "_blank",
    }, [icon(Heart), "Donate", icon(ExternalLink, 14)]),
    h(ShareRow, { key: "share", title, url: donationUrl }),
  ]);
}

function MeetingCard({ meeting }) {
  const title = String(meeting && meeting.title ? meeting.title : "Meeting");
  const date = meeting && meeting.date ? String(meeting.date) : "";
  return h("article", { className: "fundraiser-card", "data-react-events-meeting": "true" }, [
    h("h3", { className: "fundraiser-title", key: "title" }, date ? `${title} - ${date}` : title),
    meeting && meeting.minutes_md ? h(MarkdownBody, { key: "minutes" }, meeting.minutes_md) : null,
  ]);
}

function activeFundraisers(data) {
  const items = Array.isArray(data && data.fundraisers) ? data.fundraisers : [];
  return items.filter((fundraiser) => fundraiser && fundraiser.status === "active");
}

function meetingItems(data) {
  return Array.isArray(data && data.meetings) ? data.meetings : [];
}

export function EventsFundraisersApp() {
  const api = React.useMemo(publicApiBase, []);
  const [fundraisers, setFundraisers] = React.useState([]);

  React.useEffect(() => {
    let active = true;

    async function loadFundraisers() {
      try {
        const data = await fetchPublicJson(api, "/fundraisers");
        if (active) setFundraisers(activeFundraisers(data));
      } catch {
        if (active) setFundraisers([]);
      }
    }

    loadFundraisers();
    return () => {
      active = false;
    };
  }, [api]);

  if (!fundraisers.length) return null;
  return h("section", { "data-react-events-fundraisers": "true" }, [
    h("h2", { className: "events-section-title", key: "title" }, "Fundraisers"),
    ...fundraisers.map((fundraiser, index) =>
      h(FundraiserCard, { fundraiser, key: fundraiserKey(fundraiser, index) })),
  ]);
}

export function EventsMeetingsApp() {
  const api = React.useMemo(publicApiBase, []);
  const [meetings, setMeetings] = React.useState([]);

  React.useEffect(() => {
    let active = true;

    async function loadMeetings() {
      try {
        const data = await fetchPublicJson(api, "/meetings");
        if (active) setMeetings(meetingItems(data));
      } catch {
        if (active) setMeetings([]);
      }
    }

    loadMeetings();
    return () => {
      active = false;
    };
  }, [api]);

  if (!meetings.length) return null;
  return h("section", { "data-react-events-meetings": "true" }, [
    h("h2", { className: "events-section-title", key: "title" }, "Meetings & Minutes"),
    ...meetings.map((meeting, index) => h(MeetingCard, { meeting, key: meetingKey(meeting, index) })),
  ]);
}
