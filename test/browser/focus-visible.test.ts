import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scanPage } from "../../src/axe.js";
import { withBrowser } from "../../src/browser.js";
import type { AxeScan, Finding, NeedsReview } from "../../src/finding.js";
import { MAX_SCREENSHOT_STOPS } from "../../src/focus-visible.js";
import { wordingOf } from "../../src/plain.js";
import { runScan } from "../../src/run-scan.js";
import { CANNOT_SEE } from "../../src/scan-record.js";
import { chromeIsInstalled, guardContext } from "../helpers/browser-guard.js";
import { startFixtureServer, type FixtureServer } from "../helpers/fixture-server.js";

// Claim C8: genie/focus-visible (spec 6.3) flags `outline: none` with nothing in its place; a custom box-shadow
// ring is not flagged. Each fixture page names, in its comment, what must fire. Skipped, and says so, where
// Chrome is not installed.
const hasChrome = await chromeIsInstalled();

describe.skipIf(!hasChrome)("focus visible (skipped where Chrome is not installed)", () => {
  let server: FixtureServer;
  beforeAll(async () => {
    server = await startFixtureServer();
  });
  afterAll(async () => {
    await server.close();
  });

  interface Scanned {
    result: AxeScan;
    finding: Finding | undefined;
    review: NeedsReview | undefined;
    /** What the page itself recorded, from its `body` data attributes, after the scan. */
    data: Record<string, string>;
  }

  /** Scans a fixture page, or `html` set as its content, with `tags` (`--tags`) when given. */
  async function scan(page: string, tags: string[] | null = null, html?: string): Promise<Scanned> {
    return withBrowser("chrome", async (browser) => {
      const context = await browser.newContext();
      const attempted = await guardContext(context, server.origin);
      const tab = await context.newPage();
      await tab.goto(server.url(page));
      if (html !== undefined) await tab.setContent(html);
      const result = await scanPage(tab, undefined, tags, { maxTabs: 1000 });
      const data = (await tab.evaluate("({ ...document.body.dataset })")) as Record<string, string>;
      expect(attempted).toEqual([]);
      return {
        result,
        finding: result.findings.find((f) => f.rule.id === "focus-visible"),
        review: result.needsReview.find((n) => n.rule.id === "focus-visible"),
        data,
      };
    });
  }

  it("focus-custom-ok.html: a box-shadow ring, a change of background and a heavier border are not flagged", async () => {
    const { result, finding, review } = await scan("focus-custom-ok.html");
    expect(result.walk?.stops.map((s) => s.selector)).toEqual(["#ring", "#fill", "#name"]);
    expect(finding).toBeUndefined();
    expect(review).toBeUndefined();
  });

  it("focus-hidden.html: outline: none with nothing in its place is a serious WCAG 2.4.7 finding", async () => {
    const { finding, review } = await scan("focus-hidden.html");
    expect(finding).toMatchObject({
      id: "genie/focus-visible@focus-hidden.html",
      kind: "violation",
      impact: "serious",
      rule: { source: "genie", id: "focus-visible", wcag: ["2.4.7"] },
    });
    // #kept keeps the browser's own outline.
    expect(finding?.elements.map((e) => e.selector)).toEqual(["#plain-link", "#plain-button"]);
    expect(finding?.elements[0]?.html).toContain("Read more");
    expect(finding?.elements[0]?.failure).toContain("Focus produced no visible change");
    expect(wordingOf({ source: "genie", id: "focus-visible" }, "violation")?.fix).toContain("outline: none");
    // A link that stays outside the window cannot be photographed: needs review, never a finding.
    expect(review?.elements.map((e) => e.selector)).toEqual(["#away"]);
    expect(review?.elements[0]?.reason).toContain("outside the window");
  });

  it("the browser's own focus outline is not flagged, in the page, in a shadow root and in a frame", async () => {
    for (const page of [
      "clean.html",
      "impact-mix.html",
      "walk-shadow.html",
      "walk-frame.html",
      "skip-link-ok.html",
    ]) {
      const { result, finding, review } = await scan(page);
      expect(result.walk?.stops.length, page).toBeGreaterThan(0);
      expect(finding, page).toBeUndefined();
      expect(review, page).toBeUndefined();
    }
  });

  it("focus-elsewhere.html: an indicator drawn away from the element is not seen, as What this scan cannot see says", async () => {
    // A known limit: the indicator is on a sibling 40 px away, and on a pseudo-element 12 px away, so neither a
    // style the check reads nor a pixel of the padded box changes. The fixed list names it (CANNOT_SEE).
    const { finding, review } = await scan("focus-elsewhere.html");
    expect(finding?.elements.map((e) => e.selector)).toEqual(["#save", "#help"]);
    expect(review).toBeUndefined();
    expect(CANNOT_SEE.some((line) => line.startsWith("A focus indicator drawn away from the element"))).toBe(
      true,
    );
  });

  it("focus-faint.html: a change too faint to see is needs review, not a finding", async () => {
    const { finding, review } = await scan("focus-faint.html");
    expect(finding).toBeUndefined();
    expect(review?.elements.map((e) => e.selector)).toEqual(["#faint-fill", "#faint-ring"]);
    expect(review?.elements[0]?.reason).toContain("background-color");
    expect(review?.elements[0]?.reason).toContain("too faint");
    expect(review?.impact).toBe("serious");
  });

  it("focus-animated.html: a ring that arrives by a transition or an animation is judged as it ends", async () => {
    const { result, finding, review } = await scan("focus-animated.html");
    expect(result.walk?.stops.map((s) => s.selector)).toEqual(["#slide", "#grow", "#pulse"]);
    expect(finding).toBeUndefined();
    expect(review).toBeUndefined();
  });

  it("focus-watched.html: the page hears no focus or blur from the check, and the walk is the same without it", async () => {
    // `wcag2a` and `best-practice` run every own check but this one; `wcag2aa` adds it.
    const without = await scan("focus-watched.html", ["wcag2a", "best-practice"]);
    const withIt = await scan("focus-watched.html", ["wcag2a", "best-practice", "wcag2aa"]);
    expect(without.finding).toBeUndefined();
    expect(withIt.finding?.elements.map((e) => e.selector)).toEqual(["#menu-first", "#menu-second"]);
    expect(withIt.result.walk).toEqual(without.result.walk);
    expect(withIt.data).toEqual(without.data);
    // The menu closed once, when the walk's own Tab left it, not when the check took focus off a link in it.
    expect(withIt.data.closed).toBe("1");
  });

  it("the walk and the trap check read the same with the check as without it", async () => {
    for (const page of [
      "trap.html",
      "trap-stuck.html",
      "walk-order.html",
      "walk-shadow.html",
      "walk-frame.html",
    ]) {
      const without = await scan(page, ["wcag2a", "best-practice"]);
      const withIt = await scan(page, ["wcag2a", "best-practice", "wcag2aa"]);
      expect(withIt.result.walk, page).toEqual(without.result.walk);
      const trap = (s: Scanned): Finding | undefined =>
        s.result.findings.find((f) => f.rule.id === "keyboard-trap");
      expect(trap(withIt), page).toEqual(trap(without));
    }
    // Ten scans, each in a browser of its own.
  }, 120_000);

  it("--tags without its tags does not run it; wcag2aa, cat.keyboard or wcag247 does", async () => {
    expect((await scan("focus-hidden.html", ["wcag2a"])).finding).toBeUndefined();
    expect((await scan("focus-hidden.html", ["best-practice"])).review).toBeUndefined();
    for (const tag of ["wcag2aa", "cat.keyboard", "wcag247"]) {
      expect((await scan("focus-hidden.html", [tag])).finding?.elements, tag).toHaveLength(2);
    }
  });

  it(`takes screenshots of the first ${MAX_SCREENSHOT_STOPS.toString()} stops; the rest are needs review`, async () => {
    const extra = 3;
    const buttons = Array.from(
      { length: MAX_SCREENSHOT_STOPS + extra },
      (_, i) => `<p><button id="b${i.toString()}" type="button">Button ${i.toString()}</button></p>`,
    ).join("");
    const html = `<!doctype html><html lang="en"><head><title>Many</title><style>button:focus { outline: none; }</style></head><body><main>${buttons}</main></body></html>`;
    const { result, finding, review } = await scan("clean.html", ["wcag2aa"], html);
    expect(result.walk?.stops).toHaveLength(MAX_SCREENSHOT_STOPS + extra);
    expect(finding?.elements).toHaveLength(MAX_SCREENSHOT_STOPS);
    expect(review?.elements.map((e) => e.selector)).toEqual(
      Array.from({ length: extra }, (_, i) => `#b${(MAX_SCREENSHOT_STOPS + i).toString()}`),
    );
    expect(review?.elements[0]?.reason).toContain(`first ${MAX_SCREENSHOT_STOPS.toString()} Tab stops`);
  }, 90_000);

  it("the screenshots stay in memory: none reaches the scan's record", async () => {
    const attempted: string[][] = [];
    const record = await runScan({
      url: server.url("focus-hidden.html"),
      channel: "chrome",
      onContext: async (context) => {
        attempted.push(await guardContext(context, server.origin));
      },
    });
    expect(attempted.flat()).toEqual([]);
    expect(record.findings.some((f) => f.rule.id === "focus-visible")).toBe(true);
    const text = JSON.stringify(record);
    // A PNG's first bytes, raw and in base64.
    expect(text).not.toContain("iVBORw0KGgo");
    expect(text).not.toContain("PNG\\r\\n");
  });
});
