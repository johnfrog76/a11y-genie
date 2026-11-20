import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SCANS_DIR_ENV } from "../../src/scans-folder.js";
import type { ScanRecord } from "../../src/scan-record.js";
import { chromeIsInstalled } from "../helpers/browser-guard.js";
import { startFixtureServer, type FixtureServer } from "../helpers/fixture-server.js";
import { expectTextGolden } from "../helpers/goldens.js";
import { validate } from "../helpers/json-schema.js";
import { neverClaimViolations } from "../helpers/never-claim.js";

// `a11y-genie narrate` and a config's workflows, run as the built command (npm test builds first). The refusals
// need no browser. The runs need Chrome, and are skipped by name where it is not installed.
const cli = new URL("../../dist/cli.js", import.meta.url).pathname;
const hasChrome = await chromeIsInstalled();
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
    const child = spawn(process.execPath, [cli, ...args], {
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

/** The one scan folder in `root`'s one site folder, or the newest of several. */
function folderIn(root: string, at = -1): string {
  const [site] = readdirSync(root);
  const scans = readdirSync(join(root, site as string)).sort();
  return join(root, site as string, scans.at(at) as string);
}

function recordIn(folder: string): ScanRecord {
  return JSON.parse(readFileSync(join(folder, "scan.json"), "utf8")) as ScanRecord;
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

describe("narrate refusals", () => {
  const PAGE = "http://127.0.0.1:9/"; // refusals come before any page is loaded

  it("needs --flow", async () => {
    const root = fresh();
    const result = await run(["narrate", PAGE], root);
    expectRefused(result, root, "narrate needs --flow: the steps to drive.");
    expect(result.stderr).toContain('Hint: run: a11y-genie narrate <url> --flow "Tab; Tab; Enter"');
  });

  it("needs a page address", async () => {
    const root = fresh();
    expectRefused(
      await run(["narrate", "--flow", "Tab"], root),
      root,
      "narrate needs a page address to narrate.",
    );
  });

  it("refuses a step that does not parse, naming it and its place", async () => {
    const root = fresh();
    expectRefused(
      await run(["narrate", PAGE, "--flow", "Tab; clik"], root),
      root,
      /^Error: --flow step 2 "clik"/,
    );
  });

  it("refuses an empty flow, and a flow that sets media", async () => {
    const root = fresh();
    expectRefused(await run(["narrate", PAGE, "--flow", ""], root), root, /^Error: --flow/);
    expectRefused(
      await run(["narrate", PAGE, "--flow", "colorScheme dark"], root),
      root,
      /colorScheme sets a state's media, and a flow has no media\.$/,
    );
  });

  it("refuses a flow of more than 200 steps", async () => {
    const root = fresh();
    const flow = Array.from({ length: 201 }, () => "Tab").join("; ");
    expectRefused(
      await run(["narrate", PAGE, "--flow", flow], root),
      root,
      "--flow has 201 steps, and narrate takes at most 200.",
    );
  });

  it("refuses the flags that are about pages and rules, and more than one page", async () => {
    const root = fresh();
    for (const extra of [
      ["--states", "dark: colorScheme dark"],
      ["--config", "x.yaml"],
      ["--tags", "wcag2a"],
    ]) {
      const result = await run(["narrate", PAGE, "--flow", "Tab", ...extra], root);
      expectRefused(result, root, /^Error: Unknown option '--/);
    }
    expectRefused(
      await run(["narrate", PAGE, `${PAGE}x`, "--flow", "Tab"], root),
      root,
      "narrate takes one page, and got more: http://127.0.0.1:9/x",
    );
  });

  it("refuses an address that is not http: or https:", async () => {
    const root = fresh();
    expectRefused(
      await run(["narrate", "file:///etc/hosts", "--flow", "Tab"], root),
      root,
      /only http: and https:/,
    );
  });

  it("refuses a config workflow with a step that does not parse, or a page it does not have", async () => {
    const root = fresh();
    const file = join(root, "..", `${Date.now()}-bad.yaml`);
    made.push(file);
    writeFileSync(
      file,
      'baseUrl: http://127.0.0.1:9\npages:\n  - path: /\nworkflows:\n  - name: a\n    page: home\n    steps: ["Tab", "clik"]\n',
    );
    expectRefused(await run(["scan", "--config", file], root), root, /clik/);
    writeFileSync(
      file,
      'baseUrl: http://127.0.0.1:9\npages:\n  - path: /\nworkflows:\n  - name: a\n    page: nowhere\n    steps: ["Tab"]\n',
    );
    expectRefused(
      await run(["scan", "--config", file], root),
      root,
      /the workflow's page "nowhere" is not a page key/,
    );
  });
});

describe.skipIf(!hasChrome)("narrate (skipped where Chrome is not installed)", () => {
  let server: FixtureServer;
  beforeAll(async () => {
    server = await startFixtureServer();
  });
  afterAll(async () => {
    await server.close();
  });

  it("prints the transcript, writes narration/flow.txt beside scan.json, and exits 1 on an unnamed step", async () => {
    const root = fresh();
    const result = await run(
      ["narrate", server.url("workflow.html"), "--flow", "Tab; Tab; Tab; Enter"],
      root,
    );
    expect(result.status).toBe(1);
    const folder = folderIn(root);
    const written = readFileSync(join(folder, "narration", "flow.txt"), "utf8");
    expectTextGolden("narration/flow.txt", written);
    // The same lines are printed, then what was found, then where it was written.
    expect(result.stdout).toContain(written.trimEnd());
    expect(result.stdout).toMatch(
      /Found 1 problem on http:\/\/127\.0\.0\.1:\d+\/workflow\.html, worst first: 0 critical, 1 serious/,
    );
    expect(result.stdout).toContain(`Wrote ${folder}`);
    expect(result.stderr).toBe("");
    expect(readdirSync(folder).sort()).toEqual(["narration", "report.md", "scan.json"]);
    const record = recordIn(folder);
    expect(validate(schema, record)).toEqual([]);
    expect(record).toMatchObject({ command: "narrate", exit: 1, schema: "1.10" });
    expect(record.workflows[0]?.steps).toHaveLength(4);
    const report = readFileSync(join(folder, "report.md"), "utf8");
    expect(report).toContain("## Narrated flows");
    expect(report).toContain("Saved, status");
    expect(report).toContain("Step reaches a control with no name");
    expect(neverClaimViolations(report)).toEqual([]);
  });

  it("exits 0 when no step has no name", async () => {
    const root = fresh();
    const result = await run(["narrate", server.url("narrate-press.html"), "--flow", "Tab; Enter"], root);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/No step of 1 flow left focus on a control with no name, in 2 steps\./);
    expect(recordIn(folderIn(root))).toMatchObject({ exit: 0, findings: [] });
  });

  it("--fail-on critical lets an unnamed step through, as it does a scan's serious finding", async () => {
    const root = fresh();
    const result = await run(
      ["narrate", server.url("workflow.html"), "--flow", "Tab; Tab", "--fail-on", "critical"],
      root,
    );
    expect(result.status).toBe(0);
    expect(recordIn(folderIn(root)).findings).toHaveLength(1);
  });

  it("--json prints scan.json alone on stdout, and the transcript goes to stderr", async () => {
    const root = fresh();
    const result = await run(["narrate", server.url("workflow.html"), "--flow", "Tab; Tab", "--json"], root);
    expect(result.status).toBe(1);
    const record = JSON.parse(result.stdout) as ScanRecord;
    expect(validate(schema, record)).toEqual([]);
    expect(record.workflows[0]?.name).toBe("flow");
    expect(result.stderr).toContain("flow, on workflow.html");
  });

  it("a step that fails is a flow not narrated: its transcript says why, and the exit is 1", async () => {
    const root = fresh();
    const result = await run(
      ["narrate", server.url("workflow.html"), "--flow", "Tab to link 'Nope'", "--max-tabs", "2"],
      root,
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      "The flow \"flow\" on workflow.html was not narrated to the end: step 1 (Tab to link 'Nope') failed: focus did not reach it within 2 Tab presses.",
    );
    const folder = folderIn(root);
    expect(readFileSync(join(folder, "narration", "flow.txt"), "utf8")).toContain(
      "Not narrated past this point",
    );
    expect(recordIn(folder).summary.notScanned).toBe(1);
  });

  it("a page that does not answer is a refusal, and nothing is written", async () => {
    const root = fresh();
    const result = await run(["narrate", "http://127.0.0.1:9/", "--flow", "Tab"], root);
    expectRefused(result, root, /did not answer/);
  });

  it("strips terminal escapes from what the page says", async () => {
    const root = fresh();
    const result = await run(
      ["narrate", server.url("hostile/narrate-text.html"), "--flow", "Tab; Enter"],
      root,
    );
    // eslint-disable-next-line no-control-regex
    expect(result.stdout + result.stderr).not.toMatch(/[\u001b\u0007\r‮]/);
    expect(result.stdout).toContain("RED said word");
  });

  describe("a config's workflows", () => {
    function configFile(root: string): string {
      const file = join(root, "a11y-genie.yaml");
      writeFileSync(
        file,
        [
          `baseUrl: ${server.origin}`,
          "pages:",
          "  - key: settings",
          "    path: /workflow.html",
          "  - key: press",
          "    path: /narrate-press.html",
          "workflows:",
          "  - name: save the form",
          "    page: settings",
          '    steps: ["Tab", "Tab", "Tab to button \'Save\'", "Enter"]',
          "  - name: save-the-form",
          "    page: settings",
          '    steps: ["Tab to button \'Save\'", "Enter"]',
          "  - name: open settings",
          "    page: press",
          '    steps: ["Tab", "Enter", "Enter"]',
          "",
        ].join("\n"),
      );
      return file;
    }

    it("scan --config narrates each workflow, and each gets its own transcript", async () => {
      const root = fresh();
      const out = fresh();
      const result = await run(["scan", "--config", configFile(root), "--out", out], root);
      expect(result.status).toBe(1);
      const folder = folderIn(out);
      const record = recordIn(folder);
      expect(validate(schema, record)).toEqual([]);
      expect(record.command).toBe("scan");
      expect(record.workflows.map((flow) => [flow.name, flow.page, flow.file])).toEqual([
        ["save the form", "settings", "narration/save-the-form.txt"],
        ["save-the-form", "settings", "narration/save-the-form-2.txt"],
        ["open settings", "press", "narration/open-settings.txt"],
      ]);
      expect(readFileSync(join(folder, "narration", "save-the-form.txt"), "utf8")).toBe(
        [
          "save the form, on settings",
          "1  Tab                   Email, edit text, required",
          "2  Tab                   button",
          '   ^ This step has no name. A screen reader says "button", and stops.',
          "3  Tab to button 'Save'  Save, button",
          "4  Enter                 Saved, status",
          "",
        ].join("\n"),
      );
      expect(readFileSync(join(folder, "narration", "save-the-form-2.txt"), "utf8")).toContain("2  Enter");
      expect(readFileSync(join(folder, "narration", "open-settings.txt"), "utf8")).toContain(
        "Settings, dialog",
      );
      // The pages were scanned too: axe-core's button-name beside the product's own finding.
      const ids = record.findings.map((finding) => finding.id);
      expect(ids).toContain("axe/button-name@settings");
      expect(ids).toContain("genie/unnamed-step@settings");
      expect(ids).not.toContain("genie/unnamed-step@press");
      expect(result.stdout).not.toContain("flow, on");
    });

    it("a workflow that fails reads not scanned, and the pages are still scanned", async () => {
      const root = fresh();
      const out = fresh();
      const file = join(root, "bad.yaml");
      writeFileSync(
        file,
        [
          `baseUrl: ${server.origin}`,
          "pages:",
          "  - key: press",
          "    path: /narrate-press.html",
          "workflows:",
          "  - name: off",
          "    page: press",
          "    steps: [\"Tab to link 'Nope'\"]",
          "",
        ].join("\n"),
      );
      const result = await run(["scan", "--config", file, "--out", out, "--max-tabs", "3"], root);
      expect(result.status).toBe(1);
      expect(result.stdout).toMatch(/The flow "off" on press was not narrated to the end: step 1/);
      const record = recordIn(folderIn(out));
      expect(record.summary.notScanned).toBe(1);
      expect(record.pages[0]?.notScanned).toEqual([]);
    });
  });

  describe("beside scans", () => {
    it("a narration is not the previous scan that a scan compares with, and is not a baseline", async () => {
      const root = fresh();
      const page = server.url("narrate-press.html");
      expect((await run(["scan", page], root)).status).toBe(0);
      expect((await run(["narrate", page, "--flow", "Tab"], root)).status).toBe(0);
      const second = await run(["scan", page], root);
      expect(second.status).toBe(0);
      const [site] = readdirSync(root);
      const folders = readdirSync(join(root, site as string)).sort();
      expect(folders).toHaveLength(3);
      const first = recordIn(join(root, site as string, folders[0] as string));
      const latest = recordIn(join(root, site as string, folders[2] as string));
      expect(latest.summary.sincePrevious).toMatchObject({ new: 0, fixed: 0, startedAt: first.startedAt });

      const narration = join(root, site as string, folders[1] as string);
      expect(existsSync(join(narration, "narration", "flow.txt"))).toBe(true);
      const checked = await run(["check", "--baseline", narration, page], fresh());
      expect(checked.status).toBe(2);
      expect(checked.stderr).toMatch(
        /^Error: --baseline is a narration, which has no axe-core results to compare with\./,
      );
    });
  });
});
