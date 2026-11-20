import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scanPage } from "../../src/axe.js";
import { withBrowser } from "../../src/browser.js";
import type { AxeScan, Finding } from "../../src/finding.js";
import { nativeModalLine } from "../../src/keyboard-trap.js";
import { renderReport } from "../../src/report.js";
import { runScan } from "../../src/run-scan.js";
import { CANNOT_SEE } from "../../src/scan-record.js";
import { parseStateFlags } from "../../src/scan-plan.js";
import { chromeIsInstalled, guardContext } from "../helpers/browser-guard.js";
import { neverClaimViolations } from "../helpers/never-claim.js";
import { startFixtureServer, type FixtureServer } from "../helpers/fixture-server.js";

// Claim C9: genie/keyboard-trap (spec 6.5) flags a widget that holds Tab and ignores Escape, read from the
// keyboard walk; a proper modal dialog is not flagged, and one that drops focus when Escape closes it is
// genie/focus-not-returned. Each fixture page names, in its comment, what must fire. Skipped, and says so,
// where Chrome is not installed.
const hasChrome = await chromeIsInstalled();

describe.skipIf(!hasChrome)("the keyboard trap (skipped where Chrome is not installed)", () => {
  let server: FixtureServer;
  beforeAll(async () => {
    server = await startFixtureServer();
  });
  afterAll(async () => {
    await server.close();
  });

  interface Scanned {
    result: AxeScan;
    trap: Finding | undefined;
    notReturned: Finding | undefined;
  }

  /** Scans a fixture page, after a click on `click` when given (as a state's step would). */
  async function scan(page: string, click?: string, tags: string[] | null = null): Promise<Scanned> {
    return withBrowser("chrome", async (browser) => {
      const context = await browser.newContext();
      const attempted = await guardContext(context, server.origin);
      const tab = await context.newPage();
      await tab.goto(server.url(page));
      if (click !== undefined) await tab.click(click);
      const result = await scanPage(tab, undefined, tags);
      expect(attempted).toEqual([]);
      return {
        result,
        trap: result.findings.find((f) => f.rule.id === "keyboard-trap"),
        notReturned: result.findings.find((f) => f.rule.id === "focus-not-returned"),
      };
    });
  }

  it("trap.html: focus held in a date picker is a critical WCAG 2.1.2 finding on its three days", async () => {
    const { result, trap, notReturned } = await scan("trap.html");
    expect(result.walk).toMatchObject({ end: "cycled", cycleFrom: 2 });
    expect(result.walk?.stops.map((s) => s.name)).toEqual([
      "How booking works",
      "Monday",
      "Tuesday",
      "Wednesday",
    ]);
    expect(trap).toMatchObject({
      id: "genie/keyboard-trap@trap.html",
      kind: "violation",
      impact: "critical",
      rule: { source: "genie", id: "keyboard-trap", wcag: ["2.1.2"] },
    });
    expect(trap?.elements.map((e) => e.selector)).toEqual(["#day-1", "#day-2", "#day-3"]);
    expect(trap?.elements[0]?.html).toContain("Monday");
    expect(trap?.elements[0]?.failure).toContain("among these 3 elements");
    expect(notReturned).toBeUndefined();
  });

  it("trap-first.html: a trap that holds the first Tab stop wraps, and is found against the page's other controls", async () => {
    const { result, trap } = await scan("trap-first.html");
    expect(result.walk?.end).toBe("wrapped");
    expect(trap?.elements.map((e) => e.selector)).toEqual(["#day-1", "#day-2", "#day-3"]);
  });

  it("trap-stuck.html: focus that does not move is a trap of one element", async () => {
    const { result, trap } = await scan("trap-stuck.html");
    // The search box, then two more presses that leave focus on it: the same element after three Tabs.
    expect(result.walk).toMatchObject({ end: "cycled", cycleFrom: 2, tabs: 4 });
    expect(trap?.elements.map((e) => e.selector)).toEqual(["#search"]);
    expect(trap?.elements[0]?.failure).toContain("Focus does not move");
  });

  it("modal-ok.html: a modal dialog that keeps focus and gives it back on Escape is not flagged", async () => {
    const open = await scan("modal-ok.html", "#open");
    // Focus goes round the dialog's two buttons, on purpose.
    expect(open.result.walk).toMatchObject({ end: "cycled" });
    expect(open.trap).toBeUndefined();
    expect(open.notReturned).toBeUndefined();
    const closed = await scan("modal-ok.html");
    expect(closed.result.walk?.end).not.toBe("cycled");
    expect(closed.trap).toBeUndefined();
    expect(closed.notReturned).toBeUndefined();
  });

  it("trap-shift-leaves.html: a cycle that Shift+Tab can leave is not a trap", async () => {
    const { result, trap } = await scan("trap-shift-leaves.html");
    expect(result.walk).toMatchObject({ end: "cycled" });
    expect(trap).toBeUndefined();
  });

  it("trap-escape-leaves.html: a cycle that Escape, then Tab, can leave is not a trap", async () => {
    const { result, trap } = await scan("trap-escape-leaves.html");
    expect(result.walk).toMatchObject({ end: "cycled" });
    expect(trap).toBeUndefined();
  });

  it("a page with no trap has neither finding", async () => {
    for (const page of ["clean.html", "walk-order.html", "impact-mix.html"]) {
      const { result, trap, notReturned } = await scan(page);
      expect(result.walk?.end, page).not.toBe("cycled");
      expect(trap, page).toBeUndefined();
      expect(notReturned, page).toBeUndefined();
    }
  });

  it("focus-not-returned.html: a modal dialog that drops focus on Escape is moderate, WCAG 2.4.3", async () => {
    const { trap, notReturned } = await scan("focus-not-returned.html", "#open");
    expect(trap).toBeUndefined();
    expect(notReturned).toMatchObject({
      id: "genie/focus-not-returned@focus-not-returned.html",
      kind: "violation",
      impact: "moderate",
      rule: { source: "genie", id: "focus-not-returned", wcag: ["2.4.3"] },
    });
    expect(notReturned?.elements.map((e) => e.selector)).toEqual(["#confirm"]);
    expect(notReturned?.elements[0]?.html).toContain('role="dialog"');
    // With the dialog closed there is nothing to close.
    const closed = await scan("focus-not-returned.html");
    expect(closed.notReturned).toBeUndefined();
  });

  it("--tags without either rule's tags runs neither", async () => {
    const { trap } = await scan("trap.html", undefined, ["wcag2aa"]);
    expect(trap).toBeUndefined();
    const levelA = await scan("trap.html", undefined, ["wcag2a"]);
    expect(levelA.trap?.impact).toBe("critical");
  });

  it("a scan with a state that opens the dialog finds focus-not-returned in that state only", async () => {
    const attempted: string[][] = [];
    const url = server.url("focus-not-returned.html");
    const record = await runScan({
      url,
      pages: [{ url, states: parseStateFlags(["delete-dialog: click css '#open'"]) }],
      channel: "chrome",
      onContext: async (context) => {
        attempted.push(await guardContext(context, server.origin));
      },
    });
    expect(attempted.flat()).toEqual([]);
    const finding = record.findings.find((f) => f.rule.id === "focus-not-returned");
    expect(finding?.elements[0]?.states).toEqual(["delete-dialog"]);
    expect(record.pages[0]?.walks?.map((w) => w.state)).toEqual(["default", "delete-dialog"]);
    expect(record.pages[0]?.walks?.[1]).toMatchObject({ end: "cycled", cycleFrom: 3 });
    expect(record.schema).toBe("1.10");
  });

  it("a native dialog opened with showModal() is named in What this scan cannot see, and only there", async () => {
    const attempted: string[][] = [];
    const onContext = async (context: Parameters<typeof guardContext>[0]): Promise<void> => {
      attempted.push(await guardContext(context, server.origin));
    };
    const url = server.url("native-modal.html");
    const record = await runScan({
      url,
      pages: [{ url, states: parseStateFlags(["change-email: click css '#open'"]) }],
      channel: "chrome",
      onContext,
    });
    const line = nativeModalLine("native-modal.html", ["change-email"]);
    expect(line).toBe(
      "A dialog on native-modal.html (in the state change-email) was opened with showModal(); A11y Genie cannot " +
        "walk the keyboard inside a native modal dialog, so check by hand that Tab stays in it and Escape closes it (WCAG 2.1.2).",
    );
    expect(record.cannotSee).toEqual([...CANNOT_SEE, line]);
    expect(renderReport(record)).toContain(`- ${line}`);
    expect(neverClaimViolations(line)).toEqual([]);
    expect(record.findings.filter((f) => f.rule.source === "genie" && f.rule.id !== "skip-link")).toEqual([]);
    const clean = await runScan({ url: server.url("clean.html"), channel: "chrome", onContext });
    expect(clean.cannotSee).toEqual([...CANNOT_SEE]);
    expect(attempted.flat()).toEqual([]);
  });
});
