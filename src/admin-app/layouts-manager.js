import React from "react";

import { AdminLayoutBuilder } from "./layouts-builder.js";
import { newHoleRow, normalizeCourse, normalizeLayout, rowFromHole } from "./layouts-model.js";
import { AdminLayoutPositionPool, AdminLayoutsList, AdminLayoutUdiscImport } from "./layouts-sections.js";

const h = React.createElement;

const EMPTY_COURSES_STATE = { courses: [] };
const EMPTY_LAYOUTS_STATE = { courseId: "", layouts: [], positions: [], status: "idle" };
const REQUEST_EVENTS = {
  addPosition: "gvdg:admin-course-layout-position-add-request",
  applyUdisc: "gvdg:admin-course-layout-udisc-apply-request",
  deleteLayout: "gvdg:admin-course-layout-delete-request",
  deletePosition: "gvdg:admin-course-layout-position-delete-request",
  fetchUdisc: "gvdg:admin-course-layout-udisc-fetch-request",
  load: "gvdg:admin-course-layouts-load-request",
  saveLayout: "gvdg:admin-course-layout-save-request",
};

function normalizeCourses(state) {
  return Array.isArray(state.courses) ? state.courses.map(normalizeCourse) : [];
}

function normalizeLayoutsState(state) {
  return {
    courseId: state.courseId == null ? "" : String(state.courseId),
    layouts: Array.isArray(state.layouts) ? state.layouts : [],
    positions: Array.isArray(state.positions) ? state.positions : [],
    status: typeof state.status === "string" ? state.status : "idle",
  };
}

function dispatchRequest(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function nextRequestId(ref) {
  ref.current += 1;
  return `layout-save-${ref.current}`;
}

function rowsFromLayout(layout) {
  const holes = Array.isArray(layout?.holes) ? layout.holes : [];
  return holes.map(rowFromHole);
}

function emptyRows() {
  return [newHoleRow(0)];
}

export function AdminLayoutsManager() {
  const [courses, setCourses] = React.useState(() => normalizeCourses(EMPTY_COURSES_STATE));
  const [selectedCourseId, setSelectedCourseId] = React.useState("");
  const [layoutsState, setLayoutsState] = React.useState(() => normalizeLayoutsState(EMPTY_LAYOUTS_STATE));
  const [editingId, setEditingId] = React.useState(null);
  const [layoutName, setLayoutName] = React.useState("");
  const [rows, setRows] = React.useState(() => emptyRows());
  const [savePending, setSavePending] = React.useState(false);
  const requestCounter = React.useRef(0);
  const currentSaveRequest = React.useRef("");

  React.useLayoutEffect(() => {
    function update(event) {
      const detail = event.detail && typeof event.detail === "object" ? event.detail : EMPTY_COURSES_STATE;
      setCourses(normalizeCourses(detail));
    }
    window.addEventListener("gvdg:admin-courses-list", update);
    return () => window.removeEventListener("gvdg:admin-courses-list", update);
  }, []);

  React.useLayoutEffect(() => {
    function update(event) {
      const detail = event.detail && typeof event.detail === "object" ? event.detail : EMPTY_LAYOUTS_STATE;
      setLayoutsState(normalizeLayoutsState(detail));
    }
    window.addEventListener("gvdg:admin-course-layouts-state", update);
    return () => window.removeEventListener("gvdg:admin-course-layouts-state", update);
  }, []);

  React.useEffect(() => {
    function update(event) {
      const detail = event.detail && typeof event.detail === "object" ? event.detail : {};
      if (!detail.requestId || detail.requestId !== currentSaveRequest.current) return;
      setSavePending(false);
      if (detail.ok === true) resetBuilder();
    }
    window.addEventListener("gvdg:admin-course-layouts-action-result", update);
    return () => window.removeEventListener("gvdg:admin-course-layouts-action-result", update);
  }, []);

  function resetBuilder() {
    setEditingId(null);
    setLayoutName("");
    setRows(emptyRows());
  }

  function selectCourse(courseId) {
    setSelectedCourseId(courseId);
    resetBuilder();
    if (!courseId) {
      setLayoutsState(normalizeLayoutsState(EMPTY_LAYOUTS_STATE));
      return;
    }
    dispatchRequest(REQUEST_EVENTS.load, { courseId });
  }

  function editLayout(layout) {
    const normalized = normalizeLayout(layout);
    setEditingId(normalized.id || null);
    setLayoutName(normalized.name || "");
    setRows(rowsFromLayout(normalized).length ? rowsFromLayout(normalized) : emptyRows());
  }

  function applyUdiscLayout(layout) {
    const normalized = normalizeLayout(layout);
    setEditingId(null);
    setLayoutName(normalized.name || "Main");
    setRows(rowsFromLayout(normalized).length ? rowsFromLayout(normalized) : emptyRows());
  }

  function saveLayout(layout) {
    const requestId = nextRequestId(requestCounter);
    currentSaveRequest.current = requestId;
    setSavePending(true);
    dispatchRequest(REQUEST_EVENTS.saveLayout, { courseId: selectedCourseId, layout, requestId });
  }

  const selected = Boolean(selectedCourseId);
  const loading = layoutsState.status === "loading";
  const coursesOptions = courses.map((course) => h("option", { key: course.id || course.label, value: course.id }, course.label));

  return h("div", { "data-react-admin-layouts": layoutsState.status }, [
    h("div", { key: "course" }, [
      h("label", { htmlFor: "alCourse", key: "label" }, "Course"),
      h("select", {
        disabled: !courses.length,
        id: "alCourse",
        key: "select",
        onChange: (event) => selectCourse(event.target.value),
        value: selectedCourseId,
      }, [
        h("option", { key: "none", value: "" }, courses.length ? "select a course" : "No courses loaded"),
        ...coursesOptions,
      ]),
    ]),
    selected ? h("div", { id: "alBody", key: "body", style: { marginTop: "1rem" } }, [
      loading ? h("div", { className: "al-note", key: "loading", role: "status" }, "Loading layouts...") : null,
      h(AdminLayoutUdiscImport, { courseId: selectedCourseId, key: "udisc", onApply: applyUdiscLayout }),
      h(AdminLayoutPositionPool, { courseId: selectedCourseId, key: "pool", pool: layoutsState.positions }),
      h(AdminLayoutBuilder, {
        editingId,
        key: "builder",
        name: layoutName,
        onNameChange: setLayoutName,
        onReset: resetBuilder,
        onRowsChange: setRows,
        onSave: saveLayout,
        pending: savePending,
        pool: layoutsState.positions,
        rows,
      }),
      h(AdminLayoutsList, { key: "list", layouts: layoutsState.layouts, onEdit: editLayout }),
    ]) : null,
  ]);
}
