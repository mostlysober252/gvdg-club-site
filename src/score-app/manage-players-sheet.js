import React from "react";
import { createRoot } from "react-dom/client";

const h = React.createElement;

function playerLabel(player) {
  return player.name + (player.isMe ? " (you)" : "");
}

function PairEditor({ players, onSavePairs }) {
  const [labels, setLabels] = React.useState(() => pairLabels(players));

  React.useEffect(() => {
    setLabels(pairLabels(players));
  }, [players]);

  return h("div", { className: "card stack manage-pairs" }, [
    h("label", { className: "lbl", key: "label" }, "Doubles pairs"),
    h(
      "p",
      { className: "muted", key: "hint" },
      "Use the same pair label for exactly two active players before scoring starts.",
    ),
    ...players.map((player) =>
      h("label", { className: "lbl manage-pair-field", key: "pair-" + player.index }, [
        h("span", { key: "name" }, playerLabel(player)),
        h("input", {
          className: "field",
          key: "input",
          maxLength: 40,
          placeholder: "Pair label",
          value: labels[player.index] || "",
          onChange: (event) => {
            const value = event.target.value;
            setLabels((current) => ({ ...current, [player.index]: value }));
          },
        }),
      ]),
    ),
    h(
      "button",
      {
        className: "btn small secondary",
        key: "save",
        type: "button",
        onClick: () => {
          onSavePairs(players.map((player) => ({ index: player.index, pairLabel: (labels[player.index] || "").trim() })));
        },
      },
      "Save pairs",
    ),
  ]);
}

function pairLabels(players) {
  return players.reduce((labels, player) => {
    labels[player.index] = player.team || "";
    return labels;
  }, {});
}

function PlayerRow({ onRemove, player }) {
  return h("div", { className: "prow manage-player-row" }, [
    h("div", { className: "pname", key: "name" }, playerLabel(player)),
    h(
      "button",
      { className: "btn small ghost", key: "remove", type: "button", onClick: () => onRemove(player) },
      player.isMe ? "Leave round" : "Remove",
    ),
  ]);
}

function ManagePlayersSheet(props) {
  const players = props.players || [];
  return h(
    "div",
    {
      className: "overlay",
      onClick: (event) => {
        if (event.target === event.currentTarget) props.onClose();
      },
    },
    h("div", { className: "sheet" }, [
      h("div", { className: "grab", key: "grab" }),
      h("h2", { className: "section", key: "title" }, "Players"),
      h(
        "p",
        { className: "muted", key: "copy" },
        "Remove a player who registered by accident, had to leave, or did not show. Their scores are cleared.",
      ),
      props.isDoubles ? h(PairEditor, { key: "pairs", onSavePairs: props.onSavePairs, players }) : null,
      players.map((player) => h(PlayerRow, { key: "player-" + player.index, onRemove: props.onRemove, player })),
      h("button", { className: "btn secondary sheet-close", key: "close", type: "button", onClick: props.onClose }, "Close"),
    ]),
  );
}

export function createManagePlayersSheetRenderer() {
  let host = null;
  let root = null;

  function close() {
    if (root) root.render(null);
  }

  function render(props) {
    if (!host) {
      host = document.getElementById("scoreReactManagePlayersSheetApp");
      if (!host) throw new Error("Missing scoreReactManagePlayersSheetApp mount element");
    }
    if (!root) root = createRoot(host);
    root.render(h(ManagePlayersSheet, props));
  }

  return { close, render };
}
