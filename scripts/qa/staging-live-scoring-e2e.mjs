import { chromium } from "playwright";

const DEFAULT_SITE_URL = "https://gvdgclub.com";
const DEFAULT_API_URL = "https://auth.gvdgclub.com";
const DEFAULT_GET_TIMEOUT_MS = 45_000;
const DEFAULT_MUTATION_TIMEOUT_MS = 15_000;
const SAFE_GET_RETRIES = 2;
const TOKEN_KEY = "gvdg_member_token";

function env(name) {
  return (process.env[name] || "").trim();
}

function cleanUrl(value, fallback) {
  const raw = value || fallback;
  return raw.replace(/\/+$/, "");
}

function jsonHeaders(token) {
  const headers = { Accept: "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  return headers;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isSafeGet(options) {
  return (options.method || "GET").toUpperCase() === "GET" && options.body === undefined;
}

function isTransientApiError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("TimeoutError") ||
    message.includes("server_error") ||
    message.includes("Network connection lost") ||
    message.includes("fetch failed")
  );
}

async function requestJson(apiBase, path, options = {}) {
  const attempts = options.retries ?? (isSafeGet(options) ? SAFE_GET_RETRIES + 1 : 1);
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const headers = jsonHeaders(options.token);
    const method = options.method || "GET";
    const init = {
      method,
      headers,
      signal: AbortSignal.timeout(options.timeoutMs || (method.toUpperCase() === "GET" ? DEFAULT_GET_TIMEOUT_MS : DEFAULT_MUTATION_TIMEOUT_MS)),
    };
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(options.body);
    }

    try {
      const response = await fetch(apiBase + path, init);
      const text = await response.text();
      let data = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch (error) {
          if (error instanceof SyntaxError) data = { raw: text };
          else throw error;
        }
      }
      if (!response.ok) {
        const message = data && typeof data.error === "string" ? data.error : text.slice(0, 200);
        throw new Error(`API ${init.method} ${path} failed with ${response.status}: ${message}`);
      }
      return data;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt >= attempts || !isTransientApiError(lastError)) throw lastError;
      await sleep(500 * attempt);
    }
  }
  throw lastError ?? new Error(`API GET ${path} failed`);
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

function rowId(row) {
  const id = Number(row?.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function chooseCourseLayout(apiBase) {
  const wantedCourse = env("GVDG_STAGING_QA_COURSE_ID");
  const wantedLayout = env("GVDG_STAGING_QA_LAYOUT_ID");
  const coursesData = await requestJson(apiBase, "/courses");
  const courses = Array.isArray(coursesData?.courses) ? coursesData.courses : [];

  for (const course of courses) {
    const courseId = rowId(course);
    if (courseId == null) continue;
    if (wantedCourse && String(courseId) !== wantedCourse) continue;

    const layoutsData = await requestJson(apiBase, `/courses/${courseId}/layouts`);
    const layouts = Array.isArray(layoutsData?.layouts) ? layoutsData.layouts : [];
    const layout = layouts.find((candidate) => {
      const layoutId = rowId(candidate);
      if (layoutId == null) return false;
      return !wantedLayout || String(layoutId) === wantedLayout;
    });
    if (layout) return { course, layout };
  }

  const suffix = wantedCourse || wantedLayout ? " matching the configured ids" : "";
  throw new Error(`No scorable course/layout found${suffix}.`);
}

function collectPageErrors(page) {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function waitForPageText(page, selector, expected, label) {
  try {
    await page.waitForFunction(
      ({ selector: query, expected: text }) => document.querySelector(query)?.textContent?.includes(text),
      { selector, expected },
      { timeout: 10_000 },
    );
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    const body = await page.locator("body").innerText().catch(() => "");
    throw new Error(`Timed out waiting for ${label} to include ${expected}. Page text:\n${body}`);
  }
}

function firstHole(snapshot) {
  const holes = Array.isArray(snapshot?.holes) ? snapshot.holes : [];
  const hole = holes.find((row) => Number.isInteger(Number(row?.hole)) && Number.isFinite(Number(row?.par)));
  if (!hole) throw new Error("Round snapshot did not include a scorable hole.");
  return { hole: Number(hole.hole), par: Number(hole.par) };
}

function scoredPlayer(snapshot, memberName) {
  const cardmates = Array.isArray(snapshot?.cardmates) ? snapshot.cardmates : [];
  return cardmates.find((row) => row?.isMe === true) || cardmates.find((row) => row?.name === memberName) || cardmates[0] || null;
}

async function waitForSavedScore(apiBase, token, code, memberName, hole, expectedStrokes) {
  const deadline = Date.now() + 12_000;
  let last = null;
  while (Date.now() < deadline) {
    last = await requestJson(apiBase, `/rounds/${encodeURIComponent(code)}/live/mine`, { token });
    const player = scoredPlayer(last, memberName);
    const score = Number(player?.scores?.[hole]);
    if (score === expectedStrokes) return last;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`Timed out waiting for saved hole ${hole} score ${expectedStrokes}: ${JSON.stringify(last)}`);
}

async function runBrowserQa({ siteUrl, apiBase, token, member, course, layout }) {
  const browser = await chromium.launch({ headless: true });
  let roundCode = "";
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const errors = collectPageErrors(page);
    await page.addInitScript(
      ({ key, value }) => sessionStorage.setItem(key, value),
      { key: TOKEN_KEY, value: token },
    );

    await page.goto(`${siteUrl}/score.html`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /Start a casual round/ }).click();
    await page.locator("button.tap-row").filter({ hasText: String(course.name || course.id) }).first().click();
    await page.locator("button.tap-row").filter({ hasText: String(layout.name || "Layout") }).first().click();
    await page.locator("[data-group-format='singles']").click();
    await page.locator("[data-scoring-style='stroke']").click();
    await page.locator("[data-create-round='casual']").click();
    await page.waitForURL(/round=[A-Z0-9]+/, { timeout: 20_000 });

    roundCode = new URL(page.url()).searchParams.get("round") || "";
    if (!roundCode) throw new Error("Created round did not put a round code in the URL.");
    await page.waitForSelector(".hole-head", { timeout: 20_000 });

    const snapshot = await requestJson(apiBase, `/rounds/${encodeURIComponent(roundCode)}/live/mine`, { token });
    const targetHole = firstHole(snapshot);
    await page.locator(".prow").first().locator("button.plus").click();
    await waitForPageText(page, ".totbar", "1/", "scored hole count");
    await waitForSavedScore(apiBase, token, roundCode, member.name, targetHole.hole, targetHole.par);

    await page.locator("#lbBtn").click();
    await page.waitForSelector(".sheet", { timeout: 10_000 });
    const leaderboard = await page.locator(".sheet").innerText();
    if (!leaderboard.includes(member.name)) {
      throw new Error(`Leaderboard did not include QA member ${member.name}: ${leaderboard}`);
    }
    if (errors.length) throw new Error(errors.join("\n"));
    await context.close();
    return roundCode;
  } finally {
    await browser.close();
  }
}

async function cleanupRound(apiBase, token, code) {
  await requestJson(apiBase, `/rounds/${encodeURIComponent(code)}/cancel`, {
    method: "POST",
    token,
    body: {},
  });
}

async function main() {
  const siteUrl = cleanUrl(env("GVDG_STAGING_SITE_URL"), DEFAULT_SITE_URL);
  const apiBase = cleanUrl(env("GVDG_STAGING_API_URL"), DEFAULT_API_URL);
  const token = await qaToken(apiBase);
  const member = await requestJson(apiBase, "/me", { token });
  if (!member || typeof member.name !== "string") throw new Error("QA token did not resolve to a named member.");
  if (member.isAdmin !== true) throw new Error("The staging QA member must be an admin so QA rounds can be cancelled.");

  const { course, layout } = await chooseCourseLayout(apiBase);
  let roundCode = "";
  let testError = null;
  try {
    roundCode = await runBrowserQa({ siteUrl, apiBase, token, member, course, layout });
  } catch (error) {
    testError = error instanceof Error ? error : new Error(String(error));
  }

  let cleanupError = null;
  if (roundCode) {
    try {
      await cleanupRound(apiBase, token, roundCode);
    } catch (error) {
      cleanupError = error instanceof Error ? error : new Error(String(error));
    }
  }

  if (testError || cleanupError) {
    const parts = [];
    if (testError) parts.push(testError.message);
    if (cleanupError) parts.push("Cleanup failed: " + cleanupError.message);
    throw new Error(parts.join("\n"));
  }
  console.log("staging live-scoring E2E passed");
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
