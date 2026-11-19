import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SCANS_DIR_ENV } from "../../src/scans-folder.js";
import { chromeIsInstalled } from "../helpers/browser-guard.js";
import { startFixtureServer, type FixtureServer } from "../helpers/fixture-server.js";
import { neverClaimViolations } from "../helpers/never-claim.js";
import { validate } from "../helpers/json-schema.js";

// Runs the built command (npm test builds first) on pages served from 127.0.0.1, and reads what it wrote.
// The command runs in its own process, so the browser-side guard cannot be installed on it: the pages here
// only ever load from the fixture server. The goldens test (test/browser/) runs the guarded path.
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

/** Async, because the fixture server is in this process and must keep answering while the command runs. */
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

/** The one scan folder under `<root>/<site>/`. */
function scanFolder(root: string): string {
  const [site] = readdirSync(root);
  if (site === undefined) throw new Error("no site folder");
  const [scan] = readdirSync(join(root, site));
  if (scan === undefined) throw new Error("no scan folder");
  return join(root, site, scan);
}

describe.skipIf(!hasChrome)("a11y-genie scan <url> (skipped where Chrome is not installed)", () => {
  let server: FixtureServer;
  let scans: string;
  beforeAll(async () => {
    server = await startFixtureServer();
  });
  afterAll(async () => {
    await server.close();
  });
  const fresh = () => {
    scans = mkdtempSync(join(tmpdir(), "a11y-genie-test-"));
    return scans;
  };
  afterAll(() => {
    if (scans) rmSync(scans, { recursive: true, force: true });
  });

  it("clean.html exits 0, says how much it checked, and writes scan.json and report.md", async () => {
    const root = fresh();
    const result = await run(["scan", server.url("clean.html")], root);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^No problems found by these \d+ rules on this 1 page\. /);
    expect(neverClaimViolations(result.stdout + result.stderr)).toEqual([]);
    const folder = scanFolder(root);
    expect(existsSync(join(folder, "scan.json"))).toBe(true);
    expect(existsSync(join(folder, "report.md"))).toBe(true);
    expect(folder).toMatch(/127\.0\.0\.1-\d+[\\/]\d{4}-\d\d-\d\dT\d\d-\d\d-\d\dZ$/);
  });

  it("icon-button.html exits 1 and its scan.json says exit 1", async () => {
    const root = fresh();
    const result = await run(["scan", server.url("icon-button.html")], root);
    expect(result.status).toBe(1);
    expect(neverClaimViolations(result.stdout + result.stderr)).toEqual([]);
    const record = JSON.parse(readFileSync(join(scanFolder(root), "scan.json"), "utf8"));
    expect(record.exit).toBe(1);
    expect(validate(schema, record)).toEqual([]);
  });

  it("--json prints scan.json, and nothing else, on stdout", async () => {
    const root = fresh();
    const result = await run(["scan", server.url("impact-mix.html"), "--json"], root);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe(readFileSync(join(scanFolder(root), "scan.json"), "utf8"));
    expect(JSON.parse(result.stdout).findings).toHaveLength(4);
    expect(result.stderr).toContain("Found 4 problems");
  });

  it("--json on a scan with no findings still prints one document, and exits 0", async () => {
    const result = await run(["scan", server.url("clean.html"), "--json"], fresh());
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).exit).toBe(0);
  });

  it("--out puts the scan folder under it, not in the per-user scans folder", async () => {
    const elsewhere = fresh();
    const out = mkdtempSync(join(tmpdir(), "a11y-genie-out-"));
    try {
      const result = await run(["scan", server.url("clean.html"), "--out", out], elsewhere);
      expect(result.status).toBe(0);
      expect(readdirSync(elsewhere)).toEqual([]);
      expect(existsSync(join(scanFolder(out), "scan.json"))).toBe(true);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it("--format json writes scan.json and no report.md; --format md,json writes both", async () => {
    const onlyJson = fresh();
    await run(["scan", server.url("clean.html"), "--format", "json"], onlyJson);
    expect(readdirSync(scanFolder(onlyJson)).sort()).toEqual(["scan.json"]);
    const both = fresh();
    await run(["scan", server.url("clean.html"), "--format", "md,json"], both);
    expect(readdirSync(scanFolder(both)).sort()).toEqual(["report.md", "scan.json"]);
  });

  it("refuses an unknown --format with one Error: and one Hint:, before scanning", async () => {
    const root = fresh();
    const result = await run(["scan", server.url("clean.html"), "--format", "html"], root);
    expect(result.status).toBe(2);
    expect(result.stderr.trim().split("\n")).toHaveLength(2);
    expect(result.stderr).toMatch(/^Error: unknown --format: html\nHint: /);
    expect(readdirSync(root)).toEqual([]);
  });

  it("writes nothing into the folder it was run from", async () => {
    const root = fresh();
    const before = readdirSync(process.cwd()).sort();
    await run(["scan", server.url("clean.html")], root);
    expect(readdirSync(process.cwd()).sort()).toEqual(before);
  });
});
