import React from "react";
import { createRoot } from "react-dom/client";
import { Moon, Trophy, UsersRound } from "lucide-react";

import { startScoreApp } from "./score-controller.js";
import { ScoreAuthFlow } from "./auth-flow.js";
import { ScorecardView } from "./scorecard-view.js";
import { ScoreSetupFlow } from "./setup-flow.js";
import { StatusView } from "./status-view.js";

if (import.meta.env.DEV && import.meta.env.VITE_DISABLE_REACT_DEVTOOLS !== "1") {
  void import("react-grab");
  void import("react-scan");
}

const h = React.createElement;
const INITIAL_SCORE_VIEW = { kind: "status", props: { mode: "loading" } };

function icon(Icon, size = 18) {
  return h(Icon, {
    key: "icon",
    size,
    strokeWidth: 2.4,
    "aria-hidden": "true",
    focusable: "false",
  });
}

function ScoreBody({ view }) {
  switch (view.kind) {
    case "auth":
      return h(ScoreAuthFlow, view.props);
    case "scorecard":
      return h(ScorecardView, view.props);
    case "setup":
      return h(ScoreSetupFlow, view.props);
    case "status":
    default:
      return h(StatusView, view.props);
  }
}

function ScoreShell() {
  const [header, setHeader] = React.useState({
    showLeaderboard: false,
    subtitle: "Greenville Disc Golf Club",
    title: "Live Scoring",
  });
  const [bodyView, setBodyView] = React.useState(INITIAL_SCORE_VIEW);
  const [darkTheme, setDarkTheme] = React.useState(() => localStorage.getItem("theme") === "dark");
  const leaderboardHandlerRef = React.useRef(null);
  const bodyController = React.useMemo(() => ({
    render(kind, props) {
      setBodyView({ kind, props });
    },
  }), []);

  React.useEffect(() => {
    startScoreApp({
      body: bodyController,
      shell: {
        setHeader(nextHeader) {
          setHeader((current) => ({ ...current, ...nextHeader }));
        },
        setLeaderboardHandler(handler) {
          leaderboardHandlerRef.current = handler;
        },
      },
    });
    return () => {
      leaderboardHandlerRef.current = null;
    };
  }, [bodyController]);

  React.useEffect(() => {
    if (darkTheme) {
      document.documentElement.setAttribute("data-theme", "dark");
      localStorage.setItem("theme", "dark");
    } else {
      document.documentElement.removeAttribute("data-theme");
      localStorage.setItem("theme", "light");
    }
  }, [darkTheme]);

  return h("div", { class: "wrap" }, [
    h("header", { class: "topbar" }, [
      h("img", { src: "img/logo.png", alt: "GVDG", class: "logo", width: 32, height: 32 }),
      h("h1", { id: "barTitle" }, [
        header.title,
        h("small", { id: "barSub", key: "subtitle" }, header.subtitle),
      ]),
      h(
        "a",
        {
          class: "top-link",
          href: "gvdg-members.html",
          "aria-label": "Return to members",
          title: "Members",
        },
        [icon(UsersRound), h("span", { class: "top-link-label", key: "label" }, "Members")],
      ),
      h(
        "button",
        {
          "aria-label": "Leaderboard",
          class: "iconbtn",
          hidden: !header.showLeaderboard,
          id: "lbBtn",
          title: "Leaderboard",
          type: "button",
          onClick: () => leaderboardHandlerRef.current?.(),
        },
        icon(Trophy),
      ),
      h(
        "button",
        {
          "aria-label": "Toggle theme",
          class: "iconbtn",
          id: "themeBtn",
          title: "Toggle theme",
          type: "button",
          onClick: () => setDarkTheme((current) => !current),
        },
        icon(Moon),
      ),
    ]),
    h("main", { id: "app" }, h(ScoreBody, { view: bodyView })),
  ]);
}

const root = document.getElementById("scoreRoot");
if (!root) {
  throw new Error("Missing scoreRoot mount element");
}

createRoot(root).render(h(ScoreShell));
