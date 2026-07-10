import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const DEFAULT_SITE_URL = "https://gvdgclub.com";
const DEFAULT_API_URL = "https://auth.gvdgclub.com";
const TOKEN_KEY = "gvdg_member_token";
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const dashboardPanels = ["#myDashboard", "#clubRegister", "#clubBoard", "#teeCapture", "#membersReactClubPanel"];
const visibleDashboardPanels = {
  overview: ["#myDashboard", "#clubRegister"],
  events: ["#clubRegister"],
  board: ["#clubBoard"],
  tee: ["#teeCapture"],
  club: ["#membersReactClubPanel"],
};

function env(name) {
  return (process.env[name] || "").trim();
}

function loadDeployEnv() {
  const file = path.join(repoRoot, ".gvdg-deploy.env");
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

function cleanUrl(value, fallback) {
  return (value || fallback).replace(/\/+$/, "");
}

function jsonHeaders(token) {
  const headers = { Accept: "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  return headers;
}

async function requestJson(apiBase, path, options = {}) {
  const headers = jsonHeaders(options.token);
  const init = {
    method: options.method || "GET",
    headers,
    signal: AbortSignal.timeout(options.timeoutMs || 15_000),
  };
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }

  const response = await fetch(apiBase + path, init);
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = data && typeof data.error === "string" ? data.error : text.slice(0, 200);
    throw new Error(`API ${init.method} ${path} failed with ${response.status}: ${message}`);
  }
  return data;
}

async function qaToken(apiBase) {
  const token = env("GVDG_STAGING_QA_TOKEN");
  if (token) return token;

  const identifier = env("GVDG_STAGING_QA_IDENTIFIER");
  const pin = env("GVDG_STAGING_QA_PIN");
  if (!identifier || !pin) {
    throw new Error("Set GVDG_STAGING_QA_TOKEN, or GVDG_STAGING_QA_IDENTIFIER plus GVDG_STAGING_QA_PIN.");
  }

  const data = await requestJson(apiBase, "/login", {
    method: "POST",
    body: { identifier, pin },
  });
  if (!data || typeof data.token !== "string") throw new Error("Login succeeded without a token.");
  return data.token;
}

function collectPageErrors(page) {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function usefulStats(apiBase, pdgaNo) {
  const data = await requestJson(apiBase, `/pdga-stats?pdga=${encodeURIComponent(pdgaNo)}`);
  if (data?.live_rating == null) {
    throw new Error(
      `QA member PDGA #${pdgaNo} has no live dashboard rating. Run npm run qa:ensure-staging-dashboard-data.`,
    );
  }
}

async function waitForText(page, selector, expected, label) {
  try {
    await page.waitForFunction(
      ({ selector: query, expected: text }) => document.querySelector(query)?.textContent?.includes(text),
      { selector, expected },
      { timeout: 15_000 },
    );
  } catch {
    const body = await page.locator("body").innerText().catch(() => "");
    throw new Error(`Timed out waiting for ${label} to include ${expected}. Page text:\n${body}`);
  }
}

async function waitForLiveRating(page) {
  try {
    await page.waitForFunction(
      () => /^\d{3,4}$/.test(document.querySelector("[data-react-live-rating] .dash-tile-num")?.textContent?.trim() || ""),
      null,
      { timeout: 15_000 },
    );
  } catch {
    const body = await page.locator("body").innerText().catch(() => "");
    const actual = await page.locator("[data-react-live-rating] .dash-tile-num").innerText().catch(() => "<missing>");
    throw new Error(`Expected a numeric React live rating, got ${actual.trim()}. Page text:\n${body}`);
  }
  return (await page.locator("[data-react-live-rating] .dash-tile-num").innerText()).trim();
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
    { timeout: 15_000 },
  );
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
  try {
    await page.waitForFunction(
      ({ panels, tab: expectedTab, visiblePanels }) => {
        const visible = new Set(visiblePanels);
        return document.body.dataset.memberDashboardTab === expectedTab
          && panels.every((panelSelector) => {
            const panel = document.querySelector(panelSelector);
            const display = panel ? getComputedStyle(panel).display : "<missing>";
            return visible.has(panelSelector) ? display !== "none" : display === "none";
          });
      },
      { panels: dashboardPanels, tab, visiblePanels: visibleDashboardPanels[tab] || [selector] },
      { timeout: 15_000 },
    );
  } catch {
    const actual = await page.evaluate((panels) => {
      return {
        displays: Object.fromEntries(panels.map((panelSelector) => {
          const panel = document.querySelector(panelSelector);
          return [panelSelector, panel ? getComputedStyle(panel).display : "<missing>"];
        })),
        tab: document.body.dataset.memberDashboardTab || "<unset>",
      };
    }, dashboardPanels);
    throw new Error(`${label} did not isolate tab ${tab}: ${JSON.stringify(actual)}`);
  }
}

async function runAuthGateQa(browser, siteUrl) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = collectPageErrors(page);
  await installAuthSubmitCapture(page);

  await page.goto(`${siteUrl}/gvdg-members.html`, { waitUntil: "domcontentloaded" });
  await page.locator('[data-react-auth-gate="login"]').waitFor({ state: "visible", timeout: 15_000 });
  await waitForText(page, "[data-react-auth-gate]", "Members Only", "React auth gate");
  await waitForText(page, "[data-react-auth-gate]", "PDGA # or UDisc Username", "React auth login form");
  await page.getByRole("button", { name: "Log In", exact: true }).click();
  await waitForText(page, '[data-react-auth-error="login"]', "Enter your PDGA #/UDisc and PIN.", "empty login validation");
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("gvdg:member-auth-form-state", {
      detail: { form: "login", busyAction: "login" },
    }));
  });
  await page.getByRole("button", { name: "Please wait..." }).waitFor({ state: "visible", timeout: 15_000 });
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

  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("gvdg:member-auth-mode", { detail: { mode: "pin", passkeysSupported: false } }));
  });
  await page.locator("#pinChangeForm").waitFor({ state: "visible", timeout: 15_000 });
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

  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("gvdg:member-auth-mode", { detail: { mode: "profile", passkeysSupported: false } }));
  });
  await page.locator("#profileForm").waitFor({ state: "visible", timeout: 15_000 });
  await waitForText(page, "[data-react-auth-gate]", "Add / change photo", "React auth profile form");
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("gvdg:member-profile-preview", {
      detail: { src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p94AAAAASUVORK5CYII=" },
    }));
  });
  await page.locator('[data-react-profile-preview="ready"]').waitFor({ state: "visible", timeout: 15_000 });
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

  const width = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth));
  const viewport = page.viewportSize()?.width || 390;
  if (width > viewport + 1) throw new Error(`React auth gate has horizontal overflow: ${width}px > ${viewport}px.`);
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

async function runBrowserQa({ siteUrl, token, memberName, memberIsAdmin }) {
  const browser = await chromium.launch({ headless: true });
  try {
    await runAuthGateQa(browser, siteUrl);

    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const errors = collectPageErrors(page);
    await page.addInitScript(
      ({ key, value }) => sessionStorage.setItem(key, value),
      { key: TOKEN_KEY, value: token },
    );

    await page.goto(`${siteUrl}/gvdg-members.html`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#membersReactDashboardShell:not(:empty)", { timeout: 15_000 });
    await page.waitForSelector("#membersReactOverviewPanel:not(:empty)", { state: "attached", timeout: 15_000 });
    await page.waitForSelector("#membersReactRegistrationPanel:not(:empty)", { state: "attached", timeout: 15_000 });
    await page.waitForSelector("#membersReactBoardPanel:not(:empty)", { state: "attached", timeout: 15_000 });
    await page.waitForSelector("#membersReactTeeSignsPanel:not(:empty)", { state: "attached", timeout: 15_000 });
    await page.waitForSelector("#membersReactClubPanel:not(:empty)", { state: "attached", timeout: 15_000 });
    await expectNoReadinessClasses(page);
    await waitForText(page, "#membersReactDashboardShell", "Player Dashboard", "React dashboard title");
    await expectReactTab(page, "Overview");
    await page.locator('[data-react-overview-dashboard="ready"]').waitFor({ state: "visible", timeout: 15_000 });
    await page.locator('[data-react-registration-panel="ready"]').waitFor({ state: "visible", timeout: 15_000 });
    await page.locator('[data-react-board-panel="ready"]').waitFor({ state: "attached", timeout: 15_000 });
    await page.locator('[data-react-tee-signs-panel="ready"]').waitFor({ state: "attached", timeout: 15_000 });
    await page.locator('[data-react-club-panel="ready"]').waitFor({ state: "attached", timeout: 15_000 });
    await page.locator('[data-react-pdga-dashboard="ready"]').waitFor({ state: "visible", timeout: 15_000 });
    await page.locator('[data-react-account-tools="ready"]').waitFor({ state: "visible", timeout: 15_000 });
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
    await page.locator('[data-react-member-banner="ready"]').waitFor({ state: "visible", timeout: 15_000 });
    await waitForText(page, "[data-react-member-banner]", `Welcome back, ${memberName}!`, "React member banner");
    if (memberIsAdmin) {
      await waitForText(page, "[data-react-admin-portal]", "Admin Portal", "React admin portal");
    } else if (await page.locator("[data-react-admin-portal]").count()) {
      throw new Error("React admin portal link rendered for a non-admin member.");
    }

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
      "#doublesLeague",
      "#doublesTable",
      "#seasonSelector",
      "#championsBanner",
    ].join(", ")).count();
    if (migratedLegacyNodes !== 0) {
      throw new Error("Migrated member dashboard legacy nodes are still present in the DOM.");
    }

    await waitForLiveRating(page);

    await page.getByRole("tab", { name: "Events" }).click();
    await waitForText(page, "#membersReactDashboardShell", "Event Registration", "events tab title");
    await expectReactTab(page, "Events");
    if (await page.locator("[data-react-admin-portal]").count()) {
      throw new Error("React admin portal link should only render on the overview tab.");
    }
    await expectDashboardPanel(page, "events", "#clubRegister", "Events tab");
    await page.locator('[data-react-casual-form="ready"]').waitFor({ state: "visible", timeout: 15_000 });

    await page.getByRole("tab", { name: "Board" }).click();
    await waitForText(page, "#membersReactDashboardShell", "Member Board", "board tab title");
    await expectReactTab(page, "Board");
    await expectDashboardPanel(page, "board", "#clubBoard", "Board tab");
    await page.locator('[data-react-board-panel="ready"]').waitFor({ state: "visible", timeout: 15_000 });

    await page.getByRole("tab", { name: "Tee Signs" }).click();
    await waitForText(page, "#membersReactDashboardShell", "Tee Sign Capture", "tee signs tab title");
    await expectReactTab(page, "Tee Signs");
    await expectDashboardPanel(page, "tee", "#teeCapture", "Tee Signs tab");
    await page.locator('[data-react-tee-signs-panel="ready"]').waitFor({ state: "visible", timeout: 15_000 });

    await page.getByRole("tab", { name: "Club" }).click();
    await waitForText(page, "#membersReactDashboardShell", "GVDG Member Directory", "club tab title");
    await expectReactTab(page, "Club");
    await page.locator('[data-react-club-panel="ready"]').waitFor({ state: "visible", timeout: 15_000 });
    await expectDashboardPanel(page, "club", "#membersReactClubPanel", "Club tab");
    await waitForText(page, "[data-react-club-panel]", "Membership Growth Since 2004", "React club growth chart");
    await waitForText(page, "[data-react-club-panel]", "Future Course Improvements - Ayden", "React meeting minutes");
    const clubPanel = page.locator('[data-react-club-panel]');
    const doublesPanel = clubPanel.locator('[data-react-doubles-league="ready"]');
    await doublesPanel.waitFor({ state: "visible", timeout: 15_000 });
    await waitForText(page, "[data-react-doubles-league]", "Doubles League Records", "React doubles title");
    await clubPanel.locator(".members-search").fill("Martinez");
    await waitForText(page, "[data-react-club-panel] .members-grid", "Juan Martinez", "React directory search");
    await clubPanel.locator(".members-search").fill("");
    await clubPanel.getByRole("button", { name: "PDGA Members" }).click();
    await waitForText(page, "[data-react-club-panel] .members-count", "Showing 12 of", "React directory PDGA filter count");
    await clubPanel.getByRole("button", { name: "All Members" }).click();
    await clubPanel.getByRole("button", { name: /Show More/ }).click();
    await waitForText(page, "[data-react-club-panel] .members-count", "Showing 24 of", "React directory load more count");
    await doublesPanel.getByRole("tab", { name: "All-Time Leaders" }).click();
    await doublesPanel.locator(".doubles-search-bar").fill("Blake Poland");
    await waitForText(page, "[data-react-doubles-league] .doubles-table-wrap", "Blake Poland", "React doubles all-time search");
    await doublesPanel.locator("tbody tr.clickable-row").filter({ hasText: "Blake Poland" }).first().click();
    await waitForText(page, ".player-modal", "Season History", "React doubles player modal");
    await page.getByRole("button", { name: "Close player details" }).click();
    await doublesPanel.getByRole("tab", { name: "Season Results" }).click();
    await doublesPanel.getByRole("button", { name: "Spring 2025" }).click();
    await waitForText(page, "[data-react-doubles-league] .doubles-table-wrap", "Blake Poland", "React doubles season results");

    const width = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth));
    const viewport = page.viewportSize()?.width || 390;
    if (width > viewport + 1) throw new Error(`Members dashboard has horizontal overflow: ${width}px > ${viewport}px.`);
    await page.getByRole("button", { name: "Log Out" }).click();
    await page.locator('[data-react-auth-gate="login"]').waitFor({ state: "visible", timeout: 15_000 });
    if (errors.length) throw new Error(errors.join("\n"));
    await context.close();
  } finally {
    await browser.close();
  }
}

async function main() {
  loadDeployEnv();
  const siteUrl = cleanUrl(env("GVDG_STAGING_SITE_URL"), DEFAULT_SITE_URL);
  const apiBase = cleanUrl(env("GVDG_STAGING_API_URL"), DEFAULT_API_URL);
  const token = await qaToken(apiBase);
  const member = await requestJson(apiBase, "/me", { token });
  if (!member || typeof member.name !== "string") throw new Error("QA token did not resolve to a named member.");
  if (!member.pdgaNo) throw new Error("QA member has no linked PDGA number. Run npm run qa:ensure-staging-dashboard-data.");

  await usefulStats(apiBase, member.pdgaNo);
  await runBrowserQa({ siteUrl, token, memberName: member.name, memberIsAdmin: member.isAdmin === true });
  console.log("staging member dashboard E2E passed");
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
