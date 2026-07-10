import React from "react";
import { createRoot } from "react-dom/client";
import { AlertTriangle, WifiOff } from "lucide-react";

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

function ToastItem(props) {
  const toast = props.toast;
  const className = [
    "toast",
    toast.variant === "conflict" ? "conflict" : "",
    toast.variant === "conflict" && props.offline ? "with-offline" : "",
    toast.visible ? "" : "is-hiding",
  ]
    .filter(Boolean)
    .join(" ");
  return h(
    "div",
    {
      className,
      key: toast.id,
      role: toast.variant === "conflict" ? "alert" : "status",
      onClick: () => props.onDismiss(toast.id),
    },
    [toast.variant === "conflict" ? icon(AlertTriangle) : null, h("span", { key: "message" }, toast.message)],
  );
}

function ScoreNotifications(props) {
  return h(React.Fragment, null, [
    props.offline
      ? h("div", { className: "offline-bar", key: "offline", role: "status" }, [
          icon(WifiOff),
          h("span", { key: "message" }, "Offline - scores sync when reconnected"),
        ])
      : null,
    props.toasts.map((toast) => h(ToastItem, { key: toast.id, offline: props.offline, toast, onDismiss: props.onDismiss })),
  ]);
}

export function createScoreNotificationsRenderer() {
  let root = null;
  let host = null;
  let nextId = 1;
  let offline = false;
  let toasts = [];

  function mount() {
    if (!host) {
      host = document.getElementById("scoreReactNotificationsApp");
      if (!host) throw new Error("Missing scoreReactNotificationsApp mount element");
    }
    if (!root) root = createRoot(host);
    return root;
  }

  function render() {
    mount().render(h(ScoreNotifications, { offline, toasts, onDismiss: dismiss }));
  }

  function remove(id) {
    toasts = toasts.filter((toast) => toast.id !== id);
    render();
  }

  function hide(id) {
    toasts = toasts.map((toast) => (toast.id === id ? { ...toast, visible: false } : toast));
    render();
  }

  function dismiss(id) {
    hide(id);
    window.setTimeout(() => remove(id), 300);
  }

  function show(message, options = {}) {
    const id = nextId++;
    const hideAfter = options.hideAfter == null ? 1800 : options.hideAfter;
    const removeAfter = options.removeAfter == null ? hideAfter + 400 : options.removeAfter;
    toasts = toasts.concat({
      id,
      message,
      variant: options.variant || "default",
      visible: true,
    });
    render();
    window.setTimeout(() => hide(id), hideAfter);
    window.setTimeout(() => remove(id), removeAfter);
    return id;
  }

  return {
    showToast(message) {
      return show(message);
    },
    showConflict(message) {
      return show(message, { hideAfter: 6500, removeAfter: 7100, variant: "conflict" });
    },
    setOnline(online) {
      offline = !online;
      render();
    },
    clear() {
      offline = false;
      toasts = [];
      render();
    },
  };
}
