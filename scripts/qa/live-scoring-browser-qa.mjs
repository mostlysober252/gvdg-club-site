import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const apiBase = "http://127.0.0.1:8788";

const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
]);

const holes = Array.from({ length: 18 }, (_, index) => ({
  hole: index + 1,
  par: 3,
  distance_ft: 260 + index * 12,
}));

const qaCourse = {
  id: 1,
  name: "ECU North Rec Complex",
  location: "Greenville, NC",
  lat: 35.631092,
  lng: -77.319923,
};

const qaLayout = {
  id: 11,
  name: "Pee Dee's Treasure Map",
  total_par: 54,
  holes: JSON.stringify(holes),
};

const weather = {
  location: {
    lat: qaCourse.lat,
    lng: qaCourse.lng,
    label: `${qaCourse.name} - ${qaCourse.location}`,
  },
  current: {
    source: "open-meteo",
    observedAt: "2026-07-05T18:15",
    fetchedAt: "2026-07-05T22:20:00.020Z",
    temperatureF: 96.4,
    apparentTemperatureF: 101.3,
    relativeHumidity: 42,
    precipitationIn: 0,
    rainIn: 0,
    showersIn: 0,
    snowfallIn: 0,
    weatherCode: 0,
    cloudCover: 0,
    windSpeedMph: 6.7,
    windDirectionDeg: 154,
    windGustMph: 8.1,
    isDay: true,
  },
  history: [],
  updatedAt: "2026-07-05T22:20:00.020Z",
  nextRefreshAt: "2026-07-05T22:25:00.020Z",
  error: null,
};

const courses = [
  qaCourse,
];

const layouts = [
  qaLayout,
];

const events = [
  {
    id: 2,
    type: "tournament",
    name: "Live Scoring QA",
    status: "live",
    format: "stroke",
    play_format: "singles",
    date: "2026-07-04",
    course_id: qaCourse.id,
    layout_id: qaLayout.id,
    liveScoringConfig: { groupFormat: "singles", scoringStyle: "stroke" },
  },
];

let createdRoundBody = null;

let eventLive = makeLiveSnapshot({
  eventId: 2,
  roundConfig: { groupFormat: "singles", scoringStyle: "stroke" },
  players: [
    makePlayer({ index: 0, name: "Ava King", cardId: "card-a", scores: { 1: 3 } }),
    makePlayer({ index: 1, name: "Milo Chen", cardId: "card-a", scores: { 1: 4 } }),
  ],
});

let roundLive = makeLiveSnapshot({
  roundCode: "QA1234",
  roundConfig: { groupFormat: "singles", scoringStyle: "stroke" },
  players: [
    makePlayer({ index: 0, name: "Ava King", cardId: "card-a", scores: {} }),
    makePlayer({ index: 1, name: "Milo Chen", cardId: "card-a", scores: {} }),
  ],
});

function makePlayer({ index, name, cardId, scores }) {
  return {
    index,
    cardId,
    name,
    division: "MA1",
    startingHole: 1,
    scores: { ...scores },
    scorecards: {},
    canEnterScorecard: true,
  };
}

function makeLiveSnapshot({ eventId = null, roundCode = null, roundConfig, players }) {
  return {
    status: "live",
    eventId,
    roundCode,
    format: roundConfig.scoringStyle,
    playFormat: roundConfig.groupFormat,
    roundConfig,
    courseName: qaCourse.name,
    layoutName: qaLayout.name,
    weather,
    holes,
    players,
    cardId: "card-a",
    playerIndex: 0,
    cardmates: activeCardmates(players),
    conflicts: [],
    missing: [],
    standings: standingsFor(players),
    rev: 1,
  };
}

function activeCardmates(players) {
  return players.filter((player) => !player.removed).map((player) => ({
    ...player,
    isMe: player.index === 0,
  }));
}

function standingsFor(players) {
  return players.filter((player) => !player.removed).map((player) => {
    const scoredHoles = holes.filter((hole) => Number.isInteger(player.scores[hole.hole]));
    const total = scoredHoles.reduce((sum, hole) => sum + player.scores[hole.hole], 0);
    const par = scoredHoles.reduce((sum, hole) => sum + hole.par, 0);
    return {
      name: player.name,
      division: player.division,
      thru: scoredHoles.length,
      total,
      toPar: total - par,
    };
  });
}

function scoreSnapshot(snapshot, body) {
  const player = snapshot.players.find((row) => row.index === body.index);
  if (!player) return snapshot;
  player.scores[body.hole] = body.strokes;
  player.scorecards[body.hole] = { [`player:${body.scorerIndex ?? body.index}`]: body.strokes };
  snapshot.cardmates = activeCardmates(snapshot.players);
  snapshot.standings = standingsFor(snapshot.players);
  snapshot.rev += 1;
  return snapshot;
}

function addGuest(snapshot, body) {
  const index = snapshot.players.reduce((max, player) => Math.max(max, player.index), -1) + 1;
  snapshot.players.push(makePlayer({ index, name: body.name || "Guest", cardId: "card-a", scores: {} }));
  snapshot.cardmates = activeCardmates(snapshot.players);
  snapshot.standings = standingsFor(snapshot.players);
  snapshot.rev += 1;
  return snapshot;
}

function removePlayer(snapshot, body) {
  const player = snapshot.players.find((row) => row.index === body.index && row.name === body.name);
  if (!player) return { ok: false, snapshot };
  player.removed = true;
  player.scores = {};
  player.scorecards = {};
  snapshot.cardmates = activeCardmates(snapshot.players);
  snapshot.standings = standingsFor(snapshot.players);
  snapshot.rev += 1;
  return { ok: true, snapshot };
}

function json(body, status = 200) {
  return {
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  };
}

function parseBody(request) {
  const raw = request.postData() || "{}";
  return JSON.parse(raw);
}

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

async function installApiRoutes(page) {
  await page.route(`${apiBase}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathName = url.pathname;
    const method = request.method();

    if (pathName === "/me") return route.fulfill(json({ sub: "member-1", isAdmin: true, name: "QA Admin" }));
    if (pathName === "/login" && method === "POST") return route.fulfill(json({ token: "qa-token", name: "QA Admin" }));
    if (pathName === "/courses" && method === "GET") return route.fulfill(json({ courses }));
    if (pathName === "/courses/1/layouts" && method === "GET") return route.fulfill(json({ layouts }));
    if (pathName === "/courses/1/tee-signs" && method === "GET") return route.fulfill(json({ teeSigns: [] }));
    if (pathName === "/events" && method === "GET") return route.fulfill(json({ events }));
    if (pathName === "/events/2" && method === "GET") return route.fulfill(json({ event: events[0] }));
    if (pathName === "/events/2/live" && method === "GET") return route.fulfill(json(eventLive));
    if (pathName === "/events/2/live/score" && method === "POST") {
      eventLive = scoreSnapshot(eventLive, parseBody(request));
      return route.fulfill(json(eventLive));
    }
    if (pathName === "/rounds" && method === "POST") {
      createdRoundBody = parseBody(request);
      return route.fulfill(json({ code: "QA1234" }, 201));
    }
    if (pathName === "/rounds/QA1234/live/mine" && method === "GET") return route.fulfill(json(roundLive));
    if (pathName === "/rounds/QA1234/live/score" && method === "POST") {
      roundLive = scoreSnapshot(roundLive, parseBody(request));
      return route.fulfill(json(roundLive));
    }
    if (pathName === "/rounds/QA1234/join" && method === "POST") return route.fulfill(json(roundLive));
    if (pathName === "/rounds/QA1234/guest" && method === "POST") {
      roundLive = addGuest(roundLive, parseBody(request));
      return route.fulfill(json(roundLive));
    }
    if (pathName === "/rounds/QA1234/remove" && method === "POST") {
      const result = removePlayer(roundLive, parseBody(request));
      roundLive = result.snapshot;
      return route.fulfill(json(result.ok ? roundLive : { error: "no_player" }, result.ok ? 200 : 404));
    }
    if (pathName === "/shop/orders/new-count" && method === "GET") return route.fulfill(json({ count: 0 }));
    if (pathName === "/leagues" && method === "GET") return route.fulfill(json({ leagues: [] }));
    if (pathName === "/meetings" && method === "GET") return route.fulfill(json({ meetings: [] }));
    if (pathName === "/admin/members" && method === "GET") return route.fulfill(json({ members: [] }));
    if (pathName.startsWith("/admin/")) return route.fulfill(json({ ok: true }));

    return route.fulfill(json({ ok: true }));
  });
}

function collectPageErrors(page, errors) {
  page.on("console", (message) => {
    const text = message.text();
    if (message.type() !== "error") return;
    if (/WebSocket connection to .*127\.0\.0\.1:8788.*ERR_CONNECTION_REFUSED/.test(text)) return;
    if (/Failed to load resource: the server responded with a status of 404/.test(text)) return;
    errors.push(text);
  });
  page.on("pageerror", (error) => errors.push(error.message));
}

async function runCasualRoundQa(browser, origin) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  collectPageErrors(page, errors);
  page.on("dialog", (dialog) => {
    errors.push(`Unexpected native dialog: ${dialog.type()} ${dialog.message()}`);
    return dialog.dismiss();
  });
  await installApiRoutes(page);
  await page.addInitScript(() => {
    sessionStorage.setItem("gvdg_member_token", "qa-token");
    class MockDeviceOrientationEvent extends Event {
      constructor(type, init = {}) {
        super(type);
        this.absolute = Boolean(init.absolute);
        this.alpha = init.alpha;
        this.webkitCompassHeading = init.webkitCompassHeading;
      }
    }
    MockDeviceOrientationEvent.requestPermission = (absolute) => {
      window.__gvdgOrientationPermission = absolute;
      return Promise.resolve("granted");
    };
    Object.defineProperty(window, "DeviceOrientationEvent", { configurable: true, value: MockDeviceOrientationEvent });
  });

  await page.goto(`${origin}/score.html`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /Start a casual round/ }).click();
  await page.getByRole("button", { name: /ECU North Rec Complex/ }).click();
  await page.getByRole("button", { name: /Pee Dee/ }).click();
  await page.locator("[data-group-format='singles']").click();
  await page.locator("[data-scoring-style='stroke']").click();
  await page.locator("[data-create-round='casual']").click();
  await page.waitForURL(/round=QA1234/);
  await page.waitForSelector(".hole-head");
  await waitForPageText(page, ".weather-strip", "Round weather", "casual weather title");
  await waitForPageText(page, ".weather-strip", "Clear", "casual weather condition");
  await waitForPageText(page, ".weather-wind", "SSE 7 mph", "casual weather wind");
  await waitForPageText(page, ".weather-strip", qaCourse.name, "casual weather course label");
  await page.locator(".weather-wind").click();
  await page.evaluate(() => {
    window.dispatchEvent(new DeviceOrientationEvent("deviceorientation", { absolute: true, alpha: 90 }));
  });
  await waitForPageText(page, ".weather-wind", "Phone-relative", "casual weather wind device orientation mode");
  const windArrow = await page.locator(".weather-wind-arrow").evaluate((arrow) => ({
    relative: arrow.getAttribute("data-relative"),
    status: arrow.getAttribute("data-compass-status"),
    transform: arrow.style.transform,
    permission: window.__gvdgOrientationPermission,
  }));
  if (windArrow.permission !== true) throw new Error(`Expected absolute orientation permission request, got ${windArrow.permission}`);
  if (windArrow.relative !== "facing" || windArrow.status !== "active" || windArrow.transform !== "rotate(64deg)") {
    throw new Error(`Unexpected relative wind arrow state: ${JSON.stringify(windArrow)}`);
  }

  await page.getByRole("button", { name: "Add player" }).click();
  await page.getByRole("dialog", { name: "Add player" }).waitFor();
  await page.getByLabel("Player name").fill("Nina Park");
  await page.locator(".score-dialog").getByRole("button", { name: "Add player" }).click();
  await waitForPageText(page, "body", "Nina Park", "added player score row");
  await page.getByRole("button", { name: "Manage" }).click();
  await page.waitForSelector(".sheet");
  const ninaRow = page.locator(".manage-player-row").filter({ hasText: "Nina Park" });
  await ninaRow.getByRole("button", { name: "Remove" }).click();
  await page.getByRole("dialog", { name: "Remove Nina Park?" }).waitFor();
  await page.locator(".score-dialog").getByRole("button", { name: "Remove player" }).click();
  await page.waitForFunction(() => !document.body.textContent.includes("Nina Park"), null, { timeout: 5_000 });

  if (createdRoundBody?.liveScoringConfig?.groupFormat !== "singles") {
    throw new Error(`Expected singles config, got ${JSON.stringify(createdRoundBody)}`);
  }
  if (createdRoundBody?.liveScoringConfig?.scoringStyle !== "stroke") {
    throw new Error(`Expected stroke config, got ${JSON.stringify(createdRoundBody)}`);
  }

  await page.locator(".prow").filter({ hasText: "Ava King" }).locator("button.plus").click();
  await waitForPageText(page, ".totbar", "1/18", "casual score total");
  await page.locator("#lbBtn").click();
  await page.waitForSelector(".sheet");
  const leaderboard = await page.locator(".sheet").innerText();
  if (!leaderboard.includes("Ava King") || !leaderboard.includes("1")) {
    throw new Error(`Casual leaderboard did not reflect saved score: ${leaderboard}`);
  }
  if (errors.length) throw new Error(errors.join("\n"));
  await context.close();
}

async function waitForPageText(page, selector, expected, label) {
  try {
    await page.waitForFunction(
      ({ selector: query, expected: text }) => document.querySelector(query)?.textContent?.includes(text),
      { selector, expected },
      { timeout: 5_000 },
    );
  } catch (error) {
    const body = await page.locator("body").innerText().catch(() => "");
    throw new Error(`Timed out waiting for ${label} to include ${expected}. Page text:\n${body}`);
  }
}

async function runAdminEventQa(browser, origin) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  collectPageErrors(page, errors);
  await installApiRoutes(page);
  await page.addInitScript(() => {
    sessionStorage.setItem("gvdg_member_token", "qa-token");
  });

  await page.goto(`${origin}/admin.html`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#adminPanel", { state: "visible" });
  await page.locator('[data-atab="scoring"]').first().click();
  await page.locator("#scEvent").selectOption("2");
  await page.waitForSelector("#scGrid tbody tr");
  const rowsBefore = await page.locator("#scGrid tbody tr").evaluateAll((rows) => rows.map((row) => row.textContent?.trim() || ""));
  if (!rowsBefore.some((row) => row.includes("Ava King"))) {
    throw new Error(`Admin live grid missing Ava King: ${JSON.stringify(rowsBefore)}`);
  }
  const firstScoreInput = page.locator("#scGrid tbody tr").first().locator("input").nth(1);
  await firstScoreInput.fill("4");
  await firstScoreInput.dispatchEvent("change");
  await page.waitForFunction(() => document.querySelector("#scBoard")?.textContent?.includes("Ava King"));
  const board = await page.locator("#scBoard").innerText();
  if (!board.includes("Ava King")) throw new Error(`Admin leaderboard missing Ava King: ${board}`);
  if (errors.length) throw new Error(errors.join("\n"));
  await context.close();
}

const staticServer = await startStaticServer();
const browser = await chromium.launch({ headless: true });

try {
  await runCasualRoundQa(browser, staticServer.origin);
  await runAdminEventQa(browser, staticServer.origin);
} finally {
  await browser.close();
  await staticServer.close();
}

console.log("live-scoring browser QA passed");
