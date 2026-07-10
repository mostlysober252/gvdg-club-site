import React from "react";
import { ArrowLeft, ChevronRight, LogOut, PlayCircle } from "lucide-react";

const h = React.createElement;

function icon(Icon, props = {}) {
  return h(Icon, {
    key: props.key || "icon",
    size: props.size || 18,
    strokeWidth: 2.4,
    "aria-hidden": "true",
    focusable: "false",
  });
}

function BackButton({ onBack }) {
  return h(
    "button",
    { className: "btn ghost small", type: "button", onClick: onBack },
    [icon(ArrowLeft, { size: 16 }), "Back"],
  );
}

function HomeView({ onStart, onJoin, onInvalidCode, onSignOut }) {
  const [joinCode, setJoinCode] = React.useState("");
  const submitJoin = () => {
    const code = joinCode.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (code.length >= 4) onJoin(code);
    else onInvalidCode();
  };

  return h("div", { className: "stack" }, [
    h("div", { className: "card stack", key: "card" }, [
      h("h2", { className: "section", key: "title" }, "Keep score"),
      h(
        "p",
        { className: "muted", key: "copy" },
        "Start a casual round and share the code with your card, or join a round someone already started.",
      ),
      h(
        "button",
        { className: "btn", type: "button", onClick: onStart, key: "start" },
        [icon(PlayCircle), "Start a casual round"],
      ),
      h("label", { className: "lbl", htmlFor: "joinRoundCode", key: "joinLabel" }, "Join with a code"),
      h("input", {
        className: "field",
        id: "joinRoundCode",
        key: "joinInput",
        value: joinCode,
        placeholder: "e.g. K7M2QX",
        autoCapitalize: "characters",
        maxLength: 8,
        onChange: (event) => setJoinCode(event.target.value),
        onKeyDown: (event) => {
          if (event.key === "Enter") submitJoin();
        },
      }),
      h(
        "button",
        { className: "btn secondary", type: "button", onClick: submitJoin, key: "joinButton" },
        "Join round",
      ),
    ]),
    h(
      "button",
      { className: "btn ghost", type: "button", onClick: onSignOut, key: "signOut" },
      [icon(LogOut), "Sign out"],
    ),
  ]);
}

function CoursePickView({ courses, onBack, onSelect }) {
  return h("div", { className: "stack" }, [
    h(BackButton, { onBack, key: "back" }),
    h("h2", { className: "section", key: "title" }, "Pick a course"),
    courses.length
      ? courses.map((course) =>
          h(
            "button",
            { className: "tap-row", type: "button", key: course.id || course.name, onClick: () => onSelect(course) },
            [
              h("div", { className: "grow", key: "content" }, [
                h("div", { className: "title", key: "title" }, course.name),
                course.location ? h("div", { className: "sub", key: "sub" }, course.location) : null,
              ]),
              h("div", { className: "chev", key: "chev" }, icon(ChevronRight)),
            ],
          ),
        )
      : h("p", { className: "muted", key: "empty" }, "No courses found."),
  ]);
}

function LayoutPickView({ course, layouts, onBack, onSelect }) {
  return h("div", { className: "stack" }, [
    h(BackButton, { onBack, key: "back" }),
    h("h2", { className: "section", key: "title" }, course.name),
    layouts.length
      ? layouts.map((layout) =>
          h(
            "button",
            { className: "tap-row", type: "button", key: layout.id || layout.name, onClick: () => onSelect(layout) },
            [
              h("div", { className: "grow", key: "content" }, [
                h("div", { className: "title", key: "title" }, layout.name || "Layout"),
                h("div", { className: "sub", key: "sub" }, layout.total_par != null ? `Par ${layout.total_par}` : ""),
              ]),
              h("div", { className: "chev", key: "chev" }, icon(ChevronRight)),
            ],
          ),
        )
      : h(
          "p",
          { className: "muted", key: "empty" },
          "This course has no scorable layouts yet - an admin can add one from Admin > Layouts, or import from UDisc.",
        ),
  ]);
}

const OPTION_GROUPS = [
  {
    key: "groupFormat",
    label: "Group format",
    attr: "data-group-format",
    options: [
      { value: "singles", title: "Singles", sub: "One score per player" },
      { value: "doubles", title: "Doubles", sub: "One score per pair" },
    ],
  },
  {
    key: "scoringStyle",
    label: "Scoring style",
    attr: "data-scoring-style",
    options: [
      { value: "stroke", title: "Stroke play", sub: "Lowest total wins" },
      { value: "matchplay", title: "Match play", sub: "Win holes head to head" },
    ],
  },
];

function SetupPickView({ layout, defaultConfig, onBack, onCreate }) {
  const [selected, setSelected] = React.useState(defaultConfig);

  return h("div", { className: "stack" }, [
    h(BackButton, { onBack, key: "back" }),
    h("div", { className: "card stack", "data-score-setup": "casual-format", key: "intro" }, [
      h("span", { className: "pill", key: "pill" }, layout && layout.name ? layout.name : "Layout"),
      h("h2", { className: "section", key: "title" }, "Round setup"),
      h(
        "p",
        { className: "muted", key: "copy" },
        "Choose how this casual card is scored. Defaults are ready for a standard singles stroke round.",
      ),
    ]),
    ...OPTION_GROUPS.map((group) =>
      h("div", { className: "card stack", key: group.key }, [
        h("label", { className: "lbl", key: "label" }, group.label),
        h(
          "div",
          { className: "setup-grid", key: "grid" },
          group.options.map((option) => {
            const pressed = selected[group.key] === option.value;
            return h(
              "button",
              {
                className: "setup-option",
                type: "button",
                key: option.value,
                "aria-pressed": pressed ? "true" : "false",
                [group.attr]: option.value,
                onClick: () => setSelected((current) => ({ ...current, [group.key]: option.value })),
              },
              [
                h("span", { className: "title", key: "title" }, option.title),
                h("span", { className: "sub", key: "sub" }, option.sub),
              ],
            );
          }),
        ),
      ]),
    ),
    h(
      "button",
      {
        className: "btn",
        type: "button",
        "data-create-round": "casual",
        onClick: () => onCreate(selected),
        key: "create",
      },
      "Start round",
    ),
  ]);
}

export function ScoreSetupFlow(props) {
  switch (props.view) {
    case "home":
      return h(HomeView, props);
    case "coursePick":
      return h(CoursePickView, props);
    case "layoutPick":
      return h(LayoutPickView, props);
    case "setupPick":
      return h(SetupPickView, props);
    default:
      return null;
  }
}
