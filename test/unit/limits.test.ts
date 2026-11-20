import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readScanFile } from "../../src/baseline.js";
import { isAllowedScheme, LIMITS } from "../../src/context.js";
import { mapAxeResults } from "../../src/map-axe.js";
import { renderReport } from "../../src/report.js";
import { answeredButNotScanned } from "../../src/run-scan.js";
import {
  buildScanRecord,
  fitToSize,
  scanJson,
  type RecordInput,
  type RecordWalk,
  type ScanRecord,
} from "../../src/scan-record.js";
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
  const many = Array.from({ length: n }, (_, i) => ({
    ...element,
    selector: `img:nth-of-type(${i + 1})`,
    target: [`img:nth-of-type(${i + 1})`],
  }));
  return { ...base, axe: { ...axe, findings: [{ ...first!, elements: many }, ...rest] } };
}

/** A walk of `stops` stops, each with a name long enough to weigh something. */
function walkOf(state: string, stops: number): RecordWalk {
  return {
    state,
    stops: Array.from({ length: stops }, (_, i) => ({
      index: i + 1,
      selector: `#stop-${i + 1}`,
      target: [`#stop-${i + 1}`],
      tag: "a",
      role: "link",
      name: `Link number ${i + 1} ${"x".repeat(60)}`,
      focusVisible: true,
    })),
    end: "max-tabs",
    tabs: stops,
    maxTabs: stops,
  };
}

function withWalks(counts: number[]): ScanRecord {
  const record = buildScanRecord(input());
  record.pages[0]!.walks = counts.map((n, i) => walkOf(`state-${i}`, n));
  return record;
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
  const guard = { redirectCapReached: false, blockedNavigation: undefined };
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
    expect(
      answeredButNotScanned(new Error("Target closed"), { ...guard, redirectCapReached: true }, LIMITS),
    ).toBe("it redirected more than 10 times, so the scan stopped following it");
  });

  it("a page whose own frame was stopped going to a private address reads not scanned, and says so", () => {
    const stopped = { ...guard, blockedNavigation: "private-network" as const };
    expect(answeredButNotScanned(error("net::ERR_BLOCKED_BY_CLIENT"), stopped, LIMITS)).toMatch(
      /loopback, link-local or private address.*--allow-private/,
    );
    // Without the rule's word, the same error is not the page's doing.
    expect(answeredButNotScanned(error("net::ERR_BLOCKED_BY_CLIENT"), guard, LIMITS)).toBeUndefined();
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

  describe("walks and the size cap", () => {
    const folders: string[] = [];
    afterAll(() => {
      for (const folder of folders) rmSync(folder, { recursive: true, force: true });
    });

    it("cuts walks to their first stops before it drops a finding's element, and a baseline read accepts it", () => {
      const full = withWalks([600, 40, 3]);
      const bare = Buffer.byteLength(scanJson(withWalks([1, 1, 1])));
      const size = Buffer.byteLength(scanJson(full));
      // Room for the findings and a part of the walks, but not all of them.
      const limit = bare + Math.floor((size - bare) / 4);
      const fitted = fitToSize(full, limit);
      const written = scanJson(fitted);
      expect(Buffer.byteLength(written)).toBeLessThanOrEqual(limit);
      const walks = fitted.pages[0]!.walks!;
      expect(walks).toHaveLength(3);
      // The cut is the same N for every walk; a walk shorter than N is whole and has no count.
      const kept = walks[0]!.stops.length;
      expect(kept).toBeGreaterThan(1);
      expect(walks[0]!.stopsCut).toBe(600 - kept);
      expect(walks[1]!.stops.length).toBe(Math.min(40, kept));
      expect(walks[1]!.stopsCut).toBe(40 > kept ? 40 - kept : undefined);
      expect(walks[2]!.stops).toHaveLength(3);
      expect(walks[2]!.stopsCut).toBeUndefined();
      // The stops kept are the first ones, in order, and what the walk did is still recorded.
      expect(walks[0]!.stops.map((s) => s.index)).toEqual(Array.from({ length: kept }, (_, i) => i + 1));
      expect(walks[0]!.tabs).toBe(600);
      // Findings were left whole.
      expect(fitted.findings).toEqual(full.findings);
      expect(fitted.pages[0]!.notScanned).toEqual([]);
      expect(validate(schema, fitted)).toEqual([]);
      // The record it was given is left as it was.
      expect(full.pages[0]!.walks![0]!.stops).toHaveLength(600);
      expect(full.pages[0]!.walks![0]!.stopsCut).toBeUndefined();

      const folder = mkdtempSync(join(tmpdir(), "a11y-genie-fit-"));
      folders.push(folder);
      writeFileSync(join(folder, "scan.json"), written);
      expect(readScanFile(folder, "--baseline", limit).pages[0]!.walks).toEqual(walks);
    });

    it("leaves walks whole when the record already fits", () => {
      const full = withWalks([20]);
      expect(fitToSize(full, Buffer.byteLength(scanJson(full)))).toBe(full);
    });

    it("drops elements once every walk is down to one stop", () => {
      const base = withElements(400);
      const record = buildScanRecord(base);
      record.pages[0]!.walks = [walkOf("default", 50)];
      const ones = structuredClone(record);
      ones.pages[0]!.walks = [walkOf("default", 1)];
      const limit = Math.floor(Buffer.byteLength(scanJson(ones)) / 2);
      const fitted = fitToSize(record, limit);
      expect(Buffer.byteLength(scanJson(fitted))).toBeLessThanOrEqual(limit);
      expect(fitted.pages[0]!.walks![0]!.stops).toHaveLength(1);
      expect(fitted.pages[0]!.walks![0]!.stopsCut).toBe(49);
      expect(fitted.findings[0]!.elementsCut).toBeGreaterThan(0);
      expect(validate(schema, fitted)).toEqual([]);
    });

    it("keeps the not scanned fallback valid, with its walks emptied and counted", () => {
      const fitted = fitToSize(withWalks([30, 5]), 3000);
      expect(fitted.findings).toEqual([]);
      expect(fitted.pages[0]!.notScanned[0]?.reason).toMatch(/larger than the 3000 byte limit/);
      const walks = fitted.pages[0]!.walks!;
      expect(walks.map((w) => [w.stops.length, w.stopsCut])).toEqual([
        [0, 30],
        [0, 5],
      ]);
      expect(validate(schema, fitted)).toEqual([]);
    });

    it("still reads a 1.7 record, which has no stopsCut", () => {
      const old = structuredClone(withWalks([4])) as unknown as Record<string, unknown>;
      old.schema = "1.7";
      expect(validate(schema, old)).toEqual([]);
      const folder = mkdtempSync(join(tmpdir(), "a11y-genie-fit-"));
      folders.push(folder);
      writeFileSync(join(folder, "scan.json"), JSON.stringify(old));
      expect(readScanFile(folder, "--baseline").schema).toBe("1.7");
    });
  });
});
