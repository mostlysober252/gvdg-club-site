import React from "react";
import {
  ChartNoAxesColumnIncreasing,
  Mail,
  MapPin,
  MessageCircle,
  Smartphone,
  Target,
  Trophy,
} from "lucide-react";

import { safeExternalUrl } from "../shared/safe-url.js";
import { useRevealOnce } from "./interaction-hooks.js";

const h = React.createElement;

const PAYPAL_MEMBERSHIP_URL = "https://paypal.me/greenvillediscgolf/15";
const FACEBOOK_GROUP_URL = "https://www.facebook.com/groups/243452675724939";
const CLUB_EMAIL = "greenvillediscgolf@gmail.com";
const CLUB_EMAIL_LINK = "mailto:greenvillediscgolf@gmail.com";

const MEMBERSHIP_PERKS = [
  {
    title: "Tournament Access",
    body: "Member-only events and discounts",
    icon: Trophy,
  },
  {
    title: "Community",
    body: "Private Discord and social events",
    icon: MessageCircle,
  },
  {
    title: "Course Maintenance",
    body: "Help improve our local courses",
    icon: Target,
  },
  {
    title: "Skill Development",
    body: "Clinics and coaching sessions",
    icon: ChartNoAxesColumnIncreasing,
  },
];

function icon(Icon, props = {}) {
  return h(Icon, {
    ...props,
    "aria-hidden": "true",
    focusable: "false",
    size: props.size || 36,
    strokeWidth: props.strokeWidth || 2.2,
  });
}

function PerkCard({ index, perk }) {
  const [ref, visible] = useRevealOnce({ delay: index * 100 });
  return h("div", { className: "perk fade-in" + (visible ? " visible" : ""), ref }, [
    h("div", { className: "perk-icon", key: "icon" }, icon(perk.icon)),
    h("div", { className: "perk-title", key: "title" }, perk.title),
    h("p", { key: "body" }, perk.body),
  ]);
}

function ContactBox({ children, delay }) {
  const [ref, visible] = useRevealOnce({ delay });
  return h("div", { className: "contact-box fade-in" + (visible ? " visible" : ""), ref }, children);
}

export function HomeMembershipSection() {
  const membershipUrl = safeExternalUrl(PAYPAL_MEMBERSHIP_URL);
  return h("div", { className: "membership-content", "data-react-home-membership": "ready" }, [
    h("h2", { className: "section-title visible", key: "title" }, "Become a Member"),
    h("p", { className: "membership-subtitle", key: "subtitle" }, "Join our growing community and enjoy exclusive benefits"),
    h("div", { className: "membership-perks", key: "perks" }, MEMBERSHIP_PERKS.map((perk, index) => h(PerkCard, { index, perk, key: perk.title }))),
    h("div", { className: "price", key: "price" }, "$15 / Year"),
    h("a", {
      className: "cta-button",
      href: membershipUrl,
      key: "cta",
      rel: "noopener noreferrer",
      target: "_blank",
    }, "Get Started Today"),
  ]);
}

export function HomeContactSection() {
  const facebookUrl = safeExternalUrl(FACEBOOK_GROUP_URL);
  return h(React.Fragment, null, [
    h("h2", { className: "section-title fade-in visible", "data-react-home-contact": "ready", key: "title" }, "Get in Touch"),
    h("div", { className: "contact-info", key: "contact-info" }, [
      h(ContactBox, { delay: 0, key: "email" }, [
        h("div", { className: "contact-icon", key: "icon" }, icon(Mail)),
        h("div", { className: "contact-label", key: "label" }, "Email Us"),
        h("div", { className: "contact-detail", key: "detail" },
          h("a", { href: CLUB_EMAIL_LINK }, CLUB_EMAIL)),
      ]),
      h(ContactBox, { delay: 150, key: "social" }, [
        h("div", { className: "contact-icon", key: "icon" }, icon(Smartphone)),
        h("div", { className: "contact-label", key: "label" }, "Follow Us"),
        h("div", { className: "contact-detail", key: "detail" }, [
          h("a", { href: facebookUrl, key: "facebook", rel: "noopener noreferrer", target: "_blank" }, "@GreenvilleDGC on Facebook"),
          " & Instagram",
        ]),
      ]),
      h(ContactBox, { delay: 300, key: "location" }, [
        h("div", { className: "contact-icon", key: "icon" }, icon(MapPin)),
        h("div", { className: "contact-label", key: "label" }, "Location"),
        h("div", { className: "contact-detail", key: "detail" }, "Greenville, North Carolina"),
      ]),
    ]),
  ]);
}

export function HomeFooter() {
  return h("footer", { "data-react-home-footer": "ready" },
    h("p", null, "\u00a9 2026 Greenville Disc Golf Club. All rights reserved. | Greenville, NC"));
}
