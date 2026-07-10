import React from "react";
import { Menu, MoonStar, Sun, X } from "lucide-react";

const h = React.createElement;

const NAV_ITEMS = [
  { label: "Home", href: "index.html", page: "index" },
  { label: "Club Events", href: "events.html", page: "events" },
  { label: "Members", href: "gvdg-members.html", page: "gvdg-members" },
  { label: "Pro Shop", href: "pro-shop.html", page: "pro-shop" },
  { label: "Admin", href: "admin.html", page: "admin" },
];

const SESSION_KEYS = ["gvdg_member_token", "gvdg_member_name", "gvdg_member_pdga"];

function icon(Icon, size = 24) {
  return h(Icon, {
    "aria-hidden": "true",
    focusable: "false",
    size,
    strokeWidth: 2.4,
  });
}

function storedTheme() {
  try {
    const theme = localStorage.getItem("theme");
    if (theme === "dark" || theme === "light") return theme;
  } catch {
  }
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

function currentPage() {
  const path = String(window.location.pathname || "").toLowerCase();
  const basename = path.replace(/[#?].*$/, "").replace(/^.*\//, "").replace(/\.html$/, "");
  return basename === "" ? "index" : basename;
}

function AdminThemeToggle() {
  const [theme, setThemeState] = React.useState(storedTheme);

  React.useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("theme", theme);
    } catch {
    }
  }, [theme]);

  const dark = theme === "dark";
  return h("button", {
    "aria-label": dark ? "Switch to light mode" : "Switch to dark mode",
    "aria-pressed": dark ? "true" : "false",
    className: "theme-toggle",
    onClick: () => setThemeState((current) => (current === "dark" ? "light" : "dark")),
    title: dark ? "Switch to light mode" : "Switch to dark mode",
    type: "button",
  }, icon(dark ? Sun : MoonStar, 22));
}

function clearSession() {
  for (const key of SESSION_KEYS) {
    sessionStorage.removeItem(key);
  }
}

export function AdminPageChrome() {
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

  function closeMenu() {
    setMenuOpen(false);
  }

  function navLink(item) {
    const current = item.page === page;
    return h("li", { key: item.href }, h("a", {
      "aria-current": current ? "page" : undefined,
      className: current ? "active" : undefined,
      href: item.href,
      onClick: closeMenu,
    }, item.label));
  }

  function backToMembers(key) {
    return h("a", { href: "gvdg-members.html", key, onClick: closeMenu }, "Back to Members");
  }

  function logout(key) {
    return h("a", { className: "logout-link", href: "gvdg-members.html", key, onClick: clearSession }, "Log out");
  }

  return h("header", { className: scrolled ? "scrolled" : "", "data-react-admin-chrome": "true" }, h("nav", null, [
    h("a", { className: "logo", href: "index.html", key: "logo", onClick: closeMenu },
      h("img", {
        alt: "Greenville DGC Logo",
        className: "logo-image",
        height: 50,
        src: "img/logo.png",
        width: 50,
      })),
    h("ul", { className: menuOpen ? "nav-links active" : "nav-links", id: "adminNavLinks", key: "links" }, [
      ...NAV_ITEMS.map(navLink),
      h("li", { className: "nav-mobile-account", key: "mobile-members" }, backToMembers("mobile-members-link")),
      h("li", { className: "nav-mobile-account", key: "mobile-logout" }, logout("mobile-logout-link")),
    ]),
    h("div", { className: "nav-right", key: "controls" }, [
      h("div", { className: "nav-account", key: "account" }, [backToMembers("desktop-members-link"), logout("desktop-logout-link")]),
      h("button", {
        "aria-controls": "adminNavLinks",
        "aria-expanded": menuOpen ? "true" : "false",
        "aria-label": menuOpen ? "Close menu" : "Open menu",
        className: "menu-toggle",
        key: "menu",
        onClick: () => setMenuOpen((current) => !current),
        title: menuOpen ? "Close menu" : "Open menu",
        type: "button",
      }, icon(menuOpen ? X : Menu)),
      h(AdminThemeToggle, { key: "theme" }),
    ]),
  ]));
}
