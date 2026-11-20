import { channelArgs } from "../helpers/test-browser.js";
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NO_BROWSER_ENV } from "../../src/browser.js";
import { SCANS_DIR_ENV } from "../../src/scans-folder.js";
import { testBrowserIsInstalled } from "../helpers/browser-guard.js";
import { startFixtureServer, type FixtureServer } from "../helpers/fixture-server.js";

// `--tags`, `--fail-on`, `--same-origin` and `--offline` through the built command (npm test builds first):
// every refusal's words, and the exit codes the flags set. A refusal exits 2, prints one Error: and one Hint:
// on stderr, nothing on stdout, and writes nothing.
const cli = new URL("../../dist/cli.js", import.meta.url).pathname;
const hasBrowser = await testBrowserIsInstalled();

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Async, because the fixture server is in this process and must keep answering while the command runs. */
function run(args: string[], scans: string, env: Record<string, string> = {}): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...channelArgs(args, env)], {
      env: { ...process.env, [SCANS_DIR_ENV]: scans, ...env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

const temps: string[] = [];
function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), "a11y-genie-flags-"));
  temps.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

const lines = (text: string) => text.split("\n").filter((line) => line !== "");
const LOOPBACK = "http://127.0.0.1:9/";

function expectRefusal(result: Run, scans: string, error: string, hint: string | RegExp): void {
  expect(result.status).toBe(2);
  expect(result.stdout).toBe("");
  const [first, second, ...rest] = lines(result.stderr);
  expect(rest).toEqual([]);
  expect(first).toBe(`Error: ${error}`);
  if (typeof hint === "string") expect(second).toBe(`Hint: ${hint}`);
  else expect(second).toMatch(hint);
  expect(readdirSync(scans)).toEqual([]);
}

describe("refusals that need no browser", () => {
  it("an unknown --fail-on impact", async () => {
    const scans = temp();
    expectRefusal(
      await run(["scan", LOOPBACK, "--fail-on", "severe"], scans),
      scans,
      'unknown --fail-on impact: "severe"',
      "use one of: critical, serious, moderate, minor.",
    );
  });

  it("an unknown --tags tag, with axe-core's own tags in the hint", async () => {
    const scans = temp();
    const result = await run(["scan", LOOPBACK, "--tags", "wcag2a,nope"], scans);
    expectRefusal(
      result,
      scans,
      'unknown --tags value: "nope"',
      "use axe-core tags separated by commas, such as wcag2a, wcag2aa, wcag21aa or best-practice. The landmark rules need best-practice.",
    );
  });

  it("an empty --tags part", async () => {
    const scans = temp();
    expectRefusal(
      await run(["scan", LOOPBACK, "--tags", "wcag2a,"], scans),
      scans,
      "--tags needs one or more axe-core tags, separated by commas, and one is empty.",
      "use axe-core tags separated by commas, such as wcag2a,wcag2aa,best-practice.",
    );
  });

  it.each([
    ["a public address", "http://example.com/", "http://example.com"],
    ["a private address", "http://192.168.0.5:3000/", "http://192.168.0.5:3000"],
    ["an unspecified address", "http://0.0.0.0:3000/", "http://0.0.0.0:3000"],
  ])("--offline with %s as the target", async (_name, target, origin) => {
    const scans = temp();
    expectRefusal(
      await run(["scan", target, "--offline"], scans),
      scans,
      `--offline allows only a page on this machine, and ${origin} is not one.`,
      "serve the page on localhost, 127.0.0.1 or [::1], or run without --offline.",
    );
  });

  it.each(["http://localhost:3000/", "http://127.0.0.1:9/", "http://[::1]:9/"])(
    "--offline takes %s as a target (it is refused later only for want of a browser)",
    async (target) => {
      const scans = temp();
      const result = await run(["scan", target, "--offline"], scans, { [NO_BROWSER_ENV]: "1" });
      expect(lines(result.stderr)[0]).toMatch(/^Error: Chrome was not found on this machine, and --offline/);
    },
  );

  it("--offline with no Chrome refuses rather than downloading Playwright's Chromium", async () => {
    const scans = temp();
    expectRefusal(
      await run(["scan", LOOPBACK, "--offline"], scans, { [NO_BROWSER_ENV]: "1" }),
      scans,
      "Chrome was not found on this machine, and --offline stops A11y Genie from downloading Playwright's Chromium.",
      "Install Chrome, or run with --browser-channel msedge if that one is installed, or download Playwright's Chromium yourself: npx playwright-core@1.65.1 install --no-shell chromium",
    );
  });

  it("--offline with no Chrome says nothing of a download beginning", async () => {
    const result = await run(["scan", LOOPBACK, "--offline"], temp(), { [NO_BROWSER_ENV]: "1" });
    expect(result.stderr).not.toMatch(/is downloading/);
    expect(lines(result.stderr)).toHaveLength(2);
  });

  it("--offline with --browser-channel chromium and no Chromium names --offline too", async () => {
    const scans = temp();
    expectRefusal(
      await run(["scan", LOOPBACK, "--offline", "--browser-channel", "chromium"], scans, {
        [NO_BROWSER_ENV]: "1",
      }),
      scans,
      "Playwright's Chromium is not installed on this machine, and --offline stops A11y Genie from downloading it.",
      "download it yourself: npx playwright-core@1.65.1 install --no-shell chromium, or run with another --browser-channel.",
    );
  });

  it("both --offline and --no-download name the one the person typed: --no-download", async () => {
    const result = await run(["scan", LOOPBACK, "--offline", "--no-download"], temp(), {
      [NO_BROWSER_ENV]: "1",
    });
    expect(lines(result.stderr)[0]).toMatch(
      /^Error: Chrome was not found on this machine, and --no-download/,
    );
  });

  it("--help names each flag, and says the landmark rules need best-practice", async () => {
    const { stdout } = await run(["--help"], temp());
    for (const flag of ["--tags", "--fail-on", "--same-origin", "--offline"]) expect(stdout).toContain(flag);
    expect(stdout).toMatch(/landmark rules[^]*need best-practice/);
  });
});

describe.skipIf(!hasBrowser)(
  "exit codes the flags set (skipped where the test browser is not installed)",
  () => {
    let server: FixtureServer;
    beforeAll(async () => {
      server = await startFixtureServer();
    });
    afterAll(async () => {
      await server.close();
    });

    const onlyScan = (scans: string) => {
      const [name] = readdirSync(scans);
      const [folder] = readdirSync(join(scans, name ?? ""));
      return JSON.parse(readFileSync(join(scans, name ?? "", folder ?? "", "scan.json"), "utf8")) as {
        exit: number;
        schema: string;
        engine: { tags: string[] | null; rulesRun: number };
        options: unknown;
        summary: Record<string, number>;
      };
    };

    it("--fail-on serious exits 0 over a page with only moderate findings, and says so", async () => {
      const scans = temp();
      const result = await run(["scan", server.url("no-main.html"), "--fail-on", "serious"], scans);
      expect(result.status).toBe(0);
      const out = lines(result.stdout);
      expect(out[0]).toMatch(
        /^Found 1 problem on .*, worst first: 0 critical, 0 serious, 1 moderate, 0 minor\.$/,
      );
      expect(out[1]).toBe("None is serious or worse, so the exit is 0 (--fail-on serious).");
      const record = onlyScan(scans);
      expect(record.exit).toBe(0);
      expect(record.summary).toMatchObject({ moderate: 1 });
      expect(record.options).toEqual({ failOn: "serious", sameOrigin: false, offline: false });
    });

    it("--fail-on moderate, and the default, exit 1 over the same page", async () => {
      expect((await run(["scan", server.url("no-main.html"), "--fail-on", "moderate"], temp())).status).toBe(
        1,
      );
      expect((await run(["scan", server.url("no-main.html")], temp())).status).toBe(1);
    });

    it("--tags is recorded, and changes how many rules ran", async () => {
      const scans = temp();
      const tagged = await run(["scan", server.url("no-main.html"), "--tags", "wcag2a"], scans);
      expect(tagged.status).toBe(0);
      const record = onlyScan(scans);
      expect(record.engine.tags).toEqual(["wcag2a"]);
      const defaults = temp();
      await run(["scan", server.url("no-main.html")], defaults);
      const base = onlyScan(defaults);
      expect(base.engine.tags).toBeNull();
      expect(record.engine.rulesRun).toBeLessThan(base.engine.rulesRun);
    });

    it("--offline scans a loopback page, and --same-origin one on its own origin", async () => {
      const scans = temp();
      const result = await run(["scan", server.url("clean.html"), "--offline", "--same-origin"], scans);
      expect(result.status).toBe(0);
      expect(onlyScan(scans).options).toEqual({ failOn: "minor", sameOrigin: true, offline: true });
    });
  },
);
