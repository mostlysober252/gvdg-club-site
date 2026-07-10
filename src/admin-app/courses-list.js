import React from "react";

const h = React.createElement;

const EMPTY_STATE = { courses: [] };

function courseLabel(course) {
  const name = typeof course.name === "string" && course.name ? course.name : "Untitled course";
  return course.location ? `${name} — ${course.location}` : name;
}

function normalizeCourse(course) {
  const source = course && typeof course === "object" ? course : {};
  return {
    id: source.id == null ? "" : String(source.id),
    label: courseLabel(source),
  };
}

function normalizeState(state) {
  return {
    courses: Array.isArray(state.courses) ? state.courses.map(normalizeCourse) : [],
  };
}

export function AdminCoursesList() {
  const [state, setState] = React.useState(() => normalizeState(EMPTY_STATE));

  React.useLayoutEffect(() => {
    function update(event) {
      setState(normalizeState(event.detail && typeof event.detail === "object" ? event.detail : EMPTY_STATE));
    }
    window.addEventListener("gvdg:admin-courses-list", update);
    return () => window.removeEventListener("gvdg:admin-courses-list", update);
  }, []);

  if (!state.courses.length) {
    return h("div", { "data-react-admin-courses-list": "empty" });
  }

  return h("div", { "data-react-admin-courses-list": "ready" }, state.courses.map((course, index) => (
    h("div", { className: "admin-cand", key: course.id || `${course.label}-${index}` }, course.label)
  )));
}
