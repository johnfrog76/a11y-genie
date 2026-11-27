import { TEST_CHANNEL, TEST_LAP_END } from "../helpers/test-browser.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { withBrowser } from "../../src/browser.js";
import type { AxeTarget } from "../../src/finding.js";
import { runScan, type RunScanOptions } from "../../src/run-scan.js";
import { parseStateFlags } from "../../src/scan-plan.js";
import type { ScanRecord } from "../../src/scan-record.js";
import { walkPage, type Walk, type WalkOptions } from "../../src/walk.js";
import { testBrowserIsInstalled, guardContext } from "../helpers/browser-guard.js";
import { startFixtureServer, type FixtureServer } from "../helpers/fixture-server.js";
import { lapEndAsTested, readGoldenRecord } from "../helpers/goldens.js";

// The keyboard walk (docs/ARCHITECTURE.md, *The keyboard walk*) over its fixture pages: the order Tab takes, through open shadow
// roots and same-origin frames, a positive tabindex first, hidden controls skipped, --max-tabs, a page that
// lies about focus, a frame of another origin, and names kept as data. The walk over impact-mix.html matches
// the walk in its golden scan.json. Skipped, and says so, where Chrome is not installed.
const hasBrowser = await testBrowserIsInstalled();

/** Runs in the page: the name of the element a `target` names, read part by part, or null when none. */
async function resolve(page: Page, target: AxeTarget): Promise<string | null> {
  return page.evaluate((parts) => {
    type Root = { querySelector(selector: string): unknown };
    type El = {
      shadowRoot: Root | null;
      contentDocument: Root | null;
      getAttribute(name: string): string | null;
      textContent: string | null;
      labels?: { textContent: string | null }[];
    };
    let root = (globalThis as unknown as { document: Root }).document;
    let found: El | null = null;
    for (const [i, entry] of parts.entries()) {
      const chain = typeof entry === "string" ? [entry] : entry;
      for (const [j, part] of chain.entries()) {
        found = root.querySelector(part) as El | null;
        if (found === null) return null;
        if (j < chain.length - 1) {
          if (found.shadowRoot === null) return null;
          root = found.shadowRoot;
        }
      }
      if (i < parts.length - 1) {
        if (found === null || found.contentDocument === null) return null;
        root = found.contentDocument;
      }
    }
    if (found === null) return null;
    return (
      found.getAttribute("aria-label") ?? found.labels?.[0]?.textContent ?? found.textContent?.trim() ?? ""
    );
  }, target);
}

describe.skipIf(!hasBrowser)("the keyboard walk (skipped where the test browser is not installed)", () => {
  let server: FixtureServer;
  let other: FixtureServer;
  beforeAll(async () => {
    server = await startFixtureServer();
    other = await startFixtureServer();
  });
  afterAll(async () => {
    await server.close();
    await other.close();
  });

  async function walkOf(
    page: string,
    options: WalkOptions = {},
    look?: (tab: Page, walk: Walk) => Promise<void>,
  ): Promise<Walk> {
    return withBrowser(TEST_CHANNEL, async (browser) => {
      const context = await browser.newContext();
      const attempted = await guardContext(context, [server.origin, other.origin]);
      const tab = await context.newPage();
      await tab.goto(page.startsWith("http") ? page : server.url(page));
      const walk = await walkPage(tab, options);
      await look?.(tab, walk);
      expect(attempted).toEqual([]);
      return walk;
    });
  }

  const names = (walk: Walk): string[] => walk.stops.map((stop) => stop.name);

  it("walks impact-mix.html as its golden scan.json records it", async () => {
    const walk = await walkOf("impact-mix.html");
    const golden = readGoldenRecord("impact-mix").pages[0]?.walks?.[0];
    expect(golden?.state).toBe("default");
    // The golden is the full build's walk; its lap end is read as the browser under test gives it (TEST_LAP_END).
    expect({ ...walk, state: "default" }).toEqual(golden && { ...golden, end: lapEndAsTested(golden.end) });
    expect(names(walk)).toEqual(["Read more", "Email", "Send"]);
    expect(walk.stops.map((stop) => stop.index)).toEqual([1, 2, 3]);
    expect(walk.stops.map((stop) => stop.role)).toEqual(["link", "textbox", "button"]);
    expect(walk.stops.every((stop) => stop.focusVisible)).toBe(true);
  });

  it("ends where focus comes back to the first stop, and every selector finds its element again", async () => {
    await walkOf("impact-mix.html", {}, async (tab, walk) => {
      // After a Shift+Tab out of the page, a lap on the full build goes from the last element straight back to the
      // first; on the headless shell it leaves the page again (V5, TEST_LAP_END).
      expect(walk.end).toBe(TEST_LAP_END);
      expect(walk.tabs).toBe(walk.stops.length + 1);
      for (const stop of walk.stops) expect(await resolve(tab, stop.target)).toBe(stop.name);
    });
  });

  it("ends cycled where focus goes twice round a later part of the page, and records each stop once", async () => {
    const walk = await walkOf("trap.html");
    expect(names(walk)).toEqual(["How booking works", "Monday", "Tuesday", "Wednesday"]);
    expect(walk.end).toBe("cycled");
    expect(walk.cycleFrom).toBe(2);
    // Four stops, the press back to Monday, and the second lap of three.
    expect(walk.tabs).toBe(8);
  });

  it("walks on past focus sent back once, when the second lap does not go the same way", async () => {
    const walk = await walkOf("walk-revisit.html");
    expect(names(walk)).toEqual(["First", "Second", "Third", "Fourth"]);
    expect(walk.end).not.toBe("cycled");
    expect(walk.cycleFrom).toBeUndefined();
    // The third press, sent back to Second, is not a stop; Third is the fourth press, and the indices say so.
    expect(walk.stops.map((stop) => stop.index)).toEqual([1, 2, 4, 5]);
  });

  it("gives the same walk twice on an unchanged page", async () => {
    expect(await walkOf("walk-shadow.html")).toEqual(await walkOf("walk-shadow.html"));
  });

  it("goes into open shadow roots, one inside another", async () => {
    await walkOf("walk-shadow.html", {}, async (tab, walk) => {
      expect(names(walk)).toEqual(["Before", "In the shadow", "Deeper still", "After"]);
      expect(walk.stops[1]?.target).toEqual([["#host", ":host > button"]]);
      expect(walk.stops[2]?.target).toEqual([["#host", ":host > span", ":host > div > input"]]);
      expect(walk.stops[2]?.selector).toBe("#host >>> :host > span >>> :host > div > input");
      for (const stop of walk.stops) expect(await resolve(tab, stop.target)).toBe(stop.name);
    });
  });

  it("goes into a frame of the same origin", async () => {
    await walkOf("walk-frame.html", {}, async (tab, walk) => {
      expect(names(walk)).toEqual(["Before", "In the frame", "After"]);
      expect(walk.stops[1]?.target).toEqual(["#inner", "html > body > main > div > button"]);
      expect(walk.stops[1]?.selector).toBe("#inner >>> html > body > main > div > button");
      for (const stop of walk.stops) expect(await resolve(tab, stop.target)).toBe(stop.name);
    });
  });

  it("takes a positive tabindex first, and skips what is hidden, disabled, inert or out of the order", async () => {
    const walk = await walkOf("walk-order.html");
    expect(names(walk)).toEqual([
      "Second in source, first by tabindex",
      "First in source, second by tabindex",
      "Plain link",
      "Plain button",
      "Custom control",
    ]);
    expect(walk.stops[4]).toMatchObject({ selector: "#custom", tag: "div", role: "button" });
    expect(walk.end).toBe(TEST_LAP_END);
  });

  it("starts from the top after something lower on the page was clicked", async () => {
    const fromLoad = await walkOf("walk-order.html");
    const afterClick = await withBrowser(TEST_CHANNEL, async (browser) => {
      const context = await browser.newContext();
      await guardContext(context, server.origin);
      const tab = await context.newPage();
      await tab.goto(server.url("walk-order.html"));
      await tab.getByRole("button", { name: "Plain button" }).click();
      return walkPage(tab);
    });
    expect(afterClick).toEqual(fromLoad);
  });

  it("stops at --max-tabs and says it reached the limit", async () => {
    const walk = await walkOf("walk-long.html", { maxTabs: 10 });
    expect(walk).toMatchObject({ end: "max-tabs", tabs: 10, maxTabs: 10 });
    expect(names(walk)).toEqual(Array.from({ length: 10 }, (_, i) => `Button ${i + 1}`));
    const whole = await walkOf("walk-long.html");
    expect(whole).toMatchObject({ end: TEST_LAP_END, tabs: 31, maxTabs: 200 });
    expect(whole.stops).toHaveLength(30);
  });

  it("reads focus in a world of its own, so a page that lies about it changes nothing", async () => {
    const walk = await walkOf("walk-tampered.html");
    expect(names(walk)).toEqual(["One", "Two"]);
    expect(walk.stops.every((stop) => stop.focusVisible)).toBe(true);
  });

  it("marks a frame of another origin as opaque, and walks on past it", async () => {
    const inner = other.url("walk-frame-inner.html");
    const walk = await walkOf(`${server.url("walk-other-origin.html")}?inner=${encodeURIComponent(inner)}`);
    const first = walk.stops[0];
    const last = walk.stops.at(-1);
    expect(first?.name).toBe("Before");
    expect(last?.name).toBe("After");
    const inside = walk.stops.slice(1, -1);
    expect(inside.length).toBeGreaterThan(0);
    for (const stop of inside)
      expect(stop).toMatchObject({ selector: "#other", tag: "iframe", opaque: true });
    expect(walk.end).toBe(TEST_LAP_END);
  });

  it("ends at once, with no stop, on a page where nothing takes focus", async () => {
    expect(await walkOf("walk-nothing.html")).toEqual({ stops: [], end: "left", tabs: 1, maxTabs: 200 });
  });

  it("takes terminal escapes and controls out of names", async () => {
    const walk = await walkOf("walk-names.html");
    expect(walk.stops[0]?.name).toBe("Red and bell");
    expect(walk.stops[1]?.name).toBe("Long ".repeat(60).trim());
  });

  describe("in a scan", () => {
    async function scan(page: string, extra: Partial<RunScanOptions> = {}): Promise<ScanRecord> {
      const attempted: string[][] = [];
      const record = await runScan({
        url: server.url(page),
        channel: TEST_CHANNEL,
        onContext: async (context) => {
          attempted.push(await guardContext(context, server.origin));
        },
        ...extra,
      });
      expect(attempted.flat()).toEqual([]);
      return record;
    }

    it("walk-deep.html: siblings far down a page with no ids are each their own stop, and no trap is read", async () => {
      const record = await scan("walk-deep.html");
      const walk = record.pages[0]?.walks?.[0];
      expect(walk?.end).not.toBe("cycled");
      expect(walk?.stops.map((stop) => stop.name)).toEqual(["Before", "One", "Two", "Three", "After"]);
      const targets = walk?.stops.map((stop) => JSON.stringify(stop.target)) ?? [];
      expect(new Set(targets).size).toBe(targets.length);
      for (const target of targets) expect(target.length).toBeLessThan(1200);
      expect(record.findings.find((f) => f.rule.id === "keyboard-trap")).toBeUndefined();
    });

    it("keeps one walk per state that was scanned, each from the top", async () => {
      const states = parseStateFlags(["sent: click button 'Send'", "gone: wait css '#nothing-here'"]);
      const record = await scan("impact-mix.html", {
        pages: [{ url: server.url("impact-mix.html"), states }],
        limits: { pageMs: 5_000 },
      });
      const walks = record.pages[0]?.walks ?? [];
      expect(walks.map((walk) => walk.state)).toEqual(["default", "sent"]);
      expect(walks[1]?.stops).toEqual(walks[0]?.stops);
      expect(record.pages[0]?.notScanned.map((missed) => missed.state)).toEqual(["gone"]);
    });

    it("holds the walk and a Tab to step to --max-tabs", async () => {
      const states = parseStateFlags(["far: Tab to button 'Button 5'"]);
      const record = await scan("walk-long.html", {
        pages: [{ url: server.url("walk-long.html"), states }],
        maxTabs: 3,
      });
      expect(record.pages[0]?.walks).toEqual([
        expect.objectContaining({ state: "default", end: "max-tabs", tabs: 3 }),
      ]);
      expect(record.pages[0]?.notScanned[0]?.reason).toBe(
        "step 1 (Tab to button 'Button 5') failed: focus did not reach it within 3 Tab presses",
      );
    });

    it("cuts a long name to the excerpt limit in scan.json", async () => {
      const record = await scan("walk-names.html");
      const name = record.pages[0]?.walks?.[0]?.stops[1]?.name ?? "";
      expect([...name]).toHaveLength(161);
      expect(name.endsWith("…")).toBe(true);
    });
  });
});
