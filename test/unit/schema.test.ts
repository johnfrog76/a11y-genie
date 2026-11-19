/* eslint-disable @typescript-eslint/no-explicit-any -- edits a record as loose JSON to see what the schema refuses */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GOLDEN_PAGES, readGoldenRecord } from "../helpers/goldens.js";
import { validate } from "../helpers/json-schema.js";

const schema = JSON.parse(
  readFileSync(new URL("../../schema/scan-1.json", import.meta.url), "utf8"),
) as Record<string, never>;

describe("schema/scan-1.json", () => {
  it.each(GOLDEN_PAGES)("holds the golden scan.json for %s.html", (name) => {
    expect(validate(schema, readGoldenRecord(name))).toEqual([]);
  });

  it("is a 2020-12 schema for major version 1", () => {
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(readGoldenRecord("clean").schema).toMatch(/^1\.\d+$/);
  });

  it("allows a field added in a minor version", () => {
    const record = { ...readGoldenRecord("impact-mix"), addedLater: { anything: true } };
    expect(validate(schema, record)).toEqual([]);
  });

  describe("refuses", () => {
    const refuses = (change: (record: Record<string, any>) => void, mention: string) => {
      const record = structuredClone(readGoldenRecord("impact-mix")) as unknown as Record<string, any>;
      change(record);
      const problems = validate(schema, record);
      expect(problems.length).toBeGreaterThan(0);
      expect(problems.join("\n")).toContain(mention);
    };

    it("a record of another major version", () => refuses((r) => (r.schema = "2.0"), "schema"));
    it("a record with no summary", () => refuses((r) => delete r.summary, "missing summary"));
    it("a finding with no fix", () => refuses((r) => delete r.findings[0].fix, "missing fix"));
    it("a finding with an empty fix", () => refuses((r) => (r.findings[0].fix = ""), "fix"));
    it("a finding with no rule id", () => refuses((r) => (r.findings[0].rule.id = ""), "rule.id"));
    it("an impact axe-core does not have", () => refuses((r) => (r.findings[1].impact = "huge"), "impact"));
    it("an element with no selector", () =>
      refuses((r) => delete r.findings[0].elements[0].selector, "selector"));
    it("a count that is not a number", () => refuses((r) => (r.summary.critical = "1"), "summary.critical"));
    it("an exit code the command does not use", () => refuses((r) => (r.exit = 2), "exit"));
  });
});

describe("the validator", () => {
  it("throws on a keyword it does not support, so the schema cannot outgrow it", () => {
    expect(() => validate({ type: "object", additionalProperties: false }, {})).toThrow(
      /additionalProperties/,
    );
  });
});
