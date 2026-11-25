import { TEST_CHANNEL } from "../helpers/test-browser.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scanPage } from "../../src/axe.js";
import { withBrowser } from "../../src/browser.js";
import type { AxeScan, Finding, NeedsReview } from "../../src/finding.js";
import { FocusGuard } from "../../src/focus-guard.js";
import {
  HELD_FOR_TESTS,
  MAX_SCREENSHOT_STOPS,
  RESUME_FOR_TESTS,
  SCROLL_MARK,
  STILL_FOR_TESTS,
  WITNESS_FRAME_MS,
} from "../../src/focus-visible.js";
import { wordingOf } from "../../src/plain.js";
import { runScan } from "../../src/run-scan.js";
import { CANNOT_SEE } from "../../src/scan-record.js";
import { testBrowserIsInstalled, guardContext } from "../helpers/browser-guard.js";
import { startFixtureServer, type FixtureServer } from "../helpers/fixture-server.js";

// Claim C8: genie/focus-visible (spec 6.3) flags `outline: none` with nothing in its place; a custom box-shadow
// ring is not flagged. Each fixture page names, in its comment, what must fire. Skipped, and says so, where
// Chrome is not installed.
const hasBrowser = await testBrowserIsInstalled();

describe.skipIf(!hasBrowser)("focus visible (skipped where the test browser is not installed)", () => {
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
    /** What the page's own `window.report()` said after the scan, when it has one. */
    report: string | undefined;
  }

  /**
   * Scans a fixture page, or `html` set as its content, with `tags` (`--tags`) when given. `slower` runs the page's
   * CPU that many times slower (the DevTools Protocol's CPU throttling), as a busy machine would.
   */
  async function scan(
    page: string,
    tags: string[] | null = null,
    html?: string,
    slower = 1,
  ): Promise<Scanned> {
    return withBrowser(TEST_CHANNEL, async (browser) => {
      const context = await browser.newContext();
      const attempted = await guardContext(context, server.origin);
      const tab = await context.newPage();
      if (slower > 1) {
        const cdp = await context.newCDPSession(tab);
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: slower });
      }
      // Before the page loads, as `runScan` does: the guard is then first in line.
      await FocusGuard.install(tab);
      await tab.goto(server.url(page));
      if (html !== undefined) await tab.setContent(html);
      const result = await scanPage(tab, undefined, tags, { maxTabs: 1000 });
      const data = (await tab.evaluate("({ ...document.body.dataset })")) as Record<string, string>;
      const report = (await tab.evaluate("window.report?.()")) as string | undefined;
      expect(attempted).toEqual([]);
      return {
        report,
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

  it("focus-marked.html: a ring drawn from a mark the page's focus handlers set is seen; a bare one beside it is not", async () => {
    const { result, finding } = await scan("focus-marked.html");
    expect(result.walk?.stops.map((s) => s.selector)).toEqual(["#marked-first", "#marked-second", "#bare"]);
    expect(finding?.elements.map((e) => e.selector)).toEqual(["#bare"]);
  });

  it("focus-marked-scroll.html: a Tab press that scrolls leaves the witness unused, and the stop reads as before", async () => {
    const { result, finding, review } = await scan("focus-marked-scroll.html");
    expect(result.walk?.stops.map((s) => s.selector)).toEqual(["#top", "#marked-low", "#native"]);
    expect(finding?.elements.map((e) => e.selector)).toEqual(["#marked-low"]);
    expect(review).toBeUndefined();
  });

  it("focus-witness-edges.html: a wide ring beside, a shadow-root animation and a caret do not fool the witness", async () => {
    const { result, finding } = await scan("focus-witness-edges.html");
    expect(result.walk?.stops.map((s) => s.selector)).toEqual([
      "#wide-ring",
      "#after-wide",
      "#beside-spinner",
      "#small-field",
    ]);
    expect(finding?.elements.map((e) => e.selector)).toEqual([
      "#after-wide",
      "#beside-spinner",
      "#small-field",
    ]);
  });

  it("focus-witness-scrolled.html: on a page scrolled far down, the witness photographs the window", async () => {
    const { result, finding } = await scan("focus-witness-scrolled.html");
    expect(result.walk?.stops.map((s) => s.selector)).toEqual(["#deep", "#fixed-marked", "#fixed-bare"]);
    expect(finding?.elements.map((e) => e.selector)).toEqual(["#fixed-bare"]);
  });

  it("the witness's scroll mark gives up, with no witness, on a page whose frames never come", async () => {
    await withBrowser(TEST_CHANNEL, async (browser) => {
      const context = await browser.newContext();
      const tab = await context.newPage();
      await tab.goto(server.url("focus-marked.html"));
      // The page's own frames stop: requestAnimationFrame never calls back, as on a hidden page.
      await tab.evaluate("window.requestAnimationFrame = () => 0");
      const started = Date.now();
      const mark = await tab.evaluate(`(${SCROLL_MARK})()`);
      expect(mark).toBeNull();
      expect(Date.now() - started).toBeLessThan(WITNESS_FRAME_MS + 2000);
    });
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

  it("focus-listening.html: a capture listener on window, added at load, hears the same events with the check as without it", async () => {
    const without = await scan("focus-listening.html", ["wcag2a", "best-practice"]);
    const withIt = await scan("focus-listening.html", ["wcag2a", "best-practice", "wcag2aa"]);
    expect(without.finding).toBeUndefined();
    expect(withIt.finding?.elements.map((e) => e.selector)).toEqual(["#one", "#two"]);
    // The walk's own two Tabs and its wrap-around: the page hears them, and nothing the check did.
    expect(Number(without.data.focusin)).toBeGreaterThan(0);
    expect(withIt.data).toEqual(without.data);
  });

  it("focus-running.html: a running animation and transition keep their time and play state, and fire no end event", async () => {
    const read = (s: Scanned) =>
      JSON.parse(s.report ?? "null") as {
        elapsed: number;
        animations: { id: string; time: number; state: string }[];
      };
    const without = await scan("focus-running.html", ["wcag2a", "best-practice"]);
    const withIt = await scan("focus-running.html", ["wcag2a", "best-practice", "wcag2aa"]);
    expect(withIt.finding?.elements.map((e) => e.selector)).toEqual(["#one", "#two"]);
    const a = read(without);
    const b = read(withIt);
    expect(b.animations.map((x) => [x.id, x.state])).toEqual(a.animations.map((x) => [x.id, x.state]));
    expect(b.animations.map((x) => x.id).sort()).toEqual(["animation", "transition"]);
    for (const x of b.animations) {
      expect(x.state).toBe("running");
      // Each is where the page's own clock says it should be, as it is without the check: not at its end, and
      // not behind by the time the check held it still.
      expect(x.time).toBeLessThan(30_000);
      expect(Math.abs(x.time - b.elapsed)).toBeLessThan(500);
    }
    expect(withIt.data).toEqual({});
    for (const name of [
      "animationend",
      "transitionend",
      "animationcancel",
      "transitioncancel",
      "finish",
      "cancel",
    ]) {
      expect(withIt.data[name], name).toBeUndefined();
    }
    expect(withIt.data).toEqual(without.data);
  });

  /**
   * What, in the ordered log `focus-transitioning.html` keeps, the page heard that no focus change it heard can
   * explain: each such transition event, with the rule it breaks. Empty when every one follows the page's own.
   */
  function unexplained(heard: [string, string][]): string[] {
    const broken: string[] = [];
    let changes = 0;
    // Per element: its focus changes the page heard, since its last run, start or end of each kind; and whether
    // the page heard it lose focus since it last gained it.
    const since = new Map<string, Map<string, number>>();
    const left = new Map<string, boolean>();
    heard.forEach(([type, id], at) => {
      if (type === "focus" || type === "blur") {
        changes += 1;
        left.set(id, type === "blur");
        const kinds = since.get(id) ?? new Map<string, number>();
        for (const kind of ["transitionrun", "transitionstart", "transitionend"])
          kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
        since.set(id, kinds);
        return;
      }
      const where = `${type} on #${id}, event ${at.toString()}`;
      if (changes === 0) broken.push(`${where}: before any focus change the page heard`);
      if (type === "transitioncancel") {
        if (left.get(id) !== true) broken.push(`${where}: the page had not heard it lose focus`);
        return;
      }
      const kinds = since.get(id) ?? new Map<string, number>();
      if ((kinds.get(type) ?? 0) === 0)
        broken.push(`${where}: a second one with no focus change of its own heard`);
      kinds.set(type, 0);
      since.set(id, kinds);
    });
    return broken;
  }

  for (const slower of [1, 6]) {
    const pace = slower === 1 ? "" : `, with the CPU ${slower.toString()} times slower`;
    it(`focus-transitioning.html: a ring by a transition is seen, and the page hears no transition event of the check's making${pace}`, async () => {
      const heard = (s: Scanned) => JSON.parse(s.report ?? "[]") as [string, string][];
      const without = heard(
        await scan("focus-transitioning.html", ["wcag2a", "best-practice"], undefined, slower),
      );
      const withScan = await scan(
        "focus-transitioning.html",
        ["wcag2a", "best-practice", "wcag2aa"],
        undefined,
        slower,
      );
      expect(withScan.finding).toBeUndefined();
      // The walk's own Tabs start the ring's transitions, and the page hears those.
      expect(without.filter(([type]) => type === "transitionrun").length).toBeGreaterThan(0);
      // With the check, every transition event the page hears follows a focus change it heard itself: none comes
      // before the first, an element starts, runs or ends at most once for each of its own, and is cancelled only
      // after the page heard it lose focus. The check's blur and refocus are not heard, so what they start or
      // cancel breaks one of the three. How many there are is not compared: that depends on the walk's pace.
      expect(unexplained(heard(withScan)), JSON.stringify(heard(withScan))).toEqual([]);
      expect(unexplained(without), JSON.stringify(without)).toEqual([]);
    }, 60_000);
  }

  it("a held animation whose time ran out ends where it would have, and does not start again", async () => {
    await withBrowser(TEST_CHANNEL, async (browser) => {
      const context = await browser.newContext();
      const tab = await context.newPage();
      await tab.goto(server.url("focus-hidden.html"));
      const result = (await tab.evaluate(`(async () => {
        const el = document.body;
        const animation = el.animate([{ opacity: 1 }, { opacity: 0.5 }], { duration: 150 });
        let finished = 0;
        animation.onfinish = () => (finished += 1);
        await new Promise((done) => setTimeout(done, 50));
        // The check's own hold and put-back, as it runs them, held past the animation's end.
        globalThis[${JSON.stringify(HELD_FOR_TESTS)}] = { el, paused: [] };
        (${STILL_FOR_TESTS})([""]);
        await new Promise((done) => setTimeout(done, 300));
        (${RESUME_FOR_TESTS})();
        const right = { state: animation.playState, time: animation.currentTime };
        await new Promise((done) => setTimeout(done, 300));
        return { ...right, finished };
      })()`)) as { state: string; time: number; finished: number };
      expect(result.state).toBe("finished");
      expect(result.time).toBe(150);
      expect(result.finished).toBe(1);
    });
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
      channel: TEST_CHANNEL,
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

  it("focus-hidden.html: with the early guard install failed, its stops are needs review, never a finding", async () => {
    await withBrowser(TEST_CHANNEL, async (browser) => {
      const context = await browser.newContext();
      const attempted = await guardContext(context, server.origin);
      const tab = await context.newPage();
      // The install is made to fail once; `FocusGuard.of` then adds a late guard, and marks it.
      const real = context.newCDPSession.bind(context);
      let failures = 1;
      context.newCDPSession = (async (...args: Parameters<typeof real>) => {
        if (failures-- > 0) throw new Error("install stubbed to fail");
        return real(...args);
      }) as typeof real;
      await FocusGuard.install(tab).catch(() => undefined);
      await tab.goto(server.url("focus-hidden.html"));
      const result = await scanPage(tab, undefined, null, { maxTabs: 1000 });
      expect(attempted).toEqual([]);
      expect(result.findings.find((f) => f.rule.id === "focus-visible")).toBeUndefined();
      const review = result.needsReview.find((n) => n.rule.id === "focus-visible");
      expect(review?.elements.some((e) => e.selector === "#plain-link")).toBe(true);
      expect(review?.elements.find((e) => e.selector === "#plain-link")?.reason).toContain(
        "may have heard the check",
      );
    });
  });

  it("a page with no early guard at all reads the same: late, needs review, no finding", async () => {
    await withBrowser(TEST_CHANNEL, async (browser) => {
      const context = await browser.newContext();
      const tab = await context.newPage();
      await tab.goto(server.url("focus-hidden.html"));
      const result = await scanPage(tab, undefined, null, { maxTabs: 1000 });
      expect(result.findings.find((f) => f.rule.id === "focus-visible")).toBeUndefined();
      expect(result.needsReview.find((n) => n.rule.id === "focus-visible")?.elements.length).toBeGreaterThan(
        0,
      );
    });
  });
});
