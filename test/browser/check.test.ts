import { TEST_CHANNEL } from "../helpers/test-browser.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkLine, checkRecord } from "../../src/compare.js";
import { scanSchema, validate } from "../../src/json-schema.js";
import { renderReport } from "../../src/report.js";
import { runScan } from "../../src/run-scan.js";
import type { ScanRecord } from "../../src/scan-record.js";
import { testBrowserIsInstalled, guardContext } from "../helpers/browser-guard.js";
import { startFixtureServer, type FixtureServer } from "../helpers/fixture-server.js";
import { neverClaimViolations } from "../helpers/never-claim.js";

// Scan, fix, rescan (spec 4.6), in the machine's real Chrome, over one page served in three versions:
// check/v1 has three bugs, check/v2 fixes two of them, check/v3 is v2 with a new one. Each is scanned as the
// page "page", so its findings keep their ids, as they would on a dev server whose page was edited. Skipped,
// and says so, where Chrome is not installed.
const hasBrowser = await testBrowserIsInstalled();
const schema = scanSchema();

describe.skipIf(!hasBrowser)("check --baseline (skipped where the test browser is not installed)", () => {
  let server: FixtureServer;
  beforeAll(async () => {
    server = await startFixtureServer(undefined, {
      redirects: { "/check/gone/page.html": "file:///etc/hosts" },
    });
  });
  afterAll(async () => {
    await server.close();
  });

  /** The page `page`, served as `version`, scanned with the no-network guard on. */
  async function scan(version: string): Promise<ScanRecord> {
    const attempted: string[][] = [];
    const url = server.url(`check/${version}/page.html`);
    const record = await runScan({
      url,
      pages: [{ url, key: "page", states: [] }],
      channel: TEST_CHANNEL,
      onContext: async (context) => {
        attempted.push(await guardContext(context, server.origin));
      },
    });
    expect(attempted.flat()).toEqual([]);
    expect(validate(schema, record)).toEqual([]);
    return record;
  }

  function check(baseline: ScanRecord, now: ScanRecord): ScanRecord {
    const record = checkRecord(now, { path: "baseline/scan.json", record: baseline });
    expect(validate(schema, record)).toEqual([]);
    expect(neverClaimViolations(renderReport(record))).toEqual([]);
    return record;
  }

  /** Each finding as `rule: status`, and each element as `selector: status`. */
  const statuses = (record: ScanRecord) =>
    Object.fromEntries(
      record.findings.map((f) => [
        f.rule.id,
        {
          status: f.status,
          elements: f.elements.map((e) => `${e.selector}: ${e.status}`),
          fixed: (f.fixedElements ?? []).map((e) => e.selector),
        },
      ]),
    );

  let baseline: ScanRecord;
  beforeAll(async () => {
    if (hasBrowser) baseline = await scan("v1");
  });

  it("finds the three bugs of v1, the baseline", () => {
    expect(baseline.findings.map((f) => [f.id, f.elements.map((e) => e.selector)])).toEqual([
      ["axe/button-name@page", ["#save", "#share"]],
      ["axe/image-alt@page", ["img"]],
    ]);
    expect(baseline.exit).toBe(1);
  });

  it("gives the same targets for an unchanged page, run after run (V9)", async () => {
    const again = await scan("v1");
    const targets = (record: ScanRecord) =>
      record.findings.map((f) => [f.id, f.elements.map((e) => e.target)]);
    expect(targets(again)).toEqual(targets(baseline));
  });

  it("reads an unchanged page as still open, and does not fail on what the baseline had", async () => {
    const record = check(baseline, await scan("v1"));
    expect(record.summary).toMatchObject({ new: 0, still: 2, fixed: 0 });
    expect(record.findings.every((f) => f.status === "still")).toBe(true);
    expect(record.exit).toBe(0);
  });

  it("reads v2's fixes as fixed, the bug left as still open, and exits 0", async () => {
    const record = check(baseline, await scan("v2"));
    expect(statuses(record)).toEqual({
      "button-name": { status: "still", elements: ["#save: still"], fixed: ["#share"] },
      "image-alt": { status: "fixed", elements: ["img: fixed"], fixed: [] },
    });
    expect(record.findings.find((f) => f.status === "fixed")?.fixedIn).toEqual({
      startedAt: record.startedAt,
      commit: null,
    });
    expect(checkLine(record)).toBe("1 fixed, 0 new, 1 still open (worst: critical, button-name on page)");
    expect(record.exit).toBe(0);
  });

  it("reads v3's bug as new, and exits 1", async () => {
    const record = check(baseline, await scan("v3"));
    expect(statuses(record)).toEqual({
      "button-name": { status: "still", elements: ["#save: still"], fixed: ["#share"] },
      label: { status: "new", elements: ["#email: new"], fixed: [] },
      "image-alt": { status: "fixed", elements: ["img: fixed"], fixed: [] },
    });
    expect(checkLine(record)).toBe("1 fixed, 1 new, 1 still open (worst: critical, button-name on page)");
    expect(record.exit).toBe(1);
    // The unlabelled field reads in the wording table's words, not axe-core's own help and summary.
    const report = renderReport(record);
    expect(report).toContain("Form field with no label");
    expect(report).toContain(
      "- Fix: Add a visible label tied to the field: a label element with a for attribute",
    );
  });

  it("never reads a page that was not scanned as fixed: its findings are still open, unverified, and it exits 1", async () => {
    const record = check(baseline, await scan("gone"));
    expect(record.summary.notScanned).toBe(1);
    expect(record.summary).toMatchObject({ new: 0, still: 2, fixed: 0 });
    expect(record.findings.every((f) => f.status === "still" && f.unverified === true)).toBe(true);
    expect(record.exit).toBe(1);
  });
});
