import React from "react";

import { request, requestJson } from "./api.js";
import { MarkdownBlocks } from "./board-markdown.js";
import { memberConfirm } from "./member-dialogs.js";
import { useMemberContext } from "./member-context.js";
import { useSessionToken } from "./session-token.js";

const h = React.createElement;

function boardInitials(name) {
  const parts = String(name || "Member").trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] || "M";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return `${first}${last}`.toUpperCase();
}

function BoardAvatar({ post, authors }) {
  const [failed, setFailed] = React.useState(false);
  const photo = !failed && post.member_id ? authors[post.member_id] : "";
  if (!photo) return h("div", { className: "board-avatar initials" }, boardInitials(post.author_name));
  return h("img", {
    className: "board-avatar",
    src: photo,
    alt: "",
    loading: "lazy",
    referrerPolicy: "no-referrer",
    onError: () => setFailed(true),
  });
}

function ReplyBox({ onSubmit }) {
  const [text, setText] = React.useState("");
  return h("form", {
    className: "board-replybox",
    onSubmit: (event) => {
      event.preventDefault();
      onSubmit(text, () => setText(""));
    },
  }, [
    h("textarea", { rows: 2, maxLength: 4000, placeholder: "Write a reply...", value: text, onChange: (event) => setText(event.target.value), key: "input" }),
    h("button", { type: "submit", className: "passkey-btn", key: "button" }, "Reply"),
  ]);
}

function BoardPost({ post, authors, isReply, canDelete, onDelete, onReply }) {
  const [replying, setReplying] = React.useState(false);
  return h("div", { className: isReply ? "board-reply" : "board-post" }, [
    h("div", { className: "board-head", key: "head" }, [
      h(BoardAvatar, { post, authors, key: "avatar" }),
      h("div", { className: "board-meta", key: "meta" }, [
        h("span", { className: "board-author", key: "author" }, post.author_name || "Member"),
        h("span", { className: "board-when", key: "when" }, post.created_at || ""),
      ]),
    ]),
    h("div", { className: "board-body", key: "body" }, h(MarkdownBlocks, { text: post.body || "" })),
    h("div", { className: "board-actions", key: "actions" }, [
      !isReply ? h("button", { type: "button", className: "board-link", onClick: () => setReplying((value) => !value), key: "reply" }, "Reply") : null,
      canDelete(post) ? h("button", { type: "button", className: "board-link danger", onClick: () => onDelete(post), key: "delete" }, "Delete") : null,
    ]),
    !isReply && replying ? h(ReplyBox, { onSubmit: (text, clear) => onReply(post.id, text, clear), key: "replybox" }) : null,
    !isReply && Array.isArray(post.replies) && post.replies.length
      ? h("div", { className: "board-replies", key: "replies" }, post.replies.map((reply) =>
        h(BoardPost, { post: reply, authors, isReply: true, canDelete, onDelete, onReply, key: reply.id }),
      ))
      : null,
  ]);
}

export function MemberBoardPanel() {
  const token = useSessionToken();
  const context = useMemberContext();
  const [state, setState] = React.useState({ status: token ? "loading" : "idle", posts: [], authors: {} });
  const [status, setStatus] = React.useState({ message: "", tone: "" });
  const [text, setText] = React.useState("");

  const reload = React.useCallback(() => {
    if (!token) return;
    setState((current) => ({ ...current, status: "loading" }));
    requestJson("/board", { token })
      .then((data) => setState({
        status: "ready",
        posts: Array.isArray(data.posts) ? data.posts : [],
        authors: data.authors && typeof data.authors === "object" ? data.authors : {},
      }))
      .catch(() => {
        setState({ status: "error", posts: [], authors: {} });
        setStatus({ message: "Could not load the board. Please refresh or try again in a minute.", tone: "error" });
      });
  }, [token]);

  React.useEffect(() => {
    if (token) reload();
    else setState({ status: "idle", posts: [], authors: {} });
  }, [reload, token]);

  async function submitPost(body, parentId, clear) {
    const trimmed = String(body || "").trim();
    if (!trimmed || !token) return;
    setStatus({ message: parentId ? "Saving reply..." : "Saving post...", tone: "" });
    const response = await request("/board", { method: "POST", token, body: { body: trimmed, parent_id: parentId || null } }).catch(() => null);
    if (response?.ok) {
      clear();
      setStatus({ message: parentId ? "Reply posted." : "Post added.", tone: "success" });
      reload();
    } else if (response?.status === 429) {
      setStatus({ message: "You're posting too fast. Give it a minute and try again.", tone: "error" });
    } else {
      setStatus({ message: "Sorry, your post could not be saved.", tone: "error" });
    }
  }

  async function deletePost(post) {
    if (!token) return;
    const confirmed = await memberConfirm({
      cancelText: "Keep post",
      confirmText: "Delete post",
      message: "This removes the post and any replies from the member board.",
      title: "Delete this post?",
      tone: "danger",
    });
    if (!confirmed) return;
    const response = await request(`/board/${encodeURIComponent(post.id)}`, { method: "DELETE", token }).catch(() => null);
    if (response?.ok) reload();
    else setStatus({ message: "Could not delete that post. Please try again.", tone: "error" });
  }

  const canDelete = (post) => post.member_id === context.sub || context.isAdmin === true;
  const boardCount = state.posts.length === 1 ? "1 thread" : state.posts.length ? `${state.posts.length} threads` : "No threads yet";
  if (!token) return null;

  return h("div", { className: "react-board-panel", "data-react-board-panel": state.status }, [
    h("div", { className: "board-title-row", key: "title" }, [
      h("div", { key: "copy" }, [
        h("h3", { className: "my-dashboard-title", key: "head" }, "Members Message Board"),
        h("p", { className: "board-note", key: "note" }, "Ask questions, coordinate rounds, share updates, and reply to other members."),
      ]),
      h("span", { className: "board-count", key: "count" }, boardCount),
    ]),
    h("form", { className: "board-compose", onSubmit: (event) => { event.preventDefault(); submitPost(text, null, () => setText("")); }, key: "compose" }, [
      h("textarea", {
        rows: 3,
        maxLength: 4000,
        placeholder: "Share something with the club... (markdown: **bold**, - bullets, https links)",
        value: text,
        onChange: (event) => setText(event.target.value),
        key: "input",
      }),
      h("button", { type: "submit", className: "passkey-btn", key: "button" }, "Post"),
    ]),
    h("div", { className: `board-status${status.tone ? ` ${status.tone}` : ""}`, role: "status", "aria-live": "polite", key: "status" }, status.message || (state.status === "loading" ? "Loading board..." : "")),
    h("div", { className: "board-feed", key: "feed" }, state.status === "loading"
      ? h("p", { className: "dash-note" }, "Loading board...")
      : state.status === "error"
        ? h("p", { className: "dash-note" }, "Board posts are temporarily unavailable.")
        : state.posts.length
          ? state.posts.map((post) => h(BoardPost, { post, authors: state.authors, canDelete, onDelete: deletePost, onReply: submitPost, key: post.id }))
        : h("p", { className: "dash-note" }, "No posts yet - start the conversation!")),
  ]);
}
