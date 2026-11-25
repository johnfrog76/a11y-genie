import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SCANS_DIR_ENV } from "../../src/scans-folder.js";
import { processesIn } from "../helpers/processes-in.js";
import { channelArgs } from "../helpers/test-browser.js";
import { testBrowserIsInstalled } from "../helpers/browser-guard.js";
import { startFixtureServer, type FixtureServer } from "../helpers/fixture-server.js";
import { builtCli } from "../helpers/built-cli.js";

// Each a11y-genie process makes a temp folder of its own and removes it when it ends (src/private-temp.ts).
// These run the built command with a "shared" temp folder of the test's own, and look in it afterwards.
const cli = builtCli();
const diskFull = new URL("../fixtures/preload/disk-full.mjs", import.meta.url).pathname;
const hasBrowser = await testBrowserIsInstalled();

const made: string[] = [];
function folder(): string {
  const dir = mkdtempSync(join(tmpdir(), "a11y-genie-private-"));
  made.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

interface Run {
  status: number | null;
  stderr: string;
}

function start(args: string[], shared: string, scans: string, nodeArgs: string[] = []) {
  const child = spawn(process.execPath, [...nodeArgs, cli, ...channelArgs(args)], {
    env: { ...process.env, TMPDIR: shared, TEMP: shared, TMP: shared, [SCANS_DIR_ENV]: scans },
  });
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => (stderr += chunk));
  const done = new Promise<Run>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stderr }));
  });
  return { child, done };
}

const MISSING = ["scan", "http://127.0.0.1:8/", "--browser-channel", "msedge"];

describe("the private temp folder", () => {
  it("a temp folder that cannot be made is a refusal with one Error: and one Hint: line, and only for a browser command", async () => {
    const missing = join(folder(), "not-there");
    const scan = await start(["scan", "http://127.0.0.1:8/"], missing, folder()).done;
    expect(scan.status).toBe(2);
    expect(scan.stderr.trim().split("\n")).toEqual([
      `Error: cannot make a temp folder in ${missing} (ENOENT)`,
      "Hint: point TMPDIR at a folder that exists and that you may write to.",
    ]);
    expect((await start(["--version"], missing, folder()).done).status).toBe(0);
    expect((await start(["rules"], missing, folder()).done).status).toBe(0);
  });

  it("a run that needs no browser leaves nothing in the shared temp folder", async () => {
    const shared = folder();
    expect((await start(["--version"], shared, folder()).done).status).toBe(0);
    expect((await start(["scna"], shared, folder()).done).status).toBe(2);
    expect(readdirSync(shared)).toEqual([]);
  });

  it("a missing browser, a refusal, leaves nothing in the shared temp folder (skipped where Edge is installed)", async (ctx) => {
    const shared = folder();
    const result = await start(MISSING, shared, folder()).done;
    if (result.status !== 2) ctx.skip();
    expect(result.stderr).toMatch(/Microsoft Edge was not found/);
    expect(readdirSync(shared)).toEqual([]);
  });
});

describe.skipIf(!hasBrowser)("a run with a browser (skipped where the test browser is not installed)", () => {
  let server: FixtureServer;
  let hang: import("node:http").Server;
  let hangPort: number;
  const held = new Set<import("node:net").Socket>();
  beforeAll(async () => {
    server = await startFixtureServer();
    const { createServer } = await import("node:http");
    hang = createServer(() => undefined);
    hang.on("connection", (socket) => held.add(socket));
    await new Promise<void>((resolve) => hang.listen(0, "127.0.0.1", resolve));
    hangPort = (hang.address() as { port: number }).port;
  });
  afterAll(async () => {
    for (const socket of held) socket.destroy();
    await new Promise<void>((resolve) => hang.close(() => resolve()));
    await server.close();
  });

  // Browser processes whose command line names this test's shared temp folder: the ones the child started.
  function browsersIn(shared: string): string[] {
    return processesIn(shared).map((found) => found.command);
  }

  // Waits for this run's own browser, not for a profile folder or a socket an earlier test left: the browser
  // process is up once its command line names the shared folder, and the page request has arrived once the
  // hanging server holds a connection beyond the ones it held before this run started.
  async function waitForBrowser(shared: string, heldBefore: number): Promise<void> {
    const deadline = Date.now() + 20_000;
    // Windows has no `ps`, so there only the page request is waited for.
    while ((process.platform !== "win32" && browsersIn(shared).length === 0) || held.size <= heldBefore) {
      if (Date.now() > deadline) throw new Error("the scan never reached the page");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  // Starts a scan of the hanging page and waits until its browser is up. The scan is stopped if it never gets
  // there, so a failed wait never leaves a scan or its browser running.
  async function startHanging(shared: string) {
    const heldBefore = held.size;
    const run = start(["scan", `http://127.0.0.1:${hangPort}/`], shared, folder());
    try {
      await waitForBrowser(shared, heldBefore);
    } catch (error) {
      run.child.kill("SIGKILL");
      await run.done;
      throw error;
    }
    return run;
  }

  it("the browser's profile lands in the process's own folder, not beside it", async () => {
    const shared = folder();
    const { child, done } = await startHanging(shared);
    const top = readdirSync(shared);
    expect(top).toHaveLength(1);
    expect(top[0]).toMatch(/^a11y-genie-/);
    child.kill("SIGINT");
    expect((await done).status).toBe(130);
  });

  it("a finished scan (exit 0 or 1) leaves nothing in the shared temp folder", async () => {
    const shared = folder();
    expect((await start(["scan", server.url("clean.html")], shared, folder()).done).status).toBe(0);
    expect((await start(["scan", server.url("icon-button.html")], shared, folder()).done).status).toBe(1);
    expect(readdirSync(shared)).toEqual([]);
  });

  it("an unexpected error (exit 3) leaves nothing in the shared temp folder", async () => {
    const shared = folder();
    const result = await start(["scan", server.url("clean.html")], shared, folder(), ["--import", diskFull])
      .done;
    expect(result.status).toBe(3);
    expect(readdirSync(shared)).toEqual([]);
  });

  it("Ctrl-C (exit 130) leaves nothing in the shared temp folder", async () => {
    const shared = folder();
    const { child, done } = await startHanging(shared);
    child.kill("SIGINT");
    expect((await done).status).toBe(130);
    expect(readdirSync(shared)).toEqual([]);
  });

  // SIGTERM is not delivered on Windows, and SIGHUP there arrives only when the console window closes, so a
  // test cannot send either to a spawned process: both skip on win32.
  const signalCases = [
    ["SIGTERM", 143],
    ["SIGHUP", 129],
  ] as const;
  for (const [signal, code] of signalCases) {
    it.skipIf(process.platform === "win32")(
      `${signal} (exit ${code}) leaves no temp folder and no browser (skipped on win32, which does not deliver it)`,
      async () => {
        const shared = folder();
        const { child, done } = await startHanging(shared);
        expect(browsersIn(shared).length, "the browser is up").toBeGreaterThan(0);
        child.kill(signal);
        const result = await done;
        expect(result.status).toBe(code);
        expect(readdirSync(shared)).toEqual([]);
        // The browser is closed before the command exits, but give the system a moment to reap it.
        const deadline = Date.now() + 5_000;
        while (browsersIn(shared).length > 0 && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        expect(browsersIn(shared)).toEqual([]);
      },
    );
  }

  it("a killed run (SIGKILL) leaves at most one folder, named a11y-genie-*", async () => {
    const shared = folder();
    const { child, done } = await startHanging(shared);
    child.kill("SIGKILL");
    await done;
    // The browser it started may take a moment to notice; whatever is left is inside the one folder.
    const left = readdirSync(shared);
    expect(left).toHaveLength(1);
    expect(left[0]).toMatch(/^a11y-genie-/);
  });

  it("a scan never fails to launch while missing-browser launches run beside it (20 rounds)", async (ctx) => {
    const shared = folder();
    const probe = await start(MISSING, shared, folder()).done;
    if (probe.status !== 2) ctx.skip();
    let running = true;
    const loops = [0, 1, 2].map(async () => {
      while (running) {
        const result = await start(MISSING, shared, folder()).done;
        expect(result.status).toBe(2);
      }
    });
    try {
      for (let round = 0; round < 20; round++) {
        const result = await start(["scan", server.url("clean.html")], shared, folder()).done;
        expect(result.stderr, `round ${round}`).not.toMatch(/ProcessSingleton|profile is already in use/);
        expect(result.status, `round ${round}: ${result.stderr}`).toBe(0);
      }
    } finally {
      running = false;
      await Promise.all(loops);
    }
    expect(readdirSync(shared)).toEqual([]);
  }, 240_000);
});
