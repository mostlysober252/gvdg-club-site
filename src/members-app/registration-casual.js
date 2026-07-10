import React from "react";

import { request, requestJson } from "./api.js";
import { shortDateTime } from "./format.js";
import { memberAlert, memberConfirm } from "./member-dialogs.js";
import { localDateTimeValue } from "./registration-utils.js";

const h = React.createElement;

function useCourses(token) {
  const [state, setState] = React.useState({ status: "loading", courses: [] });

  React.useEffect(() => {
    if (!token) {
      setState({ status: "idle", courses: [] });
      return undefined;
    }
    const controller = new AbortController();
    setState({ status: "loading", courses: [] });
    requestJson("/courses", { signal: controller.signal })
      .then((data) => setState({ status: "ready", courses: Array.isArray(data.courses) ? data.courses : [] }))
      .catch((error) => {
        if (error.name !== "AbortError") setState({ status: "error", courses: [] });
      });
    return () => controller.abort();
  }, [token]);

  return state;
}

function useLayouts(courseId) {
  const [state, setState] = React.useState({ status: "idle", layouts: [] });

  React.useEffect(() => {
    if (!courseId) {
      setState({ status: "idle", layouts: [] });
      return undefined;
    }
    const controller = new AbortController();
    setState({ status: "loading", layouts: [] });
    requestJson(`/courses/${encodeURIComponent(courseId)}/layouts`, { signal: controller.signal })
      .then((data) => setState({ status: "ready", layouts: Array.isArray(data.layouts) ? data.layouts : [] }))
      .catch((error) => {
        if (error.name !== "AbortError") setState({ status: "error", layouts: [] });
      });
    return () => controller.abort();
  }, [courseId]);

  return state;
}

function CasualRoundForm({ token, onReload }) {
  const coursesState = useCourses(token);
  const courses = coursesState.courses;
  const [courseId, setCourseId] = React.useState("");
  const layoutsState = useLayouts(courseId);
  const layouts = layoutsState.layouts;
  const [layoutId, setLayoutId] = React.useState("");
  const [startsAt, setStartsAt] = React.useState(() => localDateTimeValue(Date.now() + 2 * 60 * 60 * 1000));
  const [notes, setNotes] = React.useState("");
  const [status, setStatus] = React.useState({ message: "", error: false });
  const [posting, setPosting] = React.useState(false);

  React.useEffect(() => {
    setCourseId((current) => current || (courses[0]?.id != null ? String(courses[0].id) : ""));
  }, [courses]);

  React.useEffect(() => {
    setLayoutId(layouts[0]?.id != null ? String(layouts[0].id) : "");
  }, [layouts]);

  async function submit(event) {
    event.preventDefault();
    const starts = new Date(startsAt);
    if (!courseId || !layoutId || Number.isNaN(starts.getTime())) {
      setStatus({ message: "Pick a course, layout, and time.", error: true });
      return;
    }
    setPosting(true);
    setStatus({ message: "Posting...", error: false });
    const response = await request("/casual-rounds", {
      method: "POST",
      token,
      body: { course_id: Number(courseId), layout_id: Number(layoutId), starts_at: starts.toISOString(), notes: notes.trim() || null },
    }).catch(() => null);
    setPosting(false);
    if (!response?.ok) {
      setStatus({ message: response?.status === 401 ? "Please sign in again." : "Could not post - try again.", error: true });
      return;
    }
    setNotes("");
    setStatus({ message: "Casual round posted.", error: false });
    onReload();
  }

  const unavailable = !courses.length || !layouts.length;
  const statusMessage = status.message
    || (coursesState.status === "error" ? "Courses are unavailable right now."
      : !courses.length && coursesState.status === "ready" ? "Courses are unavailable right now."
        : !layouts.length && layoutsState.status === "ready" ? "No layouts for this course."
          : "");

  return h("form", { className: "casual-form", onSubmit: submit, "data-react-casual-form": "ready" }, [
    h("label", { className: "casual-field", key: "course" }, [
      h("span", null, "Course"),
      h("select", { className: "form-input", value: courseId, onChange: (change) => setCourseId(change.target.value) },
        courses.map((course) => h("option", { value: String(course.id), key: course.id }, course.name || "Course"))),
    ]),
    h("label", { className: "casual-field", key: "layout" }, [
      h("span", null, "Layout"),
      h("select", { className: "form-input", value: layoutId, disabled: !layouts.length, onChange: (change) => setLayoutId(change.target.value) },
        layouts.map((layout) => h("option", { value: String(layout.id), key: layout.id }, layout.name || "Layout"))),
    ]),
    h("label", { className: "casual-field time", key: "time" }, [
      h("span", null, "Time"),
      h("input", {
        className: "form-input",
        type: "datetime-local",
        min: localDateTimeValue(Date.now() - 5 * 60 * 60 * 1000),
        value: startsAt,
        onChange: (change) => setStartsAt(change.target.value),
      }),
    ]),
    h("label", { className: "casual-field notes", key: "notes" }, [
      h("span", null, "Notes"),
      h("textarea", { className: "form-input casual-notes", maxLength: 800, rows: 2, placeholder: "Optional", value: notes, onChange: (change) => setNotes(change.target.value) }),
    ]),
    h("button", { type: "submit", className: "passkey-btn", disabled: posting || unavailable, key: "submit" }, posting ? "Posting..." : "Post casual round"),
    h("div", { className: `casual-status${status.error ? " error" : ""}`, role: "status", key: "status" }, statusMessage),
  ]);
}

function CasualRoundCard({ request: round, token, viewerSub, onReload }) {
  const when = shortDateTime(round.starts_at);
  const players = Array.isArray(round.players) && round.players.length ? round.players.join(", ") : "No commitments yet";
  const count = Number(round.player_count || 0);

  async function joinOrLeave() {
    const response = await request(`/casual-rounds/${encodeURIComponent(round.id)}/join`, {
      method: round.committed ? "DELETE" : "POST",
      token,
      body: round.committed ? undefined : {},
    });
    if (response.ok) onReload();
    else await memberAlert({
      message: "Casual round could not be updated.",
      title: "Round update failed",
    });
  }

  async function close() {
    const confirmed = await memberConfirm({
      cancelText: "Keep open",
      confirmText: "Close post",
      message: "This removes the casual round post from the dashboard.",
      title: "Close this casual round post?",
      tone: "danger",
    });
    if (!confirmed) return;
    const response = await request(`/casual-rounds/${encodeURIComponent(round.id)}`, { method: "DELETE", token });
    if (response.ok) onReload();
    else await memberAlert({
      message: "Casual round could not be closed.",
      title: "Close failed",
    });
  }

  return h("div", { className: "register-card casual-register-card" }, [
    h("div", { className: "register-head", key: "head" }, [
      h("span", { className: "register-name", key: "name" }, round.course_name || "Casual round"),
      when ? h("span", { className: "register-date", key: "date" }, when) : null,
    ]),
    [round.layout_name, round.course_location, round.created_by_name ? `Posted by ${round.created_by_name}` : null].filter(Boolean).length
      ? h("div", { className: "register-fee", key: "meta" }, [round.layout_name, round.course_location, round.created_by_name ? `Posted by ${round.created_by_name}` : null].filter(Boolean).join(" - "))
      : null,
    round.notes ? h("div", { className: "casual-register-note", key: "note" }, round.notes) : null,
    h("div", { className: "casual-register-players", key: "players" }, `${count} ${count === 1 ? "player" : "players"} in - ${players}`),
    h("div", { className: "register-actions", key: "actions" }, [
      h("button", { type: "button", className: "passkey-btn", onClick: joinOrLeave, key: "join" }, round.committed ? "Leave casual round" : "Join casual round"),
      viewerSub && round.created_by === viewerSub ? h("button", { type: "button", className: "board-link danger", onClick: close, key: "close" }, "Close") : null,
    ]),
  ]);
}

export function CasualRoundsSection({ token, requests, viewerSub, onReload }) {
  return h(React.Fragment, null, [
    h("h4", { className: "register-subhead", key: "title" }, "Casual rounds"),
    h(CasualRoundForm, { token, onReload, key: "form" }),
    ...requests.map((requestItem) => h(CasualRoundCard, { request: requestItem, token, viewerSub, onReload, key: `casual-${requestItem.id}` })),
  ]);
}
