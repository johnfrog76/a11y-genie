// `npm run smoke` -- the project's page and the deck page, in a browser, as Pages will serve them.
//
// It builds web/ (unless --no-build), puts the two pages together by running the Pages workflow's own
// "Assemble the page" step (.github/workflows/pages.yml), serves the result on 127.0.0.1, and holds:
//
//   1. The deck page plays the registered deck: "1 / N" in its bar, slide 1's title on screen, and Escape
//      leaves it for the project's page.
//   2. Every baked clip is in the build and answers 200 as audio, and for every slide and every voice the player
//      finds a clip, and that clip is served. The player's own resolver (src/deck/bakedVoices.ts) is asked,
//      loaded through Vite, so a slide renamed away from its clip fails here instead of playing silent.
//   3. The project's page shows "Watch the video" (scripts/build-site.ts, DECK_URL), and it opens deck/.
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
//   --serve           after the checks, keep serving and print the address (stop with Ctrl+C); the exit code
//                     still says whether the checks held
//   --host <addr>     the address to listen on (default 127.0.0.1)
//   --port <n>        the port (default: any free one)
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream";
import { setTimeout } from "node:timers";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer as createVite } from "vite";

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

// What this run makes is put away on every way out: the checks ending, a step that fails, a check that throws,
// a browser that will not start, and Ctrl+C or SIGTERM, with --serve or without it.
let scratch;
let scanOut;
let server;
let browser;
let serving = false;
let cleaning;
const cleanUp = () =>
  (cleaning ??= (async () => {
    for (const folder of [scanOut, scratch]) {
      if (folder) fs.rmSync(folder, { recursive: true, force: true });
    }
    await browser?.close().catch(() => {});
    if (server) {
      server.closeAllConnections();
      await new Promise((done) => server.close(() => done()));
    }
  })());
const stop = (signal) => {
  // Stopped while serving, the exit code is the checks'; stopped during them, it is the signal's.
  const code = serving ? (process.exitCode ?? 0) : 128 + os.constants.signals[signal];
  // A browser that will not close cannot keep the run alive: five seconds, then out.
  setTimeout(() => process.exit(code), 5_000).unref();
  cleanUp().finally(() => process.exit(code));
};
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.once(signal, stop);

// The server, as Pages would serve the folder: a folder answers with its index.html. A malformed escape is the
// request's fault (400), and a file that cannot be read answers 404 or 500; neither stops the server.
const serve = (site) => (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  let name;
  try {
    name = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (name.includes("\0")) {
    res.writeHead(400).end();
    return;
  }
  let file = path.join(site, name);
  if (!file.startsWith(site)) {
    res.writeHead(403).end();
    return;
  }
  try {
    if (fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  } catch {
    // Not there, or not readable: the read below answers for it.
  }
  const stream = fs.createReadStream(file);
  const refuse = (error) => res.writeHead(error.code === "ENOENT" ? 404 : 500).end();
  stream.once("error", refuse);
  stream.once("open", () => {
    stream.off("error", refuse);
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
    // An error after the headers ends the response; it does not reach the process.
    pipeline(stream, res, () => {});
  });
};

// The clip the player asks for, for each slide and each voice. The deck page hands the player
// voiceUrl(deck.id, slide.id, voice) from src/deck/bakedVoices.ts (src/DeckPage.tsx); this asks that same
// resolver, over the registry's first deck and the player's voices, loaded through Vite with the page's own
// config, so its import.meta.glob finds the clips as the build does. Nothing listens: Vite runs in middleware
// mode with no socket.
const playerClips = async () => {
  const vite = await createVite({
    root: WEB_ROOT,
    logLevel: "error",
    appType: "custom",
    server: { middlewareMode: true, hmr: false, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    const { DECKS } = await vite.ssrLoadModule("/src/deck/decks/index.ts");
    const { BAKED_VOICES, voiceUrl } = await vite.ssrLoadModule("/src/deck/bakedVoices.ts");
    const deck = DECKS[0];
    if (!deck) return [];
    return deck.slides().flatMap((slide) =>
      BAKED_VOICES.map((voice) => ({
        slide: slide.id,
        voice: voice.id,
        url: voiceUrl(deck.id, slide.id, voice.id),
      })),
    );
  } finally {
    await vite.close();
  }
};
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const run = async () => {
  // 1. Build web/, then put the two pages together in a scratch folder: the project's page at the top, the
  // deck page at deck/.
  if (!args.includes("--no-build")) {
    const built = spawnSync("npm", ["run", "build"], {
      cwd: WEB_ROOT,
      stdio: "ignore",
      shell: process.platform === "win32",
    });
    if (built.status !== 0) throw new Error("npm run build failed in web/");
  }
  // The two are put together by the Pages workflow's own "Assemble the page" step, read from
  // .github/workflows/pages.yml and run here in a scratch folder, so what this test serves is what Pages
  // publishes.
  const workflow = fs.readFileSync(path.join(REPO_ROOT, ".github", "workflows", "pages.yml"), "utf8");
  const step = /- name: Assemble the page\n\s+run: \|\n((?:\s{10}.*\n)+)/.exec(workflow);
  if (!step) throw new Error('pages.yml has no "Assemble the page" step to run');
  const assemble = step[1]
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-genie-pages-"));
  for (const folder of ["site", "web"]) {
    fs.symlinkSync(path.join(REPO_ROOT, folder), path.join(scratch, folder), "dir");
  }
  // Copied, not linked: scripts/build-site.ts builds only when it is the script Node was started on, which it
  // tells by its own path, and a link would give it a second one.
  fs.cpSync(path.join(REPO_ROOT, "scripts"), path.join(scratch, "scripts"), { recursive: true });
  const ran = spawnSync("bash", ["-e", "-c", assemble], { cwd: scratch, stdio: "inherit" });
  if (ran.status !== 0) throw new Error("the Assemble the page step failed");
  const SITE = path.join(scratch, "_site");

  // 2. Serve it.
  server = http.createServer(serve(SITE));
  await new Promise((done) => server.listen(port, host, done));
  const address = server.address();
  const BASE = `http://${host.includes(":") ? `[${host}]` : host}:${address.port}/`;

  const registry = fs.readFileSync(path.join(WEB_ROOT, "src", "deck", "decks", "index.ts"), "utf8");
  const empty = /export const DECKS: Deck\[\] = \[\];/.test(registry);
  const VOICES = path.join(WEB_ROOT, "src", "deck", "voices");

  // No channel, headless: playwright-core's headless shell.
  browser = await chromium.launch({ headless: true });
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

  check(!empty, "the registry lists a deck, as the checks below expect");

  // The project's page shows "Watch the video", and it opens the deck page.
  const desk = await open({ width: 1280, height: 800 });
  await desk.goto(BASE);
  const video = desk.locator('[data-cta="deck"]');
  check(await video.isVisible(), 'the project\'s page shows "Watch the video"');
  check((await video.getAttribute("href")) === "deck/", "it links the deck page, deck/");
  await shot(desk, "landing-desktop");

  // The deck page, opened from it, plays the deck.
  await video.click();
  await desk.waitForURL(`${BASE}deck/`, { timeout: 5_000 }).catch(() => {});
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
  const served = new Set();
  for (const name of built) {
    const response = await globalThis.fetch(`${BASE}deck/assets/${name}`);
    if (response.ok && response.headers.get("content-type") === "audio/mpeg") {
      answered += 1;
      served.add(sha256(new Uint8Array(await response.arrayBuffer())));
    }
  }
  check(built.length > 0 && answered === built.length, "each clip answers 200 as audio");

  // For every slide and every voice, the player finds a clip, and that clip is served: the build hashes a clip's
  // name, not its bytes, so the served file is told by its bytes.
  const clips = await playerClips();
  const missing = clips.filter((clip) => !clip.url);
  check(
    clips.length > 0 && missing.length === 0,
    `the player finds a clip for every slide in every voice (${clips.length - missing.length} of ${clips.length})` +
      missing.map((clip) => `\n       no clip for slide "${clip.slide}" in ${clip.voice}`).join(""),
  );
  const unserved = clips.filter((clip) => {
    if (!clip.url) return false;
    const source = path.join(WEB_ROOT, clip.url);
    return (
      !source.startsWith(WEB_ROOT + path.sep) ||
      !fs.existsSync(source) ||
      !served.has(sha256(fs.readFileSync(source)))
    );
  });
  check(
    clips.length > missing.length && unserved.length === 0,
    `each of those clips is served (${clips.length - missing.length - unserved.length} of ${clips.length - missing.length})` +
      unserved
        .map((clip) => `\n       not served: slide "${clip.slide}" in ${clip.voice}, ${clip.url}`)
        .join(""),
  );

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
  await browser.close();
  browser = undefined;

  // 6. A11y Genie scans its own deck page, on the deck's first slide, on the headless shell, held to the loopback
  // address.
  if (!fs.existsSync(CLI)) {
    check(false, "A11y Genie scans the deck page: run `npm run build` at the repository's root first");
  } else {
    scanOut = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-genie-deck-scan-"));
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
          scanOut,
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
  }

  console.log(failures.length === 0 ? "\nAll checks passed." : `\n${failures.length} check(s) failed.`);
  // The exit code says whether the checks held, with --serve or without it.
  process.exitCode = failures.length === 0 ? 0 : 1;
  if (args.includes("--serve")) {
    serving = true;
    console.log(`Serving ${BASE} (the project's page) and ${BASE}deck/ (the deck page). Ctrl+C stops it.`);
  }
};

try {
  await run();
} finally {
  // Serving, the scratch folder stays until Ctrl+C or SIGTERM, which put it away (stop, above).
  if (!serving) await cleanUp();
}
