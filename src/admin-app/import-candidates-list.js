import React from "react";

const h = React.createElement;

const EMPTY_STATE = { status: "idle", candidates: [] };

function objectOrEmpty(value) {
  return value && typeof value === "object" ? value : {};
}

function normalizeText(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function normalizeCandidate(candidate, index) {
  const source = objectOrEmpty(candidate);
  const name = normalizeText(source.name);
  const date = normalizeText(source.date);
  const type = normalizeText(source.type, "event") || "event";
  return {
    date,
    key: `${name || "candidate"}-${date || "no-date"}-${index}`,
    name,
    source,
    type,
  };
}

function normalizeState(state) {
  return {
    candidates: Array.isArray(state.candidates) ? state.candidates.map(normalizeCandidate) : [],
    status: state.status === "loading" ? "loading" : state.status === "ready" ? "ready" : "idle",
  };
}

function candidateLabel(candidate) {
  return `${candidate.name || "?"}${candidate.date ? ` (${candidate.date})` : ""} [${candidate.type}]`;
}

function dispatchRequest(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

export function AdminImportCandidatesList() {
  const [state, setState] = React.useState(() => normalizeState(EMPTY_STATE));
  const [actions, setActions] = React.useState({});
  const requestCounter = React.useRef(0);

  React.useEffect(() => {
    function update(event) {
      setState(normalizeState(event.detail && typeof event.detail === "object" ? event.detail : EMPTY_STATE));
      setActions({});
    }
    window.addEventListener("gvdg:admin-import-candidates", update);
    return () => window.removeEventListener("gvdg:admin-import-candidates", update);
  }, []);

  React.useEffect(() => {
    function updateAction(event) {
      const detail = objectOrEmpty(event.detail);
      const requestId = normalizeText(detail.requestId);
      if (!requestId) return;
      setActions((current) => ({ ...current, [requestId]: detail.ok === true ? "created" : "failed" }));
    }
    window.addEventListener("gvdg:admin-import-candidate-create-result", updateAction);
    return () => window.removeEventListener("gvdg:admin-import-candidate-create-result", updateAction);
  }, []);

  if (state.status === "idle") return null;
  if (state.status === "loading") {
    return h("p", { className: "dash-note", "data-react-admin-import-candidates": "loading", role: "status" }, "Loading candidates...");
  }
  if (!state.candidates.length) {
    return h("p", { className: "dash-note", "data-react-admin-import-candidates": "empty", role: "status" }, "No candidates found.");
  }

  function requestCreate(candidate) {
    const requestId = `${candidate.key}-${requestCounter.current += 1}`;
    setActions((current) => ({ ...current, [requestId]: "creating" }));
    dispatchRequest("gvdg:admin-import-candidate-create-request", { candidate: candidate.source, requestId });
  }

  function actionState(candidate) {
    const current = Object.entries(actions).find(([requestId]) => requestId.startsWith(`${candidate.key}-`));
    return current ? current[1] : "idle";
  }

  return h("div", { "data-react-admin-import-candidates": "ready" }, state.candidates.map((candidate) => {
    const status = actionState(candidate);
    const busy = status === "creating";
    return h("div", { className: "admin-cand", key: candidate.key }, [
      h("span", { key: "label" }, candidateLabel(candidate)),
      h("button", {
        className: "admin-btn secondary",
        disabled: busy || status === "created" || status === "failed" || !candidate.name,
        key: "create",
        onClick: () => requestCreate(candidate),
        type: "button",
      }, busy ? "Creating..." : status === "created" ? "Created" : status === "failed" ? "Failed" : "Create"),
    ]);
  }));
}
