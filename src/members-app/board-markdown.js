import React from "react";

const h = React.createElement;
const inlinePattern = /\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;

function InlineMarkdown({ text }) {
  const parts = [];
  let last = 0;
  let match;
  inlinePattern.lastIndex = 0;
  while ((match = inlinePattern.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    if (match[1] != null) {
      parts.push(h("strong", { key: `strong-${match.index}` }, match[1]));
    } else {
      parts.push(h("a", {
        href: match[3],
        target: "_blank",
        rel: "noopener noreferrer",
        key: `link-${match.index}`,
      }, match[2]));
    }
    last = inlinePattern.lastIndex;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function ParagraphBlock({ lines }) {
  const children = [];
  lines.forEach((line, index) => {
    if (index) children.push(h("br", { key: `br-${index}` }));
    children.push(h(InlineMarkdown, { text: line, key: `line-${index}` }));
  });
  return h("p", null, children);
}

export function MarkdownBlocks({ text }) {
  const blocks = String(text || "").split(/\n\s*\n/).map((block) => block.split("\n").filter((line) => line.trim() !== ""));
  return blocks.map((lines, index) => {
    if (!lines.length) return null;
    if (lines.every((line) => /^\s*-\s+/.test(line))) {
      return h("ul", { key: `block-${index}` }, lines.map((line, rowIndex) =>
        h("li", { key: rowIndex }, h(InlineMarkdown, { text: line.replace(/^\s*-\s+/, "") })),
      ));
    }
    return h(ParagraphBlock, { lines, key: `block-${index}` });
  });
}
