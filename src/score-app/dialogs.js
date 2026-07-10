import React from "react";
import { createRoot } from "react-dom/client";
import { AlertTriangle, UserPlus } from "lucide-react";

const h = React.createElement;

function icon(Icon) {
  return h(Icon, {
    key: "icon",
    size: 20,
    strokeWidth: 2.4,
    "aria-hidden": "true",
    focusable: "false",
  });
}

function ScoreDialog(props) {
  const dialog = props.dialog;
  const titleId = React.useId();
  const bodyId = React.useId();
  const inputRef = React.useRef(null);
  const [value, setValue] = React.useState(dialog.initialValue || "");
  const [error, setError] = React.useState("");
  const isPrompt = dialog.kind === "prompt";

  React.useEffect(() => {
    if (isPrompt) inputRef.current?.focus();
    function onKeyDown(event) {
      if (event.key === "Escape") props.onResolve(isPrompt ? null : false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isPrompt, props.onResolve]);

  function cancel() {
    props.onResolve(isPrompt ? null : false);
  }

  function submit(event) {
    event.preventDefault();
    if (!isPrompt) {
      props.onResolve(true);
      return;
    }
    const nextValue = dialog.trim === false ? value : value.trim();
    if (dialog.required && !nextValue) {
      setError(dialog.errorText || "This field is required.");
      return;
    }
    props.onResolve(nextValue);
  }

  return h(
    "div",
    {
      className: "overlay score-dialog-overlay",
      onClick: (event) => {
        if (event.target === event.currentTarget) cancel();
      },
    },
    h(
      "form",
      {
        "aria-describedby": bodyId,
        "aria-labelledby": titleId,
        "aria-modal": "true",
        className: "sheet score-dialog",
        role: "dialog",
        onSubmit: submit,
      },
      [
        h("div", { className: "score-dialog-icon" + (dialog.danger ? " danger" : ""), key: "icon" }, icon(dialog.danger ? AlertTriangle : UserPlus)),
        h("h2", { className: "section", id: titleId, key: "title" }, dialog.title),
        dialog.message ? h("p", { className: "muted", id: bodyId, key: "message" }, dialog.message) : null,
        isPrompt
          ? h("label", { className: "lbl score-dialog-field", key: "field" }, [
              h("span", { key: "label" }, dialog.label || "Value"),
              h("input", {
                className: "field",
                key: "input",
                maxLength: dialog.maxLength || 60,
                placeholder: dialog.placeholder || "",
                ref: inputRef,
                value,
                onChange: (event) => {
                  setValue(event.target.value);
                  if (error) setError("");
                },
              }),
            ])
          : null,
        error ? h("p", { className: "muted auth-error", key: "error", role: "alert" }, error) : null,
        h("div", { className: "score-dialog-actions", key: "actions" }, [
          h("button", { className: "btn secondary", key: "cancel", type: "button", onClick: cancel }, dialog.cancelText || "Cancel"),
          h(
            "button",
            { className: "btn" + (dialog.danger ? " danger" : ""), key: "confirm", type: "submit" },
            dialog.confirmText || (isPrompt ? "Continue" : "Confirm"),
          ),
        ]),
      ],
    ),
  );
}

export function createScoreDialogRenderer() {
  let host = null;
  let root = null;
  let activeResolve = null;

  function mount() {
    if (!host) {
      host = document.getElementById("scoreReactDialogsApp");
      if (!host) throw new Error("Missing scoreReactDialogsApp mount element");
    }
    if (!root) root = createRoot(host);
    return root;
  }

  function resolve(result) {
    const done = activeResolve;
    activeResolve = null;
    mount().render(null);
    if (done) done(result);
  }

  function ask(dialog) {
    if (activeResolve) resolve(dialog.kind === "prompt" ? null : false);
    return new Promise((promiseResolve) => {
      activeResolve = promiseResolve;
      mount().render(h(ScoreDialog, { dialog, onResolve: resolve }));
    });
  }

  return {
    confirm(options) {
      return ask({ ...(options || {}), kind: "confirm" });
    },
    prompt(options) {
      return ask({ ...(options || {}), kind: "prompt" });
    },
    clear() {
      if (activeResolve) resolve(null);
      else if (root) root.render(null);
    },
  };
}
