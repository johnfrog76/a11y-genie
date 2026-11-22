import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { genieRules } from "../../src/genie-rules.js";
import "../../src/rules-command.js"; // imports every check, so every `genie/*` rule is registered
import { findingTitle, oneLine } from "../../src/scan-record.js";

const axe = createRequire(import.meta.url)("axe-core") as {
  getRules(): { ruleId: string; help: string }[];
};

// A finding's title is its rule's help text, then " on " and the page (#130). No title has a full stop before
// " on ", for every rule the product can report: each of its own, and each of axe-core's at the pinned version.
const page = "page.html";
const helps = [
  ...genieRules().map((entry) => ({ id: `genie/${entry.rule.id}`, help: entry.rule.help })),
  ...axe.getRules().map((rule) => ({ id: `axe/${rule.ruleId}`, help: rule.help })),
];

describe("a finding's title", () => {
  it("covers every genie rule and axe-core's rules", () => {
    expect(genieRules().length).toBeGreaterThanOrEqual(7);
    expect(helps.length).toBeGreaterThan(genieRules().length + 50);
  });

  it.each(helps)("has no full stop before ' on ' for $id", ({ help }) => {
    const title = findingTitle(oneLine(help), page);
    expect(title.endsWith(` on ${page}`)).toBe(true);
    expect(title).not.toMatch(/\. on page\.html$/);
  });

  it("keeps the rest of the help text as it is", () => {
    expect(findingTitle("The page has no landmarks: no banner, navigation, main or contentinfo.", page)).toBe(
      "The page has no landmarks: no banner, navigation, main or contentinfo on page.html",
    );
    expect(findingTitle("Images must have alternative text", page)).toBe(
      "Images must have alternative text on page.html",
    );
    expect(findingTitle("Wait for it...", page)).toBe("Wait for it... on page.html");
  });
});
