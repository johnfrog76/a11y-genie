import { TEST_CHANNEL } from "../helpers/test-browser.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scanPage } from "../../src/axe.js";
import { FocusGuard } from "../../src/focus-guard.js";
import { withBrowser } from "../../src/browser.js";
import {
  checkClickOnNonControl,
  MAX_LISTENER_QUERIES,
  type ClickOnNonControl,
} from "../../src/click-on-non-control.js";
import type { AxeScan } from "../../src/finding.js";
import { renderReport } from "../../src/report.js";
import { runScan } from "../../src/run-scan.js";
import { testBrowserIsInstalled, guardContext } from "../helpers/browser-guard.js";
import { startFixtureServer, type FixtureServer } from "../helpers/fixture-server.js";

// genie/click-on-non-control (docs/ARCHITECTURE.md, *Click on a non-control*) flags an inline onclick and an own click listener on an
// element that is not a control; a real button and a div with role="button" and tabindex="0" are not
// flagged; a delegated handler, on the list and not on the item, is *needs review*. Each fixture page names, in
// its comment, what must fire. Skipped, and says so, where Chrome is not installed.
const hasBrowser = await testBrowserIsInstalled();

describe.skipIf(!hasBrowser)(
  "click on a non-control (skipped where the test browser is not installed)",
  () => {
    let server: FixtureServer;
    beforeAll(async () => {
      server = await startFixtureServer();
    });
    afterAll(async () => {
      await server.close();
    });

    async function scan(page: string): Promise<[AxeScan, string[]]> {
      return withBrowser(TEST_CHANNEL, async (browser) => {
        const context = await browser.newContext();
        const attempted = await guardContext(context, server.origin);
        const tab = await context.newPage();
        // Before the page loads, as `runScan` does: a late guard would make the focus-visible check read needs review.
        await FocusGuard.install(tab);
        await tab.goto(server.url(page));
        return [await scanPage(tab), attempted];
      });
    }

    async function check(page: string): Promise<[ClickOnNonControl, string[]]> {
      return withBrowser(TEST_CHANNEL, async (browser) => {
        const context = await browser.newContext();
        const attempted = await guardContext(context, server.origin);
        const tab = await context.newPage();
        await tab.goto(server.url(page));
        return [await checkClickOnNonControl(tab, "page"), attempted];
      });
    }

    it("div-onclick.html flags exactly the inline onclick div and the span with a click listener", async () => {
      const [result, attempted] = await scan("div-onclick.html");
      expect(attempted).toEqual([]);
      expect(result.findings.map((f) => f.id)).toEqual(["genie/click-on-non-control@div-onclick.html"]);
      const [finding] = result.findings;
      expect(finding?.rule).toEqual({
        source: "genie",
        id: "click-on-non-control",
        help: expect.any(String) as string,
        helpUrl: "",
        wcag: ["2.1.1", "4.1.2"],
      });
      expect(finding?.impact).toBe("serious");
      expect(finding?.kind).toBe("violation");
      expect(finding?.elements.map((e) => e.selector)).toEqual(["#inline-div", "#listener-span"]);
      for (const element of finding?.elements ?? []) {
        expect(element.target).toEqual([element.selector]);
        expect(element.failure).toContain("Make it a <button> with the same handler and the same text.");
      }
      expect(finding?.elements[0]?.html).toBe(
        `<div id="inline-div" onclick="this.textContent = 'Saved'">Save</div>`,
      );
    });

    it("does not flag a real button, a div with role and tabindex, a role of several tokens, the delegating list, a hidden div or a contenteditable div", async () => {
      const [result] = await scan("div-onclick.html");
      const named = [...result.findings, ...result.needsReview].flatMap((f) =>
        f.elements.map((e) => e.selector),
      );
      for (const selector of [
        "#real-button",
        "#role-button",
        "#multi-role",
        "#delegated-list",
        "#hidden-div",
        "#editable",
      ]) {
        expect(named).not.toContain(selector);
      }
    });

    it("lists the delegated items under needs review, not as findings, and not the spans inside them", async () => {
      const [result] = await scan("div-onclick.html");
      expect(result.needsReview.map((n) => n.id)).toEqual(["genie/click-on-non-control@div-onclick.html"]);
      const [item] = result.needsReview;
      expect(item?.impact).toBe("serious");
      expect(item?.elements.map((e) => e.selector)).toEqual(["#delegated-one", "#delegated-two"]);
      for (const element of item?.elements ?? []) {
        expect(element.reason).toMatch(/no click handler of its own/);
        expect(element.reason).toMatch(/make it a <button>/);
      }
    });

    it("reads the page from an isolated world, so a page that replaces what it reads changes nothing", async () => {
      const [result, attempted] = await check("click-tampered.html");
      expect(attempted).toEqual([]);
      expect(result.finding?.elements.map((e) => e.selector)).toEqual(["#tampered-div", "#tampered-span"]);
      expect(result.needsReview).toBeUndefined();
    });

    it("asks listeners for at most the cap of elements, and lists those past it as not asked", async () => {
      const [result] = await check("many-clickable.html");
      expect(result.cost).toMatchObject({ candidates: 2100, asked: MAX_LISTENER_QUERIES, pastCap: 100 });
      expect(result.finding?.elements.map((e) => e.selector)).toEqual(
        Array.from({ length: 10 }, (_, i) => `#row-${i}`),
      );
      const review = result.needsReview?.elements ?? [];
      expect(review).toHaveLength(2090);
      const notAsked = review.filter((e) => e.reason.includes("was not asked"));
      expect(notAsked.map((e) => e.selector)).toEqual(
        Array.from({ length: 100 }, (_, i) => `#row-${2000 + i}`),
      );
    });

    it("does not run under a --tags list that has none of its tags", async () => {
      const result = await withBrowser(TEST_CHANNEL, async (browser) => {
        const context = await browser.newContext();
        await guardContext(context, server.origin);
        const tab = await context.newPage();
        await FocusGuard.install(tab);
        await tab.goto(server.url("div-onclick.html"));
        return [await scanPage(tab, "page", ["wcag2aa"]), await scanPage(tab, "page", ["wcag2a"])] as const;
      });
      expect(result[0].findings.some((f) => f.rule.id === "click-on-non-control")).toBe(false);
      expect(result[1].findings.some((f) => f.rule.id === "click-on-non-control")).toBe(true);
    });

    it("the report names the finding and its fix, and the needs review items", async () => {
      const record = await runScan({
        url: server.url("div-onclick.html"),
        channel: TEST_CHANNEL,
        onContext: async (context) => {
          await guardContext(context, server.origin);
        },
      });
      expect(record.exit).toBe(1);
      expect(record.findings.map((f) => f.id)).toEqual(["genie/click-on-non-control@div-onclick.html"]);
      expect(record.summary.needsReview).toBe(1);
      const report = renderReport(record);
      expect(report).toContain("`genie/click-on-non-control`");
      // The fix line is the wording table's; the check's own words stay with the element, fenced.
      expect(report).toContain(
        "- Fix: Make it a button element with the same handler and the same text, or a link if it goes to another page.",
      );
      expect(report).toContain("What the check said:");
      expect(report).toContain("## Needs review");
    });
  },
);
