import React from "react";
import { createRoot } from "react-dom/client";
import { MoonStar, Sun } from "lucide-react";

import { TeeSignSvg } from "../shared/tee-sign-svg.js";

const h = React.createElement;
const THEME_KEY = "theme";

const SAMPLES = Object.freeze([
  {
    hole: 1,
    courseName: "Battle Park",
    layouts: [
      { label: "Long", color: "blue", par: 4, distance_ft: 420 },
      { label: "Short", color: "white", par: 3, distance_ft: 285 },
    ],
  },
  {
    hole: 7,
    courseName: "West Meadowbrook",
    layouts: [
      { label: "Gold", color: "gold", par: 5, distance_ft: 615 },
      { label: "Blue", color: "blue", par: 4, distance_ft: 480 },
      { label: "Red", color: "red", par: 3, distance_ft: 300 },
    ],
  },
  {
    hole: 12,
    courseName: "No data yet",
    layouts: [{ label: "Main", par: null, distance_ft: null }],
  },
]);

if (import.meta.env.DEV && import.meta.env.VITE_DISABLE_REACT_DEVTOOLS !== "1") {
  import("react-scan").then(({ scan }) => scan({ enabled: true })).catch(() => {});
}

function storedTheme() {
  try {
    const theme = localStorage.getItem(THEME_KEY);
    if (theme === "dark" || theme === "light") return theme;
  } catch {
  }
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

function Icon({ dark }) {
  const Component = dark ? Sun : MoonStar;
  return h(Component, {
    "aria-hidden": "true",
    focusable: "false",
    size: 18,
    strokeWidth: 2.4,
  });
}

function TeeSignGraphic({ sample }) {
  return h("div", {
    "aria-label": `Preview for hole ${sample.hole}`,
    className: "tee-preview-sample",
  }, h(TeeSignSvg, {
    courseName: sample.courseName,
    hole: sample.hole,
    layouts: sample.layouts,
  }));
}

export function TeeSignPreviewApp() {
  const [theme, setTheme] = React.useState(storedTheme);
  const dark = theme === "dark";

  React.useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
    }
  }, [theme]);

  return h("main", { className: "tee-preview", "data-react-tee-sign-preview": theme }, [
    h("div", { className: "tee-preview-head", key: "head" }, [
      h("h1", { className: "tee-preview-title", key: "title" }, "Tee-sign preview"),
      h("button", {
        "aria-label": dark ? "Switch to light mode" : "Switch to dark mode",
        "aria-pressed": dark ? "true" : "false",
        className: "tee-preview-toggle",
        key: "toggle",
        onClick: () => setTheme((current) => (current === "dark" ? "light" : "dark")),
        type: "button",
      }, [
        h(Icon, { dark, key: "icon" }),
        h("span", { key: "label" }, dark ? "Light" : "Dark"),
      ]),
    ]),
    h("div", { className: "tee-preview-grid", key: "grid" },
      SAMPLES.map((sample) => h(TeeSignGraphic, { key: `${sample.courseName}-${sample.hole}`, sample }))),
  ]);
}

const mount = document.getElementById("teeSignPreviewReactApp");
if (mount) {
  createRoot(mount).render(h(TeeSignPreviewApp));
}
