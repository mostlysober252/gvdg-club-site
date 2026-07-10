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
      title: options.title || "Confirm action",
      message: options.message || "",
      confirmText: options.confirmText || "Confirm",
      cancelText: options.cancelText || "Cancel",
      danger: options.danger === true,
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

export function adminConfirm(options) {
  return requestDialog(options || {});
}

export function AdminDialogs() {
  const [dialog, setDialog] = React.useState(activeDialog);
  const confirmRef = React.useRef(null);

  React.useEffect(() => {
    subscribers.add(setDialog);
    setDialog(activeDialog);
    return () => subscribers.delete(setDialog);
  }, []);

  React.useEffect(() => {
    if (!dialog) return undefined;
    confirmRef.current?.focus();
    function onKeyDown(event) {
      if (event.key === "Escape") settle(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dialog]);

  if (!dialog) return null;
  const titleId = `adminDialogTitle-${dialog.id}`;
  const bodyId = `adminDialogBody-${dialog.id}`;
  const confirmClass = `admin-btn admin-dialog-btn${dialog.danger ? " danger-strong" : ""}`;

  return h("div", {
    className: "admin-dialog-overlay",
    onClick: (event) => {
      if (event.target === event.currentTarget) settle(false);
    },
    role: "presentation",
  }, h("div", {
    "aria-describedby": bodyId,
    "aria-labelledby": titleId,
    "aria-modal": "true",
    className: `admin-dialog${dialog.danger ? " danger" : ""}`,
    role: "dialog",
  }, [
    h("h2", { className: "admin-dialog-title", id: titleId, key: "title" }, dialog.title),
    h("p", { className: "admin-dialog-message", id: bodyId, key: "message" }, dialog.message),
    h("div", { className: "admin-dialog-actions", key: "actions" }, [
      h("button", { className: "admin-btn secondary admin-dialog-btn", key: "cancel", onClick: () => settle(false), type: "button" }, dialog.cancelText),
      h("button", { className: confirmClass, key: "confirm", onClick: () => settle(true), ref: confirmRef, type: "button" }, dialog.confirmText),
    ]),
  ]));
}
