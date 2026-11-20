import { TEST_CHANNEL } from "../helpers/test-browser.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scanPage } from "../../src/axe.js";
import { FocusGuard } from "../../src/focus-guard.js";
import { withBrowser } from "../../src/browser.js";
import type { AxeScan } from "../../src/finding.js";
import { testBrowserIsInstalled, guardContext } from "../helpers/browser-guard.js";
import { startFixtureServer, type FixtureServer } from "../helpers/fixture-server.js";

// These tests run axe-core in the machine's real Chrome, on pages served from 127.0.0.1. Where Chrome
// is not installed they are skipped, and say so in their names. Every request the browser makes off the
// fixture server is aborted and recorded, and each test checks that none was attempted.
const hasBrowser = await testBrowserIsInstalled();

/** Each fixture page, and the rules its comment says must fire, worst first. */
const PAGES: [page: string, findings: string[], needsReview: string[]][] = [
  ["clean.html", [], []],
  ["contrast.html", ["color-contrast"], []],
  ["icon-button.html", ["button-name"], []],
  ["impact-mix.html", ["image-alt", "color-contrast", "heading-order", "empty-heading"], []],
  ["needs-review.html", [], ["color-contrast"]],
];

describe.skipIf(!hasBrowser)(
  "axe-core on the fixture pages (skipped where the test browser is not installed)",
  () => {
    let server: FixtureServer;
    beforeAll(async () => {
      server = await startFixtureServer();
    });
    afterAll(async () => {
      await server.close();
    });

    /** Loads a page in a guarded context, runs `inPage` in it if given, and scans it. */
    async function scan(page: string, inPage?: () => Promise<unknown>): Promise<[AxeScan, string[]]> {
      return withBrowser(TEST_CHANNEL, async (browser) => {
        const context = await browser.newContext();
        const attempted = await guardContext(context, server.origin);
        const tab = await context.newPage();
        await FocusGuard.install(tab);
        await tab.goto(server.url(page));
        if (inPage) await tab.evaluate(inPage);
        return [await scanPage(tab), attempted];
      });
    }

    it.each(PAGES)("%s gives exactly the rules its comment names", async (page, findings, needsReview) => {
      const [result, attempted] = await scan(page);
      expect(result.findings.map((f) => f.rule.id)).toEqual(findings);
      expect(result.needsReview.map((r) => r.rule.id)).toEqual(needsReview);
      expect(attempted).toEqual([]);
    });

    it("clean.html has no finding, and still says how many rules ran", async () => {
      const [result] = await scan("clean.html");
      expect(result.findings).toEqual([]);
      expect(result.axeCore).toBe("4.14.1");
      expect(result.rulesRun).toBeGreaterThan(50);
    });

    it("names the page, the rule and each element in a finding", async () => {
      const [result] = await scan("icon-button.html");
      expect(result.findings).toHaveLength(1);
      const [finding] = result.findings;
      expect(finding?.id).toBe("axe/button-name@icon-button.html");
      expect(finding?.page).toBe("icon-button.html");
      expect(finding?.kind).toBe("violation");
      expect(finding?.impact).toBe("critical");
      expect(finding?.rule.source).toBe("axe");
      expect(finding?.rule.wcag).toEqual(["4.1.2"]);
      expect(finding?.elements).toHaveLength(1);
      expect(finding?.elements[0]?.selector).toBe("button");
      expect(finding?.elements[0]?.html).toMatch(/^<button type="button">/);
    });

    it("aborts and records a request the page makes off the fixture server", async () => {
      const [, attempted] = await scan("clean.html", async () => {
        const reached = await fetch("http://off-loopback.invalid/beacon").then(
          () => true,
          () => false,
        );
        if (reached) throw new Error("the request was not aborted");
      });
      expect(attempted).toEqual(["http://off-loopback.invalid/beacon"]);
    });
  },
);
