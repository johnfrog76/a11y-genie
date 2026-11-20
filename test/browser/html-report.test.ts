import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withBrowser } from "../../src/browser.js";
import { renderHtmlReport } from "../../src/html-report.js";
import { runScan } from "../../src/run-scan.js";
import { parseStateFlags } from "../../src/scan-plan.js";
import { testBrowserIsInstalled, guardContext } from "../helpers/browser-guard.js";
import { TEST_CHANNEL } from "../helpers/test-browser.js";
import { startFixtureServer, type FixtureServer } from "../helpers/fixture-server.js";
import { GOLDEN_PAGES, goldenPath, readGoldenRecord } from "../helpers/goldens.js";
import { goldenCheckRecord, hostileRecord } from "../helpers/report-records.js";

// report.html in the tests' browser (Playwright's Chromium unless test/helpers/test-browser.ts is told otherwise): opened from disk, it asks for nothing but itself and breaks none of
// its own content security policy; and A11y Genie's own scan of it finds nothing critical or serious, in light,
// in dark and at 320 px. Skipped, and says so, where the test browser is not installed.
const hasBrowser = await testBrowserIsInstalled();

/** What opening `file` from disk asked for, every request aborted but the document's own, and what the browser logged. */
async function openFromDisk(
  file: string,
): Promise<{ requests: string[]; console: string[]; styled: boolean }> {
  const url = pathToFileURL(file).href;
  return withBrowser(TEST_CHANNEL, async (browser) => {
    const context = await browser.newContext();
    try {
      const requests: string[] = [];
      // Chromium routes file: requests too, so a stylesheet, image or script beside the file would be seen here.
      await context.route("**/*", async (route) => {
        requests.push(route.request().url());
        if (route.request().url() === url) await route.continue();
        else await route.abort("blockedbyclient");
      });
      const page = await context.newPage();
      const logged: string[] = [];
      page.on("console", (message) => logged.push(`${message.type()}: ${message.text()}`));
      page.on("pageerror", (error) => logged.push(`pageerror: ${error.message}`));
      await page.goto(url, { waitUntil: "load" });
      // The skip link is placed by the stylesheet: a style the policy refused would leave it in the flow.
      const styled = (await page.evaluate(
        `(() => { const skip = document.querySelector(".skip"); return skip !== null && getComputedStyle(skip).position === "absolute"; })()`,
      )) as boolean;
      return { requests, console: logged, styled };
    } finally {
      await context.close();
    }
  });
}

describe.skipIf(!hasBrowser)(
  "report.html in the test browser (skipped where the test browser is not installed)",
  () => {
    const folder = mkdtempSync(join(tmpdir(), "a11y-genie-html-"));
    afterAll(() => {
      rmSync(folder, { recursive: true, force: true });
    });

    it.each(GOLDEN_PAGES)("%s: the golden opens from disk with no request but itself", async (name) => {
      const file = goldenPath(name, "report.html");
      const opened = await openFromDisk(file);
      expect(opened.requests).toEqual([pathToFileURL(file).href]);
      expect(opened.console).toEqual([]);
      expect(opened.styled).toBe(true);
    });

    it("the check report and a hostile record's report open with no request and no script run", async () => {
      for (const [name, record] of [
        ["check.html", goldenCheckRecord()],
        ["hostile.html", hostileRecord()],
      ] as const) {
        const file = join(folder, name);
        writeFileSync(file, renderHtmlReport(record));
        const opened = await openFromDisk(file);
        expect(opened.requests, name).toEqual([pathToFileURL(file).href]);
        expect(opened.console, name).toEqual([]);
        expect(opened.styled, name).toBe(true);
      }
    });

    it("would see a request: a page that asks for files and addresses has each one listed", async () => {
      const file = join(folder, "asks.html");
      writeFileSync(
        file,
        '<!doctype html><link rel="stylesheet" href="other.css"><img src="x.png" alt=""><img src="http://127.0.0.1:9/y.png" alt="">',
      );
      const opened = await openFromDisk(file);
      expect(opened.requests).toEqual(
        expect.arrayContaining([
          pathToFileURL(file).href,
          pathToFileURL(join(folder, "other.css")).href,
          pathToFileURL(join(folder, "x.png")).href,
          "http://127.0.0.1:9/y.png",
        ]),
      );
    });

    describe("A11y Genie's own scan of the report", () => {
      const site = join(folder, "site");
      let server: FixtureServer;
      beforeAll(async () => {
        mkdirSync(site);
        writeFileSync(join(site, "impact-mix.html"), renderHtmlReport(readGoldenRecord("impact-mix")));
        writeFileSync(join(site, "check.html"), renderHtmlReport(goldenCheckRecord()));
        writeFileSync(join(site, "clean.html"), renderHtmlReport(readGoldenRecord("clean")));
        server = await startFixtureServer(site);
      });
      afterAll(async () => {
        await server.close();
      });

      it("finds nothing critical or serious in the impact-mix, check and empty reports, light, dark and at 320 px", async () => {
        const states = parseStateFlags(["dark: colorScheme dark", "phone: viewport 320x800"]);
        const pages = ["impact-mix.html", "check.html", "clean.html"].map((page) => ({
          url: server.url(page),
          states,
        }));
        const attempted: string[][] = [];
        const record = await runScan({
          url: server.url("impact-mix.html"),
          pages,
          channel: TEST_CHANNEL,
          onContext: async (context) => {
            attempted.push(await guardContext(context, server.origin));
          },
        });
        expect(attempted.flat()).toEqual([]);
        expect(record.summary.notScanned).toBe(0);
        expect(record.pages.map((page) => page.states)).toEqual(
          pages.map(() => ["default", "dark", "phone"]),
        );
        const worst = record.findings
          .filter((finding) => finding.impact === "critical" || finding.impact === "serious")
          .map((finding) => finding.id);
        expect(worst).toEqual([]);
      }, 120_000);
    });
  },
);
