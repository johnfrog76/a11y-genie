import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SCANS_DIR_ENV } from "../../src/scans-folder.js";
import { testBrowserIsInstalled } from "../helpers/browser-guard.js";
import { startFixtureServer, type FixtureServer } from "../helpers/fixture-server.js";
import { channelArgs } from "../helpers/test-browser.js";
import { builtCli } from "../helpers/built-cli.js";

// The genie's drawing is for a terminal. These runs pipe stdout and stderr, so neither is one, and nothing
// is drawn. (The drawing itself, and when it is shown, are held in test/unit/banner.test.ts.)
const cli = builtCli();
const hasBrowser = await testBrowserIsInstalled();
const DRAWING_LINE = "'._______.'";

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
afterAll(() => {
  for (const folder of made) rmSync(folder, { recursive: true, force: true });
});

describe("the drawing, with output piped", () => {
  it("--help starts with its own words and has no drawing", async () => {
    const result = await run(["--help"], tmpdir());
    expect(result.status).toBe(0);
    expect(result.stdout.startsWith("A11y Genie: ")).toBe(true);
    expect(result.stdout).not.toContain(DRAWING_LINE);
  });

  it("a refusal is one Error line and one Hint line", async () => {
    const result = await run(["scan"], tmpdir());
    expect(result.status).toBe(2);
    expect(result.stderr.trimEnd().split("\n")).toHaveLength(2);
    expect(result.stderr).not.toContain(DRAWING_LINE);
  });

  describe.skipIf(!hasBrowser)("a run", () => {
    let server: FixtureServer;
    beforeAll(async () => {
      server = await startFixtureServer();
    });
    afterAll(async () => {
      await server.close();
    });

    it("scan, check and narrate draw nothing on stderr, and --json draws nothing on stdout", async () => {
      const root = mkdtempSync(join(tmpdir(), "a11y-genie-test-"));
      made.push(root);
      const page = server.url("clean.html");
      const scan = await run(["scan", page], root);
      expect(scan.stderr + scan.stdout).not.toContain(DRAWING_LINE);
      const json = await run(["scan", page, "--json"], root);
      expect(json.stderr + json.stdout).not.toContain(DRAWING_LINE);
      expect(() => JSON.parse(json.stdout) as unknown).not.toThrow();
      const narrate = await run(["narrate", page, "--flow", "Tab"], root);
      expect(narrate.stderr + narrate.stdout).not.toContain(DRAWING_LINE);
      const check = await run(["check", page, "--baseline", root], root);
      expect(check.stderr + check.stdout).not.toContain(DRAWING_LINE);
    });
  });
});
