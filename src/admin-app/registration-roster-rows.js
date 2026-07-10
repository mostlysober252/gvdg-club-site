import React from "react";

import { adminConfirm } from "./admin-dialogs.js";

const h = React.createElement;

function dispatchRequest(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

export function RegistrationRow({ registration }) {
  const [division, setDivision] = React.useState(registration.division);
  const [team, setTeam] = React.useState(registration.team);
  const [startingHole, setStartingHole] = React.useState(registration.startingHole);
  const [checkedIn, setCheckedIn] = React.useState(registration.checkedIn);
  const [paidEntry, setPaidEntry] = React.useState(registration.paidEntry);
  const [amountValue, setAmountValue] = React.useState("");

  React.useEffect(() => {
    setDivision(registration.division);
    setTeam(registration.team);
    setStartingHole(registration.startingHole);
    setCheckedIn(registration.checkedIn);
    setPaidEntry(registration.paidEntry);
    setAmountValue("");
  }, [registration.id, registration.division, registration.team, registration.startingHole, registration.checkedIn, registration.paidEntry]);

  function patchText(field, value, previous) {
    const next = value.trim();
    if (next === previous) return;
    dispatchRequest("gvdg:admin-registration-roster-patch-request", {
      patch: { [field]: next || null },
      registration: registration.source,
    });
  }

  function patchStartingHole() {
    const parsed = Number.parseInt(startingHole, 10);
    const next = Number.isFinite(parsed) && parsed >= 1 ? parsed : null;
    const previous = registration.startingHole ? Number.parseInt(registration.startingHole, 10) : null;
    if (next === previous) return;
    dispatchRequest("gvdg:admin-registration-roster-patch-request", {
      patch: { starting_hole: next },
      registration: registration.source,
    });
  }

  function submitOnEnter(event) {
    if (event.key === "Enter") event.currentTarget.blur();
  }

  return h("tr", { "data-admin-registration-id": registration.id }, [
    h("td", { className: "lb-name", key: "name" }, registration.name),
    h("td", { key: "division" }, h("input", {
      "aria-label": `Division for ${registration.name}`,
      maxLength: 40,
      onBlur: () => patchText("division", division, registration.division),
      onChange: (event) => setDivision(event.target.value),
      onKeyDown: submitOnEnter,
      placeholder: "division",
      style: { width: "5rem" },
      type: "text",
      value: division,
    })),
    h("td", { key: "team" }, h("input", {
      "aria-label": `Team for ${registration.name}`,
      maxLength: 40,
      onBlur: () => patchText("team", team, registration.team),
      onChange: (event) => setTeam(event.target.value),
      onKeyDown: submitOnEnter,
      placeholder: "pair/team",
      style: { width: "5rem" },
      type: "text",
      value: team,
    })),
    h("td", { key: "starting-hole" }, h("input", {
      "aria-label": `Starting hole for ${registration.name}`,
      min: "1",
      onBlur: patchStartingHole,
      onChange: (event) => setStartingHole(event.target.value),
      onKeyDown: submitOnEnter,
      style: { width: "3.5rem" },
      type: "number",
      value: startingHole,
    })),
    h("td", { key: "checked-in" }, h("input", {
      "aria-label": `Checked in ${registration.name}`,
      checked: checkedIn,
      onChange: (event) => {
        setCheckedIn(event.target.checked);
        dispatchRequest("gvdg:admin-registration-roster-patch-request", {
          patch: { checked_in: event.target.checked },
          registration: registration.source,
        });
      },
      type: "checkbox",
    })),
    h("td", { key: "paid-entry" }, h("input", {
      "aria-label": `Paid entry for ${registration.name}`,
      checked: paidEntry,
      onChange: (event) => {
        setPaidEntry(event.target.checked);
        dispatchRequest("gvdg:admin-registration-roster-patch-request", {
          patch: { paid_entry: event.target.checked },
          registration: registration.source,
        });
      },
      type: "checkbox",
    })),
    h("td", { key: "credit" }, registration.memberId ? h("span", { className: "credit-award" }, [
      h("input", {
        "aria-label": `Store credit amount for ${registration.name}`,
        key: "amount",
        min: "0",
        onChange: (event) => setAmountValue(event.target.value),
        placeholder: "$",
        step: "0.01",
        type: "number",
        value: amountValue,
      }),
      h("button", {
        className: "admin-btn secondary",
        key: "award",
        onClick: () => dispatchRequest("gvdg:admin-registration-roster-credit-request", {
          amountValue,
          memberId: registration.memberId,
          memberName: registration.name,
        }),
        type: "button",
      }, "Award"),
    ]) : "-"),
  ]);
}

export function ManualPlayerRow({ player }) {
  async function requestRemove() {
    const confirmed = await adminConfirm({
      title: "Remove manual player",
      message: `Remove ${player.name || "this player"}?`,
      confirmText: "Remove",
      danger: true,
    });
    if (!confirmed) return;
    dispatchRequest("gvdg:admin-registration-manual-remove-request", { player: player.source });
  }

  return h("tr", { "data-admin-registration-manual-id": player.id }, [
    h("td", { className: "lb-name", key: "name" }, [
      player.name,
      h("span", { className: "al-note", key: "tag" }, " - manual"),
    ]),
    h("td", { key: "division" }, player.division || "-"),
    h("td", { key: "team" }, player.team || "-"),
    h("td", { key: "starting-hole" }, "-"),
    h("td", { key: "checked-in" }, "-"),
    h("td", { key: "paid-entry" }, "-"),
    h("td", { key: "actions" }, h("button", {
      className: "admin-btn danger",
      onClick: requestRemove,
      type: "button",
    }, "Remove")),
  ]);
}
