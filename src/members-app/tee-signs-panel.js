import React from "react";

import { request, requestJson } from "./api.js";
import { useSessionToken } from "./session-token.js";
import {
  HOLE_OPTIONS,
  TS_MAX_DATA_URL,
  resizeImageFile,
  teeSignChipText,
  teeSignLayouts,
  teeSignStatusMeta,
  teeSignWhen,
} from "./tee-signs-utils.js";

const h = React.createElement;

function courseName(courses, courseId) {
  const match = courses.find((course) => String(course.id) === String(courseId));
  return match?.name || `Course #${courseId}`;
}

function TeeSignThumb({ id, token }) {
  const [url, setUrl] = React.useState("");

  React.useEffect(() => {
    if (!id || !token) return undefined;
    const controller = new AbortController();
    let objectUrl = "";
    request(`/tee-signs/${encodeURIComponent(id)}/image`, { token, signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        objectUrl = URL.createObjectURL(await response.blob());
        setUrl(objectUrl);
      })
      .catch((error) => {
        if (error.name !== "AbortError") setUrl("");
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id, token]);

  return h("img", { className: "ts-thumb", src: url || undefined, alt: "Tee sign photo", loading: "lazy" });
}

function TeeSignCard({ row, courses, token }) {
  const status = teeSignStatusMeta(row.status);
  const layouts = teeSignLayouts(row);
  return h("div", { className: "ts-card" }, [
    h(TeeSignThumb, { id: row.id, token, key: "thumb" }),
    h("div", { className: "ts-card-body", key: "body" }, [
      h("div", { className: "ts-card-head", key: "head" }, [
        h("span", { className: "ts-where", key: "where" }, `${courseName(courses, row.course_id)} - Hole ${row.hole_number}`),
        h("span", { className: `ts-badge ${status.className}`, key: "status" }, status.label),
        row.created_at ? h("span", { className: "ts-when", key: "when" }, teeSignWhen(row.created_at)) : null,
      ]),
      layouts.length
        ? h("div", { className: "ts-guess", key: "guess" }, layouts.map((layout, index) =>
          h("span", { className: "ts-chip", key: index }, teeSignChipText(layout)),
        ))
        : h("div", { className: "ts-guess-pending", key: "pending" }, row.extract_source
          ? "Crotts could not read the layouts. An admin will enter them."
          : "Crotts is reading this sign."),
    ]),
  ]);
}

function TeeSignList({ signs, courses, token, status }) {
  if (status === "loading") return h("div", { className: "dash-note" }, "Loading tee signs...");
  if (!signs.length) {
    return h("div", { className: "dash-note" }, "No tee signs captured yet. Pick a course and hole above to add your first one.");
  }
  return h(React.Fragment, null, signs.map((row) => h(TeeSignCard, { row, courses, token, key: row.id })));
}

export function MemberTeeSignsPanel() {
  const token = useSessionToken();
  const [state, setState] = React.useState({ status: token ? "loading" : "idle", courses: [], signs: [] });
  const [selectedCourse, setSelectedCourse] = React.useState("");
  const [selectedHole, setSelectedHole] = React.useState("1");
  const [pending, setPending] = React.useState(null);
  const [message, setMessage] = React.useState({ text: "", tone: "" });
  const [version, setVersion] = React.useState(0);

  React.useEffect(() => {
    if (!token) {
      setState({ status: "idle", courses: [], signs: [] });
      return undefined;
    }
    const controller = new AbortController();
    setState((current) => ({ ...current, status: "loading" }));
    Promise.all([
      requestJson("/courses", { signal: controller.signal }).catch(() => ({ courses: [] })),
      requestJson("/my-tee-signs", { signal: controller.signal, token }).catch(() => ({ teeSigns: [] })),
    ]).then(([courseData, signData]) => {
      const courses = Array.isArray(courseData.courses) ? courseData.courses : [];
      setState({
        status: "ready",
        courses,
        signs: Array.isArray(signData.teeSigns) ? signData.teeSigns : [],
      });
      setSelectedCourse((current) => current || String(courses[0]?.id || ""));
    }).catch((error) => {
      if (error.name !== "AbortError") {
        setState({ status: "error", courses: [], signs: [] });
        setMessage({ text: "Tee signs are temporarily unavailable. Please refresh or try again in a minute.", tone: "error" });
      }
    });
    return () => controller.abort();
  }, [token, version]);

  async function onFileChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setMessage({ text: "Preparing photo...", tone: "" });
    const dataUrl = await resizeImageFile(file, 1024);
    if (!dataUrl) {
      setPending(null);
      setMessage({ text: "That file is not a readable image. Try a JPEG, PNG, or WebP photo.", tone: "error" });
      return;
    }
    if (dataUrl.length > TS_MAX_DATA_URL) {
      setPending(null);
      setMessage({ text: "That photo is too large even after resizing. Try another one.", tone: "error" });
      return;
    }
    setPending({ image: dataUrl, name: file.name || "tee-sign-photo" });
    setMessage({ text: "", tone: "" });
  }

  async function upload() {
    if (!token || !pending) return;
    const courseId = Number(selectedCourse);
    const hole = Number(selectedHole);
    if (!courseId || !hole) {
      setMessage({ text: "Pick a course and hole first.", tone: "error" });
      return;
    }
    setMessage({ text: "Uploading tee sign...", tone: "" });
    const response = await request("/tee-signs", { method: "POST", token, body: { courseId, hole, image: pending.image } }).catch(() => null);
    if (response?.status === 201) {
      setPending(null);
      setMessage({ text: "Uploaded. Crotts is reading the sign.", tone: "success" });
      setVersion((current) => current + 1);
    } else if (response?.status === 429) {
      setMessage({ text: "You're uploading a lot quickly. Please wait a minute and try again.", tone: "error" });
    } else {
      setMessage({ text: "Upload failed. Please check the course and hole, then try again.", tone: "error" });
    }
  }

  if (!token) return null;

  return h("div", { className: "react-tee-signs-panel", "data-react-tee-signs-panel": state.status }, [
    h("h3", { className: "my-dashboard-title", key: "title" }, "Capture a Tee Sign"),
    h("p", { className: "tee-capture-note", key: "note" }, "Snap a photo of a tee sign while you play and Crotts will read the par and distance for every layout on it. An admin reviews each photo before it counts."),
    h("div", { className: "ts-controls", key: "controls" }, [
      h("div", { className: "ts-field", key: "course" }, [
        h("label", { htmlFor: "reactTsCourse", key: "label" }, "Course"),
        h("select", {
          id: "reactTsCourse",
          value: selectedCourse,
          onChange: (event) => setSelectedCourse(event.target.value),
          disabled: !state.courses.length,
          key: "input",
        }, state.courses.map((course) => h("option", { value: String(course.id), key: course.id }, course.name))),
      ]),
      h("div", { className: "ts-field", key: "hole" }, [
        h("label", { htmlFor: "reactTsHole", key: "label" }, "Hole"),
        h("select", { id: "reactTsHole", value: selectedHole, onChange: (event) => setSelectedHole(event.target.value), key: "input" },
          HOLE_OPTIONS.map((hole) => h("option", { value: String(hole), key: hole }, `Hole ${hole}`))),
      ]),
      h("label", { className: "ts-filelabel", htmlFor: "reactTsPhotoInput", key: "filelabel" }, "Take / choose photo"),
      h("input", {
        type: "file",
        id: "reactTsPhotoInput",
        "data-react-tee-file": "true",
        accept: "image/png,image/jpeg,image/webp",
        capture: "environment",
        style: { display: "none" },
        onChange: onFileChange,
        key: "file",
      }),
    ]),
    pending ? h("img", { className: "ts-preview", src: pending.image, alt: "Tee-sign photo preview", style: { display: "block" }, key: "preview" }) : null,
    h("div", { key: "upload" }, h("button", { type: "button", className: "passkey-btn", disabled: !pending || !state.courses.length, onClick: upload }, "Upload tee sign")),
    h("div", { className: `ts-status${message.tone ? ` ${message.tone}` : ""}`, role: "status", "aria-live": "polite", key: "status" }, message.text),
    h("div", { className: "ts-mylist-title", key: "list-title" }, "My captured signs"),
    h("div", { id: "reactTsMyList", key: "list" }, h(TeeSignList, { signs: state.signs, courses: state.courses, token, status: state.status })),
  ]);
}
