import { channelArgs } from "../helpers/test-browser.js";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_PUBLIC_ORIGINS_ENV } from "../../src/context.js";
import { SCANS_DIR_ENV } from "../../src/scans-folder.js";
import { testBrowserIsInstalled } from "../helpers/browser-guard.js";
import { controlsIn } from "../helpers/controls.js";
import { startFixtureServer, type FixtureServer } from "../helpers/fixture-server.js";
import { neverClaimViolations } from "../helpers/never-claim.js";
import { validate } from "../helpers/json-schema.js";

// Runs the built command (npm test builds first) on pages served from 127.0.0.1, and reads what it wrote.
// The command runs in its own process, so the browser-side guard cannot be installed on it: the pages here
// only ever load from the fixture server. The goldens test (test/browser/) runs the guarded path.
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

/** Async, because the fixture server is in this process and must keep answering while the command runs. */
function run(args: string[], scans: string, env: NodeJS.ProcessEnv = {}): Promise<Run> {
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

/** The one scan folder under `<root>/<site>/`. */
function scanFolder(root: string): string {
  const [site] = readdirSync(root);
  if (site === undefined) throw new Error("no site folder");
  const [scan] = readdirSync(join(root, site));
  if (scan === undefined) throw new Error("no scan folder");
  return join(root, site, scan);
}

describe.skipIf(!hasBrowser)(
  "a11y-genie scan <url> (skipped where the test browser is not installed)",
  () => {
    let server: FixtureServer;
    let privateServer: FixtureServer;
    const made: string[] = [];
    beforeAll(async () => {
      server = await startFixtureServer(undefined, { redirects: { "/to-file": "file:///etc/hosts" } });
      privateServer = await startFixtureServer();
    });
    afterAll(async () => {
      await server.close();
      await privateServer.close();
    });
    const fresh = () => {
      const folder = mkdtempSync(join(tmpdir(), "a11y-genie-test-"));
      made.push(folder);
      return folder;
    };
    afterAll(() => {
      for (const folder of made) rmSync(folder, { recursive: true, force: true });
    });

    it("clean.html exits 0, says how much it checked, and writes scan.json, report.md and report.html", async () => {
      const root = fresh();
      const result = await run(["scan", server.url("clean.html")], root);
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/^No problems found by these \d+ rules on this page\. /);
      expect(neverClaimViolations(result.stdout + result.stderr)).toEqual([]);
      const folder = scanFolder(root);
      expect(existsSync(join(folder, "scan.json"))).toBe(true);
      expect(existsSync(join(folder, "report.md"))).toBe(true);
      expect(existsSync(join(folder, "report.html"))).toBe(true);
      expect(neverClaimViolations(readFileSync(join(folder, "report.html"), "utf8"))).toEqual([]);
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

    it("--format json writes scan.json alone; md,json adds report.md; html adds report.html", async () => {
      const onlyJson = fresh();
      await run(["scan", server.url("clean.html"), "--format", "json"], onlyJson);
      expect(readdirSync(scanFolder(onlyJson)).sort()).toEqual(["scan.json"]);
      const both = fresh();
      await run(["scan", server.url("clean.html"), "--format", "md,json"], both);
      expect(readdirSync(scanFolder(both)).sort()).toEqual(["report.md", "scan.json"]);
      const html = fresh();
      await run(["scan", server.url("clean.html"), "--format", "html"], html);
      expect(readdirSync(scanFolder(html)).sort()).toEqual(["report.html", "scan.json"]);
    });

    it("refuses an unknown --format with one Error: and one Hint:, before scanning", async () => {
      const root = fresh();
      const result = await run(["scan", server.url("clean.html"), "--format", "pdf"], root);
      expect(result.status).toBe(2);
      expect(result.stderr.trim().split("\n")).toHaveLength(2);
      expect(result.stderr).toMatch(/^Error: unknown --format: pdf\nHint: use md, json or html/);
      expect(readdirSync(root)).toEqual([]);
    });

    it("a page that redirects to file: exits 1, says it was not scanned and why, and still writes scan.json", async () => {
      const root = fresh();
      const result = await run(["scan", server.url("to-file")], root);
      expect(result.status).toBe(1);
      expect(result.stdout).toMatch(
        / was not scanned: it redirected to an address that is not http: or https:/,
      );
      expect(result.stdout).not.toContain("No problems found");
      expect(result.stderr).toBe("");
      const record = JSON.parse(readFileSync(join(scanFolder(root), "scan.json"), "utf8"));
      expect(record.exit).toBe(1);
      expect(record.summary.notScanned).toBe(1);
      expect(validate(schema, record)).toEqual([]);
      expect(readFileSync(join(scanFolder(root), "report.md"), "utf8")).toContain("was not scanned");
    });

    it("says what the page tried and was stopped, by count only: no page text reaches the terminal", async () => {
      const result = await run(["scan", server.url("hostile/dialogs.html")], fresh());
      expect(result.stdout).toContain(
        "Stopped what the page tried: 5 dialogs dismissed. The report lists them.",
      );
      expect(result.stdout).not.toContain("Your password?");
    });

    it("no escape sequence from the page reaches the terminal or report.md, with or without --json", async () => {
      const root = fresh();
      const result = await run(["scan", server.url("hostile/escapes.html")], root);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("Stopped what the page tried: 2 dialogs dismissed.");
      expect(controlsIn(result.stdout + result.stderr)).toEqual([]);
      const report = readFileSync(join(scanFolder(root), "report.md"), "utf8");
      expect(controlsIn(report)).toEqual([]);
      expect(report).toContain("RED alert click here");
      const page = readFileSync(join(scanFolder(root), "report.html"), "utf8");
      expect(controlsIn(page)).toEqual([]);
      expect(page).toContain("RED alert click here");

      const json = await run(["scan", server.url("hostile/escapes.html"), "--json"], fresh());
      expect(controlsIn(json.stdout + json.stderr)).toEqual([]);
      // The document still holds the page's text exactly.
      const record = JSON.parse(json.stdout);
      expect(record.pages[0].stopped[0].examples[0]).toContain(`${String.fromCharCode(0x1b)}[31mRED`);
    });

    it("blocks a public page's request to a private address and says so; --allow-private lets it through", async () => {
      // The fixture server is declared public, as only a test can; the second one stands in for a private service.
      const env = { [TEST_PUBLIC_ORIGINS_ENV]: server.origin };
      const page = server.url(
        `hostile/private-network.html?case=image&private=${encodeURIComponent(privateServer.origin)}`,
      );
      const root = fresh();
      const blocked = await run(["scan", page], root, env);
      expect(blocked.stdout).toContain(
        "Stopped what the page tried: 1 request to a private address blocked. The report lists them.",
      );
      expect(privateServer.requests).not.toContain("GET /private/image.png");
      const record = JSON.parse(readFileSync(join(scanFolder(root), "scan.json"), "utf8"));
      expect(record.pages[0].stopped).toEqual([
        { kind: "private-network", count: 1, examples: [privateServer.url("private/image.png")] },
      ]);
      expect(validate(schema, record)).toEqual([]);

      const allowed = await run(["scan", page, "--allow-private"], fresh(), env);
      expect(allowed.stdout).not.toContain("Stopped what the page tried");
      expect(privateServer.requests).toContain("GET /private/image.png");
    });

    it("writes nothing into the folder it was run from", async () => {
      const root = fresh();
      const before = readdirSync(process.cwd()).sort();
      await run(["scan", server.url("clean.html")], root);
      expect(readdirSync(process.cwd()).sort()).toEqual(before);
    });
  },
);
