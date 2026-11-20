import { channelArgs } from "../helpers/test-browser.js";
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SCANS_DIR_ENV } from "../../src/scans-folder.js";
import type { ScanRecord } from "../../src/scan-record.js";
import { testBrowserIsInstalled } from "../helpers/browser-guard.js";
import { startFixtureServer, type FixtureServer } from "../helpers/fixture-server.js";
import { neverClaimViolations } from "../helpers/never-claim.js";
import { validate } from "../helpers/json-schema.js";

// `scan --states` and `scan --config`, run as the built command (npm test builds first). The refusals need no
// browser. The scans need Chrome, and are skipped by name where it is not installed.
const cli = new URL("../../dist/cli.js", import.meta.url).pathname;
const hasBrowser = await testBrowserIsInstalled();
const schema = JSON.parse(
  readFileSync(new URL("../../schema/scan-1.json", import.meta.url), "utf8"),
) as Record<string, never>;

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

function run(args: string[], scans: string): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...channelArgs(args)], {
      env: { ...process.env, [SCANS_DIR_ENV]: scans },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

const made: string[] = [];
function fresh(): string {
  const folder = mkdtempSync(join(tmpdir(), "a11y-genie-test-"));
  made.push(folder);
  return folder;
}
afterAll(() => {
  for (const folder of made) rmSync(folder, { recursive: true, force: true });
});

function recordIn(root: string): ScanRecord {
  const [site] = readdirSync(root);
  const [scan] = readdirSync(join(root, site as string));
  return JSON.parse(
    readFileSync(join(root, site as string, scan as string, "scan.json"), "utf8"),
  ) as ScanRecord;
}

/** A refusal: exit 2, one Error and one Hint on stderr, nothing on stdout, nothing written. */
function expectRefused(result: Run, root: string, error: string | RegExp): void {
  expect(result.status).toBe(2);
  expect(result.stdout).toBe("");
  const lines = result.stderr.trimEnd().split("\n");
  expect(lines).toHaveLength(2);
  expect(lines[0]).toMatch(/^Error: /);
  expect(lines[1]).toMatch(/^Hint: /);
  if (typeof error === "string") expect(lines[0]).toBe(`Error: ${error}`);
  else expect(lines[0]).toMatch(error);
  expect(readdirSync(root)).toEqual([]);
}

describe("scan --states and --config refusals", () => {
  const URL_ = "http://127.0.0.1:9/"; // refusals come before any page is loaded

  it("refuses a state name given twice", async () => {
    const root = fresh();
    const result = await run(
      ["scan", URL_, "--states", "dark: colorScheme dark", "--states", "dark: reducedMotion"],
      root,
    );
    expectRefused(result, root, '--states gives the state "dark" twice.');
  });

  it("refuses a step that does not parse, naming the step and its place", async () => {
    const root = fresh();
    const result = await run(["scan", URL_, "--states", "menu: Tab; clik button 'Menu'"], root);
    expectRefused(result, root, `--states step 2 "clik button 'Menu'", column 12: "clik" is not a step.`);
  });

  it("refuses a state with no name or no steps", async () => {
    const root = fresh();
    expectRefused(
      await run(["scan", URL_, "--states", "click button 'Menu'"], root),
      root,
      /--states needs a state name and a ":" before the steps\.$/,
    );
    expectRefused(
      await run(["scan", URL_, "--states", "dark:"], root),
      root,
      /the state has no steps after its name\.$/,
    );
  });

  it("refuses a CSS selector that starts with an engine prefix", async () => {
    const root = fresh();
    for (const selector of ["xpath=//a", "text=Menu", "id=foo"]) {
      const result = await run(["scan", URL_, "--states", `a: click css '${selector}'`], root);
      expectRefused(result, root, new RegExp(`a selector cannot start with "${selector.split("=")[0]}="`));
    }
  });

  it("refuses --states with --config", async () => {
    const root = fresh();
    const config = join(root, "..", "x");
    const result = await run(["scan", URL_, "--config", config, "--states", "a: Tab"], root);
    expectRefused(result, root, "--states and --config cannot be used together.");
  });

  it("refuses an unknown key in the config, naming the file, the line and the key", async () => {
    const root = fresh();
    const dir = fresh();
    const config = join(dir, "a11y-genie.yaml");
    writeFileSync(
      config,
      "baseUrl: http://127.0.0.1:9\npages:\n  - path: /\n    states:\n      - name: a\n        step: [Tab]\n",
    );
    const result = await run(["scan", "--config", config], root);
    expectRefused(
      result,
      root,
      `${config}, line 6: unknown key "step" in a state; the keys it takes are name, steps.`,
    );
  });

  it("refuses a bad step in the config, naming the file and the line", async () => {
    const root = fresh();
    const dir = fresh();
    const config = join(dir, "a11y-genie.yaml");
    writeFileSync(
      config,
      'baseUrl: http://127.0.0.1:9\npages:\n  - path: /\n    states:\n      - name: a\n        steps: ["clik"]\n',
    );
    expectRefused(
      await run(["scan", "--config", config], root),
      root,
      `${config} line 6 "clik", column 1: "clik" is not a step.`,
    );
  });

  it("refuses a config with no address at all, and a file that is not there", async () => {
    const root = fresh();
    const dir = fresh();
    const config = join(dir, "a11y-genie.yaml");
    writeFileSync(config, "pages:\n  - path: /\n");
    expectRefused(
      await run(["scan", "--config", config], root),
      root,
      /^Error: scan --config needs a base address/,
    );
    expectRefused(
      await run(["scan", "--config", join(dir, "nope.yaml")], root),
      root,
      /^Error: --config cannot be read: .*\(ENOENT\)$/,
    );
  });

  it("refuses a --max-tabs that is not a whole number from 1 to 1000, on scan and on check", async () => {
    for (const value of ["0", "lots", "1001"]) {
      const root = fresh();
      expectRefused(
        await run(["scan", URL_, "--max-tabs", value], root),
        root,
        `--max-tabs takes a whole number of Tab presses from 1 to 1000, not "${value}".`,
      );
    }
    const root = fresh();
    const result = await run(["check", "--baseline", join(root, "nope.json"), URL_, "--max-tabs=-3"], root);
    expectRefused(result, root, '--max-tabs takes a whole number of Tab presses from 1 to 1000, not "-3".');
    expect(result.stderr).toContain("Hint: for example --max-tabs 500. The default is 200.");
  });

  it("refuses a --timeout that is not a number of seconds, and a --storage-state that is not there", async () => {
    const root = fresh();
    expectRefused(
      await run(["scan", URL_, "--timeout", "soon"], root),
      root,
      /^Error: --timeout takes a number of seconds/,
    );
    expectRefused(
      await run(["scan", URL_, "--storage-state", join(root, "nope.json")], root),
      root,
      /^Error: --storage-state cannot be read/,
    );
  });
});

describe.skipIf(!hasBrowser)(
  "scan --states and --config (skipped where the test browser is not installed)",
  () => {
    let server: FixtureServer;
    let slow: Server;
    let slowOrigin: string;
    beforeAll(async () => {
      server = await startFixtureServer();
      slow = createServer((request, response) => {
        if (request.url === "/hang") return; // never answers
        response.setHeader("content-type", "text/html");
        response.end(
          '<!doctype html><html lang="en"><head><title>ok</title></head><body><main><h1>ok</h1></main></body></html>',
        );
      });
      await new Promise<void>((resolve) => slow.listen(0, "127.0.0.1", resolve));
      slowOrigin = `http://127.0.0.1:${(slow.address() as AddressInfo).port}`;
    });
    afterAll(async () => {
      await server.close();
      slow.closeAllConnections();
      await new Promise<void>((resolve) => slow.close(() => resolve()));
    });

    it("finds the menu's unnamed button only under menu-open, and exits 1", async () => {
      const root = fresh();
      const result = await run(
        [
          "scan",
          server.url("states.html"),
          "--states",
          "menu-open: click button 'Menu'; wait menu",
          "--json",
        ],
        root,
      );
      expect(result.status).toBe(1);
      const record = JSON.parse(result.stdout) as ScanRecord;
      expect(validate(schema, record)).toEqual([]);
      expect(record.exit).toBe(1);
      expect(record.pages[0]?.states).toEqual(["default", "menu-open"]);
      expect(record.findings.map((f) => [f.id, f.elements.map((e) => e.states)])).toEqual([
        ["axe/button-name@states.html", [["menu-open"]]],
      ]);
      expect(result.stderr).toMatch(
        /^Found 1 problem on http:\/\/127\.0\.0\.1:\d+\/states\.html, worst first: 1 critical/m,
      );
      expect(neverClaimViolations(result.stdout + result.stderr)).toEqual([]);
      expect(recordIn(root).findings).toHaveLength(1);
    });

    it("with the default state alone, states.html finds nothing and exits 0", async () => {
      const root = fresh();
      const result = await run(["scan", server.url("states.html")], root);
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/^No problems found by these \d+ rules on this page\./);
    });

    it("reads a state whose step fails as not scanned, says why, goes on, and exits 1", async () => {
      const root = fresh();
      const result = await run(
        [
          "scan",
          server.url("states.html"),
          "--timeout",
          "4",
          "--states",
          "broken: click button 'Nothing here'",
          "--states",
          "dark: colorScheme dark",
        ],
        root,
      );
      expect(result.status).toBe(1);
      expect(result.stdout).toMatch(
        /states\.html was not scanned in the state "broken": step 1 \(click button 'Nothing here'\) failed: no such element was found, or it could not be clicked, within \d+ seconds\.\n/,
      );
      expect(result.stdout).toMatch(/Found 1 problem on /);
      const record = recordIn(root);
      expect(record.exit).toBe(1);
      expect(record.summary.notScanned).toBe(1);
      expect(record.pages[0]?.notScanned.map((entry) => entry.state)).toEqual(["broken"]);
      expect(record.findings.map((f) => f.rule.id)).toEqual(["color-contrast"]);
      expect(
        readFileSync(
          join(
            root,
            readdirSync(root)[0] as string,
            readdirSync(join(root, readdirSync(root)[0] as string))[0] as string,
            "report.md",
          ),
          "utf8",
        ),
      ).toContain("broken");
    });

    it("a state that fails and nothing else wrong still exits 1", async () => {
      const root = fresh();
      const result = await run(
        ["scan", server.url("clean.html"), "--timeout", "3", "--states", "gone: wait dialog"],
        root,
      );
      expect(result.status).toBe(1);
      expect(result.stdout).toMatch(
        /was not scanned in the state "gone": step 1 \(wait dialog\) failed: it did not become visible/,
      );
      expect(result.stdout).not.toMatch(/^No problems found/m);
    });

    it("scans every page and state of a config, and a second page that does not answer exits 1", async () => {
      const root = fresh();
      const dir = fresh();
      const config = join(dir, "a11y-genie.yaml");
      writeFileSync(
        config,
        [
          `baseUrl: ${slowOrigin}`,
          "pages:",
          "  - key: home",
          "    path: /",
          "  - key: hang",
          "    path: /hang",
          "  - key: again",
          "    path: /again",
          "",
        ].join("\n"),
      );
      const result = await run(["scan", "--config", config, "--timeout", "3"], root);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain(
        `${slowOrigin}/hang was not scanned: it did not answer: no answer within 3 seconds.`,
      );
      const record = recordIn(root);
      expect(validate(schema, record)).toEqual([]);
      expect(record.pages.map((page) => [page.key, page.notScanned.length])).toEqual([
        ["home", 0],
        ["hang", 1],
        ["again", 0],
      ]);
      expect(record.exit).toBe(1);
    });

    it("scans the pages and states of a config on the address given, each page in each state", async () => {
      const root = fresh();
      const dir = fresh();
      const config = join(dir, "a11y-genie.yaml");
      writeFileSync(
        config,
        [
          "pages:",
          "  - key: clean",
          "    path: /clean.html",
          "  - key: states",
          "    path: /states.html",
          "    states:",
          "      - name: menu-open",
          '        steps: ["click button \'Menu\'", "wait menu"]',
          "      - name: dark",
          '        steps: ["colorScheme dark"]',
          "",
        ].join("\n"),
      );
      const result = await run(["scan", server.origin, "--config", config, "--json"], root);
      expect(result.status).toBe(1);
      const record = JSON.parse(result.stdout) as ScanRecord;
      expect(validate(schema, record)).toEqual([]);
      expect(record.pages.map((page) => [page.key, page.states])).toEqual([
        ["clean", ["default"]],
        ["states", ["default", "menu-open", "dark"]],
      ]);
      expect(record.findings.map((f) => [f.id, f.page, f.elements.map((e) => e.states)])).toEqual([
        ["axe/button-name@states", "states", [["menu-open"]]],
        ["axe/color-contrast@states", "states", [["dark"]]],
      ]);
      expect(record.target.origin).toBe(server.origin);
    });

    it("reads --storage-state and never copies it into the scan", async () => {
      const root = fresh();
      const dir = fresh();
      const secret = "SECRET-TOKEN-value-1234567890";
      const state = join(dir, "state.json");
      writeFileSync(
        state,
        JSON.stringify({
          cookies: [
            {
              name: "session",
              value: secret,
              domain: "127.0.0.1",
              path: "/",
              expires: -1,
              httpOnly: false,
              secure: false,
              sameSite: "Lax",
            },
          ],
          origins: [],
        }),
      );
      const result = await run(["scan", server.url("clean.html"), "--storage-state", state, "--json"], root);
      expect(result.status).toBe(0);
      expect(result.stdout + result.stderr).not.toContain(secret);
      const [site] = readdirSync(root);
      const [scan] = readdirSync(join(root, site as string));
      for (const name of readdirSync(join(root, site as string, scan as string))) {
        expect(readFileSync(join(root, site as string, scan as string, name), "utf8")).not.toContain(secret);
      }
    });
  },
);
