import { describe, expect, it } from "vitest";
import { CRITERION_WORDING, RULE_WORDING } from "../../src/plain.js";
import { emptyScanSentence, renderReport } from "../../src/report.js";
import { CANNOT_SEE } from "../../src/scan-record.js";
import { GOLDEN_PAGES, readGolden, readGoldenRecord } from "../helpers/goldens.js";
import { neverClaimViolations } from "../helpers/never-claim.js";

describe("the phrase list (C16)", () => {
  it.each([
    "This site is accessible.",
    "The page is COMPLIANT",
    "full compliance",
    "conformant to WCAG",
    "it conforms",
    "the page passes",
    "passed WCAG 2.2",
  ])("catches %j", (text) => {
    expect(neverClaimViolations(text)).not.toEqual([]);
  });

  it("allows the accessible name, and nothing near it", () => {
    expect(
      neverClaimViolations("A button needs an accessible name. Accessible names come from text."),
    ).toEqual([]);
    expect(neverClaimViolations("An accessible namespace")).toEqual(["accessible"]);
  });

  it("matches whole words only", () => {
    expect(neverClaimViolations("bypasses, compassed, inaccessible")).toEqual([]);
  });

  it("allows the four test phrases in the README, the docs and the prompt file only", () => {
    const text = "Run it until `npm test` passes, the test passes, the tests pass and CI passes.";
    expect(neverClaimViolations(text, { docs: true })).toEqual([]);
    expect(neverClaimViolations(text)).toEqual(["passes", "passes", "passes"]);
    expect(neverClaimViolations("The page passes, and the tests pass.", { docs: true })).toEqual(["passes"]);
  });
});

describe("what a report says", () => {
  it.each(GOLDEN_PAGES)("%s.html: neither golden claims anything", (name) => {
    expect(neverClaimViolations(readGolden(name, "report.md"))).toEqual([]);
    expect(neverClaimViolations(readGolden(name, "scan.json"))).toEqual([]);
  });

  it("the empty scan's report and sentence claim nothing, and still say what it cannot see", () => {
    const record = readGoldenRecord("clean");
    expect(record.findings).toEqual([]);
    const report = renderReport(record);
    expect(neverClaimViolations(report)).toEqual([]);
    expect(report).toContain(emptyScanSentence(record));
    expect(report).toContain("## What this scan cannot see");
  });

  it("the fixed text of what a scan cannot see claims nothing", () => {
    expect(neverClaimViolations(CANNOT_SEE.join("\n"))).toEqual([]);
  });

  it("the wording table, every rule's title, plain, fix and advice and every criterion's words, claims nothing", () => {
    const words = Object.values(RULE_WORDING).flatMap((entry) => [
      entry.title,
      entry.plain,
      entry.fix,
      ...(entry.advice === undefined ? [] : [entry.advice.title, entry.advice.plain, entry.advice.fix]),
    ]);
    const criteria = Object.values(CRITERION_WORDING).flatMap((entry) => [entry.name, entry.plain]);
    expect(words.length).toBeGreaterThan(0);
    expect(neverClaimViolations([...words, ...criteria].join("\n"))).toEqual([]);
  });

  it("every golden report ends with What this scan cannot see, with the whole fixed list", () => {
    for (const name of GOLDEN_PAGES) {
      const report = readGolden(name, "report.md");
      const section = report.slice(report.indexOf("## What this scan cannot see"));
      expect(section.startsWith("## What this scan cannot see")).toBe(true);
      expect(section.match(/^## /gm)).toHaveLength(1);
      for (const line of CANNOT_SEE) expect(section).toContain(line);
    }
  });
});
