import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scanPage } from "../../src/axe.js";
import { withBrowser } from "../../src/browser.js";
import type { AxeScan, Finding } from "../../src/finding.js";
import { runScan } from "../../src/run-scan.js";
import { chromeIsInstalled, guardContext } from "../helpers/browser-guard.js";
import { startFixtureServer, type FixtureServer } from "../helpers/fixture-server.js";

// Claim C7: genie/skip-link is advice where landmarks or headings already give a way past the navigation, a
// WCAG 2.4.1 violation where nothing does, and a working skip link is clean. Each fixture page names, in its
// comment, what must fire. Skipped, and says so, where Chrome is not installed.
const hasChrome = await chromeIsInstalled();

describe.skipIf(!hasChrome)(
  "the skip link on the fixture pages (skipped where Chrome is not installed)",
  () => {
    let server: FixtureServer;
    beforeAll(async () => {
      server = await startFixtureServer();
    });
    afterAll(async () => {
      await server.close();
    });

    async function scan(page: string): Promise<{ result: AxeScan; skip: Finding | undefined }> {
      return withBrowser("chrome", async (browser) => {
        const context = await browser.newContext();
        const attempted = await guardContext(context, server.origin);
        const tab = await context.newPage();
        await tab.goto(server.url(page));
        const result = await scanPage(tab);
        expect(attempted).toEqual([]);
        return { result, skip: result.findings.find((f) => f.rule.id === "skip-link") };
      });
    }

    it("no-skip-link.html gives advice, minor, for the page", async () => {
      const { result, skip } = await scan("no-skip-link.html");
      expect(result.findings).toHaveLength(1);
      expect(skip).toMatchObject({
        id: "genie/skip-link@no-skip-link.html",
        kind: "advice",
        impact: "minor",
      });
      expect(skip?.rule.wcag).toEqual(["2.4.1"]);
      expect(skip?.elements).toHaveLength(1);
      expect(skip?.elements[0]?.failure).toContain("Add a link to #main as the first thing on the page");
    });

    it("no-skip-no-structure.html gives a WCAG 2.4.1 violation, moderate", async () => {
      const { result, skip } = await scan("no-skip-no-structure.html");
      expect(result.findings.map((f) => f.id)).toEqual([
        "axe/landmark-one-main@no-skip-no-structure.html",
        "genie/no-landmarks@no-skip-no-structure.html",
        "axe/page-has-heading-one@no-skip-no-structure.html",
        "axe/region@no-skip-no-structure.html",
        "genie/skip-link@no-skip-no-structure.html",
      ]);
      expect(skip).toMatchObject({ kind: "violation", impact: "moderate" });
      expect(skip?.rule.wcag).toEqual(["2.4.1"]);
    });

    it("skip-link-ok.html has a working skip link and no finding", async () => {
      const { result } = await scan("skip-link-ok.html");
      expect(result.findings).toEqual([]);
    });

    it("skip-link-broken.html: a link to an id that is not there is not a skip link", async () => {
      const { skip } = await scan("skip-link-broken.html");
      expect(skip).toMatchObject({ kind: "advice", impact: "minor" });
    });

    it("skip-link-tampered.html: a page that fakes a skip link still has none", async () => {
      const { result, skip } = await scan("skip-link-tampered.html");
      expect(result.findings).toHaveLength(1);
      expect(skip).toMatchObject({ kind: "advice", impact: "minor" });
    });

    it("skip-link-hidden-tampered.html: a page that hides its skip link still has one", async () => {
      // axe-core runs in the page's own world and is fooled (it reports the link as content outside a landmark);
      // the skip-link check is not.
      const { skip } = await scan("skip-link-hidden-tampered.html");
      expect(skip).toBeUndefined();
    });

    it("few-tabbable.html is not checked: two Tab stops before main is nothing much to skip", async () => {
      const { result } = await scan("few-tabbable.html");
      expect(result.findings).toEqual([]);
    });

    it("advice never changes the exit code", async () => {
      const record = await runScan({
        url: server.url("no-skip-link.html"),
        channel: "chrome",
        onContext: async (context) => {
          await guardContext(context, server.origin);
        },
      });
      expect(record.findings.map((f) => f.id)).toEqual(["genie/skip-link@no-skip-link.html"]);
      expect(record.exit).toBe(0);
    });
  },
);
