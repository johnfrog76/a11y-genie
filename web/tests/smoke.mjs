// `npm run smoke` -- the project's page and the deck page, in a browser, as Pages will serve them.
//
// It builds web/ (unless --no-build), puts the two pages together by running the Pages workflow's own
// "Assemble the page" step (.github/workflows/pages.yml), serves the result on 127.0.0.1, and holds:
//
//   1. While the registry is empty, the deck page says the deck is not here yet, and links back to the
//      project's page, which that link opens.
//   2. While DECK_URL is empty, the project's page has no deck button (scripts/build-site.ts).
//   3. On a phone, 390 px wide, the deck page does not scroll sideways.
//   4. Neither page logs an error.
//   5. A11y Genie's own scan of the deck page finds nothing critical or serious (it needs `npm run build` at the
//      repository's root first, for dist/cli.js).
//
// When a deck is registered, this test gains the checks that it plays, as Code Sleuth's does.
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
  // A registered deck needs this test's checks that it plays (see the top), added in the same commit.
  check(empty, "the registry is empty, as the checks below expect (a shipped deck brings its own checks)");

  // The project's page has no deck button while DECK_URL is empty.
  const desk = await open({ width: 1280, height: 800 });
  await desk.goto(BASE);
  check((await desk.locator('[data-cta="deck"]').count()) === 0, "the project's page has no deck button yet");
  await shot(desk, "landing-desktop");

  // The deck page says the deck is not here, and links back.
  await desk.goto(`${BASE}deck/`);
  const line = desk.getByText("The deck isn’t here yet.");
  await line.waitFor({ timeout: 15_000 }).catch(() => {});
  check(await line.isVisible(), 'the deck page says "The deck isn’t here yet."');
  const back = desk.getByRole("link", { name: "Back to A11y Genie" });
  check((await back.getAttribute("href")) === "../", 'it links "Back to A11y Genie" at ../');
  await shot(desk, "deck-empty-desktop");
  await back.click();
  await desk.waitForURL(BASE, { timeout: 5_000 }).catch(() => {});
  check(desk.url() === BASE, "that link opens the project's page");

  // A phone.
  const phone = await open({ width: 390, height: 844 });
  await phone.goto(`${BASE}deck/`);
  await phone
    .getByText("The deck isn’t here yet.")
    .waitFor({ timeout: 15_000 })
    .catch(() => {});
  check(!(await sideways(phone)), "on a phone, the deck page does not scroll sideways");
  await shot(phone, "deck-empty-phone");

  const real = errors.filter((text) => !/play\(\) failed|NotAllowedError|user didn't interact/i.test(text));
  check(real.length === 0, `neither page logs an error${real.length ? `: ${real.join(" | ")}` : ""}`);
} finally {
  await browser.close();
}

// 5. A11y Genie scans its own deck page, on the headless shell, held to the loopback address.
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
