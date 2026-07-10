import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const apiBase = "http://127.0.0.1:8788";
const evidenceDir = path.join(repoRoot, ".omo/evidence/site-smoke-browser-qa");

const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
]);

const holes = Array.from({ length: 18 }, (_, index) => ({
  hole: index + 1,
  par: 3,
  distance_ft: 250 + index * 10,
}));

const courses = [
  { id: 1, name: "ECU North Rec Complex", location: "Greenville, NC", lat: 35.631, lng: -77.32 },
];

const layouts = [
  { id: 11, name: "Main Layout", total_par: 54, holes: JSON.stringify(holes) },
];

const events = [
  {
    id: 2,
    type: "tournament",
    name: "Release Smoke Open",
    status: "scheduled",
    format: "stroke",
    play_format: "singles",
    date: "2026-07-15",
    course_id: 1,
    layout_id: 11,
    players: [],
  },
  {
    id: 3,
    type: "league",
    name: "Release Smoke League",
    status: "scheduled",
    format: "stroke",
    play_format: "singles",
    date: "2026-08-01",
    course_id: 1,
    layout_id: 11,
    players: [],
  },
];

const league = {
  id: 4,
  name: "Ryder Cup",
  standings: [],
  teamStandings: [],
  roundWinners: [],
  events: [],
};

const pages = [
  {
    name: "home",
    path: "/index.html",
    text: ["Greenville Disc Golf Club", "Our Courses"],
  },
  {
    name: "events-status",
    path: "/events.html",
    text: ["Events & Club Events", "Leagues & Standings"],
  },
  {
    name: "events-detail",
    path: "/events.html#event/2",
    text: ["Release Smoke Open", "ECU North Rec Complex"],
  },
  {
    name: "events-league",
    path: "/events.html#league/4",
    text: ["Ryder Cup"],
  },
  {
    name: "members-auth",
    path: "/gvdg-members.html",
    text: ["Members Only", "PDGA # or UDisc Username"],
  },
  {
    name: "admin-auth",
    path: "/admin.html",
    text: ["Admin", "Event management"],
  },
  {
    name: "blog",
    path: "/gvdg-blog.html",
    text: ["Club Blog", "Coming Soon"],
  },
  {
    name: "pro-shop",
    path: "/pro-shop.html",
    text: ["Pro Shop", "GVDG Disc"],
  },
  {
    name: "ryder-cup",
    path: "/ryder-cup.html",
    text: ["Ryder Cup"],
  },
  {
    name: "tee-sign-preview",
    path: "/tee-sign-preview.html",
    text: ["Tee-sign preview", "Battle Park"],
  },
];

const viewports = [
  { label: "mobile", width: 390, height: 844 },
  { label: "desktop", width: 1280, height: 900 },
];

function json(body, status = 200) {
  return {
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  };
}

function csv() {
  return [
    "Name,Date,Detail,URL",
    "Release Smoke,Jul 15 2026,QA row,https://gvdgclub.com",
  ].join("\n");
}

function apiResponse(url) {
  const pathName = url.pathname;
  if (pathName === "/me") return json({ error: "unauthorized" }, 401);
  if (pathName === "/courses") return json({ courses });
  if (pathName === "/courses/1/layouts") return json({ layouts });
  if (pathName === "/courses/1/tee-signs") return json({ teeSigns: [] });
  if (pathName === "/events") return json({ events });
  if (pathName === "/events/2") return json({ event: events[0] });
  if (pathName === "/events/2/ace-pot") return json({ ace_pot: null });
  if (pathName === "/events/2/ctps") return json({ ctps: [] });
  if (pathName === "/events/2/registration") return json({ registrations: [], players: [] });
  if (pathName === "/events/2/results") return json({ results: [] });
  if (pathName === "/club-feed") return json({ events: [], clubEvents: [] });
  if (pathName === "/fundraisers") return json({ fundraisers: [] });
  if (pathName === "/leagues") return json({ leagues: [league] });
  if (pathName === "/leagues/4") return json(league);
  if (pathName === "/meetings") return json({ meetings: [] });
  if (pathName === "/payments/config") return json({ enabled: false });
  if (pathName === "/shop/products") {
    return json({
      products: [
        {
          id: 1,
          active: 1,
          brand: "GVDG",
          name: "GVDG Disc",
          price_cents: 1800,
          product_type: "disc",
          stock_qty: 4,
        },
      ],
    });
  }
  if (pathName === "/shop/wallet") return json({ balance_cents: 0, orders: [] });
  return json({});
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

async function installRoutes(context) {
  await context.route(`${apiBase}/**`, (route) => {
    route.fulfill(apiResponse(new URL(route.request().url())));
  });
  await context.route("**/favicon.ico", (route) => route.fulfill({ status: 204, body: "" }));
  await context.route("https://docs.google.com/**", (route) => {
    route.fulfill({ status: 200, contentType: "text/csv; charset=utf-8", body: csv() });
  });
  await context.route("https://www.paypal.com/**", (route) => route.fulfill({ status: 204, body: "" }));
}

async function waitForText(page, expected, label) {
  await page.waitForFunction(
    ({ expected: values }) => values.every((value) => document.body.textContent.includes(value)),
    { expected },
    { timeout: 12_000 },
  ).catch(async () => {
    const body = await page.locator("body").innerText().catch(() => "");
    throw new Error(`${label} did not render expected text ${JSON.stringify(expected)}. Page text:\n${body}`);
  });
}

async function assertNoHorizontalOverflow(page, label) {
  const overflow = await page.evaluate(() =>
    Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
  );
  if (overflow <= 1) return;
  throw new Error(`${label} has horizontal overflow of ${overflow}px`);
}

async function runPage(browser, server, item, viewport) {
  const context = await browser.newContext({ viewport });
  await installRoutes(context);
  const page = await context.newPage();
  const errors = collectPageErrors(page);
  try {
    await page.goto(`${server.origin}${item.path}`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => {});
    await waitForText(page, item.text, item.name);
    await assertNoHorizontalOverflow(page, `${viewport.width} ${item.name}`);
    if (errors.length) throw new Error(errors.join("\n"));
    await page.screenshot({
      path: path.join(evidenceDir, `${viewport.width}-${item.name}.png`),
      fullPage: true,
    });
  } finally {
    await context.close();
  }
}

await mkdir(evidenceDir, { recursive: true });
const server = await startStaticServer();
const browser = await chromium.launch();
const failures = [];
try {
  for (const viewport of viewports) {
    for (const item of pages) {
      try {
        await runPage(browser, server, item, { width: viewport.width, height: viewport.height });
        console.log(`PASS ${viewport.label} ${item.name}`);
      } catch (error) {
        failures.push(`${viewport.label} ${item.name}: ${error.message}`);
        console.error(`FAIL ${viewport.label} ${item.name}: ${error.message}`);
      }
    }
  }
} finally {
  await browser.close();
  await server.close();
}

if (failures.length) {
  console.error(`site smoke browser QA failed:\n${failures.join("\n")}`);
  process.exit(1);
}

console.log(`site smoke browser QA passed; screenshots: ${evidenceDir}`);
