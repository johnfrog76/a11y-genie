// `npm run smoke` -- the project's page and the deck page, in a browser, as Pages will serve them.
//
// It builds web/ (unless --no-build), puts the two pages together by running the Pages workflow's own
// "Assemble the page" step (.github/workflows/pages.yml), serves the result on 127.0.0.1, and holds:
//
//   1. The deck page plays the registered deck: "1 / N" in its bar, slide 1's title on screen, and Escape
//      leaves it for the project's page.
//   2. Every baked clip is in the build and answers 200 as audio.
//   3. While DECK_URL is empty, the project's page has no deck button (scripts/build-site.ts).
//   4. On a phone, 390 px wide, the deck page plays slide 1 and does not scroll sideways.
//   5. Neither page logs an error.
//   6. A11y Genie's own scan of the deck page, on the deck's first slide, finds nothing critical or serious (it
//      needs `npm run build` at the repository's root first, for dist/cli.js).
//
// The browser is Playwright's headless shell, never the Google Chrome app: playwright-core launched headless
// with no channel runs the shell (`npx playwright-core@1.65.1 install chromium` installs it). It needs no
// network.
//
// Options:
//   --no-build        use web/dist as it is
//   --shots <dir>     save screenshots there
//   --serve           after the checks, keep serving and print the address (stop with Ctrl+C)
//   --host <addr>     the address to listen on (default 127.0.0.1)
//   --port <n>        the port (default: any free one)
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(WEB_ROOT, "..");
const CLI = path.join(REPO_ROOT, "dist", "cli.js");
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
  ".png": "image/png",
  ".json": "application/json",
};

const args = process.argv.slice(2);
const option = (name) => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
};
const shots = option("--shots");
const host = option("--host") ?? "127.0.0.1";
const port = Number(option("--port") ?? 0);

const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};

// 1. Build web/, then put the two pages together in a scratch folder: the project's page at the top, the deck
// page at deck/.
if (!args.includes("--no-build")) {
  const built = spawnSync("npm", ["run", "build"], {
    cwd: WEB_ROOT,
    stdio: "ignore",
    shell: process.platform === "win32",
  });
  if (built.status !== 0) throw new Error("npm run build failed in web/");
}
// The two are put together by the Pages workflow's own "Assemble the page" step, read from
// .github/workflows/pages.yml and run here in a scratch folder, so what this test serves is what Pages publishes.
const workflow = fs.readFileSync(path.join(REPO_ROOT, ".github", "workflows", "pages.yml"), "utf8");
const step = /- name: Assemble the page\n\s+run: \|\n((?:\s{10}.*\n)+)/.exec(workflow);
if (!step) throw new Error('pages.yml has no "Assemble the page" step to run');
const assemble = step[1]
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean)
  .join("\n");
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-genie-pages-"));
for (const folder of ["site", "web"]) {
  fs.symlinkSync(path.join(REPO_ROOT, folder), path.join(scratch, folder), "dir");
}
// Copied, not linked: scripts/build-site.ts builds only when it is the script Node was started on, which it
// tells by its own path, and a link would give it a second one.
fs.cpSync(path.join(REPO_ROOT, "scripts"), path.join(scratch, "scripts"), { recursive: true });
const ran = spawnSync("bash", ["-e", "-c", assemble], { cwd: scratch, stdio: "inherit" });
if (ran.status !== 0) throw new Error("the Assemble the page step failed");
const SITE = path.join(scratch, "_site");

// 2. Serve it, as Pages would: a folder answers with its index.html.
const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  let file = path.join(SITE, decodeURIComponent(url.pathname));
  if (!file.startsWith(SITE)) {
    res.writeHead(403).end();
    return;
  }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  if (!fs.existsSync(file)) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((done) => server.listen(port, host, done));
const address = server.address();
const BASE = `http://${host.includes(":") ? `[${host}]` : host}:${address.port}/`;

const registry = fs.readFileSync(path.join(WEB_ROOT, "src", "deck", "decks", "index.ts"), "utf8");
const empty = /export const DECKS: Deck\[\] = \[\];/.test(registry);
const VOICES = path.join(WEB_ROOT, "src", "deck", "voices");

// No channel, headless: playwright-core's headless shell.
const browser = await chromium.launch({ headless: true });
const errors = [];
const open = async (viewport) => {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return page;
};
const shot = async (page, name) => {
  if (shots) {
    fs.mkdirSync(shots, { recursive: true });
    await page.screenshot({ path: path.join(shots, `${name}.png`) });
  }
};
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);

try {
  check(!empty, "the registry lists a deck, as the checks below expect");

  // The project's page has no deck button while DECK_URL is empty.
  const desk = await open({ width: 1280, height: 800 });
  await desk.goto(BASE);
  check((await desk.locator('[data-cta="deck"]').count()) === 0, "the project's page has no deck button yet");
  await shot(desk, "landing-desktop");

  // The deck page plays the deck.
  await desk.goto(`${BASE}deck/`);
  const counter = desk.getByText(/^\s*1\s*\/\s*\d+\s*$/).first();
  await counter.waitFor({ timeout: 15_000 }).catch(() => {});
  check(await counter.isVisible(), 'the deck page plays the deck: "1 / N" in its bar');
  const title = desk.locator("h1, h2").first();
  check(
    (await title.isVisible()) && (await title.innerText()).trim().length > 0,
    "slide 1's title is on screen",
  );
  await desk.waitForTimeout(1500);
  await shot(desk, "deck-slide-1-desktop");

  // Every baked clip is in the build and answers as audio.
  const baked = fs
    .readdirSync(VOICES, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) =>
      fs.readdirSync(path.join(VOICES, entry.name)).filter((name) => name.endsWith(".mp3")),
    );
  const built = fs.readdirSync(path.join(SITE, "deck", "assets")).filter((name) => name.endsWith(".mp3"));
  check(
    built.length === baked.length,
    `every baked clip is in the build (${built.length} of ${baked.length})`,
  );
  let answered = 0;
  for (const name of built) {
    const response = await globalThis.fetch(`${BASE}deck/assets/${name}`);
    if (response.ok && response.headers.get("content-type") === "audio/mpeg") answered += 1;
  }
  check(built.length > 0 && answered === built.length, "each clip answers 200 as audio");

  // Escape leaves the deck for the project's page.
  await desk.keyboard.press("Escape");
  await desk.waitForURL(BASE, { timeout: 5_000 }).catch(() => {});
  check(desk.url() === BASE, "Escape leaves the deck for the project's page");

  // A phone.
  const phone = await open({ width: 390, height: 844 });
  await phone.goto(`${BASE}deck/`);
  const phoneCounter = phone.getByText(/^\s*1\s*\/\s*\d+\s*$/).first();
  await phoneCounter.waitFor({ timeout: 15_000 }).catch(() => {});
  check(await phoneCounter.isVisible(), "on a phone, the deck page plays slide 1");
  check(!(await sideways(phone)), "on a phone, the deck page does not scroll sideways");
  await phone.waitForTimeout(1500);
  await shot(phone, "deck-slide-1-phone");

  // A browser may refuse sound before a press; that is not an error of the page's.
  const real = errors.filter((text) => !/play\(\) failed|NotAllowedError|user didn't interact/i.test(text));
  check(real.length === 0, `neither page logs an error${real.length ? `: ${real.join(" | ")}` : ""}`);
} finally {
  await browser.close();
}

// 6. A11y Genie scans its own deck page, on the deck's first slide, on the headless shell, held to the loopback address.
if (!fs.existsSync(CLI)) {
  check(false, "A11y Genie scans the deck page: run `npm run build` at the repository's root first");
} else {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-genie-deck-scan-"));
  // Asynchronous, so this process's own server keeps answering while the scan loads the page.
  const scan = await new Promise((done) => {
    const child = spawn(
      process.execPath,
      [
        CLI,
        "scan",
        `${BASE}deck/`,
        "--offline",
        "--browser-channel",
        "chromium",
        "--fail-on",
        "serious",
        "--out",
        out,
      ],
      { env: { ...process.env, A11Y_GENIE_TEST_HEADLESS_SHELL: "1" } },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (status) => done({ status, stdout, stderr }));
  });
  check(
    scan.status === 0,
    `A11y Genie's scan of the deck page finds nothing critical or serious (exit ${scan.status})`,
  );
  if (scan.status !== 0) console.log(scan.stdout, scan.stderr);
  fs.rmSync(out, { recursive: true, force: true });
}

console.log(failures.length === 0 ? "\nAll checks passed." : `\n${failures.length} check(s) failed.`);
if (args.includes("--serve")) {
  console.log(`Serving ${BASE} (the project's page) and ${BASE}deck/ (the deck page). Ctrl+C stops it.`);
} else {
  server.close();
  fs.rmSync(scratch, { recursive: true, force: true });
  process.exitCode = failures.length === 0 ? 0 : 1;
}
