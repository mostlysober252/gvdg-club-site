import React from "react";

import { TOKEN_KEY, storageGet } from "./api.js";

export function useSessionToken() {
  const [token, setToken] = React.useState(() => storageGet(TOKEN_KEY));

  React.useEffect(() => {
    function update() {
      setToken(storageGet(TOKEN_KEY));
    }
    window.addEventListener("gvdg:member-dashboard-ready", update);
    window.addEventListener("gvdg:member-profile-updated", update);
    return () => {
      window.removeEventListener("gvdg:member-dashboard-ready", update);
      window.removeEventListener("gvdg:member-profile-updated", update);
    };
  }, []);

  return token;
}
