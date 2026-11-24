import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CRITERION_WORDING, RULE_WORDING } from "../../src/plain.js";
import { emptyScanSentence, renderReport } from "../../src/report.js";
import { CANNOT_SEE } from "../../src/scan-record.js";
import { GOLDEN_PAGES, readGolden, readGoldenRecord } from "../helpers/goldens.js";
import { neverClaimViolations, PROMPT_WORD_LIST } from "../helpers/never-claim.js";

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

  it("allows axe-core's `passes` key, with its backticks, in the docs only", () => {
    expect(neverClaimViolations("`null` in `passes`.", { docs: true })).toEqual([]);
    expect(neverClaimViolations("`null` in `passes`.")).toEqual(["passes"]);
    expect(neverClaimViolations("The scan passes; see `passes`.", { docs: true })).toEqual(["passes"]);
  });
});

/**
 * The project's own words for people (spec C16, and AGENTS.md rule 1). The README and docs/ are read in docs mode,
 * as the spec says. CONTRIBUTING, SECURITY and the .github templates are read in the strict mode, so the test-run
 * phrases stay where the spec allows them. CODE_OF_CONDUCT.md and THIRD-PARTY-NOTICES.md are left out on purpose:
 * one is adopted text and the other quotes licences (Apache-2.0 says "compliance"), so neither is the project's
 * own words. Do not add them. The site and the prompt file are held in test/unit/site.test.ts and above.
 */
describe("the project's own docs claim nothing (C16)", () => {
  const root = new URL("../../", import.meta.url);
  const read = (path: string) => readFileSync(new URL(path, root), "utf8");
  const docs = [
    "README.md",
    ...readdirSync(new URL("docs/", root))
      .filter((name) => name.endsWith(".md"))
      .map((name) => `docs/${name}`),
  ];
  const strict = [
    "CONTRIBUTING.md",
    "SECURITY.md",
    ".github/pull_request_template.md",
    ...readdirSync(new URL(".github/ISSUE_TEMPLATE/", root)).map((name) => `.github/ISSUE_TEMPLATE/${name}`),
  ];

  it("reads every doc there is", () => {
    expect(docs).toContain("docs/JSON.md");
    expect(strict).toContain(".github/ISSUE_TEMPLATE/bug_report.yml");
  });

  it.each(docs)("%s, in docs mode", (path) => {
    expect(neverClaimViolations(read(path), { docs: true })).toEqual([]);
  });

  it.each(strict)("%s, strictly", (path) => {
    expect(neverClaimViolations(read(path))).toEqual([]);
  });

  it("the --help text and the package description, strictly", () => {
    expect(
      neverClaimViolations(read("src/cli.ts").match(/const HELP = `([\s\S]*?)`;/)?.[1] ?? "missing"),
    ).toEqual([]);
    expect(neverClaimViolations(JSON.parse(read("package.json")).description)).toEqual([]);
  });
});

describe("what the prompt file says", () => {
  it("agentic/fix-loop.prompt.md claims nothing", () => {
    const prompt = readFileSync(new URL("../../agentic/fix-loop.prompt.md", import.meta.url), "utf8");
    expect(neverClaimViolations(prompt, { promptFile: true })).toEqual([]);
  });

  it("names the forbidden words in the one exact sentence, once", () => {
    const prompt = readFileSync(new URL("../../agentic/fix-loop.prompt.md", import.meta.url), "utf8");
    expect(prompt.split(PROMPT_WORD_LIST)).toHaveLength(2);
    expect(PROMPT_WORD_LIST).toBe('Never call the site "accessible", "compliant" or "conformant".');
  });

  it("allows the sentence in the prompt file, and nowhere else", () => {
    const text = `Some words.\n\n${PROMPT_WORD_LIST}\n`;
    expect(neverClaimViolations(text, { promptFile: true })).toEqual([]);
    // README.md and docs/ are read in docs mode, and a report or anything else in the default one.
    expect(neverClaimViolations(text, { docs: true })).toEqual(["accessible", "compliant", "conformant"]);
    expect(neverClaimViolations(text)).toEqual(["accessible", "compliant", "conformant"]);
  });

  it.each([
    'Never call the site "accessible", "compliant" or "certified".',
    'Never call the site "accessible", "compliant" or conformant".',
    'never call the site "accessible", "compliant" or "conformant".',
    'Never call the page "accessible", "compliant" or "conformant".',
  ])("a variant of the sentence fails in the prompt file: %s", (variant) => {
    expect(neverClaimViolations(variant, { promptFile: true })).not.toEqual([]);
  });

  it("a second copy of the sentence in the prompt file fails", () => {
    const twice = `${PROMPT_WORD_LIST}\n\nAnd again: ${PROMPT_WORD_LIST}\n`;
    expect(neverClaimViolations(twice, { promptFile: true })).toEqual([
      "accessible",
      "compliant",
      "conformant",
    ]);
  });
});

describe("the known-gaps page", () => {
  // docs/KNOWN-GAPS.md is for strangers: what is planned and not built, and the known limits (#133).
  const gaps = readFileSync(new URL("../../docs/KNOWN-GAPS.md", import.meta.url), "utf8");

  it("docs/KNOWN-GAPS.md claims nothing", () => {
    expect(neverClaimViolations(gaps, { docs: true })).toEqual([]);
  });

  it("lists what is planned and not built, and the README links to it", () => {
    expect(gaps).toContain("## Planned, not built");
    const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8");
    expect(readme).toContain("](docs/KNOWN-GAPS.md)");
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
