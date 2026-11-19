import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runScan, type PageSpec } from "../../src/run-scan.js";
import type { ScanRecord } from "../../src/scan-record.js";
import { parseState } from "../../src/steps.js";
import { chromeIsInstalled, guardContext } from "../helpers/browser-guard.js";
import { startFixtureServer, type FixtureServer } from "../helpers/fixture-server.js";
import { validate } from "../helpers/json-schema.js";

// States, in the machine's real Chrome (spec 5.2): each state is a fresh load with its own steps, a bug that
// shows only in a state is found only in it, and a step that fails reads *not scanned*. Skipped, and says so,
// where Chrome is not installed.
const hasChrome = await chromeIsInstalled();
const schema = JSON.parse(
  readFileSync(new URL("../../schema/scan-1.json", import.meta.url), "utf8"),
) as Record<string, never>;

const MENU = "menu-open: click button 'Menu'; wait menu";
const DARK = "dark: colorScheme dark";

describe.skipIf(!hasChrome)("states (skipped where Chrome is not installed)", () => {
  let server: FixtureServer;
  beforeAll(async () => {
    server = await startFixtureServer();
  });
  afterAll(async () => {
    await server.close();
  });

  /** `pageMs` is short where a step is meant to fail, so the test does not wait out the full limit. */
  async function scan(
    pages: PageSpec[],
    origin: string = server.origin,
    pageMs = 15_000,
  ): Promise<ScanRecord> {
    const attempted: string[][] = [];
    const record = await runScan({
      url: (pages[0] as PageSpec).url,
      pages,
      channel: "chrome",
      limits: { pageMs },
      onContext: async (context) => {
        attempted.push(await guardContext(context, origin));
      },
    });
    expect(attempted.flat()).toEqual([]);
    expect(validate(schema, record)).toEqual([]);
    return record;
  }

  const statesPage = (...states: string[]): PageSpec => ({
    url: server.url("states.html"),
    states: states.map((state) => parseState(state)),
  });

  /** The states each element of each finding was found in, as `rule: [[states], ...]`. */
  function foundIn(record: ScanRecord): Record<string, string[][]> {
    return Object.fromEntries(
      record.findings.map((finding) => [finding.rule.id, finding.elements.map((element) => element.states)]),
    );
  }

  it("finds nothing in the default state of states.html", async () => {
    const record = await scan([statesPage()]);
    expect(record.findings).toEqual([]);
    expect(record.pages[0]?.states).toEqual(["default"]);
    expect(record.exit).toBe(0);
  });

  it("finds the unnamed menu button only under menu-open", async () => {
    const record = await scan([statesPage(MENU)]);
    expect(record.pages[0]?.states).toEqual(["default", "menu-open"]);
    expect(record.pages[0]?.notScanned).toEqual([]);
    expect(foundIn(record)).toEqual({ "button-name": [["menu-open"]] });
    expect(record.findings[0]?.id).toBe("axe/button-name@states.html");
    expect(record.exit).toBe(1);
  });

  it("finds the dark-mode contrast failure only under dark", async () => {
    const record = await scan([statesPage(DARK)]);
    expect(foundIn(record)).toEqual({ "color-contrast": [["dark"]] });
    expect(record.findings[0]?.elements[0]?.colorPair?.foreground).toBe("#3a3a3a");
  });

  it("scans every state from a fresh load, and names each state an element was found in", async () => {
    const record = await scan([
      statesPage(MENU, DARK, "both: colorScheme dark; click button 'Menu'; wait menu"),
    ]);
    expect(record.pages[0]?.states).toEqual(["default", "menu-open", "dark", "both"]);
    expect(foundIn(record)).toEqual({
      // the same element is one element, listing both states it failed in
      "button-name": [["menu-open", "both"]],
      "color-contrast": [["dark", "both"]],
    });
    expect(record.findings.map((finding) => finding.id)).toEqual([
      "axe/button-name@states.html",
      "axe/color-contrast@states.html",
    ]);
  });

  it("says a state has not scanned when a step finds no such element, and goes on with the others", async () => {
    const record = await scan(
      [statesPage("broken: click button 'Nothing here'", DARK)],
      server.origin,
      4_000,
    );
    const [page] = record.pages;
    expect(page?.states).toEqual(["default", "broken", "dark"]);
    expect(page?.notScanned).toHaveLength(1);
    expect(page?.notScanned[0]?.state).toBe("broken");
    expect(page?.notScanned[0]?.reason).toMatch(
      /^step 1 \(click button 'Nothing here'\) failed: no such element was found, or it could not be clicked, within \d+ seconds$/,
    );
    expect(foundIn(record)).toEqual({ "color-contrast": [["dark"]] });
    expect(record.summary.notScanned).toBe(1);
    expect(record.exit).toBe(1);
  });

  it("with nothing else wrong, a failing step alone makes the run exit 1", async () => {
    const record = await scan([statesPage("broken: wait dialog")], server.origin, 3_000);
    expect(record.findings).toEqual([]);
    expect(record.pages[0]?.notScanned[0]?.reason).toMatch(
      /^step 1 \(wait dialog\) failed: it did not become visible/,
    );
    expect(record.exit).toBe(1);
  });

  it("matches a name whole: a part of it is no match", async () => {
    const record = await scan([statesPage("part: click button 'Men'")], server.origin, 3_000);
    expect(record.pages[0]?.notScanned[0]?.reason).toMatch(
      /^step 1 \(click button 'Men'\) failed: no such element/,
    );
  });

  it("finds an element by CSS, and says a selector that is not CSS is not scanned", async () => {
    const record = await scan([
      statesPage("by-css: click css '#toggle'; wait menu", "bad-css: click css '[unclosed'"),
    ]);
    expect(foundIn(record)).toEqual({ "button-name": [["by-css"]] });
    expect(record.pages[0]?.notScanned[0]).toEqual({
      state: "bad-css",
      reason: "step 1 (click css '[unclosed') failed: the selector is not valid CSS",
    });
  });

  it("reads a selector with an engine prefix as invalid CSS, never as another engine", async () => {
    // The parser refuses these first (test/unit/steps.test.ts); built by hand, the driver must still treat
    // them as CSS only, so `xpath=//button` finds nothing and fails rather than clicking the button.
    const state = {
      name: "engine",
      steps: [{ kind: "click" as const, target: { by: "css" as const, selector: "xpath=//button" } }],
    };
    const record = await scan([{ url: server.url("states.html"), states: [state] }]);
    expect(record.pages[0]?.notScanned[0]?.state).toBe("engine");
    expect(record.pages[0]?.notScanned[0]?.reason).toMatch(
      /^step 1 \(click css 'xpath=\/\/button'\) failed: /,
    );
    expect(record.findings).toEqual([]);
  });

  it("says a step that matches more than one element is not scanned, and why", async () => {
    // The parser needs a name for a click; built by hand, a click on a role alone matches both menu items.
    const open = parseState(MENU);
    const state = {
      name: "ambiguous",
      steps: [
        ...open.steps,
        { kind: "click" as const, target: { by: "role" as const, role: "menuitem" as const } },
      ],
    };
    const record = await scan([{ url: server.url("states.html"), states: [state] }]);
    expect(record.pages[0]?.notScanned[0]?.reason).toBe(
      "step 3 (click menuitem) failed: more than one element matches it, so the step cannot tell which one is meant",
    );
  });

  it("types into the focused element, tabs to an element, and presses keys", async () => {
    const record = await scan([
      statesPage(
        "keyboard: Tab to button 'Menu'; Enter; wait menu",
        "typed: Tab to button 'Menu'; type 'x'; Shift+Tab",
      ),
    ]);
    expect(record.pages[0]?.notScanned).toEqual([]);
    expect(foundIn(record)).toEqual({ "button-name": [["keyboard"]] });
  });

  it("gives up Tab to after 200 presses, and says so", async () => {
    const record = await scan([statesPage("lost: Tab to button 'Nothing here'")]);
    expect(record.pages[0]?.notScanned[0]?.reason).toBe(
      "step 1 (Tab to button 'Nothing here') failed: focus did not reach it within 200 Tab presses",
    );
  });

  it("sets the viewport and reduced motion before the page loads", async () => {
    const seen: string[] = [];
    await runScan({
      url: server.url("states.html"),
      pages: [statesPage("small: viewport 390x844; reducedMotion")],
      channel: "chrome",
      onContext: async (context) => {
        await guardContext(context, server.origin);
      },
      onLoaded: async (page) => {
        seen.push(
          // A string, run in the page, so this file needs no DOM types.
          await page.evaluate<string>(
            'innerWidth + "x" + innerHeight + " " + matchMedia("(prefers-reduced-motion: reduce)").matches',
          ),
        );
      },
    });
    expect(seen).toEqual(["1280x720 false", "390x844 true"]);
  });

  describe("a second page that does not answer", () => {
    let slow: Server;
    let slowOrigin: string;
    beforeAll(async () => {
      slow = createServer((request, response) => {
        if (request.url === "/hang") return; // never answers
        response.setHeader("content-type", "text/html");
        response.end(
          '<!doctype html><html lang="en"><head><title>ok</title></head><body><main><h1>ok</h1></main></body></html>',
        );
      });
      await new Promise<void>((resolve) => slow.listen(0, "127.0.0.1", resolve));
      slowOrigin = `http://127.0.0.1:${(slow.address() as AddressInfo).port}`;
    });
    afterAll(async () => {
      slow.closeAllConnections();
      await new Promise<void>((resolve) => slow.close(() => resolve()));
    });

    it("reads not scanned, goes on, and exits 1", async () => {
      const record = await scan(
        [
          { url: `${slowOrigin}/`, key: "home", states: [] },
          { url: `${slowOrigin}/hang`, key: "hang", states: [] },
          { url: `${slowOrigin}/`, key: "again", states: [] },
        ],
        slowOrigin,
        4_000,
      );
      expect(record.pages.map((page) => page.key)).toEqual(["home", "hang", "again"]);
      expect(record.pages[0]?.notScanned).toEqual([]);
      expect(record.pages[1]?.notScanned).toHaveLength(1);
      expect(record.pages[1]?.notScanned[0]?.reason).toMatch(
        /^it did not answer: no answer within \d+(\.\d+)? seconds$/,
      );
      expect(record.pages[2]?.notScanned).toEqual([]);
      expect(record.exit).toBe(1);
      expect(record.summary.notScanned).toBe(1);
    }, 60_000);
  });
});
