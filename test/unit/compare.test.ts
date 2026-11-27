import { describe, expect, it } from "vitest";
import {
  checkLine,
  checkRecord,
  compareScans,
  incomparable,
  neverScannedLine,
  sincePreviousLine,
  unverifiedOf,
  withPrevious,
} from "../../src/compare.js";
import type { AxeScan, Finding, Impact } from "../../src/finding.js";
import { renderReport } from "../../src/report.js";
import {
  buildPagesRecord,
  fitToSize,
  scanJson,
  type ScanRecord,
  type StateResult,
} from "../../src/scan-record.js";
import { scanLines, type PreparedScan } from "../../src/scan-command.js";
import { CARRIED_ITEMS, CARRIED_TEXT_CHARS } from "../../src/compare.js";
import { axeHelpUrl } from "../../src/map-axe.js";
import { scanSchema, validate } from "../../src/json-schema.js";
import { readGolden } from "../helpers/goldens.js";
import { neverClaimViolations } from "../helpers/never-claim.js";

// How two scans are compared (docs/ARCHITECTURE.md, *Scan, fix, rescan*), with no browser: records built from made-up axe-core findings.
// test/browser/check.test.ts proves the same over a real page served in three versions.

const schema = scanSchema();

function finding(rule: string, selectors: string[], impact: Impact = "critical", page = "page"): Finding {
  return {
    id: `axe/${rule}@${page}`,
    rule: { source: "axe", id: rule, help: `The ${rule} rule`, helpUrl: "", wcag: [] },
    kind: "violation",
    impact,
    page,
    elements: selectors.map((selector) => ({
      selector,
      target: [selector],
      html: `<b id="${selector.slice(1)}"></b>`,
      failure: "",
    })),
  };
}

const axe = (...findings: Finding[]): AxeScan => ({
  axeCore: "4.14.1",
  rulesRun: 90,
  findings,
  needsReview: [],
});

let second = 0;
/** A record of the page `page`, in the states given, each new one a second later than the last. */
function scanOf(
  states: StateResult[],
  options: { tags?: string[]; failOn?: Impact; key?: string; commit?: string } = {},
): ScanRecord {
  second += 1;
  const at = `2000-01-01T00:00:${String(second).padStart(2, "0")}Z`;
  const record = buildPagesRecord({
    tool: { name: "a11y-genie", version: "0.0.0" },
    browser: "chrome 1",
    fallback: false,
    startedAt: at,
    finishedAt: at,
    pages: [{ key: options.key ?? "page", url: "http://127.0.0.1:1/page", states }],
    ...(options.tags === undefined ? {} : { tags: options.tags }),
    ...(options.failOn === undefined ? {} : { failOn: options.failOn }),
  });
  return { ...record, target: { ...record.target, commit: options.commit ?? null } };
}

const only = (...findings: Finding[]): StateResult[] => [{ name: "default", axe: axe(...findings) }];

function check(baseline: ScanRecord, now: ScanRecord): ScanRecord {
  const record = checkRecord(now, { path: "baseline/scan.json", record: baseline });
  expect(validate(schema, record)).toEqual([]);
  return record;
}

const byId = (record: ScanRecord) => Object.fromEntries(record.findings.map((f) => [f.rule.id, f]));

describe("check against a baseline", () => {
  const baseline = scanOf(only(finding("button-name", ["#save", "#share"]), finding("image-alt", ["img"])));

  it("reads a finding gone as fixed, and an element gone as fixed under a finding still open; exits 0", () => {
    const now = scanOf(only(finding("button-name", ["#save"])), { commit: "abc123" });
    const record = check(baseline, now);
    const { "button-name": button, "image-alt": image } = byId(record);
    expect(button?.status).toBe("still");
    expect(button?.elements.map((e) => [e.selector, e.status])).toEqual([["#save", "still"]]);
    expect(button?.fixedElements?.map((e) => [e.selector, e.status])).toEqual([["#share", "fixed"]]);
    expect(image?.status).toBe("fixed");
    expect(image?.elements.map((e) => e.selector)).toEqual(["img"]);
    expect(image?.fixedIn).toEqual({ startedAt: now.startedAt, commit: "abc123" });
    expect(record.summary).toMatchObject({ new: 0, still: 1, fixed: 1, critical: 1 });
    expect(record.command).toBe("check");
    expect(record.baseline).toEqual({
      path: "baseline/scan.json",
      startedAt: baseline.startedAt,
      commit: null,
      notScanned: [],
    });
    // A finding still open from the baseline never fails the check.
    expect(record.exit).toBe(0);
    // Open findings first, then the fixed ones.
    expect(record.findings.map((f) => f.status)).toEqual(["still", "fixed"]);
    expect(checkLine(record)).toBe("1 fixed, 0 new, 1 still open (worst: critical, button-name on page)");
  });

  it("reads a finding the baseline did not have as new, and exits 1", () => {
    const now = scanOf(
      only(
        finding("button-name", ["#save", "#share"]),
        finding("image-alt", ["img"]),
        finding("label", ["#email"]),
      ),
    );
    const record = check(baseline, now);
    expect(byId(record).label?.status).toBe("new");
    expect(byId(record).label?.elements[0]?.status).toBe("new");
    expect(record.summary).toMatchObject({ new: 1, still: 2, fixed: 0 });
    expect(record.exit).toBe(1);
  });

  it("fails only on a new violation at or above --fail-on", () => {
    const now = scanOf(
      only(
        finding("button-name", ["#save", "#share"]),
        finding("image-alt", ["img"]),
        finding("list", ["ul"], "serious"),
      ),
      {
        failOn: "critical",
      },
    );
    const record = check(baseline, now);
    expect(byId(record).list?.status).toBe("new");
    expect(record.exit).toBe(0);
  });

  it("reads a new element on a finding the baseline had as new", () => {
    const now = scanOf(
      only(finding("button-name", ["#save", "#share", "#print"]), finding("image-alt", ["img"])),
    );
    const record = check(baseline, now);
    const button = byId(record)["button-name"];
    expect(button?.status).toBe("new");
    // Elements in the record's order: by their first state, then by target (src/merge-states.ts).
    expect(button?.elements.map((e) => [e.selector, e.status])).toEqual([
      ["#print", "new"],
      ["#save", "still"],
      ["#share", "still"],
    ]);
    expect(record.exit).toBe(1);
  });

  it("reads elements whose selectors moved, as many as before, as still: never fixed plus new", () => {
    const now = scanOf(
      only(finding("button-name", ["#save", "button:nth-child(3)"]), finding("image-alt", ["img"])),
    );
    const record = check(baseline, now);
    const button = byId(record)["button-name"];
    expect(button?.status).toBe("still");
    expect(button?.fixedElements).toBeUndefined();
    expect(record.summary).toMatchObject({ new: 0, fixed: 0 });
    expect(record.exit).toBe(0);
  });

  it("never pairs an element of a state not scanned with a new one: the new one is new, the other still and unverified", () => {
    const before = scanOf([
      { name: "default", axe: axe() },
      { name: "dark", axe: axe(finding("image-alt", ["#b"])) },
    ]);
    const now = scanOf([
      { name: "default", axe: axe(finding("image-alt", ["#a"])) },
      { name: "dark", axe: null, notScanned: "step 1 (colorScheme dark) failed" },
    ]);
    const image = byId(check(before, now))["image-alt"];
    expect(image?.status).toBe("new");
    expect(image?.unverified).toBe(true);
    expect(image?.elements.map((e) => [e.selector, e.status, e.unverified ?? false])).toEqual([
      ["#a", "new", false],
      ["#b", "still", true],
    ]);
  });

  it("never reads a finding of a state not scanned as fixed: it stays still and unverified, and the run exits 1", () => {
    const states = (menuFindings: Finding[] | null, defaultFindings: Finding[]): StateResult[] => [
      { name: "default", axe: axe(...defaultFindings) },
      menuFindings === null
        ? { name: "menu", axe: null, notScanned: "step 1 (click button 'Menu') failed" }
        : { name: "menu", axe: axe(...menuFindings) },
    ];
    const before = scanOf(
      states([finding("aria-hidden-focus", ["#menu a"])], [finding("image-alt", ["img"])]),
    );
    const now = scanOf(states(null, []));
    const record = check(before, now);
    const { "aria-hidden-focus": menu, "image-alt": image } = byId(record);
    expect(menu?.status).toBe("still");
    expect(menu?.unverified).toBe(true);
    expect(menu?.elements.map((e) => [e.selector, e.status, e.unverified])).toEqual([
      ["#menu a", "still", true],
    ]);
    // A finding of a state that was scanned is still read as fixed.
    expect(image?.status).toBe("fixed");
    expect(record.summary).toMatchObject({ new: 0, still: 1, fixed: 1, notScanned: 1 });
    expect(record.exit).toBe(1);
  });

  it("keeps when a finding was first found gone, through a baseline that is itself a check, and reads one come back as new", () => {
    const first = scanOf(only(finding("button-name", ["#save"])), { commit: "first" });
    const round1 = check(baseline, first);
    const second = scanOf(only(finding("button-name", ["#save"])), { commit: "second" });
    const round2 = check(round1, second);
    expect(byId(round2)["image-alt"]?.fixedIn).toEqual({ startedAt: first.startedAt, commit: "first" });
    expect(byId(round2)["image-alt"]?.status).toBe("fixed");
    const back = check(
      round1,
      scanOf(only(finding("button-name", ["#save"]), finding("image-alt", ["img"]))),
    );
    expect(byId(back)["image-alt"]?.status).toBe("new");
    expect(back.exit).toBe(1);
  });

  it("copies only the fields it knows from the baseline, and cuts its HTML again", () => {
    const hostile = structuredClone(baseline) as ScanRecord & Record<string, unknown>;
    const element = hostile.findings[1]?.elements[0] as unknown as Record<string, unknown>;
    element.html = "<img>" + "x".repeat(10_000);
    element.extra = "kept nowhere";
    const record = check(hostile, scanOf(only(finding("button-name", ["#save", "#share"]))));
    const fixed = byId(record)["image-alt"]?.elements[0] as unknown as Record<string, unknown>;
    expect([...(fixed.html as string)].length).toBe(161);
    expect(fixed.extra).toBeUndefined();
  });

  it("writes a report that names each status and the fixed findings, and never claims the site is fine", () => {
    const record = check(baseline, scanOf(only(finding("button-name", ["#save"])), { commit: "abc123" }));
    const report = renderReport(record);
    expect(report).toContain("1 fixed, 0 new, 1 still open");
    expect(report).toContain("- Status: still open");
    expect(report).toContain("- Fixed under it: `#share`");
    expect(report).toContain("## Fixed since the baseline");
    expect(report).toMatch(
      /`axe\/image-alt@page`: .*first found gone in the scan that began .* at `abc123`\./,
    );
    expect(neverClaimViolations(report)).toEqual([]);
  });
});

describe("check over merged states", () => {
  // The states golden: one page in three states, and `.unnamed` found in two of them, menu-open and menu-dark.
  const golden = JSON.parse(readGolden("states", "scan.json")) as ScanRecord;

  it("reads an element found in two states, then in only one of them, as still, with nothing fixed under it", () => {
    const baseline = golden.findings.find((f) => f.id === "axe/button-name@states.html");
    expect(baseline?.elements.map((e) => [e.selector, e.states])).toEqual([
      [".unnamed", ["menu-open", "menu-dark"]],
    ]);
    const now = structuredClone(golden);
    const finding = now.findings.find((f) => f.id === "axe/button-name@states.html");
    (finding?.elements[0] as { states: string[] }).states = ["menu-open"];
    now.startedAt = "2000-01-01T00:01:00Z";

    const record = check(golden, now);
    const button = record.findings.find((f) => f.id === "axe/button-name@states.html");
    expect(button?.status).toBe("still");
    expect(button?.elements.map((e) => [e.selector, e.states, e.status])).toEqual([
      [".unnamed", ["menu-open"], "still"],
    ]);
    // The element is the same element, so nothing is fixed under the finding.
    expect(button?.fixedElements).toBeUndefined();
    expect(record.summary).toMatchObject({ new: 0, still: 2, fixed: 0 });
    expect(record.exit).toBe(0);
  });
});

describe("check against a baseline that did not scan a state (decided 2026-11-19)", () => {
  // The baseline asked for "dark" and could not scan it, so a finding there now cannot be told new or old.
  const baseline = scanOf([
    { name: "default", axe: axe(finding("button-name", ["#save"])) },
    { name: "dark", axe: null, notScanned: "step 1 (colorScheme dark) failed" },
  ]);
  const now = (defaultFindings: Finding[], darkFindings: Finding[]): ScanRecord =>
    scanOf([
      { name: "default", axe: axe(...defaultFindings) },
      { name: "dark", axe: axe(...darkFindings) },
    ]);

  it("reads a finding found only there as unverified, not new, and does not fail the check", () => {
    const record = check(
      baseline,
      now([finding("button-name", ["#save"])], [finding("color-contrast", ["p"], "serious")]),
    );
    const contrast = byId(record)["color-contrast"];
    expect(contrast?.status).toBe("still");
    expect(contrast?.unverified).toBe(true);
    expect(contrast?.elements.map((e) => [e.selector, e.states, e.status, e.unverified])).toEqual([
      ["p", ["dark"], "still", true],
    ]);
    expect(record.summary).toMatchObject({ new: 0, still: 2, fixed: 0 });
    expect(record.exit).toBe(0);
    expect(record.baseline?.notScanned).toEqual([{ page: "page", state: "dark" }]);
    expect(unverifiedOf(record)).toEqual({ thisTime: 0, neverScanned: 1, states: ["dark"] });
    expect(neverScannedLine(record)).toBe(
      '1 finding is unverified: the baseline did not scan the state "dark". To compare it, run a11y-genie scan with the same --states to make a new baseline.',
    );
    expect(renderReport(record)).toContain(
      '1 finding is unverified: the baseline did not scan the state "dark".',
    );
  });

  it("marks an unseen state's element on a finding the baseline had as unverified, not new", () => {
    const record = check(
      baseline,
      now([finding("button-name", ["#save"])], [finding("button-name", ["#print"])]),
    );
    const button = byId(record)["button-name"];
    expect(button?.status).toBe("still");
    expect(button?.unverified).toBe(true);
    expect(button?.elements.map((e) => [e.selector, e.status, e.unverified ?? false])).toEqual([
      ["#save", "still", false],
      ["#print", "still", true],
    ]);
    expect(record.exit).toBe(0);
  });

  it("keeps a finding new when another of its elements is new in a state both scans had: only the unseen one is unverified", () => {
    const record = check(
      baseline,
      now([finding("button-name", ["#save"]), finding("label", ["#email"])], [finding("label", ["#phone"])]),
    );
    const label = byId(record).label;
    expect(label?.status).toBe("new");
    expect(label?.unverified).toBe(true);
    expect(label?.elements.map((e) => [e.selector, e.status, e.unverified ?? false])).toEqual([
      ["#email", "new", false],
      ["#phone", "still", true],
    ]);
    expect(record.exit).toBe(1);
  });

  it("reads an element found in the unseen state and in a state both scanned as new", () => {
    const record = check(
      baseline,
      now([finding("button-name", ["#save"]), finding("label", ["#email"])], [finding("label", ["#email"])]),
    );
    const label = byId(record).label;
    expect(label?.status).toBe("new");
    expect(label?.unverified).toBeUndefined();
    expect(label?.elements.map((e) => [e.selector, e.states, e.status])).toEqual([
      ["#email", ["default", "dark"], "new"],
    ]);
    expect(neverScannedLine(record)).toBeUndefined();
    expect(record.exit).toBe(1);
  });
});

describe("compareScans", () => {
  it("lists nothing as fixed for a finding of a page none of whose states were scanned", () => {
    const before = scanOf(only(finding("image-alt", ["img"])));
    const now = scanOf([{ name: "default", axe: null, notScanned: "it did not answer" }]);
    const compared = compareScans(before, now);
    expect(compared.fixed).toBe(0);
    expect(compared.unverified).toBe(1);
    expect(compared.findings.map((f) => [f.id, f.status, f.unverified])).toEqual([
      ["axe/image-alt@page", "still", true],
    ]);
  });
});

describe("elements carried from a baseline get a fresh scan's limits (issue 75)", () => {
  const LONG = "x".repeat(10_000);
  const many = (count: number) => Array.from({ length: count }, (_, i) => `#e${i}`);
  /** A baseline whose finding has elements with an oversized failure and selector. */
  function crafted(selectors: string[]): ScanRecord {
    const baseline = scanOf(only(finding("image-alt", selectors)));
    for (const f of baseline.findings) {
      f.elements = f.elements.map((e) => ({ ...e, selector: LONG + e.selector, failure: LONG }));
    }
    return baseline;
  }
  const gone = (): ScanRecord => scanOf(only());

  it("cuts a fixed element's failure and selector, in the record and the report", () => {
    const record = check(crafted(["#a"]), gone());
    const [fixed] = record.findings;
    const element = fixed!.elements[0]!;
    expect(fixed!.status).toBe("fixed");
    expect([...element.failure].length).toBeLessThanOrEqual(CARRIED_TEXT_CHARS + 1);
    expect([...element.selector].length).toBeLessThanOrEqual(CARRIED_TEXT_CHARS + 1);
    expect(renderReport(record)).not.toContain("x".repeat(CARRIED_TEXT_CHARS + 2));
  });

  it("carries at most 500 of 1,000 fixed elements and counts the rest", () => {
    const record = check(crafted(many(1000)), gone());
    const [fixed] = record.findings;
    expect(fixed!.elements).toHaveLength(500);
    expect(fixed!.elementsCut).toBe(500);
  });

  it("carries at most 500 of 1,000 unverified elements and counts the rest", () => {
    const now = scanOf([{ name: "default", axe: null, notScanned: "it did not answer" }]);
    const [still] = compareScans(crafted(many(1000)), now).findings;
    expect(still!.status).toBe("still");
    expect(still!.elements).toHaveLength(500);
    expect(still!.elementsCut).toBe(500);
    expect(still!.elements.every((e) => e.unverified === true)).toBe(true);
    expect([...still!.elements[0]!.failure].length).toBeLessThanOrEqual(CARRIED_TEXT_CHARS + 1);
  });
});

describe("fixed elements cut from a baseline are not failing elements (issue 79)", () => {
  const many = (count: number, prefix: string) => Array.from({ length: count }, (_, i) => `#${prefix}${i}`);
  // A baseline file lists 600 elements (a fresh scan never keeps more than 500, but a file can say anything):
  // 1 still fails, 599 are fixed, of which 500 are carried and 99 cut.
  const baseline = (): ScanRecord => {
    const record = scanOf(only(finding("image-alt", ["#a-open"])));
    const [first] = record.findings;
    const template = first!.elements[0]!;
    first!.elements.push(
      ...many(599, "f").map((selector) => ({ ...template, selector, target: [selector] })),
    );
    return record;
  };
  const now = () => scanOf(only(finding("image-alt", ["#a-open"])));

  it("counts the excess in fixedCut and leaves elementsCut alone", () => {
    const record = check(baseline(), now());
    const [open] = record.findings;
    expect(open!.status).toBe("still");
    expect(open!.fixedElements).toHaveLength(500);
    expect(open!.fixedCut).toBe(99);
    expect(open!.elementsCut).toBeUndefined();
    expect(validate(schema, record)).toEqual([]);
  });

  it("reads the Elements line as failing elements only, and says the fixed ones not listed", () => {
    const report = renderReport(check(baseline(), now()));
    expect(report).toContain("- Elements: 1\n");
    expect(report).not.toContain("more not listed (at most");
    expect(report).toMatch(/- Fixed under it: .*, and 99 more not listed\n/);
  });

  it("adds no fixedCut when nothing was cut", () => {
    const [open] = check(
      baseline(),
      scanOf(only(finding("image-alt", ["#a-open", ...many(599, "f").slice(0, 99)]))),
    ).findings;
    expect(open!.fixedCut).toBeUndefined();
  });

  it("keeps unseen (still failing) elements cut in elementsCut, not fixedCut", () => {
    const partial = scanOf([{ name: "default", axe: null, notScanned: "it did not answer" }]);
    const [open] = compareScans(baseline(), partial).findings;
    expect(open!.elementsCut).toBe(100);
    expect(open!.fixedCut).toBeUndefined();
  });

  it("says in the fixed section how many of a fixed finding's elements are not listed", () => {
    const report = renderReport(check(scanOf(only(finding("image-alt", many(600, "g")))), scanOf(only())));
    expect(report).toContain("100 more elements are not listed.");
  });
});

describe("plain scan against the last scan", () => {
  const previous = scanOf(only(finding("button-name", ["#save"]), finding("image-alt", ["img"])));

  it("counts what is new and what is gone, marks each finding new or still, and changes nothing else", () => {
    const now = scanOf(only(finding("button-name", ["#save"]), finding("label", ["#email"])));
    const record = withPrevious(now, { record: previous });
    expect(validate(schema, record)).toEqual([]);
    expect(record.summary.sincePrevious).toEqual({ new: 1, fixed: 1, startedAt: previous.startedAt });
    expect(record.findings.map((f) => [f.rule.id, f.status])).toEqual([
      ["button-name", "still"],
      ["label", "new"],
    ]);
    // No fixed finding is listed, and the exit reads only this scan.
    expect(record.findings).toHaveLength(2);
    expect(record.exit).toBe(now.exit);
    expect(record.command).toBe("scan");
    expect(sincePreviousLine(record)).toBe("1 new, 1 fixed since the last scan");
    expect(renderReport(record)).toContain("1 new, 1 fixed.");
  });

  it("is not comparable with a scan of other tags, states or pages, and says so", () => {
    for (const other of [
      scanOf(only(finding("button-name", ["#save"])), { tags: ["wcag2a"] }),
      scanOf(only(finding("button-name", ["#save"])), { key: "other" }),
      scanOf([...only(finding("button-name", ["#save"])), { name: "dark", axe: axe() }]),
    ]) {
      const record = withPrevious(other, { record: previous });
      expect(validate(schema, record)).toEqual([]);
      expect(record.summary.sincePrevious).toBeNull();
      expect(record.summary.sincePreviousReason).toBe("different pages, states or tags");
      expect(record.findings.every((f) => f.status === "new")).toBe(true);
      expect(sincePreviousLine(record)).toBe(
        "Not comparable with the last scan: different pages, states or tags.",
      );
    }
  });

  it("has no line when there is no last scan", () => {
    expect(sincePreviousLine(previous)).toBeUndefined();
  });
});

describe("incomparable", () => {
  const shape = (pages: [string, string[]][], tags: string[] | null = null) => ({
    pages: pages.map(([key, states]) => ({ key, states })),
    tags,
  });

  it("reads pages, states and tags in any order", () => {
    expect(
      incomparable(
        shape(
          [
            ["a", ["default", "dark"]],
            ["b", ["default"]],
          ],
          ["wcag2a", "best-practice"],
        ),
        shape(
          [
            ["b", ["default"]],
            ["a", ["dark", "default"]],
          ],
          ["best-practice", "wcag2a"],
        ),
      ),
    ).toBeNull();
  });

  it("names what differs", () => {
    expect(incomparable(shape([["a", ["default"]]]), shape([["b", ["default"]]]))?.what).toBe("pages");
    expect(incomparable(shape([["a", ["default"]]]), shape([["a", ["default", "dark"]]]))?.what).toBe(
      "states",
    );
    expect(incomparable(shape([["a", ["default"]]]), shape([["a", ["default"]]], ["wcag2a"]))?.what).toBe(
      "tags",
    );
    expect(incomparable(shape([["a", ["default"]]], []), shape([["a", ["default"]]]))?.what).toBe("tags");
  });
});

describe("everything carried from a baseline is cut, and its links are built again", () => {
  const HUGE = "y".repeat(200_000);
  function crafted(): ScanRecord {
    const baseline = scanOf(only(finding("image-alt", ["#a"])));
    for (const f of baseline.findings) {
      f.title = HUGE;
      f.plain = HUGE;
      f.fix = HUGE;
      f.rule = { ...f.rule, help: HUGE, helpUrl: "https://evil.example/login" };
      f.elements = f.elements.map((e) => ({
        ...e,
        target: Array.from({ length: 5_000 }, () => HUGE),
        states: Array.from({ length: 5_000 }, (_, i) => `state-${i.toString()}`),
      }));
    }
    baseline.target.commit = HUGE;
    return baseline;
  }

  it("cuts a fixed finding's text and lists, in the record and the report", () => {
    const record = check(crafted(), scanOf(only()));
    const [fixed] = record.findings;
    expect(fixed!.status).toBe("fixed");
    for (const text of [
      fixed!.title,
      fixed!.plain,
      fixed!.fix,
      fixed!.rule.help,
      fixed!.fixedIn!.commit ?? "",
    ]) {
      expect([...text].length).toBeLessThanOrEqual(CARRIED_TEXT_CHARS + 1);
    }
    const element = fixed!.elements[0]!;
    expect(element.target.length).toBeLessThanOrEqual(CARRIED_ITEMS);
    expect(element.states.length).toBeLessThanOrEqual(CARRIED_ITEMS);
    expect([...String(element.target[0])].length).toBeLessThanOrEqual(CARRIED_TEXT_CHARS + 1);
    expect([...(record.baseline?.commit ?? "")].length).toBeLessThanOrEqual(CARRIED_TEXT_CHARS + 1);
    expect(renderReport(record)).not.toContain("y".repeat(CARRIED_TEXT_CHARS + 2));
  });

  it("never carries the baseline's own link: the rule's is built again from its id", () => {
    const record = check(crafted(), scanOf(only()));
    expect(record.findings[0]!.rule.helpUrl).toBe(axeHelpUrl("image-alt"));
    expect(JSON.stringify(record)).not.toContain("evil.example");
    expect(renderReport(record)).not.toContain("evil.example");
  });
});

describe("fixed since the previous scan", () => {
  it("counts only what the previous scan had open: a check's findings already fixed are not fixed again", () => {
    const baseline = scanOf(only(finding("image-alt", ["img"]), finding("button-name", ["button"])));
    const checked = check(baseline, scanOf(only()));
    expect(checked.summary).toMatchObject({ fixed: 2 });
    const next = withPrevious(scanOf(only()), { record: checked });
    expect(next.summary.sincePrevious).toMatchObject({ new: 0, fixed: 0 });
  });
});

describe("check's lines and counts over states not scanned", () => {
  const prepared = { plan: { url: "http://127.0.0.1:1/page" }, failOn: "minor" } as unknown as PreparedScan;
  const twoStates = (defaultAxe: AxeScan | null, menuAxe: AxeScan | null): StateResult[] => [
    defaultAxe === null
      ? { name: "default", axe: null, notScanned: "it did not answer" }
      : { name: "default", axe: defaultAxe },
    menuAxe === null
      ? { name: "menu", axe: null, notScanned: "step 1 (click button 'Menu') failed" }
      : { name: "menu", axe: menuAxe },
  ];

  it("counts in Found only what this run found, and says the rest are still open, not checked (issue 157)", () => {
    const baseline = scanOf(
      twoStates(axe(finding("button-name", ["#save"])), axe(finding("label", ["#email"]))),
    );
    const record = check(baseline, scanOf(twoStates(axe(finding("button-name", ["#save"])), null)));
    expect(record.summary.critical).toBe(2);
    const lines = scanLines(record, prepared, "out");
    expect(lines).toContain(
      "Found 1 problem on http://127.0.0.1:1/page, worst first: 1 critical, 0 serious, 0 moderate, 0 minor.",
    );
    expect(lines).toContain("1 more still open, not checked this time.");
  });

  it("says nothing was found when every open finding was carried over unchecked (issue 157)", () => {
    const baseline = scanOf(
      twoStates(axe(), axe(finding("button-name", ["#save"]), finding("label", ["#email"]))),
    );
    const record = check(baseline, scanOf(twoStates(axe(), null)));
    const lines = scanLines(record, prepared, "out");
    expect(lines.some((line) => line.startsWith("Found "))).toBe(false);
    expect(lines).toContain("2 still open, not checked this time.");
  });

  it("does not say the ones still open were in the baseline when one was found only where it did not scan (issue 158)", () => {
    const baseline = scanOf(twoStates(axe(finding("button-name", ["#save"])), null));
    const record = check(
      baseline,
      scanOf(twoStates(axe(finding("button-name", ["#save"])), axe(finding("label", ["#email"])))),
    );
    expect(record.exit).toBe(0);
    expect(scanLines(record, prepared, "out")).toContain(
      "None of them is new, so the exit is 0: the ones still open were in the baseline, or were found only in states it did not scan.",
    );
    // With every one in the baseline, the line is as it was.
    const plain = check(baseline, scanOf(twoStates(axe(finding("button-name", ["#save"])), axe())));
    expect(scanLines(plain, prepared, "out")).toContain(
      "None of them is new, so the exit is 0: the ones still open were in the baseline.",
    );
  });

  it("counts a finding unverified this time when the element cap cut all its unseen elements (issue 184)", () => {
    const baseline = scanOf(
      twoStates(axe(finding("button-name", ["#save"])), axe(finding("button-name", ["#menu"]))),
    );
    const now = scanOf(twoStates(axe(finding("button-name", ["#save"])), null));
    now.limits = { ...now.limits!, elementsPerFinding: 1 };
    const record = check(baseline, now);
    const [button] = record.findings;
    expect(button).toMatchObject({ status: "still", unverified: true, elementsCut: 1 });
    expect(button!.elements.some((e) => e.unverified === true)).toBe(false);
    expect(unverifiedOf(record).thisTime).toBe(1);
  });
});

describe("an oversized check record keeps true counts (issue 183)", () => {
  const many = (count: number) => Array.from({ length: count }, (_, i) => `#f${i}`);

  it("cuts fixed elements under a finding still open, counted in fixedCut, before it gives up the findings", () => {
    const record = check(
      scanOf(only(finding("image-alt", ["#open", ...many(300)]))),
      scanOf(only(finding("image-alt", ["#open"]))),
    );
    expect(record.findings[0]!.fixedElements).toHaveLength(300);
    const limit = Buffer.byteLength(scanJson(record)) - 5000;
    const fitted = fitToSize(record, limit);
    expect(Buffer.byteLength(scanJson(fitted))).toBeLessThanOrEqual(limit);
    expect(validate(schema, fitted)).toEqual([]);
    const [open] = fitted.findings;
    expect(open!.status).toBe("still");
    expect(open!.fixedElements!.length).toBeLessThan(300);
    expect(open!.fixedElements!.length + open!.fixedCut!).toBe(300);
    expect(fitted.summary).toMatchObject({ new: 0, still: 1, fixed: 0 });
  });

  it("counts nothing new, still or fixed once nothing of the findings is kept", () => {
    const record = check(
      scanOf(only(finding("image-alt", ["#gone"]), finding("label", ["#still"]))),
      scanOf(only(finding("label", ["#still"]), finding("button-name", ["#new"]))),
    );
    expect(record.summary).toMatchObject({ new: 1, still: 1, fixed: 1 });
    const fitted = fitToSize(record, 1000);
    expect(validate(schema, fitted)).toEqual([]);
    expect(fitted.findings).toEqual([]);
    expect(fitted.summary).toMatchObject({ new: 0, still: 0, fixed: 0 });
    expect(checkLine(fitted)).toBe("0 fixed, 0 new, 0 still open");
  });

  it("reads a plain scan as not comparable with the last once nothing of its findings is kept", () => {
    const previous = scanOf(only(finding("image-alt", ["img"])));
    const record = withPrevious(scanOf(only(finding("label", ["#email"]))), { record: previous });
    expect(record.summary.sincePrevious).toMatchObject({ new: 1, fixed: 1 });
    const fitted = fitToSize(record, 1000);
    expect(validate(schema, fitted)).toEqual([]);
    expect(fitted.summary.sincePrevious).toBeNull();
    expect(sincePreviousLine(fitted)).toBe(
      "Not comparable with the last scan: nothing of this scan was kept, since its results were larger than the 1000 byte limit on scan.json.",
    );
  });
});
