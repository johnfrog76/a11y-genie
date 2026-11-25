import { TEST_CHANNEL } from "../helpers/test-browser.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withBrowser } from "../../src/browser.js";
import { runSteps } from "../../src/drive.js";
import { parseState } from "../../src/steps.js";
import { testBrowserIsInstalled, guardContext } from "../helpers/browser-guard.js";
import { startFixtureServer, type FixtureServer } from "../helpers/fixture-server.js";

// `Tab to` (src/drive.ts) reads focus from the browser's own focus state: into open shadow roots, as the target's
// locator reaches, and past a page that redefines document.activeElement (tab-to-shadow.html).
const hasBrowser = await testBrowserIsInstalled();

describe.skipIf(!hasBrowser)("Tab to (skipped where the test browser is not installed)", () => {
  let server: FixtureServer;
  beforeAll(async () => {
    server = await startFixtureServer();
  });
  afterAll(async () => {
    await server.close();
  });

  /** Runs one state's steps on tab-to-shadow.html, and answers what Enter pressed. */
  async function pressed(state: string): Promise<string | undefined> {
    return withBrowser(TEST_CHANNEL, async (browser) => {
      const context = await browser.newContext();
      const attempted = await guardContext(context, server.origin);
      const page = await context.newPage();
      await page.goto(server.url("tab-to-shadow.html"));
      await runSteps(page, parseState(state).steps, () => 30_000, 20);
      const result = (await page.evaluate("document.body.dataset.pressed")) as string | undefined;
      expect(attempted).toEqual([]);
      return result;
    });
  }

  it("reaches a button inside a web component's open shadow root", async () => {
    expect(await pressed("s: Tab to button 'Save'; Enter")).toBe("Save");
  });

  it("is not fooled by a page that redefines document.activeElement", async () => {
    expect(await pressed("s: Tab to button 'Decoy'; Enter")).toBe("Decoy");
  });
});
