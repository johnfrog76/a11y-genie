import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { genieRules } from "../../src/genie-rules.js";
import { wcagCriteria } from "../../src/map-axe.js";
import {
  criterionInWords,
  CRITERION_WORDING,
  RULE_WORDING,
  TITLE_MAX_WORDS,
  wordingOf,
} from "../../src/plain.js";
import "../../src/rules-command.js"; // imports every check, so every `genie/*` rule is registered
import { GOLDEN_PAGES, readGoldenRecord } from "../helpers/goldens.js";

const axe = createRequire(import.meta.url)("axe-core") as {
  getRules(): { ruleId: string; tags: string[] }[];
};

/** axe-core's rules at the pinned version, by id, with the WCAG criteria their tags name. */
const AXE_RULES = new Map(axe.getRules().map((rule) => [rule.ruleId, wcagCriteria(rule.tags)]));

/**
 * The axe-core rules the fixture pages make fire, each in its default state, found by scanning every page in
 * `test/fixtures/site/`. A new fixture that makes another rule fire gets wording, and its rule goes here.
 */
const FIXTURE_AXE_RULES = [
  "button-name",
  "color-contrast",
  "empty-heading",
  "heading-order",
  "image-alt",
  "label",
  "landmark-no-duplicate-main",
  "landmark-one-main",
  "page-has-heading-one",
  "region",
];

const entries = Object.entries(RULE_WORDING);

describe("the wording table", () => {
  it.each(entries)("%s has a plain and a fix, each a sentence or two", (_key, entry) => {
    for (const words of [entry, ...(entry.advice === undefined ? [] : [entry.advice])]) {
      for (const text of [words.plain, words.fix]) {
        expect(text.trim()).not.toBe("");
        expect(text).toMatch(/[.]$/);
        expect(text).not.toMatch(/\n/);
        expect(text.split(/[.!?](?:\s|$)/).filter((s) => s.trim() !== "").length).toBeLessThanOrEqual(2);
      }
      expect(words.fix).not.toBe(words.plain);
    }
  });

  it.each(entries)(
    `%s has a short title: a few words, at most ${TITLE_MAX_WORDS}, no full stop`,
    (_key, entry) => {
      for (const words of [entry, ...(entry.advice === undefined ? [] : [entry.advice])]) {
        const title = words.title;
        expect(title.trim()).not.toBe("");
        expect(title).toBe(title.trim());
        expect(title).not.toMatch(/[.\n]/);
        expect(title.split(/\s+/).length).toBeLessThanOrEqual(TITLE_MAX_WORDS);
        expect(title).not.toBe(words.plain);
      }
    },
  );

  it("has an entry for every one of the product's own rules: a new check without wording fails here", () => {
    const own = genieRules().map((entry) => `genie/${entry.rule.id}`);
    expect(own.length).toBeGreaterThan(0);
    for (const key of own) expect(Object.keys(RULE_WORDING), key).toContain(key);
  });

  it("names only rules that exist: each genie entry is registered, each axe entry is a rule of the pinned axe-core", () => {
    const own = new Set(genieRules().map((entry) => entry.rule.id));
    for (const key of Object.keys(RULE_WORDING)) {
      const [source, id] = key.split("/") as [string, string];
      expect(["axe", "genie"], key).toContain(source);
      if (source === "genie") expect(own.has(id), key).toBe(true);
      else expect(AXE_RULES.has(id), key).toBe(true);
    }
  });

  it("has an entry for every axe-core rule a fixture page hits, and for link-name, which the spec names", () => {
    for (const id of [...FIXTURE_AXE_RULES, "link-name"]) {
      expect(Object.keys(RULE_WORDING), id).toContain(`axe/${id}`);
    }
  });

  it("words an unlabelled form field: a visible label first, aria-label where one cannot fit, and never a placeholder", () => {
    const label = wordingOf({ source: "axe", id: "label" }, "violation");
    expect(label?.title).toBe("Form field with no label");
    expect(label?.fix).toMatch(/label element with a for attribute/);
    expect(label?.fix).toMatch(/aria-label or aria-labelledby/);
    expect(label?.fix).toMatch(/placeholder text is not a label/);
    for (const id of ["select-name", "input-button-name"]) {
      expect(wordingOf({ source: "axe", id }, "violation"), id).toBeDefined();
    }
  });

  it("is frozen data: a finding's words are the table's, whatever the page or axe-core said", () => {
    expect(Object.isFrozen(RULE_WORDING)).toBe(true);
    expect(Object.isFrozen(CRITERION_WORDING)).toBe(true);
    const words = wordingOf({ source: "axe", id: "button-name" }, "violation");
    expect(words).toEqual({
      title: RULE_WORDING["axe/button-name"]!.title,
      plain: RULE_WORDING["axe/button-name"]!.plain,
      fix: RULE_WORDING["axe/button-name"]!.fix,
    });
    // A copy, so changing what came back changes nothing in the table.
    words!.fix = "changed";
    expect(RULE_WORDING["axe/button-name"]!.fix).not.toBe("changed");
  });

  it("gives advice its own words where the rule has them, and the violation's where it has none", () => {
    const skip = RULE_WORDING["genie/skip-link"]!;
    expect(wordingOf({ source: "genie", id: "skip-link" }, "advice")).toEqual(skip.advice);
    expect(wordingOf({ source: "genie", id: "skip-link" }, "violation")).toEqual({
      title: skip.title,
      plain: skip.plain,
      fix: skip.fix,
    });
    expect(wordingOf({ source: "axe", id: "region" }, "advice")?.plain).toBe(
      RULE_WORDING["axe/region"]!.plain,
    );
  });

  it("has no words for a rule outside it, or for a key that is not a rule", () => {
    expect(wordingOf({ source: "axe", id: "no-such-rule" }, "violation")).toBeUndefined();
    expect(wordingOf({ source: "genie", id: "button-name" }, "violation")).toBeUndefined();
    expect(wordingOf({ source: "axe", id: "__proto__" } as never, "violation")).toBeUndefined();
    expect(wordingOf({ source: "axe", id: "toString" } as never, "violation")).toBeUndefined();
  });

  it("every golden's findings carry the table's words", () => {
    for (const name of GOLDEN_PAGES) {
      for (const finding of readGoldenRecord(name).findings) {
        const words = wordingOf(finding.rule, finding.kind);
        expect(words, finding.id).toBeDefined();
        expect({ plain: finding.plain, fix: finding.fix }, finding.id).toEqual({
          plain: words!.plain,
          fix: words!.fix,
        });
      }
    }
  });
});

describe("the criteria in plain words", () => {
  it("names every criterion a rule in the wording table carries", () => {
    const carried = new Set<string>();
    for (const entry of genieRules()) for (const c of entry.rule.wcag) carried.add(c);
    for (const key of Object.keys(RULE_WORDING)) {
      const [source, id] = key.split("/") as [string, string];
      if (source === "axe") for (const c of AXE_RULES.get(id) ?? []) carried.add(c);
    }
    expect(carried.size).toBeGreaterThan(0);
    for (const criterion of carried) expect(Object.keys(CRITERION_WORDING), criterion).toContain(criterion);
  });

  it("gives the number, the name and what it asks; a criterion outside the table, its number alone", () => {
    expect(criterionInWords("1.4.3")).toBe(
      "1.4.3 Contrast (Minimum): text must stand out from its background",
    );
    expect(criterionInWords("9.9.9")).toBe("9.9.9");
    expect(criterionInWords("constructor")).toBe("constructor");
  });

  it.each(Object.entries(CRITERION_WORDING))("%s has a name and plain words", (number, entry) => {
    expect(number).toMatch(/^\d\.\d\.\d{1,2}$/);
    expect(entry.name.trim()).not.toBe("");
    expect(entry.plain.trim()).not.toBe("");
  });
});
