import React from "react";
import { RotateCw, Trophy } from "lucide-react";

const h = React.createElement;

function icon(Icon) {
  return h(Icon, {
    key: "icon",
    size: 18,
    strokeWidth: 2.4,
    "aria-hidden": "true",
    focusable: "false",
  });
}

function LoadingView() {
  return h("div", { className: "center", "aria-label": "Loading scorecard", role: "status" }, h("div", { className: "spin" }));
}

function MessageView(props) {
  return h("div", { className: "card center stack" }, [
    h("h2", { className: "section", key: "title" }, props.title),
    props.sub ? h("p", { className: "muted", key: "sub" }, props.sub) : null,
    props.withRetry
      ? h("button", { className: "btn", key: "retry", type: "button", onClick: props.onRetry }, [icon(RotateCw), "Try again"])
      : null,
    h("button", { className: "btn secondary", key: "leaderboard", type: "button", onClick: props.onLeaderboard }, [
      icon(Trophy),
      "View live leaderboard",
    ]),
  ]);
}

export function StatusView(props) {
  if (props.mode === "loading") return h(LoadingView);
  return h(MessageView, props);
}
