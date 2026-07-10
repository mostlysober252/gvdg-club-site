import React from "react";

const h = React.createElement;
const subscribers = new Set();
const queue = [];
let activeDialog = null;
let nextId = 1;

function notify() {
  subscribers.forEach((subscriber) => subscriber(activeDialog));
}

function pumpQueue() {
  if (activeDialog || !queue.length) return;
  activeDialog = queue.shift();
  notify();
}

function requestDialog(options) {
  return new Promise((resolve) => {
    queue.push({
      id: nextId++,
      resolve,
      type: options.type || "alert",
      tone: options.tone || "",
      title: options.title || "Notice",
      message: options.message || "",
      confirmText: options.confirmText || "OK",
      cancelText: options.cancelText || "Cancel",
    });
    pumpQueue();
  });
}

function settle(value) {
  const dialog = activeDialog;
  if (!dialog) return;
  activeDialog = null;
  notify();
  dialog.resolve(value);
  pumpQueue();
}

export function memberAlert(options) {
  return requestDialog({ ...options, type: "alert" });
}

export function memberConfirm(options) {
  return requestDialog({ ...options, type: "confirm" });
}

export function MemberDialogs() {
  const [dialog, setDialog] = React.useState(activeDialog);

  React.useEffect(() => {
    subscribers.add(setDialog);
    setDialog(activeDialog);
    return () => subscribers.delete(setDialog);
  }, []);

  React.useEffect(() => {
    if (!dialog) return undefined;
    function onKeyDown(event) {
      if (event.key === "Escape") settle(dialog.type === "confirm" ? false : true);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dialog]);

  if (!dialog) return null;
  const titleId = `memberDialogTitle-${dialog.id}`;
  const bodyId = `memberDialogBody-${dialog.id}`;
  const confirmClass = `member-dialog-btn primary${dialog.tone === "danger" ? " danger" : ""}`;

  return h("div", {
    className: "member-dialog-overlay active",
    role: "presentation",
    onClick: (event) => {
      if (event.currentTarget === event.target) settle(dialog.type === "confirm" ? false : true);
    },
  }, h("div", {
    className: `member-dialog${dialog.tone ? ` ${dialog.tone}` : ""}`,
    role: "dialog",
    "aria-modal": "true",
    "aria-labelledby": titleId,
    "aria-describedby": bodyId,
  }, [
    h("div", { className: "member-dialog-title", id: titleId, key: "title" }, dialog.title),
    h("p", { className: "member-dialog-message", id: bodyId, key: "message" }, dialog.message),
    h("div", { className: "member-dialog-actions", key: "actions" }, [
      dialog.type === "confirm"
        ? h("button", { type: "button", className: "member-dialog-btn secondary", onClick: () => settle(false), key: "cancel" }, dialog.cancelText)
        : null,
      h("button", { type: "button", className: confirmClass, onClick: () => settle(true), key: "confirm" }, dialog.confirmText),
    ]),
  ]));
}
