import React from "react";

const h = React.createElement;

const EMPTY_FORM = {
  division: "",
  memberId: "",
  name: "",
  pdgaNo: "",
  team: "",
};

function requestId() {
  return `manual-player-${Date.now()}`;
}

function dispatchRequest(detail) {
  window.dispatchEvent(new CustomEvent("gvdg:admin-registration-manual-player-add-request", { detail }));
}

export function AdminRegistrationManualPlayerForm() {
  const [form, setForm] = React.useState(EMPTY_FORM);
  const [pendingRequest, setPendingRequest] = React.useState("");

  React.useEffect(() => {
    function update(event) {
      if (event.detail?.requestId !== pendingRequest) return;
      setPendingRequest("");
      if (event.detail?.ok === true) setForm(EMPTY_FORM);
    }
    if (!pendingRequest) return undefined;
    window.addEventListener("gvdg:admin-registration-manual-player-add-result", update);
    return () => window.removeEventListener("gvdg:admin-registration-manual-player-add-result", update);
  }, [pendingRequest]);

  function setField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function submit(event) {
    event.preventDefault();
    if (pendingRequest) return;
    const id = requestId();
    setPendingRequest(id);
    dispatchRequest({
      body: {
        division: form.division.trim() || null,
        member_id: form.memberId.trim() || null,
        name: form.name.trim(),
        pdga_no: form.pdgaNo.trim() || null,
        team: form.team.trim() || null,
      },
      requestId: id,
      valid: Boolean(form.name.trim()),
    });
  }

  const busy = Boolean(pendingRequest);

  return h("div", {
    className: "al-section",
    "data-react-admin-registration-manual-player-form": "",
    style: { marginTop: "1rem" },
  }, [
    h("h4", { className: "al-h", key: "title" }, "Add a walk-on / non-member"),
    h("form", { className: "al-row", key: "form", onSubmit: submit }, [
      h("input", {
        id: "rgPlayerName",
        key: "name",
        maxLength: 100,
        onChange: (event) => setField("name", event.target.value),
        placeholder: "Player name",
        value: form.name,
      }),
      h("input", {
        id: "rgPlayerMember",
        key: "member",
        maxLength: 64,
        onChange: (event) => setField("memberId", event.target.value),
        placeholder: "member id (optional)",
        value: form.memberId,
      }),
      h("input", {
        id: "rgPlayerPdga",
        key: "pdga",
        maxLength: 20,
        onChange: (event) => setField("pdgaNo", event.target.value),
        placeholder: "PDGA #",
        value: form.pdgaNo,
      }),
      h("input", {
        id: "rgPlayerDivision",
        key: "division",
        maxLength: 40,
        onChange: (event) => setField("division", event.target.value),
        placeholder: "division",
        value: form.division,
      }),
      h("input", {
        id: "rgPlayerTeam",
        key: "team",
        maxLength: 40,
        onChange: (event) => setField("team", event.target.value),
        placeholder: "team",
        value: form.team,
      }),
      h("button", { className: "admin-btn secondary", disabled: busy, key: "submit", type: "submit" }, busy ? "Adding..." : "Add player"),
    ]),
    h("p", { className: "al-note", key: "note", style: { marginTop: "0.4rem" } }, "Added players appear under Registered players above and play alongside registrants."),
  ]);
}
