import React from "react";
import { MessageCircle, Send, X } from "lucide-react";

import { resolveApiBase } from "./api-base.js";

const h = React.createElement;
const AVATAR = "img/crotts.jpg";

const CROTTS_CSS = `
#crotts-fab{position:fixed;left:18px;bottom:18px;width:60px;height:60px;border-radius:50%;border:3px solid var(--secondary);background:var(--bg-secondary);color:var(--secondary);cursor:pointer;box-shadow:0 4px 14px var(--card-shadow-hover);z-index:9998;padding:0;overflow:hidden;transition:transform .15s ease}
#crotts-fab:hover{transform:scale(1.06)}
#crotts-fab img{width:100%;height:100%;object-fit:cover;object-position:center 28%;display:block}
#crotts-badge{position:absolute;top:1px;right:1px;display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:999px;background:var(--secondary);color:white;border:2px solid var(--bg-secondary)}
#crotts-panel{position:fixed;left:18px;bottom:88px;width:340px;max-width:calc(100vw - 36px);height:460px;max-height:calc(100vh - 120px);background:var(--bg-primary);color:var(--text-primary);border:1px solid var(--border-color);border-radius:12px;box-shadow:0 20px 60px var(--card-shadow-hover);z-index:9999;display:none;flex-direction:column;overflow:hidden;font-family:inherit}
#crotts-panel.open{display:flex}
#crotts-head{display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--secondary);color:white}
#crotts-head img{width:36px;height:36px;border-radius:50%;object-fit:cover;object-position:center 28%;border:2px solid color-mix(in srgb, white 60%, transparent)}
#crotts-head .t{font-weight:700;line-height:1.1}
#crotts-head .s{font-size:11px;opacity:.85}
#crotts-close{margin-left:auto;background:transparent;border:0;color:white;width:36px;height:36px;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;cursor:pointer;line-height:1;transition:background .15s ease,transform .15s ease}
#crotts-close:hover{background:color-mix(in srgb, white 16%, transparent);transform:scale(1.03)}
#crotts-msgs{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;background:var(--bg-secondary)}
.crotts-b{max-width:85%;padding:8px 11px;border-radius:12px;font-size:14px;line-height:1.35;white-space:pre-wrap;overflow-wrap:anywhere}
.crotts-b.them{background:var(--bg-primary);color:var(--text-primary);border:1px solid var(--border-color);align-self:flex-start;border-bottom-left-radius:4px}
.crotts-b.me{background:var(--secondary);color:white;align-self:flex-end;border-bottom-right-radius:4px}
.crotts-b.err{background:var(--over-soft);color:var(--over);border:1px solid var(--over);align-self:flex-start}
#crotts-form{display:flex;gap:6px;padding:10px;border-top:1px solid var(--border-color);background:var(--bg-primary)}
#crotts-input{flex:1;resize:none;border:1px solid var(--border-color);border-radius:8px;padding:8px;font:inherit;font-size:14px;background:var(--bg-secondary);color:var(--text-primary)}
#crotts-send{display:inline-flex;align-items:center;gap:0.35rem;background:var(--secondary);color:white;border:0;border-radius:8px;padding:0 13px;font-weight:700;cursor:pointer}
#crotts-send:disabled{opacity:.5;cursor:default}
.crotts-typing{font-size:12px;color:var(--text-muted);align-self:flex-start;padding:2px 4px}
@media (max-width:768px){#crotts-fab{width:54px;height:54px;left:14px;bottom:calc(82px + env(safe-area-inset-bottom,0px))}#crotts-panel{left:12px;bottom:calc(148px + env(safe-area-inset-bottom,0px));max-width:calc(100vw - 24px);max-height:calc(100vh - 172px)}}
@media (max-width:768px){body.admin-page #crotts-fab,body.admin-page #crotts-panel{display:none}}
`;

function apiBase() {
  return resolveApiBase({ datasetKeys: ["apiBase", "authBase"] });
}

function icon(Icon, size = 18) {
  return h(Icon, {
    "aria-hidden": "true",
    focusable: "false",
    size,
    strokeWidth: 2.3,
  });
}

function messageId(counter) {
  counter.current += 1;
  return `crotts-${counter.current}`;
}

function AssistantBubble({ message }) {
  return h("div", { className: `crotts-b ${message.kind}` }, message.content);
}

export function CrottsWidget() {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [messages, setMessages] = React.useState([]);
  const historyRef = React.useRef([]);
  const inputRef = React.useRef(null);
  const messagesRef = React.useRef(null);
  const idCounter = React.useRef(0);
  const api = React.useMemo(apiBase, []);

  React.useEffect(() => {
    if (!open) return;
    setMessages((current) => {
      if (current.length) return current;
      return [{
        content: "Hey, I'm Crotts. Ask me about GVDG events, courses, or how to use the site.",
        id: messageId(idCounter),
        kind: "them",
      }];
    });
    window.setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  React.useEffect(() => {
    if (!messagesRef.current) return;
    messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [messages, busy]);

  async function sendMessage() {
    const text = draft.trim();
    if (!text || busy) return;

    setBusy(true);
    setDraft("");
    setMessages((current) => current.concat({ content: text, id: messageId(idCounter), kind: "me" }));

    try {
      const response = await fetch(`${api}/assistant`, {
        body: JSON.stringify({ message: text, history: historyRef.current.slice(-8) }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      if (response.status === 429) {
        setMessages((current) => current.concat({
          content: "I'm getting a lot of questions right now. Give me a minute and try again.",
          id: messageId(idCounter),
          kind: "err",
        }));
        return;
      }
      if (!response.ok) {
        setMessages((current) => current.concat({
          content: "Sorry, I couldn't reach the club assistant just now.",
          id: messageId(idCounter),
          kind: "err",
        }));
        return;
      }

      const data = await response.json();
      const reply = data && data.reply ? String(data.reply) : "Hmm, I didn't catch that.";
      setMessages((current) => current.concat({ content: reply, id: messageId(idCounter), kind: "them" }));
      historyRef.current = historyRef.current.concat(
        { role: "user", content: text },
        { role: "assistant", content: reply },
      ).slice(-16);
    } catch {
      setMessages((current) => current.concat({
        content: "Network hiccup - I couldn't reach the assistant.",
        id: messageId(idCounter),
        kind: "err",
      }));
    } finally {
      setBusy(false);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }

  return h(React.Fragment, null, [
    h("style", { key: "style" }, CROTTS_CSS),
    h("button", {
      "aria-label": open ? "Close Crotts assistant" : "Open Crotts assistant",
      id: "crotts-fab",
      key: "fab",
      onClick: () => setOpen((value) => !value),
      title: "Ask Crotts",
      type: "button",
    }, [
      h("img", { alt: "Crotts", key: "img", src: AVATAR }),
      h("span", { id: "crotts-badge", key: "badge" }, icon(MessageCircle, 12)),
    ]),
    h("section", {
      "aria-label": "Crotts assistant",
      "aria-modal": open ? "true" : undefined,
      className: open ? "open" : "",
      id: "crotts-panel",
      key: "panel",
      role: "dialog",
    }, [
      h("div", { id: "crotts-head", key: "head" }, [
        h("img", { alt: "Crotts", key: "avatar", src: AVATAR }),
        h("div", { key: "titles" }, [
          h("div", { className: "t", key: "title" }, "Crotts"),
          h("div", { className: "s", key: "subtitle" }, "GVDG assistant"),
        ]),
        h("button", {
          "aria-label": "Close Crotts assistant",
          id: "crotts-close",
          key: "close",
          onClick: () => setOpen(false),
          title: "Close",
          type: "button",
        }, icon(X, 20)),
      ]),
      h("div", { id: "crotts-msgs", key: "messages", ref: messagesRef }, [
        ...messages.map((message) => h(AssistantBubble, { key: message.id, message })),
        busy ? h("div", { className: "crotts-typing", key: "typing" }, "Crotts is typing...") : null,
      ]),
      h("form", {
        id: "crotts-form",
        key: "form",
        onSubmit: (event) => {
          event.preventDefault();
          void sendMessage();
        },
      }, [
        h("textarea", {
          "aria-label": "Message Crotts",
          id: "crotts-input",
          key: "input",
          onChange: (event) => setDraft(event.target.value),
          onKeyDown: (event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void sendMessage();
            }
          },
          placeholder: "Ask Crotts...",
          ref: inputRef,
          rows: 1,
          value: draft,
        }),
        h("button", {
          disabled: busy || !draft.trim(),
          id: "crotts-send",
          key: "send",
          type: "submit",
        }, [
          icon(Send, 15),
          h("span", { key: "label" }, busy ? "Sending" : "Send"),
        ]),
      ]),
    ]),
  ]);
}
