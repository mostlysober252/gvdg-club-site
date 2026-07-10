import React from "react";
import { Menu, Moon, Sun, X } from "lucide-react";

import { localStorageGet } from "./api.js";

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

function icon(Icon, size = 22) {
  return h(Icon, {
    size,
    strokeWidth: 2.3,
    "aria-hidden": "true",
    focusable: "false",
  });
}

function storedThemeIsDark() {
  const stored = localStorageGet("theme");
  if (stored === "dark") return true;
  if (stored === "light") return false;
  return document.documentElement.getAttribute("data-theme") === "dark";
}

function currentPage() {
  const path = String(window.location.pathname || "").toLowerCase();
  const basename = path.replace(/[#?].*$/, "").replace(/^.*\//, "").replace(/\.html$/, "");
  return basename === "" ? "index" : basename;
}

function storeTheme(theme) {
  try {
    localStorage.setItem("theme", theme);
    return true;
  } catch {
    return false;
  }
}

export function MemberPageChrome() {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [darkTheme, setDarkTheme] = React.useState(storedThemeIsDark);
  const page = currentPage();

  React.useEffect(() => {
    const nextTheme = darkTheme ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", nextTheme);
    storeTheme(nextTheme);
  }, [darkTheme]);

  function navLink(item) {
    const current = item.page === page;
    return h("li", { key: item.href }, h("a", {
      href: item.href,
      "aria-current": current ? "page" : undefined,
      onClick: () => setMenuOpen(false),
    }, item.label));
  }

  return h("header", { "data-react-page-chrome": "true" }, h("nav", null, [
    h("a", { className: "logo", href: "index.html", key: "logo", onClick: () => setMenuOpen(false) },
      h("img", {
        alt: "Greenville DGC Logo",
        className: "logo-image",
        height: 50,
        src: "img/logo.png",
        width: 50,
      })),
    h("div", { className: "nav-right", key: "nav" }, [
      h("button", {
        "aria-controls": "navLinks",
        "aria-expanded": menuOpen ? "true" : "false",
        "aria-label": menuOpen ? "Close menu" : "Open menu",
        className: "menu-toggle",
        key: "menu",
        onClick: () => setMenuOpen((current) => !current),
        title: menuOpen ? "Close menu" : "Open menu",
        type: "button",
      }, icon(menuOpen ? X : Menu, 24)),
      h("ul", {
        className: menuOpen ? "nav-links active" : "nav-links",
        id: "navLinks",
        key: "links",
      }, [
        ...NAV_ITEMS.map(navLink),
        h("li", { key: "donate" }, h("a", {
          className: "nav-donate",
          href: DONATE_URL,
          onClick: () => setMenuOpen(false),
          rel: "noopener noreferrer",
          target: "_blank",
        }, "Donate")),
      ]),
      h("button", {
        "aria-label": darkTheme ? "Switch to light mode" : "Switch to dark mode",
        className: "theme-toggle",
        key: "theme",
        onClick: () => setDarkTheme((current) => !current),
        title: darkTheme ? "Switch to light mode" : "Switch to dark mode",
        type: "button",
      }, icon(darkTheme ? Sun : Moon, 20)),
    ]),
  ]));
}
