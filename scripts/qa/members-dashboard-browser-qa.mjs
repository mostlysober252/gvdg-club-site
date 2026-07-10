import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

import { installMemberDashboardApiRoutes } from "./members-dashboard-api-routes.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const apiBase = "http://127.0.0.1:8788";
const evidenceDir = path.join(repoRoot, ".omo/evidence/members-dashboard-react");
const teeUploadPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p94AAAAASUVORK5CYII=", "base64");
const dashboardPanels = ["#myDashboard", "#clubRegister", "#clubBoard", "#teeCapture", "#membersReactClubPanel"];
const visibleDashboardPanels = {
  overview: ["#myDashboard", "#clubRegister"],
  events: ["#clubRegister"],
  board: ["#clubBoard"],
  tee: ["#teeCapture"],
  club: ["#membersReactClubPanel"],
};

const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
]);

async function startStaticServer() {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      const requestPath = url.pathname === "/" ? "/index.html" : url.pathname;
      const normalized = path.normalize(decodeURIComponent(requestPath)).replace(/^(\.\.[/\\])+/, "");
      const filePath = path.join(repoRoot, normalized);
      if (!filePath.startsWith(repoRoot + path.sep)) {
        response.writeHead(403);
        response.end("forbidden");
        return;
      }
      const body = await readFile(filePath);
      response.writeHead(200, { "Content-Type": mimeTypes.get(path.extname(filePath)) || "application/octet-stream" });
      response.end(body);
    } catch (error) {
      response.writeHead(error && error.code === "ENOENT" ? 404 : 500);
      response.end("not found");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

function collectPageErrors(page) {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => {
    errors.push(`Unexpected native dialog: ${dialog.type()} ${dialog.message()}`);
    return dialog.dismiss();
  });
  return errors;
}

async function waitForText(page, selector, expected, label) {
  try {
    await page.waitForFunction(
      ({ selector: query, expected: text }) => document.querySelector(query)?.textContent?.includes(text),
      { selector, expected },
      { timeout: 10_000 },
    );
  } catch {
    const body = await page.locator("body").innerText().catch(() => "");
    throw new Error(`Timed out waiting for ${label} to include ${expected}. Page text:\n${body}`);
  }
}

async function expectReactTab(page, name) {
  const selected = await page.getByRole("tab", { name }).getAttribute("aria-selected");
  if (selected !== "true") throw new Error(`Expected React tab ${name} to be selected, got ${selected}`);
}

async function expectNoReadinessClasses(page) {
  const className = await page.locator("#members").evaluate((node) => node.className || "");
  if (/members-react-(shell|overview|ratings|registration|board|tee-signs|club)-ready/.test(className)) {
    throw new Error(`Legacy member readiness class returned: ${className}`);
  }
}

async function expectDashboardPanel(page, tab, selector, label) {
  const result = await page.evaluate(({ panels, tab: expectedTab, visiblePanels }) => {
    const displays = Object.fromEntries(panels.map((panelSelector) => {
      const panel = document.querySelector(panelSelector);
      return [panelSelector, panel ? getComputedStyle(panel).display : "<missing>"];
    }));
    const visible = new Set(visiblePanels);
    return {
      displays,
      ok: document.body.dataset.memberDashboardTab === expectedTab
        && panels.every((panelSelector) => visible.has(panelSelector) ? displays[panelSelector] !== "none" : displays[panelSelector] === "none"),
      tab: document.body.dataset.memberDashboardTab || "<unset>",
    };
  }, { panels: dashboardPanels, tab, visiblePanels: visibleDashboardPanels[tab] || [selector] });
  if (!result.ok) throw new Error(`${label} did not isolate tab ${tab}: ${JSON.stringify(result)}`);
}

async function captureFullPage(page, filePath) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(100);
  await page.screenshot({ path: filePath, fullPage: true });
}

async function installAuthSubmitCapture(page) {
  await page.addInitScript(() => {
    window.__gvdgQaAuthCaptureEnabled = false;
    window.__gvdgQaAuthSubmits = {};
    [
      "gvdg:member-login-requested",
      "gvdg:member-pin-change-requested",
      "gvdg:member-profile-save-requested",
    ].forEach((eventName) => {
      window.addEventListener(eventName, (event) => {
        if (!window.__gvdgQaAuthCaptureEnabled) return;
        event.stopImmediatePropagation();
        window.__gvdgQaAuthSubmits[eventName] = event.detail || {};
        window.__gvdgQaAuthCaptureEnabled = false;
      }, { capture: true });
    });
  });
}

async function captureNextAuthSubmit(page) {
  await page.evaluate(() => {
    window.__gvdgQaAuthCaptureEnabled = true;
  });
}

async function expectAuthSubmitDetail(page, eventName, expected) {
  await page.waitForFunction(
    ({ eventName: name, expected: detail }) => {
      const actual = window.__gvdgQaAuthSubmits?.[name];
      return actual && Object.entries(detail).every(([key, value]) => actual[key] === value);
    },
    { eventName, expected },
    { timeout: 10_000 },
  );
}

async function assertNoHorizontalOverflow(page, label) {
  const overflow = await page.evaluate(() =>
    Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
  );
  if (overflow <= 1) return;
  const offenders = await page.evaluate(() => {
    return [...document.querySelectorAll("body *")].map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        tag: node.tagName.toLowerCase(),
        id: node.id || "",
        className: String(node.className || ""),
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        width: Math.round(rect.width),
      };
    }).filter((row) => row.right > window.innerWidth + 1 || row.left < -1).slice(0, 8);
  });
  throw new Error(`${label} has horizontal overflow of ${overflow}px: ${JSON.stringify(offenders)}`);
}

async function assertPdgaRatingsStacked(page, label) {
  const rows = await page.locator("#membersReactRatingPanel .dash-event").evaluateAll((events) =>
    events.map((event, index) => {
      const main = event.querySelector(".dash-event-main");
      const copy = event.querySelector(".dash-event-copy");
      const title = event.querySelector(".dash-event-name");
      const date = event.querySelector(".dash-event-date");
      const ratingRow = event.querySelector(".dash-event-rating-row");
      const ratings = event.querySelector(".dash-event-ratings");
      const eventRect = event.getBoundingClientRect();
      const mainRect = main?.getBoundingClientRect();
      const copyRect = copy?.getBoundingClientRect();
      const titleRect = title?.getBoundingClientRect();
      const dateRect = date?.getBoundingClientRect();
      const ratingRowRect = ratingRow?.getBoundingClientRect();
      const ratingsRect = ratings?.getBoundingClientRect();
      return {
        index,
        title: main?.textContent?.trim() || "",
        missing: !main || !copy || !title || !date || !ratingRow || !ratings,
        ratingRowBelowCopy: Boolean(copyRect && ratingRowRect && ratingRowRect.top >= copyRect.bottom - 1),
        ratingsBelowText: Boolean(titleRect && dateRect && ratingsRect && ratingsRect.top >= dateRect.bottom - 1 && ratingsRect.top > titleRect.top),
        ratingRowFullWidth: Boolean(mainRect && ratingRowRect && ratingRowRect.left >= mainRect.left - 1 && ratingRowRect.right <= mainRect.right + 1 && ratingRowRect.width >= mainRect.width - 2),
        ratingsInsideMain: Boolean(mainRect && ratingsRect && ratingsRect.left >= mainRect.left - 1 && ratingsRect.right <= mainRect.right + 1),
        ratingsInsideCard: Boolean(ratingsRect && ratingsRect.left >= eventRect.left - 1 && ratingsRect.right <= eventRect.right + 1),
      };
    })
  );
  const badRows = rows.filter((row) => row.missing || !row.ratingRowBelowCopy || !row.ratingsBelowText || !row.ratingRowFullWidth || !row.ratingsInsideMain || !row.ratingsInsideCard);
  if (badRows.length) throw new Error(`${label} PDGA ratings are not stacked below event text: ${JSON.stringify(badRows)}`);
}

async function captureAuthGate(browser, origin, viewport, slug) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = collectPageErrors(page);
  await installMemberDashboardApiRoutes(page, apiBase);
  await installAuthSubmitCapture(page);

  await page.goto(`${origin}/gvdg-members.html`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-react-auth-gate="login"]', { timeout: 10_000 });
  await waitForText(page, "[data-react-auth-gate]", "Members Only", "React auth gate");
  await waitForText(page, "[data-react-auth-gate]", "PDGA # or UDisc Username", "React auth login form");
  await page.getByRole("button", { name: "Log In", exact: true }).click();
  await waitForText(page, '[data-react-auth-error="login"]', "Enter your PDGA #/UDisc and PIN.", "empty login validation");
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("gvdg:member-auth-form-state", {
      detail: { form: "login", busyAction: "login" },
    }));
  });
  await page.getByRole("button", { name: "Please wait..." }).waitFor({ state: "visible", timeout: 10_000 });
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("gvdg:member-auth-form-state", {
      detail: { form: "login", busyAction: "" },
    }));
  });
  await page.locator("#identifierInput").fill("qa-member");
  await page.locator("#pinInput").fill("2468");
  await captureNextAuthSubmit(page);
  await page.getByRole("button", { name: "Log In", exact: true }).click();
  await expectAuthSubmitDetail(page, "gvdg:member-login-requested", { identifier: "qa-member", pin: "2468" });
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("gvdg:member-auth-form-state", {
      detail: { form: "login", values: { identifier: "", pin: "" } },
    }));
  });
  await assertNoHorizontalOverflow(page, `${slug} auth login`);
  await captureFullPage(page, path.join(evidenceDir, `${slug}-auth-login.png`));

  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("gvdg:member-auth-mode", { detail: { mode: "pin", passkeysSupported: false } }));
  });
  await page.locator("#pinChangeForm").waitFor({ state: "visible", timeout: 10_000 });
  await waitForText(page, "[data-react-auth-gate]", "Choose your own to continue", "React auth PIN form");
  await page.locator("#newPinInput").fill("1357");
  await page.locator("#confirmPinInput").fill("1357");
  await captureNextAuthSubmit(page);
  await page.locator('[data-react-auth-action="pin"]').click();
  await expectAuthSubmitDetail(page, "gvdg:member-pin-change-requested", { newPin: "1357", confirmPin: "1357" });
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("gvdg:member-auth-form-state", {
      detail: { form: "pin", values: { newPin: "", confirmPin: "" } },
    }));
  });
  await assertNoHorizontalOverflow(page, `${slug} auth PIN`);
  await captureFullPage(page, path.join(evidenceDir, `${slug}-auth-pin.png`));

  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("gvdg:member-auth-mode", { detail: { mode: "profile", passkeysSupported: false } }));
  });
  await page.locator("#profileForm").waitFor({ state: "visible", timeout: 10_000 });
  await waitForText(page, "[data-react-auth-gate]", "Add / change photo", "React auth profile form");
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("gvdg:member-profile-preview", {
      detail: { src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p94AAAAASUVORK5CYII=" },
    }));
  });
  await page.locator('[data-react-profile-preview="ready"]').waitFor({ state: "visible", timeout: 10_000 });
  await page.locator("#profilePdgaInput").fill("167210");
  await page.locator("#profileUdiscInput").fill("qa_udisc");
  await captureNextAuthSubmit(page);
  await page.locator('[data-react-auth-action="profile-save"]').click();
  await expectAuthSubmitDetail(page, "gvdg:member-profile-save-requested", { pdga: "167210", udisc: "qa_udisc" });
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("gvdg:member-auth-form-state", {
      detail: { form: "profile", values: { pdga: "", udisc: "" } },
    }));
  });
  await assertNoHorizontalOverflow(page, `${slug} auth profile`);
  await captureFullPage(page, path.join(evidenceDir, `${slug}-auth-profile.png`));

  const staticAuthFallbacks = await page.locator("#membersReactAuthGate + .login-card").count();
  if (staticAuthFallbacks !== 0) throw new Error("Static auth card fallback is still present beside the React auth gate.");
  const legacyAuthNodes = await page.locator([
    "#loginError",
    "#pinChangeError",
    "#profileError",
    "#loginBtn",
    "#passkeyBtn",
    "#setPinBtn",
    "#profileSaveBtn",
  ].join(", ")).count();
  if (legacyAuthNodes !== 0) throw new Error("Legacy auth error/button nodes are still present.");
  if (errors.length) throw new Error(errors.join("\n"));
  await context.close();
}

async function captureState(browser, origin, viewport, slug) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = collectPageErrors(page);
  const apiState = await installMemberDashboardApiRoutes(page, apiBase);
  await page.addInitScript(() => sessionStorage.setItem("gvdg_member_token", "qa-token"));

  await page.goto(`${origin}/gvdg-members.html`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#membersReactDashboardShell:not(:empty)", { timeout: 10_000 });
  await page.waitForSelector("#membersReactOverviewPanel:not(:empty)", { state: "attached", timeout: 10_000 });
  await page.waitForSelector("#membersReactRegistrationPanel:not(:empty)", { state: "attached", timeout: 10_000 });
  await page.waitForSelector("#membersReactBoardPanel:not(:empty)", { state: "attached", timeout: 10_000 });
  await page.waitForSelector("#membersReactTeeSignsPanel:not(:empty)", { state: "attached", timeout: 10_000 });
  await page.waitForSelector("#membersReactClubPanel:not(:empty)", { state: "attached", timeout: 10_000 });
  await expectNoReadinessClasses(page);
  await expectReactTab(page, "Overview");
  await page.waitForSelector('[data-react-overview-dashboard="ready"]', { timeout: 10_000 });
  await page.waitForSelector('[data-react-registration-panel="ready"]', { timeout: 10_000 });
  await page.waitForSelector('[data-react-board-panel="ready"]', { state: "attached", timeout: 10_000 });
  await page.waitForSelector('[data-react-tee-signs-panel="ready"]', { state: "attached", timeout: 10_000 });
  await page.waitForSelector('[data-react-club-panel="ready"]', { state: "attached", timeout: 10_000 });
  await page.waitForSelector('[data-react-member-directory="ready"]', { state: "attached", timeout: 10_000 });
  await page.waitForSelector('[data-react-meeting-minutes="ready"]', { state: "attached", timeout: 10_000 });
  await page.waitForSelector('[data-react-pdga-dashboard="ready"]', { timeout: 10_000 });
  await waitForText(page, "#membersReactRatingPanel", "941", "React live rating");
  await waitForText(page, "#membersReactRatingPanel", "Memorial Day Showdown 2026", "React long PDGA event title");
  await assertPdgaRatingsStacked(page, slug);
  await page.waitForSelector('[data-react-club-ratings="ready"]', { timeout: 10_000 });
  await page.waitForSelector('[data-react-live-scoring="ready"]', { timeout: 10_000 });
  await page.waitForSelector('[data-react-wallet="ready"]', { timeout: 10_000 });
  await page.waitForSelector('[data-react-account-tools="ready"]', { timeout: 10_000 });
  await waitForText(page, "[data-react-club-ratings]", "906", "React club ratings");
  await waitForText(page, "[data-react-wallet]", "$12.50", "React wallet balance");
  await waitForText(page, "[data-react-account-tools]", "Edit profile", "React account tools");
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("gvdg:member-passkey-state", {
      detail: { busy: false, message: "Passkey setup cancelled." },
    }));
  });
  await waitForText(page, "[data-react-passkey-status]", "Passkey setup cancelled.", "React passkey status");
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("gvdg:member-passkey-state", {
      detail: { busy: false, message: "" },
    }));
  });
  await page.waitForSelector('[data-react-member-banner="ready"]', { timeout: 10_000 });
  await waitForText(page, "[data-react-member-banner]", "Welcome back, QA Admin!", "React member banner");
  await waitForText(page, "[data-react-admin-portal]", "Admin Portal", "React admin portal");
  await waitForText(page, "[data-react-registration-panel]", "GVDG QA Doubles", "React registration event");
  await waitForText(page, "[data-react-registration-panel]", "Warm-up round before league", "React casual round");
  const migratedLegacyNodes = await page.locator([
    "#dashTabs",
    "#legacyDashboardHead",
    "#legacyPdgaDashboard",
    "#clubRatings",
    "#liveScoring",
    "#legacyDashboardActions",
    "#clubWallet",
    "#legacyRegisterTitle",
    "#registerList",
    "#loginError",
    "#pinChangeError",
    "#profileError",
    "#loginBtn",
    "#passkeyBtn",
    "#setPinBtn",
    "#profileSaveBtn",
    "#profilePhotoPreview",
    "#enablePasskeyBtn",
    "#passkeyStatus",
    "#legacyBoardPanel",
    "#legacyTeeSignsPanel",
    "#clubMeetings",
    "#passkeyRow",
    "#legacyClubDirectoryPanel",
    "#legacyMeetingMinutesPanel",
    "#membersGrid",
    "#memberSearch",
  ].join(", ")).count();
  if (migratedLegacyNodes !== 0) {
    throw new Error("Migrated member dashboard legacy nodes are still present in the DOM.");
  }
  await captureFullPage(page, path.join(evidenceDir, `${slug}-overview.png`));

  await page.getByRole("tab", { name: "Events" }).click();
  await waitForText(page, "#membersReactDashboardShell", "Event Registration", "events title");
  await expectReactTab(page, "Events");
  await expectDashboardPanel(page, "events", "#clubRegister", "Events tab");
  if (await page.locator("[data-react-admin-portal]").count()) {
    throw new Error("React admin portal link should only render on the overview tab.");
  }
  await page.waitForSelector('[data-react-casual-form="ready"]', { timeout: 10_000 });
  await page.locator('[data-react-registration-panel] input[data-register-pair="team"]').waitFor({ state: "visible", timeout: 10_000 });
  await page.locator('[data-react-casual-form] textarea').fill(`QA browser casual ${slug}`);
  await page.getByRole("button", { name: "Post casual round" }).click();
  await page.waitForFunction(
    ({ expected }) => document.querySelector("[data-react-registration-panel]")?.textContent?.includes(expected),
    { expected: `QA browser casual ${slug}` },
    { timeout: 10_000 },
  );
  if (!apiState.casualPostBody || apiState.casualPostBody.course_id !== 1 || apiState.casualPostBody.layout_id !== 11) {
    throw new Error(`Casual round POST body was not captured correctly: ${JSON.stringify(apiState.casualPostBody)}`);
  }
  const postedCasual = page.locator(".casual-register-card").filter({ hasText: `QA browser casual ${slug}` });
  await postedCasual.getByRole("button", { name: "Close" }).click();
  await page.getByRole("dialog", { name: "Close this casual round post?" }).waitFor({ state: "visible", timeout: 10_000 });
  await page.getByRole("button", { name: "Keep open" }).click();
  await postedCasual.waitFor({ state: "visible", timeout: 10_000 });
  await postedCasual.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Close post" }).click();
  await page.waitForFunction(
    ({ expected }) => !document.querySelector("[data-react-registration-panel]")?.textContent?.includes(expected),
    { expected: `QA browser casual ${slug}` },
    { timeout: 10_000 },
  );
  await page.waitForTimeout(250);
  await captureFullPage(page, path.join(evidenceDir, `${slug}-events.png`));

  await page.getByRole("tab", { name: "Board" }).click();
  await waitForText(page, "#membersReactDashboardShell", "Member Board", "board title");
  await expectReactTab(page, "Board");
  await expectDashboardPanel(page, "board", "#clubBoard", "Board tab");
  await page.locator('[data-react-board-panel="ready"]').waitFor({ state: "visible", timeout: 10_000 });
  await waitForText(page, "[data-react-board-panel]", "League night", "React board fixture");
  await page.locator("[data-react-board-panel] .board-compose textarea").fill(`QA board post ${slug}`);
  await page.locator("[data-react-board-panel] .board-compose button").click();
  await waitForText(page, "[data-react-board-panel]", `QA board post ${slug}`, "posted board message");
  if (!apiState.boardPostBody || apiState.boardPostBody.body !== `QA board post ${slug}` || apiState.boardPostBody.parent_id !== null) {
    throw new Error(`Board POST body was not captured correctly: ${JSON.stringify(apiState.boardPostBody)}`);
  }
  const postedBoard = page.locator(".board-post").filter({ hasText: `QA board post ${slug}` }).first();
  await postedBoard.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("dialog", { name: "Delete this post?" }).waitFor({ state: "visible", timeout: 10_000 });
  await page.getByRole("button", { name: "Keep post" }).click();
  await postedBoard.waitFor({ state: "visible", timeout: 10_000 });
  await postedBoard.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Delete post" }).click();
  await page.waitForFunction(
    ({ expected }) => !document.querySelector("[data-react-board-panel]")?.textContent?.includes(expected),
    { expected: `QA board post ${slug}` },
    { timeout: 10_000 },
  );
  await page.waitForTimeout(250);
  await captureFullPage(page, path.join(evidenceDir, `${slug}-board.png`));

  await page.getByRole("tab", { name: "Tee Signs" }).click();
  await waitForText(page, "#membersReactDashboardShell", "Tee Sign Capture", "tee signs title");
  await expectReactTab(page, "Tee Signs");
  await expectDashboardPanel(page, "tee", "#teeCapture", "Tee Signs tab");
  await page.locator('[data-react-tee-signs-panel="ready"]').waitFor({ state: "visible", timeout: 10_000 });
  await waitForText(page, "[data-react-tee-signs-panel]", "Blue - Par 3", "React tee sign fixture");
  await page.setInputFiles('[data-react-tee-file]', {
    name: "qa-tee-sign.png",
    mimeType: "image/png",
    buffer: teeUploadPng,
  });
  await page.locator("[data-react-tee-signs-panel] .ts-preview").waitFor({ state: "visible", timeout: 10_000 });
  await page.locator("[data-react-tee-signs-panel] .passkey-btn").click();
  await waitForText(page, "[data-react-tee-signs-panel]", "Uploaded. Crotts is reading the sign.", "tee upload status");
  await waitForText(page, "[data-react-tee-signs-panel]", "Hole 1", "uploaded tee sign row");
  if (!apiState.teeSignPostBody || apiState.teeSignPostBody.courseId !== 1 || apiState.teeSignPostBody.hole !== 1 || !String(apiState.teeSignPostBody.image || "").startsWith("data:image/jpeg;base64,")) {
    throw new Error(`Tee sign POST body was not captured correctly: ${JSON.stringify(apiState.teeSignPostBody)}`);
  }
  await page.waitForTimeout(250);
  await captureFullPage(page, path.join(evidenceDir, `${slug}-tee.png`));

  await page.getByRole("tab", { name: "Club" }).click();
  await waitForText(page, "#membersReactDashboardShell", "GVDG Member Directory", "club title");
  await expectReactTab(page, "Club");
  await expectDashboardPanel(page, "club", "#membersReactClubPanel", "Club tab");
  await page.locator('[data-react-club-panel="ready"]').waitFor({ state: "visible", timeout: 10_000 });
  const clubPanel = page.locator('[data-react-club-panel]');
  const doublesPanel = clubPanel.locator('[data-react-doubles-league="ready"]');
  await doublesPanel.waitFor({ state: "visible", timeout: 10_000 });
  await waitForText(page, "[data-react-club-panel]", "Membership Growth Since 2004", "React club growth chart");
  await waitForText(page, "[data-react-club-panel]", "Future Course Improvements - Ayden", "React meeting minutes");
  await waitForText(page, "[data-react-doubles-league]", "Doubles League Records", "React doubles title");
  await clubPanel.locator(".members-search").fill("Martinez");
  await waitForText(page, "[data-react-club-panel] .members-grid", "Juan Martinez", "React directory search");
  await waitForText(page, "[data-react-club-panel] .members-count", "Showing 1 of 1 members", "React directory search count");
  await clubPanel.locator(".members-search").fill("");
  await clubPanel.getByRole("button", { name: "PDGA Members" }).click();
  await waitForText(page, "[data-react-club-panel] .members-count", "Showing 12 of", "React directory PDGA filter count");
  await clubPanel.getByRole("button", { name: "All Members" }).click();
  await waitForText(page, "[data-react-club-panel] .members-count", "Showing 12 of", "React directory all count");
  await clubPanel.getByRole("button", { name: /Show More/ }).click();
  await waitForText(page, "[data-react-club-panel] .members-count", "Showing 24 of", "React directory load more count");
  const minutesToggle = clubPanel.getByRole("button", { name: /January 12, 2026/ });
  if (await minutesToggle.getAttribute("aria-expanded") !== "true") throw new Error("React meeting minutes did not start expanded.");
  await minutesToggle.click();
  if (await minutesToggle.getAttribute("aria-expanded") !== "false") throw new Error("React meeting minutes did not collapse.");
  await minutesToggle.click();
  if (await minutesToggle.getAttribute("aria-expanded") !== "true") throw new Error("React meeting minutes did not re-expand.");
  await doublesPanel.getByRole("tab", { name: "All-Time Leaders" }).click();
  await doublesPanel.locator(".doubles-search-bar").fill("Blake Poland");
  await waitForText(page, "[data-react-doubles-league] .doubles-table-wrap", "Blake Poland", "React doubles all-time search");
  await doublesPanel.locator("tbody tr.clickable-row").filter({ hasText: "Blake Poland" }).first().click();
  await waitForText(page, ".player-modal", "Season History", "React doubles player modal");
  await page.getByRole("button", { name: "Close player details" }).click();
  await doublesPanel.getByRole("tab", { name: "Season Results" }).click();
  await doublesPanel.getByRole("button", { name: "Spring 2025" }).click();
  await waitForText(page, "[data-react-doubles-league] .doubles-table-wrap", "Blake Poland", "React doubles season results");
  await page.waitForTimeout(250);
  await captureFullPage(page, path.join(evidenceDir, `${slug}-club.png`));

  await assertNoHorizontalOverflow(page, slug);
  await page.getByRole("button", { name: "Log Out" }).click();
  await page.locator('[data-react-auth-gate="login"]').waitFor({ state: "visible", timeout: 10_000 });
  if (errors.length) throw new Error(errors.join("\n"));
  await context.close();
}

const staticServer = await startStaticServer();
const browser = await chromium.launch({ headless: true });

try {
  await mkdir(evidenceDir, { recursive: true });
  await captureAuthGate(browser, staticServer.origin, { width: 390, height: 844 }, "mobile");
  await captureAuthGate(browser, staticServer.origin, { width: 768, height: 1024 }, "tablet");
  await captureAuthGate(browser, staticServer.origin, { width: 1280, height: 900 }, "desktop");
  await captureState(browser, staticServer.origin, { width: 390, height: 844 }, "mobile");
  await captureState(browser, staticServer.origin, { width: 768, height: 1024 }, "tablet");
  await captureState(browser, staticServer.origin, { width: 1280, height: 900 }, "desktop");
} finally {
  await browser.close();
  await staticServer.close();
}

console.log("members dashboard browser QA passed");
