import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { createServer as createNetServer } from "node:net";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NO_BROWSER_ENV } from "../../src/browser.js";
import { TEST_NAVIGATION_TIMEOUT_ENV } from "../../src/run-scan.js";
import { SCANS_DIR_ENV } from "../../src/scans-folder.js";
import { chromeIsInstalled } from "../helpers/browser-guard.js";
import { startFixtureServer, type FixtureServer } from "../helpers/fixture-server.js";

// Runs the built command (npm test builds first) and checks every exit code and every refusal M1 can reach.
// A refusal exits 2, prints exactly one `Error:` line and one `Hint:` line on stderr, prints nothing on
// stdout, and writes nothing: the scans folder and `--out` are left as they were.
const cli = new URL("../../dist/cli.js", import.meta.url).pathname;
const hasChrome = await chromeIsInstalled();

interface Run {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

function start(args: string[], env: Record<string, string>) {
  const child = spawn(process.execPath, [cli, ...args], { env: { ...process.env, ...env } });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => (stdout += chunk));
  child.stderr.on("data", (chunk: Buffer) => (stderr += chunk));
  const done = new Promise<Run>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (status, signal) => resolve({ status, signal, stdout, stderr }));
  });
  return { child, done };
}

/** Async, because the fixture server is in this process and must keep answering while the command runs. */
function run(args: string[], scans: string, env: Record<string, string> = {}): Promise<Run> {
  return start(args, { [SCANS_DIR_ENV]: scans, ...env }).done;
}

function makeTemp(): string {
  return mkdtempSync(join(tmpdir(), "a11y-genie-exit-"));
}

const temps: string[] = [];
function temp(): string {
  const dir = makeTemp();
  temps.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of temps) {
    try {
      chmodSync(dir, 0o700);
    } catch {
      // Already gone.
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A loopback port with nothing listening on it: bound, noted, closed. */
async function closedPort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

function expectRefusal(result: Run, error: RegExp, hint: RegExp = /./): void {
  expect(result.status).toBe(2);
  expect(result.stdout).toBe("");
  const lines = result.stderr.split("\n").filter((line) => line !== "");
  expect(lines).toHaveLength(2);
  expect(lines[0]).toMatch(/^Error: /);
  expect(lines[0]).toMatch(error);
  expect(lines[1]).toMatch(/^Hint: /);
  expect(lines[1]).toMatch(hint);
}

describe("refusals that need no browser", () => {
  it("an unknown command", async () => {
    const scans = temp();
    expectRefusal(
      await run(["scna", "http://127.0.0.1:1/"], scans),
      /^Error: unknown command or flag: scna$/,
    );
    expect(readdirSync(scans)).toEqual([]);
  });

  it("an unknown flag, at the top and after scan", async () => {
    const scans = temp();
    expectRefusal(await run(["--nope"], scans), /^Error: unknown command or flag: --nope$/);
    expectRefusal(await run(["scan", "http://127.0.0.1:1/", "--nope"], scans), /--nope/, /--help/);
    expect(readdirSync(scans)).toEqual([]);
  });

  it("an extra argument", async () => {
    const scans = temp();
    expectRefusal(await run(["scan", "http://127.0.0.1:1/", "two"], scans), /scan takes one page.*two/);
    expect(readdirSync(scans)).toEqual([]);
  });

  it.each([
    ["a file: address", "file:///etc/hosts", /only http: and https: addresses can be scanned.*file:/],
    ["a javascript: address", "javascript:alert(1)", /javascript:/],
    ["a data: address", "data:text/html,<p>hi</p>", /data:/],
    ["a bare word", "example", /not a web address: "example"/],
    ["a bare host name", "example.com", /not a web address|example\.com:/],
    ["a path", "./dist/index.html", /not a web address/],
  ])("%s", async (_name, target, error) => {
    const scans = temp();
    const result = await run(["scan", target], scans);
    expectRefusal(result, error, /http:\/\/ or https:\/\/.*npx serve dist/);
    expect(readdirSync(scans)).toEqual([]);
  });

  it("no Chrome and --no-download", async () => {
    const scans = temp();
    const result = await run(["scan", "http://127.0.0.1:1/", "--no-download"], scans, {
      [NO_BROWSER_ENV]: "1",
    });
    expectRefusal(result, /^Error: Chrome was not found on this machine, and --no-download stops/);
    expect(readdirSync(scans)).toEqual([]);
  });

  describe("an --out that cannot be written", () => {
    it("a parent that does not exist", async () => {
      const scans = temp();
      const root = temp();
      const out = join(root, "missing", "out");
      expectRefusal(
        await run(["scan", "http://127.0.0.1:1/", "--out", out], scans),
        /--out cannot be made, because the folder above it does not exist/,
      );
      expect(existsSync(join(root, "missing"))).toBe(false);
      expect(readdirSync(scans)).toEqual([]);
    });

    it("a path that is a file", async () => {
      const scans = temp();
      const file = join(temp(), "file.txt");
      writeFileSync(file, "keep");
      expectRefusal(
        await run(["scan", "http://127.0.0.1:1/", "--out", file], scans),
        /--out is not a folder/,
      );
      expectRefusal(
        await run(["scan", "http://127.0.0.1:1/", "--out", join(file, "inside")], scans),
        /the path above it is not a folder/,
      );
      expect(readdirSync(scans)).toEqual([]);
    });

    it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
      "a folder with no permission",
      async () => {
        const scans = temp();
        const locked = temp();
        chmodSync(locked, 0o500);
        expectRefusal(
          await run(["scan", "http://127.0.0.1:1/", "--out", locked], scans),
          /cannot be written to/,
        );
        expectRefusal(
          await run(["scan", "http://127.0.0.1:1/", "--out", join(locked, "new")], scans),
          /folder above it cannot be written to/,
        );
        expect(readdirSync(locked)).toEqual([]);
        expect(readdirSync(scans)).toEqual([]);
      },
    );
  });
});

describe.skipIf(!hasChrome)("exit codes with a browser (skipped where Chrome is not installed)", () => {
  let server: FixtureServer;
  let hang: Server;
  let hangPort: number;
  const held = new Set<import("node:net").Socket>();
  beforeAll(async () => {
    server = await startFixtureServer();
    // Accepts the connection and never answers: a page that holds the load.
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

  it("clean.html exits 0 and icon-button.html exits 1", async () => {
    expect((await run(["scan", server.url("clean.html")], temp())).status).toBe(0);
    expect((await run(["scan", server.url("icon-button.html")], temp())).status).toBe(1);
  });

  it("a target that does not answer: connection refused", async () => {
    const scans = temp();
    const port = await closedPort();
    const result = await run(["scan", `http://127.0.0.1:${port}/`], scans);
    expectRefusal(
      result,
      new RegExp(`^Error: http://127\\.0\\.0\\.1:${port} did not answer: the connection was refused\\.$`),
      /^Hint: check the address, and that the server is running\.$/,
    );
    expect(readdirSync(scans)).toEqual([]);
  });

  it("a target that does not answer: no response before the timeout", async () => {
    const scans = temp();
    const result = await run(["scan", `http://127.0.0.1:${hangPort}/`], scans, {
      [TEST_NAVIGATION_TIMEOUT_ENV]: "1500",
    });
    expectRefusal(result, /did not answer: no answer within 1\.5 seconds\.$/);
    expect(readdirSync(scans)).toEqual([]);
  });

  it("a refusal leaves --out as it was", async () => {
    const out = temp();
    const port = await closedPort();
    const result = await run(["scan", `http://127.0.0.1:${port}/`, "--out", out], temp());
    expect(result.status).toBe(2);
    expect(readdirSync(out)).toEqual([]);
  });

  it("Ctrl-C during a scan exits 130 and leaves no scan folder and no profile folder", async () => {
    const scans = temp();
    // A private temp folder for the command, so its browser's profile is the only one in it.
    const privateTmp = temp();
    const { child, done } = start(["scan", `http://127.0.0.1:${hangPort}/`], {
      [SCANS_DIR_ENV]: scans,
      TMPDIR: privateTmp,
      TEMP: privateTmp,
      TMP: privateTmp,
    });
    // The page never answers, so the scan is certain to be waiting on it once the browser's profile exists.
    const deadline = Date.now() + 20_000;
    // The command makes its own folder in it (src/private-temp.ts), and the profile is in that one.
    const profiles = () =>
      readdirSync(privateTmp)
        .filter((name) => name.startsWith("a11y-genie-"))
        .flatMap((name) => readdirSync(join(privateTmp, name)))
        .filter((name) => name.startsWith("playwright_chromiumdev_profile-"));
    while (profiles().length === 0) {
      if (Date.now() > deadline) throw new Error("the browser never started");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    while (held.size === 0) {
      if (Date.now() > deadline) throw new Error("the page was never requested");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    child.kill("SIGINT");
    const result = await done;
    expect(result.status).toBe(130);
    expect(result.stdout).toBe("");
    expect(readdirSync(scans)).toEqual([]);
    expect(readdirSync(privateTmp)).toEqual([]);
  });
});
