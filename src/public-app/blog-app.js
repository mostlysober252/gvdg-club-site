import React from "react";
import { Disc3, MoveLeft } from "lucide-react";

const h = React.createElement;

function icon(Icon, size = 18) {
  return h(Icon, {
    "aria-hidden": "true",
    focusable: "false",
    size,
    strokeWidth: 2.5,
  });
}

export function BlogApp() {
  return h(React.Fragment, null, [
    h("section", { className: "page-hero", "data-react-blog": "hero", key: "hero" },
      h("div", { className: "page-hero-content" }, [
        h("h1", { className: "page-title", key: "title" }, "Club Blog"),
        h("p", { className: "page-subtitle", key: "subtitle" },
          "News, tips, tournament recaps, and stories from the Greenville disc golf community"),
      ])),
    h("section", { className: "construction-section", "data-react-blog": "coming-soon", key: "content" },
      h("div", { className: "construction-card" }, [
        h("div", { className: "disc-icon", key: "icon" }, icon(Disc3, 72)),
        h("h2", { className: "construction-heading", key: "heading" }, [
          "Blog ",
          h("span", { key: "soon" }, "Coming Soon"),
        ]),
        h("p", { className: "construction-text", key: "text" },
          "We're working on something great! The GVDG blog will feature tournament recaps, course tips, member spotlights, and everything disc golf in Greenville. Stay tuned."),
        h("div", { className: "progress-wrap", key: "progress" }, [
          h("div", { className: "progress-label", key: "label" }, [
            h("span", { key: "name" }, "Progress"),
            h("span", { key: "value" }, "30%"),
          ]),
          h("div", { className: "progress-track", key: "track" },
            h("div", { className: "progress-fill" })),
        ]),
        h("a", { className: "back-btn", href: "index.html", key: "back" }, [
          icon(MoveLeft),
          h("span", { key: "text" }, "Back to Home"),
        ]),
      ])),
  ]);
}
