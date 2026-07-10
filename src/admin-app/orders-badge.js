import React from "react";

import { currentAdminOrdersBadgeCount } from "./admin-shell-state.js";

const h = React.createElement;

export function AdminOrdersBadge() {
  const [count, setCount] = React.useState(currentAdminOrdersBadgeCount);

  React.useEffect(() => {
    function update(event) {
      setCount(Number(event.detail?.count || 0));
    }
    window.addEventListener("gvdg:admin-orders-badge", update);
    setCount(currentAdminOrdersBadgeCount());
    return () => window.removeEventListener("gvdg:admin-orders-badge", update);
  }, []);

  if (count <= 0) return null;
  return h("span", { className: "orders-badge" }, String(count));
}
