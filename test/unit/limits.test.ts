import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isAllowedScheme, LIMITS } from "../../src/context.js";
import { mapAxeResults } from "../../src/map-axe.js";
import { renderReport } from "../../src/report.js";
import { answeredButNotScanned } from "../../src/run-scan.js";
import { buildScanRecord, fitToSize, scanJson, type RecordInput } from "../../src/scan-record.js";
import { readGoldenRecord } from "../helpers/goldens.js";
import { validate } from "../helpers/json-schema.js";

// The limits of src/context.ts as the record applies them, with no browser. test/browser/hostile.test.ts
// proves the same limits against real pages.
const schema = JSON.parse(
  readFileSync(new URL("../../schema/scan-1.json", import.meta.url), "utf8"),
) as Record<string, never>;

function input(overrides: Partial<RecordInput> = {}): RecordInput {
  const recorded: unknown = JSON.parse(
    readFileSync(new URL("../fixtures/axe/impact-mix.json", import.meta.url), "utf8"),
  );
  return {
    tool: { name: "a11y-genie", version: "0.0.0" },
    browser: "chrome 1",
    fallback: false,
    url: "http://127.0.0.1:4173/impact-mix.html",
    pageKey: "impact-mix.html",
    startedAt: "2000-01-01T00:00:00Z",
    finishedAt: "2000-01-01T00:00:01Z",
    axe: mapAxeResults(recorded, "impact-mix.html"),
    ...overrides,
  };
}

/** The recorded results with the first finding's one element repeated `n` times. */
function withElements(n: number): RecordInput {
  const base = input();
  const axe = base.axe!;
  const [first, ...rest] = axe.findings;
  const element = first!.elements[0]!;
  const many = Array.from({ length: n }, (_, i) => ({ ...element, selector: `img:nth-of-type(${i + 1})` }));
  return { ...base, axe: { ...axe, findings: [{ ...first!, elements: many }, ...rest] } };
}

describe("the record's limits", () => {
  it("keeps the elements per finding to the limit and counts the rest", () => {
    const record = buildScanRecord({ ...withElements(12), limits: { ...LIMITS, elementsPerFinding: 5 } });
    expect(record.findings[0]?.elements).toHaveLength(5);
    expect(record.findings[0]?.elementsCut).toBe(7);
    expect(record.findings[1]?.elementsCut).toBeUndefined();
    expect(validate(schema, record)).toEqual([]);
  });

  it("cuts each element's quoted HTML to the excerpt limit", () => {
    const base = withElements(1);
    base.axe!.findings[0]!.elements[0]!.html = `<p>${"x".repeat(500)}</p>`;
    const [finding] = buildScanRecord(base).findings;
    expect([...finding!.elements[0]!.html]).toHaveLength(LIMITS.excerptChars + 1);
    expect(finding!.elements[0]!.html.endsWith("…")).toBe(true);
  });

  it("holds scan.json to its size, cutting the least severe first and counting what it cut", () => {
    const full = buildScanRecord(withElements(400));
    const size = Buffer.byteLength(scanJson(full));
    const limit = Math.floor(size / 2);
    const fitted = fitToSize(full, limit);
    expect(Buffer.byteLength(scanJson(fitted))).toBeLessThanOrEqual(limit);
    const [first] = fitted.findings;
    expect((first?.elements.length ?? 0) + (first?.elementsCut ?? 0)).toBe(400);
    expect(fitted.pages[0]?.notScanned).toEqual([]);
    // The record it was given is left as it was.
    expect(full.findings[0]?.elements).toHaveLength(400);
    expect(validate(schema, fitted)).toEqual([]);
  });

  it("reads not scanned when even one element per finding is too big", () => {
    const fitted = fitToSize(buildScanRecord(withElements(10)), 2000);
    expect(fitted.findings).toEqual([]);
    expect(fitted.summary.notScanned).toBe(1);
    expect(fitted.exit).toBe(1);
    expect(fitted.pages[0]?.notScanned[0]?.reason).toMatch(/larger than the 2000 byte limit/);
  });

  it("records a page that was not scanned, with exit 1 and its reason in the report", () => {
    const record = buildScanRecord(input({ axe: null, axeCore: "4.14.1", notScanned: "it went nowhere" }));
    expect(record.exit).toBe(1);
    expect(record.engine).toMatchObject({ axeCore: "4.14.1", rulesRun: 0 });
    expect(record.pages[0]?.notScanned).toEqual([{ state: "default", reason: "it went nowhere" }]);
    expect(validate(schema, record)).toEqual([]);
    const report = renderReport(record);
    expect(report).toContain("1 page or state was not scanned:");
    expect(report).toContain("it went nowhere.");
    expect(report).not.toContain("No problems found");
  });

  it("still writes a report from a 1.0 record, which has none of the fields 1.1 added", () => {
    const old = structuredClone(readGoldenRecord("impact-mix")) as unknown as Record<string, unknown>;
    old.schema = "1.0";
    delete old.limits;
    for (const page of old.pages as Record<string, unknown>[]) {
      delete page.requestedUrl;
      delete page.redirects;
      delete page.stopped;
    }
    expect(validate(schema, old)).toEqual([]);
    expect(() => renderReport(old as never)).not.toThrow();
  });
});

describe("which loads read not scanned rather than refused", () => {
  const guard = { redirectCapReached: false };
  const error = (message: string) => new Error(`page.goto: ${message} at http://127.0.0.1:1/`);

  it("a redirect the browser stops, or a download, reads not scanned", () => {
    expect(answeredButNotScanned(error("net::ERR_UNSAFE_REDIRECT"), guard, LIMITS)).toMatch(
      /not http: or https:/,
    );
    expect(answeredButNotScanned(error("net::ERR_TOO_MANY_REDIRECTS"), guard, LIMITS)).toMatch(/redirected/);
    expect(answeredButNotScanned(error("net::ERR_ABORTED"), guard, LIMITS)).toMatch(/javascript:/);
    expect(answeredButNotScanned(new Error("page.goto: Download is starting"), guard, LIMITS)).toMatch(
      /downloads are refused/,
    );
  });

  it("the redirect cap wins over whatever error the closed page gave", () => {
    expect(answeredButNotScanned(new Error("Target closed"), { redirectCapReached: true }, LIMITS)).toBe(
      "it redirected more than 10 times, so the scan stopped following it",
    );
  });

  it("a page that did not answer is left to the refusal", () => {
    expect(answeredButNotScanned(error("net::ERR_CONNECTION_REFUSED"), guard, LIMITS)).toBeUndefined();
    expect(answeredButNotScanned(new Error("something else"), guard, LIMITS)).toBeUndefined();
  });

  it("only http: and https: are allowed schemes", () => {
    expect(isAllowedScheme("https://example.test/")).toBe(true);
    expect(isAllowedScheme("http://127.0.0.1:1/")).toBe(true);
    for (const url of [
      "file:///etc/hosts",
      "chrome://version",
      "data:text/html,x",
      "about:blank",
      "blob:x",
    ]) {
      expect(isAllowedScheme(url), url).toBe(false);
    }
    expect(isAllowedScheme("not an address")).toBe(false);
  });
});
