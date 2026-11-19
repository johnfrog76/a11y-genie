import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scanPage } from "../../src/axe.js";
import { withBrowser } from "../../src/browser.js";
import type { AxeScan } from "../../src/finding.js";
import { renderReport } from "../../src/report.js";
import { runScan } from "../../src/run-scan.js";
import { chromeIsInstalled, guardContext } from "../helpers/browser-guard.js";
import { startFixtureServer, type FixtureServer } from "../helpers/fixture-server.js";

// Claim C5: a page with no landmark is flagged, and a page with all four is clean of the landmark rules.
// Each fixture page names, in its comment, the rules that must fire. Skipped, and says so, where Chrome is
// not installed.
const hasChrome = await chromeIsInstalled();

/** Each landmark fixture page and the rules its comment says must fire, worst first, then by rule id (src/order.ts). */
const PAGES: [page: string, findings: string[]][] = [
  ["landmarks-ok.html", []],
  ["no-landmarks.html", ["landmark-one-main", "genie/no-landmarks", "region"]],
  ["content-outside-landmarks.html", ["region"]],
  ["no-main.html", ["landmark-one-main"]],
  ["two-mains.html", ["landmark-no-duplicate-main"]],
];

describe.skipIf(!hasChrome)("landmarks on the fixture pages (skipped where Chrome is not installed)", () => {
  let server: FixtureServer;
  beforeAll(async () => {
    server = await startFixtureServer();
  });
  afterAll(async () => {
    await server.close();
  });

  async function scan(page: string): Promise<[AxeScan, string[]]> {
    return withBrowser("chrome", async (browser) => {
      const context = await browser.newContext();
      const attempted = await guardContext(context, server.origin);
      const tab = await context.newPage();
      await tab.goto(server.url(page));
      return [await scanPage(tab), attempted];
    });
  }

  it.each(PAGES)("%s gives exactly the rules its comment names", async (page, expected) => {
    const [result, attempted] = await scan(page);
    const ids = result.findings.map((f) => `${f.rule.source === "genie" ? "genie/" : ""}${f.rule.id}`);
    expect(ids).toEqual(expected);
    expect(result.needsReview).toEqual([]);
    expect(attempted).toEqual([]);
  });

  it("landmarks-ok.html has all four landmarks and no finding", async () => {
    const [result] = await scan("landmarks-ok.html");
    expect(result.findings).toEqual([]);
  });

  it("states the missing landmarks once for the page, not once per element", async () => {
    const [result] = await scan("no-landmarks.html");
    const own = result.findings.filter((f) => f.rule.source === "genie");
    expect(own).toHaveLength(1);
    const [finding] = own;
    expect(finding?.id).toBe("genie/no-landmarks@no-landmarks.html");
    expect(finding?.impact).toBe("moderate");
    expect(finding?.kind).toBe("violation");
    expect(finding?.rule.wcag).toEqual(["1.3.1", "2.4.1"]);
    expect(finding?.elements).toHaveLength(1);
    expect(finding?.elements[0]?.selector).toBe("body");
    expect(finding?.elements[0]?.html).toMatch(/^<body/);
  });

  it("does not say a page has no landmark when it has a main and content outside it", async () => {
    const [result] = await scan("content-outside-landmarks.html");
    expect(result.findings.some((f) => f.rule.id === "no-landmarks")).toBe(false);
  });

  it("the report names the page-level finding and its fix", async () => {
    const record = await runScan({
      url: server.url("no-landmarks.html"),
      channel: "chrome",
      onContext: async (context) => {
        await guardContext(context, server.origin);
      },
    });
    expect(record.exit).toBe(1);
    expect(record.findings.map((f) => f.id)).toContain("genie/no-landmarks@no-landmarks.html");
    const report = renderReport(record);
    expect(report).toContain("`genie/no-landmarks`");
    expect(report).toContain("The page has no landmarks");
  });
});
