import { TEST_CHANNEL } from "../helpers/test-browser.js";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scanPage } from "../../src/axe.js";
import { withBrowser } from "../../src/browser.js";
import { testBrowserIsInstalled, guardContext } from "../helpers/browser-guard.js";
import { startFixtureServer, type FixtureServer } from "../helpers/fixture-server.js";

// The fix loop's trial site (test/fixtures/loop/): one page with exactly three named bugs, so a trial
// of the loop starts from a known place. Skipped, and says so, where Chrome is not installed.
const hasBrowser = await testBrowserIsInstalled();
const LOOP_SITE = fileURLToPath(new URL("../fixtures/loop/", import.meta.url));

describe.skipIf(!hasBrowser)(
  "the fix loop's trial site (skipped where the test browser is not installed)",
  () => {
    let server: FixtureServer;
    beforeAll(async () => {
      server = await startFixtureServer(LOOP_SITE);
    });
    afterAll(async () => {
      await server.close();
    });

    it("has exactly its three named bugs, worst first, and nothing else", async () => {
      const [result, attempted] = await withBrowser(TEST_CHANNEL, async (browser) => {
        const context = await browser.newContext();
        const tried = await guardContext(context, server.origin);
        const tab = await context.newPage();
        await tab.goto(server.url("index.html"));
        return [await scanPage(tab), tried] as const;
      });
      expect(result.findings.map((f) => f.rule.id)).toEqual(["button-name", "image-alt", "color-contrast"]);
      expect(attempted).toEqual([]);
    });
  },
);
