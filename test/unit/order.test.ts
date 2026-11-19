import { describe, expect, it } from "vitest";
import type { FindingKind, Impact } from "../../src/finding.js";
import { orderFindings } from "../../src/order.js";

interface Item {
  impact: Impact;
  kind?: FindingKind;
  rule: { id: string };
  page: string;
  name: string;
}

const item = (name: string, impact: Impact, kind: FindingKind, rule: string, page = "home"): Item => ({
  name,
  impact,
  kind,
  rule: { id: rule },
  page,
});

const names = (items: Item[]) => items.map((i) => i.name);

describe("orderFindings", () => {
  it("impact order, then kind, rule, page", () => {
    const items = [
      item("minor advice", "minor", "advice", "a-rule"),
      item("minor violation", "minor", "violation", "z-rule"),
      item("serious b on settings", "serious", "violation", "b-rule", "settings"),
      item("moderate", "moderate", "violation", "a-rule"),
      item("serious b on home", "serious", "violation", "b-rule", "home"),
      item("serious a", "serious", "violation", "a-rule", "settings"),
      item("critical", "critical", "violation", "z-rule"),
    ];
    expect(names(orderFindings(items, ["home", "settings"]))).toEqual([
      "critical",
      "serious a",
      "serious b on home",
      "serious b on settings",
      "moderate",
      "minor violation",
      "minor advice",
    ]);
  });

  it("orders critical, serious, moderate, minor, whatever the input order", () => {
    const impacts: Impact[] = ["minor", "critical", "moderate", "serious"];
    const items = impacts.map((impact) => item(impact, impact, "violation", "rule"));
    expect(names(orderFindings(items))).toEqual(["critical", "serious", "moderate", "minor"]);
  });

  it("puts a violation before advice of the same impact, whatever the rule", () => {
    const items = [
      item("advice", "moderate", "advice", "a"),
      item("violation", "moderate", "violation", "z"),
    ];
    expect(names(orderFindings(items))).toEqual(["violation", "advice"]);
  });

  it("puts impact before kind: serious advice comes before a minor violation", () => {
    const items = [
      item("minor violation", "minor", "violation", "a"),
      item("serious advice", "serious", "advice", "a"),
    ];
    expect(names(orderFindings(items))).toEqual(["serious advice", "minor violation"]);
  });

  it("orders rule ids by code point, not by locale", () => {
    const items = ["b", "B", "a-b", "a"].map((rule) => item(rule, "serious", "violation", rule));
    expect(names(orderFindings(items))).toEqual(["B", "a", "a-b", "b"]);
  });

  it("orders pages as they were scanned, then pages not listed by key", () => {
    const items = ["zeta", "about", "settings", "home"].map((page) =>
      item(page, "serious", "violation", "rule", page),
    );
    expect(names(orderFindings(items, ["settings", "home"]))).toEqual(["settings", "home", "about", "zeta"]);
  });

  it("sorts an item with no kind (needs review) as a violation", () => {
    const review = { name: "review", impact: "serious" as const, rule: { id: "b" }, page: "home" };
    const items = [
      item("advice", "serious", "advice", "a"),
      review,
      item("violation", "serious", "violation", "a"),
    ];
    expect(names(orderFindings(items))).toEqual(["violation", "review", "advice"]);
  });

  it("gives the same order for the same findings in any input order", () => {
    const items = [
      item("1", "minor", "advice", "x"),
      item("2", "serious", "violation", "y", "b"),
      item("3", "serious", "violation", "y", "a"),
      item("4", "critical", "violation", "w"),
    ];
    const once = names(orderFindings(items));
    expect(names(orderFindings([...items].reverse()))).toEqual(once);
  });

  it("returns a new array and leaves its input as it was", () => {
    const items = [item("minor", "minor", "violation", "a"), item("critical", "critical", "violation", "a")];
    const sorted = orderFindings(items);
    expect(sorted).not.toBe(items);
    expect(names(items)).toEqual(["minor", "critical"]);
  });
});
