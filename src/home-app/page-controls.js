import React from "react";
import { ArrowUp, MoonStar, Sun } from "lucide-react";

const h = React.createElement;

function icon(Icon, props = {}) {
  return h(Icon, {
    ...props,
    "aria-hidden": "true",
    focusable: "false",
    size: props.size || 20,
    strokeWidth: props.strokeWidth || 2.4,
  });
}

function storedTheme() {
  try {
    return localStorage.getItem("theme") === "dark" ? "dark" : "light";
  } catch {
    return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  }
}

function persistTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem("theme", theme);
  } catch {
    return;
  }
}

export function HomeThemeToggle() {
  const [theme, setTheme] = React.useState(storedTheme);
  const isDark = theme === "dark";

  React.useEffect(() => {
    persistTheme(theme);
  }, [theme]);

  return h(
    "button",
    {
      className: "theme-toggle",
      type: "button",
      "aria-label": isDark ? "Switch to light mode" : "Switch to dark mode",
      "aria-pressed": isDark ? "true" : "false",
      onClick: () => setTheme((current) => (current === "dark" ? "light" : "dark")),
    },
    icon(isDark ? Sun : MoonStar, { size: 22 }),
  );
}

export function HomeBackToTop() {
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    let ticking = false;
    function update() {
      setVisible(window.scrollY > 600);
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

  return h(
    "button",
    {
      className: "back-to-top" + (visible ? " visible" : ""),
      type: "button",
      "aria-label": "Back to top",
      onClick: () => window.scrollTo({ top: 0, behavior: "smooth" }),
    },
    icon(ArrowUp, { size: 22 }),
  );
}
