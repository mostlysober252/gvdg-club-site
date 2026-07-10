import React from "react";
import { Menu, MoonStar, Sun, X } from "lucide-react";

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

function PublicThemeToggle() {
  const [theme, setThemeState] = React.useState(storedTheme);

  React.useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("theme", theme);
    } catch {
    }
  }, [theme]);

  function toggleTheme() {
    setThemeState((current) => (current === "dark" ? "light" : "dark"));
  }

  const dark = theme === "dark";
  return h("button", {
    "aria-label": dark ? "Switch to light mode" : "Switch to dark mode",
    "aria-pressed": dark ? "true" : "false",
    className: "theme-toggle",
    onClick: toggleTheme,
    title: dark ? "Switch to light mode" : "Switch to dark mode",
    type: "button",
  }, icon(dark ? Sun : MoonStar, 22));
}

export function PublicPageChrome() {
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
      href: item.href,
      "aria-current": current ? "page" : undefined,
      onClick: closeMenu,
    }, item.label));
  }

  return h("header", { className: scrolled ? "scrolled" : "", "data-react-public-chrome": "true" }, h("nav", null, [
    h("a", { className: "logo", href: "index.html", key: "logo", onClick: closeMenu },
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
        onClick: closeMenu,
        rel: "noopener noreferrer",
        target: "_blank",
      }, "Donate")),
    ]),
    h("div", { className: "nav-right", key: "controls" }, [
      h(PublicThemeToggle, { key: "theme" }),
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
