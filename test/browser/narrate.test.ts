import { TEST_CHANNEL } from "../helpers/test-browser.js";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pageKeyOf } from "../../src/map-axe.js";
import { renderTranscript } from "../../src/narrate.js";
import { renderReport } from "../../src/report.js";
import { runScan } from "../../src/run-scan.js";
import type { ScanRecord } from "../../src/scan-record.js";
import { parseSteps } from "../../src/steps.js";
import { testBrowserIsInstalled, guardContext } from "../helpers/browser-guard.js";
import { startFixtureServer, type FixtureServer } from "../helpers/fixture-server.js";
import { expectTextGolden, normalise } from "../helpers/goldens.js";
import { validate } from "../helpers/json-schema.js";
import { neverClaimViolations } from "../helpers/never-claim.js";

// Narrated workflows (spec 6.6, C10) in the machine's real Chrome: the transcript of workflow.html against its
// golden, what a press of Enter, Space or a click produced (a live region, a dialog, focus), a step with no
// name, a step that fails, and page text that is hostile. Skipped, and says so, where Chrome is not installed.
const hasBrowser = await testBrowserIsInstalled();
const schema = JSON.parse(
  readFileSync(new URL("../../schema/scan-1.json", import.meta.url), "utf8"),
) as Record<string, never>;

/** The transcript with the port taken out, as the goldens are. */
function transcriptOf(record: ScanRecord, at = 0): string {
  return renderTranscript(record.workflows[at] as ScanRecord["workflows"][number]).replaceAll(
    /127\.0\.0\.1:\d+/g,
    "127.0.0.1:0000",
  );
}

describe.skipIf(!hasBrowser)("narrate (skipped where the test browser is not installed)", () => {
  let server: FixtureServer;
  beforeAll(async () => {
    server = await startFixtureServer();
  });
  afterAll(async () => {
    await server.close();
  });

  /** Narrates `flow` on `page`, as `a11y-genie narrate` does, with the no-network guard on the browser. */
  async function narrate(page: string, flow: string, pageMs = 15_000): Promise<ScanRecord> {
    const url = server.url(page);
    const attempted: string[][] = [];
    const record = await runScan({
      url,
      pages: [{ url, states: [] }],
      workflows: [
        { name: "flow", page: pageKeyOf(url), steps: parseSteps(flow, { source: "--flow", use: "flow" }) },
      ],
      narrateOnly: true,
      channel: TEST_CHANNEL,
      limits: { pageMs },
      onContext: async (context) => {
        attempted.push(await guardContext(context, server.origin));
      },
    });
    expect(attempted.flat()).toEqual([]);
    expect(validate(schema, record)).toEqual([]);
    expect(neverClaimViolations(renderReport(record))).toEqual([]);
    return record;
  }

  it("Tab; Tab; Tab; Enter on workflow.html gives the golden transcript", async () => {
    const record = await narrate("workflow.html", "Tab; Tab; Tab; Enter");
    expectTextGolden("narration/flow.txt", transcriptOf(record));
    expect(record.command).toBe("narrate");
    expect(record.workflows).toHaveLength(1);
    expect(record.workflows[0]).toMatchObject({
      name: "flow",
      page: "workflow.html",
      file: "narration/flow.txt",
    });
    expect(record.workflows[0]?.notScanned).toBeUndefined();
  });

  it("reads each step back from the accessibility tree: role, name, states and the spoken line", async () => {
    const record = await narrate("workflow.html", "Tab; Tab; Tab; Enter");
    const steps = record.workflows[0]?.steps ?? [];
    expect(steps.map((step) => step.key)).toEqual(["Tab", "Tab", "Tab", "Enter"]);
    expect(steps[0]).toMatchObject({
      role: "textbox",
      name: "Email",
      states: ["required"],
      spoken: "Email, edit text, required",
      unnamed: false,
      selector: "#email",
    });
    expect(steps[1]).toMatchObject({
      role: "button",
      name: "",
      spoken: "button",
      unnamed: true,
      selector: "#unnamed",
    });
    expect(steps[2]).toMatchObject({ role: "button", name: "Save", spoken: "Save, button", unnamed: false });
    // Only a press of Enter or Space, or a click, says what it produced.
    expect(steps[0]).not.toHaveProperty("produced");
    expect(steps[3]?.produced).toEqual([{ kind: "live", spoken: "Saved, status" }]);
  });

  it("a step that leaves focus on a control with no name is genie/unnamed-step, and the run exits 1", async () => {
    const record = await narrate("workflow.html", "Tab; Tab; Tab; Enter");
    expect(record.exit).toBe(1);
    const found = record.findings.find((finding) => finding.rule.id === "unnamed-step");
    expect(found).toMatchObject({
      id: "genie/unnamed-step@workflow.html",
      impact: "serious",
      kind: "violation",
      rule: { source: "genie", id: "unnamed-step", wcag: ["4.1.2"] },
      page: "workflow.html",
    });
    expect(found?.elements.map((element) => element.selector)).toEqual(["#unnamed"]);
    expect(found?.elements[0]?.html).toContain('<button id="unnamed"');
    expect(found?.elements[0]?.failure).toContain('Step 2 (Tab) of the flow "flow"');
    expect(found?.plain).toMatch(/no name/);
    expect(record.summary).toMatchObject({ critical: 0, serious: 1, moderate: 0, minor: 0, notScanned: 0 });
    // No axe-core ran: the only finding is the product's own.
    expect(record.findings).toHaveLength(1);
    expect(record.engine.rulesRun).toBe(0);
  });

  it("a flow with no unnamed step exits 0", async () => {
    const record = await narrate("workflow.html", "Tab; Tab to button 'Save'; Enter");
    expect(record.exit).toBe(0);
    expect(record.findings).toEqual([]);
    expect(record.workflows[0]?.steps.map((step) => step.unnamed)).toEqual([false, false, false]);
  });

  it("reaching the same unnamed control twice is one element, and a step that stays on it is not a second", async () => {
    const record = await narrate("workflow.html", "Tab; Tab; Enter; Shift+Tab; Tab");
    const steps = record.workflows[0]?.steps ?? [];
    expect(steps.map((step) => step.unnamed)).toEqual([false, true, false, false, true]);
    const found = record.findings.find((finding) => finding.rule.id === "unnamed-step");
    expect(found?.elements).toHaveLength(1);
  });

  describe("what a press produced", () => {
    it("a dialog that opened is named, then where focus went; closing it says where focus came back", async () => {
      const record = await narrate("narrate-press.html", "Tab; Enter; Enter");
      const steps = record.workflows[0]?.steps ?? [];
      expect(steps[1]?.produced).toEqual([
        { kind: "dialog", spoken: "Settings, dialog" },
        { kind: "focus", spoken: "Close, button" },
      ]);
      expect(steps[2]?.produced).toEqual([{ kind: "focus", spoken: "Open settings, button" }]);
      expect(transcriptOf(record)).toBe(
        [
          "flow, on narrate-press.html",
          "1  Tab    Open settings, button",
          "2  Enter  Settings, dialog",
          "          Close, button",
          "3  Enter  Open settings, button",
          "",
        ].join("\n"),
      );
    });

    it("text added to an aria-live region is said, and a second press says only what was added", async () => {
      const record = await narrate("narrate-press.html", "Tab; Tab; Enter; Enter");
      const steps = record.workflows[0]?.steps ?? [];
      expect(steps[2]?.produced).toEqual([{ kind: "live", spoken: "Updated at noon." }]);
      expect(steps[3]?.produced).toEqual([{ kind: "live", spoken: "Updated at noon." }]);
    });

    it("a live region inside another is said once, and two separate regions are said twice", async () => {
      const nested = await narrate("narrate-nested-live.html", "Tab; Enter");
      expect(nested.workflows[0]?.steps[1]?.produced).toEqual([{ kind: "live", spoken: "Saved" }]);
      const siblings = await narrate("narrate-nested-live.html", "Tab; Tab; Enter");
      expect(siblings.workflows[0]?.steps[2]?.produced).toEqual([
        { kind: "live", spoken: "First saved, status" },
        { kind: "live", spoken: "Second saved, status" },
      ]);
    });

    it("Space and a click are read as Enter is", async () => {
      const record = await narrate("narrate-press.html", "Tab; Tab; Space; click button 'Refresh'");
      const steps = record.workflows[0]?.steps ?? [];
      expect(steps[2]?.produced).toEqual([{ kind: "live", spoken: "Updated at noon." }]);
      expect(steps[3]?.produced).toEqual([{ kind: "live", spoken: "Updated at noon." }]);
      expect(steps[3]).toMatchObject({ key: "click button 'Refresh'", spoken: "Refresh, button" });
    });

    it("a press that produced nothing says so", async () => {
      const record = await narrate("narrate-press.html", "Tab; Tab; Tab; Enter");
      expect(record.workflows[0]?.steps[3]?.produced).toEqual([]);
      expect(transcriptOf(record)).toContain("4  Enter  (nothing is said)");
    });

    it("a jump within the page is not a new page, and a link to another page says its title", async () => {
      const jump = await narrate("narrate-press.html", "Tab to link 'Jump down'; Enter");
      // Chrome takes focus off the link and puts it on no element; the page's title is not said again.
      expect(jump.workflows[0]?.steps[1]?.produced).toEqual([{ kind: "focus", spoken: "" }]);
      const away = await narrate("narrate-press.html", "Tab to link 'Another page'; Enter; Tab");
      const steps = away.workflows[0]?.steps ?? [];
      expect(steps[1]?.produced).toEqual([{ kind: "page", spoken: "Clean fixture, document" }]);
      // The flow goes on, on the new page.
      expect(steps[2]).toMatchObject({ spoken: "Save, button" });
      expect(away.workflows[0]?.notScanned).toBeUndefined();
    });

    it("a reload at the same address is a new page, and the flow goes on", async () => {
      const record = await narrate("narrate-reload.html", "Tab to button 'Reload'; Enter; Tab; Tab");
      const steps = record.workflows[0]?.steps ?? [];
      expect(record.workflows[0]?.notScanned).toBeUndefined();
      expect(steps).toHaveLength(4);
      expect(steps[1]?.produced).toEqual([{ kind: "page", spoken: "Reloading page, document" }]);
      expect(steps.slice(2).map((step) => step.spoken)).toEqual(["Reload, button", "Next, button"]);
    });

    it("a menu button that opens says its new state", async () => {
      const record = await narrate("workflow.html", "Tab to button 'Actions'; Enter; Space");
      const steps = record.workflows[0]?.steps ?? [];
      expect(steps[1]?.produced).toEqual([{ kind: "change", spoken: "Actions, menu button, expanded" }]);
      expect(steps[2]?.produced).toEqual([{ kind: "change", spoken: "Actions, menu button, collapsed" }]);
    });
  });

  it("a step that fails on the page stops the flow, reads not scanned, and exits 1", async () => {
    const record = await narrate("workflow.html", "Tab; click button 'Nowhere'; Tab", 3_000);
    const flow = record.workflows[0];
    expect(flow?.steps).toHaveLength(1);
    expect(flow?.notScanned).toMatch(/^step 2 \(click button 'Nowhere'\) failed: no such element/);
    expect(record.summary.notScanned).toBe(1);
    expect(record.exit).toBe(1);
    expect(transcriptOf(record)).toMatch(
      /\nNot narrated past this point: step 2 \(click button 'Nowhere'\) failed/,
    );
  });

  it("a tab limit stops a `Tab to` step that never arrives", async () => {
    const url = server.url("workflow.html");
    const record = await runScan({
      url,
      pages: [{ url, states: [] }],
      workflows: [
        {
          name: "flow",
          page: "workflow.html",
          steps: parseSteps("Tab to link 'Nope'", { source: "--flow", use: "flow" }),
        },
      ],
      narrateOnly: true,
      maxTabs: 3,
      channel: TEST_CHANNEL,
      onContext: async (context) => {
        await guardContext(context, server.origin);
      },
    });
    expect(record.workflows[0]?.notScanned).toBe(
      "step 1 (Tab to link 'Nope') failed: focus did not reach it within 3 Tab presses",
    );
  });

  it("page text is made printable and cut, in the record, the transcript and the report", async () => {
    const record = await narrate("hostile/narrate-text.html", "Tab; Enter; Tab");
    const steps = record.workflows[0]?.steps ?? [];
    const everything = JSON.stringify(record) + transcriptOf(record) + renderReport(record);
    // eslint-disable-next-line no-control-regex
    expect(everything).not.toMatch(/[\u001b\u0007\r‮]/);
    expect(steps[0]?.name).toBe("Go RED faketxt");
    const said = steps[1]?.produced?.[0]?.spoken ?? "";
    expect(said.startsWith("RED said word word")).toBe(true);
    expect([...said].length).toBeLessThanOrEqual(161 + ", status".length);
    expect(said.endsWith(", status") || said.endsWith("…")).toBe(true);
  });

  it("a page that does not answer is a refusal for the first flow, as it is for a scan", async () => {
    // Every flow runs in the guarded context of src/context.ts, whose rules hostile.test.ts holds.
    const url = "http://127.0.0.1:9/";
    await expect(
      runScan({
        url,
        pages: [{ url, states: [] }],
        workflows: [
          { name: "flow", page: "home", steps: parseSteps("Tab", { source: "--flow", use: "flow" }) },
        ],
        narrateOnly: true,
        channel: TEST_CHANNEL,
      }),
    ).rejects.toThrow(/did not answer/);
  });

  it("the golden's own page, scanned as a plain page, still has its unnamed button for axe-core", async () => {
    const url = server.url("workflow.html");
    const scan = await runScan({
      url,
      pages: [{ url, states: [] }],
      channel: TEST_CHANNEL,
      onContext: async (context) => {
        await guardContext(context, server.origin);
      },
    });
    expect(scan.command).toBe("scan");
    expect(scan.workflows).toEqual([]);
    expect(scan.findings.some((finding) => finding.rule.id === "button-name")).toBe(true);
    expect(normalise(scan).schema).toBe("1.10");
  });
});
