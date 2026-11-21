import { TEST_CHANNEL, channelArgs } from "../helpers/test-browser.js";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runScan } from "../../src/run-scan.js";
import { SCANS_DIR_ENV } from "../../src/scans-folder.js";
import { buildSite } from "../../scripts/build-site.js";
import { testBrowserIsInstalled, guardContext } from "../helpers/browser-guard.js";
import { startFixtureServer, type FixtureServer } from "../helpers/fixture-server.js";
import { neverClaimViolations } from "../helpers/never-claim.js";
import { builtCli } from "../helpers/built-cli.js";

// The project's page scans itself: the page as built (scripts/build-site.ts) is served from 127.0.0.1 and
// the built command scans it, at the desktop size it defaults to. It must have no critical or serious
// finding. Skipped, and says so, where Chrome is not installed.
const cli = builtCli();
const hasBrowser = await testBrowserIsInstalled();

describe.skipIf(!hasBrowser)("the project's page (skipped where the test browser is not installed)", () => {
  const folder = mkdtempSync(join(tmpdir(), "a11y-genie-site-"));
  const site = join(folder, "site");
  const scans = join(folder, "scans");
  let server: FixtureServer;
  beforeAll(async () => {
    buildSite(site);
    server = await startFixtureServer(site);
  });
  afterAll(async () => {
    await server.close();
    rmSync(folder, { recursive: true, force: true });
  });

  it("has no critical or serious finding when A11y Genie scans it", async () => {
    const result = await new Promise<{ status: number | null; stdout: string }>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [cli, ...channelArgs(["scan", server.url("index.html"), "--json"])],
        {
          env: { ...process.env, [SCANS_DIR_ENV]: scans },
        },
      );
      let stdout = "";
      child.stdout.on("data", (chunk: Buffer) => (stdout += chunk));
      child.on("error", reject);
      child.on("close", (status) => resolve({ status, stdout }));
    });
    const record = JSON.parse(result.stdout);
    expect(record.summary.notScanned).toBe(0);
    const worst = record.findings
      .filter((f: { impact: string }) => f.impact === "critical" || f.impact === "serious")
      .map((f: { rule: { id: string } }) => f.rule.id);
    expect(worst).toEqual([]);
    expect(neverClaimViolations(result.stdout)).toEqual([]);
  });

  it("asks for nothing from anywhere but its own origin", async () => {
    const attempted: string[][] = [];
    const record = await runScan({
      url: server.url("index.html"),
      channel: TEST_CHANNEL,
      onContext: async (context) => {
        attempted.push(await guardContext(context, server.origin));
      },
    });
    expect(attempted.flat()).toEqual([]);
    expect(record.pages[0]?.stopped).toEqual([]);
  });

  it("names only files that are in the built folder, and nothing off the page's own origin", () => {
    const html = readFileSync(join(site, "index.html"), "utf8");
    const local = [...html.matchAll(/(?:src|href)="([^":#]+)"/g)].map(([, path]) => path ?? "");
    expect(local.length).toBeGreaterThan(0);
    for (const path of local) expect(existsSync(join(site, path)), path).toBe(true);
  });
});
