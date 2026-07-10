import React from "react";

import { NAME_KEY, PDGA_KEY, TOKEN_KEY, requestJson, storageGet } from "./api.js";

let memberContext = {};

export function setMemberContext(detail = {}) {
  memberContext = {
    isAdmin: detail.isAdmin === true,
    name: detail.name || null,
    pdgaNo: detail.pdgaNo || null,
    photo: detail.photo || null,
    sub: detail.sub || null,
  };
  return readMemberContext(memberContext);
}

export function readMemberContext(detail = null) {
  const stored = memberContext;
  const source = detail || stored;
  return {
    name: source.name || stored.name || storageGet(NAME_KEY) || null,
    pdgaNo: source.pdgaNo || stored.pdgaNo || storageGet(PDGA_KEY) || null,
    photo: source.photo || stored.photo || null,
    isAdmin: source.isAdmin === true || stored.isAdmin === true,
    sub: source.sub || stored.sub || null,
  };
}

export function useMemberContext() {
  const [context, setContext] = React.useState(() => readMemberContext());

  React.useEffect(() => {
    function update(event) {
      setContext(readMemberContext(event.detail || null));
    }

    window.addEventListener("gvdg:member-profile-updated", update);
    window.addEventListener("gvdg:member-dashboard-ready", update);
    return () => {
      window.removeEventListener("gvdg:member-profile-updated", update);
      window.removeEventListener("gvdg:member-dashboard-ready", update);
    };
  }, []);

  React.useEffect(() => {
    const token = storageGet(TOKEN_KEY);
    if (!token || context.pdgaNo) return undefined;

    const controller = new AbortController();
    requestJson("/me", { signal: controller.signal, token })
      .then((profile) => {
        if (!profile || typeof profile !== "object") return;
        const next = setMemberContext({
          name: profile.name || storageGet(NAME_KEY) || null,
          pdgaNo: profile.pdgaNo || storageGet(PDGA_KEY) || null,
          photo: profile.photo || null,
          isAdmin: profile.isAdmin === true,
          sub: profile.sub || null,
        });
        setContext(next);
      })
      .catch((error) => {
        if (error.name !== "AbortError") setContext(readMemberContext());
      });

    return () => controller.abort();
  }, [context.pdgaNo]);

  return context;
}
