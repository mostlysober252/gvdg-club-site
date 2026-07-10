import React from "react";
import { Menu, X } from "lucide-react";

import { HomeThemeToggle } from "./page-controls.js";

const h = React.createElement;

const NAV_ITEMS = [
  { label: "Home", href: "index.html", page: "index" },
  { label: "Events", href: "events.html", page: "events" },
  { label: "Ryder Cup", href: "ryder-cup.html", page: "ryder-cup" },
  { label: "Pro Shop", href: "pro-shop.html", page: "pro-shop" },
  { label: "Blog", href: "gvdg-blog.html", page: "gvdg-blog" },
  { label: "Members", href: "gvdg-members.html", page: "gvdg-members" },
];

const DONATE_URL = "https://www.paypal.com/paypalme/greenvillediscgolf";

function icon(Icon) {
  return h(Icon, {
    "aria-hidden": "true",
    focusable: "false",
    size: 24,
    strokeWidth: 2.4,
  });
}

function currentPage() {
  const path = String(window.location.pathname || "").toLowerCase();
  const basename = path.replace(/[#?].*$/, "").replace(/^.*\//, "").replace(/\.html$/, "");
  return basename === "" ? "index" : basename;
}

export function HomePageChrome() {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [scrolled, setScrolled] = React.useState(false);
  const page = currentPage();

  React.useEffect(() => {
    let ticking = false;
    function update() {
      setScrolled(window.scrollY > 100);
      ticking = false;
    }
    function handleScroll() {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(update);
    }
    window.addEventListener("scroll", handleScroll, { passive: true });
    update();
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  function navLink(item) {
    const current = item.page === page;
    return h("li", { key: item.href }, h("a", {
      href: item.href,
      "aria-current": current ? "page" : undefined,
      onClick: () => setMenuOpen(false),
    }, item.label));
  }

  return h("header", { className: scrolled ? "scrolled" : "", "data-react-home-chrome": "true" }, h("nav", null, [
    h("a", { className: "logo", href: "#", key: "logo", onClick: () => setMenuOpen(false) },
      h("img", {
        alt: "Greenville DGC Logo",
        className: "logo-image",
        height: 50,
        src: "img/logo.png",
        width: 50,
      })),
    h("ul", { className: menuOpen ? "nav-links active" : "nav-links", id: "navLinks", key: "links" }, [
      ...NAV_ITEMS.map(navLink),
      h("li", { key: "donate" }, h("a", {
        className: "nav-donate",
        href: DONATE_URL,
        onClick: () => setMenuOpen(false),
        rel: "noopener noreferrer",
        target: "_blank",
      }, "Donate")),
    ]),
    h("div", { className: "nav-right", key: "controls" }, [
      h(HomeThemeToggle, { key: "theme" }),
      h("button", {
        "aria-controls": "navLinks",
        "aria-expanded": menuOpen ? "true" : "false",
        "aria-label": menuOpen ? "Close menu" : "Open menu",
        className: "menu-toggle",
        key: "menu",
        onClick: () => setMenuOpen((current) => !current),
        title: menuOpen ? "Close menu" : "Open menu",
        type: "button",
      }, icon(menuOpen ? X : Menu)),
    ]),
  ]));
}
