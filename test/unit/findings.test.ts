import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mapAxeResults, pageKeyOf, selectorOf, wcagCriteria } from "../../src/map-axe.js";

// Results recorded from axe-core 4.14.1 on the fixture pages of the same names (see docs/JSON.md).
function recorded(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`../fixtures/axe/${name}.json`, import.meta.url), "utf8"));
}

/** One violation in axe-core's shape, with the parts a test does not care about filled in. */
function violation(fields: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "button-name",
    impact: "critical",
    tags: ["wcag2a", "wcag412"],
    help: "Buttons must have discernible text",
    helpUrl: "https://example.invalid/button-name",
    nodes: [{ target: ["button"], html: "<button></button>", impact: "critical", failureSummary: "Fix it" }],
    ...fields,
  };
}

describe("mapping recorded axe-core results", () => {
  it("maps each violation on impact-mix.html to a finding, worst first", () => {
    const scan = mapAxeResults(recorded("impact-mix"), "impact-mix.html");
    expect(scan.axeCore).toBe("4.14.1");
    expect(scan.findings.map((f) => [f.rule.id, f.impact])).toEqual([
      ["image-alt", "critical"],
      ["color-contrast", "serious"],
      ["heading-order", "moderate"],
      ["empty-heading", "minor"],
    ]);
    expect(scan.needsReview).toEqual([]);
  });

  it("fills a finding with the spec's fields", () => {
    const scan = mapAxeResults(recorded("impact-mix"), "impact-mix.html");
    const contrast = scan.findings.find((f) => f.rule.id === "color-contrast");
    expect(contrast).toEqual({
      id: "axe/color-contrast@impact-mix.html",
      rule: {
        source: "axe",
        id: "color-contrast",
        help: "Elements must meet minimum color contrast ratio thresholds",
        helpUrl: "https://dequeuniversity.com/rules/axe/4.14/color-contrast?application=playwright",
        wcag: ["1.4.3"],
      },
      kind: "violation",
      impact: "serious",
      page: "impact-mix.html",
      elements: [
        {
          selector: "p",
          target: ["p"],
          html: '<p style="color: #9a9a9a; background: #ffffff">This sentence is pale grey on white.</p>',
          failure: expect.stringContaining("insufficient color contrast of 2.81") as unknown as string,
        },
      ],
    });
  });

  it("gives a best-practice rule no WCAG criteria", () => {
    const scan = mapAxeResults(recorded("impact-mix"), "impact-mix.html");
    const wcag = Object.fromEntries(scan.findings.map((f) => [f.rule.id, f.rule.wcag]));
    expect(wcag).toEqual({
      "image-alt": ["1.1.1"],
      "color-contrast": ["1.4.3"],
      "heading-order": [],
      "empty-heading": [],
    });
  });

  it("counts every rule that ran, not only the ones that found something", () => {
    const scan = mapAxeResults(recorded("impact-mix"), "impact-mix.html");
    expect(scan.rulesRun).toBe(90);
  });

  it("maps axe-core's incomplete to needs review with its reason, never to a finding", () => {
    const scan = mapAxeResults(recorded("needs-review"), "needs-review.html");
    expect(scan.findings).toEqual([]);
    expect(scan.needsReview).toHaveLength(1);
    const [item] = scan.needsReview;
    expect(item?.id).toBe("axe/color-contrast@needs-review.html");
    expect(item?.rule.id).toBe("color-contrast");
    expect(item?.impact).toBe("serious");
    expect(item?.elements[0]?.selector).toBe("p");
    expect(item?.elements[0]?.reason).toBe(
      "Element's background color could not be determined due to a background gradient",
    );
  });
});

describe("no finding without a rule id", () => {
  it("every finding and needs review item from the recorded results names its rule", () => {
    for (const name of ["impact-mix", "needs-review"]) {
      const scan = mapAxeResults(recorded(name), `${name}.html`);
      for (const item of [...scan.findings, ...scan.needsReview]) {
        expect(item.rule.id).toMatch(/\S/);
        expect(item.id).toBe(`axe/${item.rule.id}@${name}.html`);
      }
    }
  });

  it.each([
    ["an empty id", { id: "" }],
    ["a blank id", { id: "   " }],
    ["no id", { id: undefined }],
    ["an id that is not a string", { id: 42 }],
  ])("drops a violation with %s", (_name, fields) => {
    const scan = mapAxeResults({ violations: [violation(fields)], incomplete: [violation(fields)] }, "home");
    expect(scan.findings).toEqual([]);
    expect(scan.needsReview).toEqual([]);
  });

  it("keeps the violations around one that has no rule id", () => {
    const scan = mapAxeResults({ violations: [violation({ id: "" }), violation({})] }, "home");
    expect(scan.findings.map((f) => f.rule.id)).toEqual(["button-name"]);
  });
});

describe("reading axe-core's results as typed data", () => {
  it("drops an element whose target is missing or not made of selectors", () => {
    const nodes = [
      { html: "<a></a>" },
      { target: [], html: "<a></a>" },
      { target: [7], html: "<a></a>" },
      { target: ["button"], html: "<button></button>" },
    ];
    const scan = mapAxeResults({ violations: [violation({ nodes })] }, "home");
    expect(scan.findings[0]?.elements.map((e) => e.selector)).toEqual(["button"]);
  });

  it("drops a violation with no element left to point at", () => {
    const scan = mapAxeResults({ violations: [violation({ nodes: [{ html: "<a></a>" }] })] }, "home");
    expect(scan.findings).toEqual([]);
  });

  it("takes the worst element's impact when the result gives none, and minor when nothing does", () => {
    const nodes = [
      { target: ["a"], impact: "moderate" },
      { target: ["b"], impact: "serious" },
    ];
    const fromNodes = mapAxeResults({ violations: [violation({ impact: null, nodes })] }, "home");
    expect(fromNodes.findings[0]?.impact).toBe("serious");
    const none = mapAxeResults(
      { violations: [violation({ impact: "huge", nodes: [{ target: ["a"] }] })] },
      "home",
    );
    expect(none.findings[0]?.impact).toBe("minor");
  });

  it("gives nothing for something that is not axe-core's results", () => {
    for (const raw of [null, "results", [], { violations: "many" }]) {
      expect(mapAxeResults(raw, "home")).toEqual({ axeCore: "", rulesRun: 0, findings: [], needsReview: [] });
    }
  });
});

describe("wcagCriteria", () => {
  it("reads criteria from tags and leaves out levels and other standards", () => {
    expect(wcagCriteria(["cat.color", "wcag2aa", "wcag143", "EN-9.1.4.3", "TT13.c"])).toEqual(["1.4.3"]);
    expect(wcagCriteria(["wcag2a", "wcag21aa", "wcag22aa", "wcag2aaa", "best-practice"])).toEqual([]);
  });

  it("reads two-digit criteria", () => {
    expect(wcagCriteria(["wcag1410", "wcag2411", "wcag412"])).toEqual(["1.4.10", "2.4.11", "4.1.2"]);
  });

  it("lists a criterion once", () => {
    expect(wcagCriteria(["wcag111", "wcag111"])).toEqual(["1.1.1"]);
  });
});

describe("selectorOf", () => {
  it("is the selector itself for an element in the page's own document", () => {
    expect(selectorOf(["#prefs > label:nth-child(2)"])).toBe("#prefs > label:nth-child(2)");
  });

  it("joins the parts with >>> inside a shadow root (axe-core nests them)", () => {
    expect(selectorOf([["#host", "button"]])).toBe("#host >>> button");
  });

  it("joins the parts with >>> inside a frame", () => {
    expect(selectorOf(["#f", "button"])).toBe("#f >>> button");
    expect(selectorOf(["#f", ["#host", "button"]])).toBe("#f >>> #host >>> button");
  });
});

describe("pageKeyOf (D6: a page is a URL)", () => {
  it.each([
    ["http://127.0.0.1:5173/", "home"],
    ["http://127.0.0.1:5173", "home"],
    ["http://127.0.0.1:5173/settings", "settings"],
    ["http://127.0.0.1:5173/settings/", "settings"],
    ["http://127.0.0.1:5173/contrast.html?x=1#top", "contrast.html"],
    ["http://127.0.0.1:5173/a/b", "a/b"],
  ])("%s is %s", (url, key) => {
    expect(pageKeyOf(url)).toBe(key);
  });
});
