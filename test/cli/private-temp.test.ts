import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SCANS_DIR_ENV } from "../../src/scans-folder.js";
import { channelArgs } from "../helpers/test-browser.js";
import { testBrowserIsInstalled } from "../helpers/browser-guard.js";
import { startFixtureServer, type FixtureServer } from "../helpers/fixture-server.js";

// Each a11y-genie process makes a temp folder of its own and removes it when it ends (src/private-temp.ts).
// These run the built command with a "shared" temp folder of the test's own, and look in it afterwards.
const cli = new URL("../../dist/cli.js", import.meta.url).pathname;
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

  async function waitForProfile(shared: string): Promise<void> {
    const deadline = Date.now() + 20_000;
    const profiles = () =>
      readdirSync(shared)
        .filter((name) => name.startsWith("a11y-genie-"))
        .flatMap((name) => readdirSync(join(shared, name)))
        .filter((name) => name.startsWith("playwright_chromiumdev_profile-"));
    while (profiles().length === 0 || held.size === 0) {
      if (Date.now() > deadline) throw new Error("the scan never reached the page");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  it("the browser's profile lands in the process's own folder, not beside it", async () => {
    const shared = folder();
    const { child, done } = start(["scan", `http://127.0.0.1:${hangPort}/`], shared, folder());
    await waitForProfile(shared);
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
    const { child, done } = start(["scan", `http://127.0.0.1:${hangPort}/`], shared, folder());
    await waitForProfile(shared);
    child.kill("SIGINT");
    expect((await done).status).toBe(130);
    expect(readdirSync(shared)).toEqual([]);
  });

  // Browser processes whose command line names this test's shared temp folder: the ones the child started.
  function browsersIn(shared: string): string[] {
    const marker = basename(shared);
    return execFileSync("ps", ["-ww", "-axo", "pid,command"], { encoding: "utf8" })
      .split("\n")
      .filter((line) => line.includes(marker));
  }

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
        const { child, done } = start(["scan", `http://127.0.0.1:${hangPort}/`], shared, folder());
        await waitForProfile(shared);
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
    const { child, done } = start(["scan", `http://127.0.0.1:${hangPort}/`], shared, folder());
    await waitForProfile(shared);
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
