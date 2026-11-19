import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mapAxeResults } from "../../src/map-axe.js";
import { renderReport } from "../../src/report.js";
import { buildPagesRecord, SCHEMA_VERSION } from "../../src/scan-record.js";
import { validate } from "../helpers/json-schema.js";

// How the record holds states, with no browser: two states of one page and a second page, built from the
// recorded axe-core results. test/browser/states.test.ts proves the same against real pages.
const schema = JSON.parse(
  readFileSync(new URL("../../schema/scan-1.json", import.meta.url), "utf8"),
) as Record<string, never>;
const recorded: unknown = JSON.parse(
  readFileSync(new URL("../fixtures/axe/impact-mix.json", import.meta.url), "utf8"),
);

const base = {
  tool: { name: "a11y-genie", version: "0.0.0" },
  browser: "chrome 1",
  fallback: false,
  startedAt: "2000-01-01T00:00:00Z",
  finishedAt: "2000-01-01T00:00:01Z",
};

describe("a record with states", () => {
  const axe = mapAxeResults(recorded, "page");
  const fewer = { ...axe, findings: axe.findings.slice(0, 1), needsReview: [] };

  it("lists every state asked for, and the elements of a finding with the states they were found in", () => {
    const record = buildPagesRecord({
      ...base,
      pages: [
        {
          key: "page",
          url: "http://127.0.0.1:1/page",
          states: [
            { name: "default", axe: fewer },
            { name: "dark", axe },
            {
              name: "broken",
              axe: null,
              notScanned: "step 1 (wait dialog) failed: it did not become visible within 3 seconds",
            },
          ],
        },
      ],
    });
    expect(SCHEMA_VERSION).toBe("1.4");
    expect(validate(schema, record)).toEqual([]);
    expect(record.pages[0]?.states).toEqual(["default", "dark", "broken"]);
    expect(record.pages[0]?.notScanned).toEqual([
      { state: "broken", reason: "step 1 (wait dialog) failed: it did not become visible within 3 seconds" },
    ]);
    expect(record.findings.map((f) => f.id)).toEqual(axe.findings.map((f) => f.id));
    // the finding both states hit lists both; the ones only `dark` hit list `dark`
    expect(record.findings[0]?.elements.map((e) => e.states)).toEqual([["default", "dark"]]);
    expect(record.findings.slice(1).every((f) => f.elements.every((e) => e.states.join() === "dark"))).toBe(
      true,
    );
    expect(record.summary.notScanned).toBe(1);
    expect(record.exit).toBe(1);
  });

  it("says in report.md which states an element was found in, and which state was not scanned", () => {
    const record = buildPagesRecord({
      ...base,
      pages: [
        {
          key: "page",
          url: "http://127.0.0.1:1/page",
          states: [
            { name: "default", axe: fewer },
            { name: "dark", axe },
            { name: "broken", axe: null, notScanned: "it went wrong" },
          ],
        },
      ],
    });
    const report = renderReport(record);
    expect(report).toContain("Found in the states: `default`, `dark`");
    expect(report).toContain("Found in the state: `dark`");
    expect(report).toContain("(broken): it went wrong.");
  });

  it("keeps a page's findings apart from another page's, and orders them worst first", () => {
    const record = buildPagesRecord({
      ...base,
      pages: [
        {
          key: "a",
          url: "http://127.0.0.1:1/a",
          states: [{ name: "default", axe: mapAxeResults(recorded, "a") }],
        },
        {
          key: "b",
          url: "http://127.0.0.1:1/b",
          states: [{ name: "default", axe: mapAxeResults(recorded, "b") }],
        },
      ],
    });
    expect(validate(schema, record)).toEqual([]);
    expect(record.findings.map((f) => f.id.split("@")[1])).toEqual(["a", "b", "a", "b", "a", "b", "a", "b"]);
    expect(record.pages.map((p) => p.key)).toEqual(["a", "b"]);
  });

  it("reads every page not scanned when the record is too big to keep any of them", () => {
    const record = buildPagesRecord({
      ...base,
      limits: {
        pageMs: 1000,
        redirects: 10,
        elementsPerFinding: 500,
        excerptChars: 160,
        scanJsonBytes: 3000,
        stoppedExamples: 5,
      },
      pages: [
        {
          key: "a",
          url: "http://127.0.0.1:1/a",
          states: [{ name: "default", axe: mapAxeResults(recorded, "a") }],
        },
        {
          key: "b",
          url: "http://127.0.0.1:1/b",
          states: [{ name: "default", axe: mapAxeResults(recorded, "b") }],
        },
      ],
    });
    expect(record.findings).toEqual([]);
    expect(record.pages.map((p) => p.notScanned.length)).toEqual([1, 1]);
    expect(record.summary.notScanned).toBe(2);
    expect(record.exit).toBe(1);
  });
});
