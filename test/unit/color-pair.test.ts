import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { colorPairOf, mapAxeResults, requiredRatioOf } from "../../src/map-axe.js";
import { renderReport } from "../../src/report.js";
import { buildScanRecord } from "../../src/scan-record.js";

function recorded(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`../fixtures/axe/${name}.json`, import.meta.url), "utf8"));
}

describe("the colour pair, from recorded axe-core results", () => {
  it("is copied from the violation's check data on impact-mix.html", () => {
    const scan = mapAxeResults(recorded("impact-mix"), "impact-mix.html");
    const contrast = scan.findings.find((f) => f.rule.id === "color-contrast");
    expect(contrast?.elements.map((e) => e.colorPair)).toEqual([
      {
        foreground: "#9a9a9a",
        background: "#ffffff",
        ratio: 2.81,
        required: 4.5,
        fontSize: "12.0pt (16px)",
        fontWeight: "normal",
      },
    ]);
  });

  it("is on no element of any other rule", () => {
    const scan = mapAxeResults(recorded("impact-mix"), "impact-mix.html");
    for (const finding of scan.findings.filter((f) => f.rule.id !== "color-contrast")) {
      for (const element of finding.elements) expect(element).not.toHaveProperty("colorPair");
    }
  });

  it("is never made for a needs review item: a gradient reads as needs review with axe-core's reason", () => {
    const scan = mapAxeResults(recorded("needs-review"), "needs-review.html");
    expect(scan.findings).toEqual([]);
    const element = scan.needsReview[0]?.elements[0];
    expect(element).not.toHaveProperty("colorPair");
    expect(element?.reason).toContain("background gradient");
  });

  it("is never guessed from check data that cannot be read", () => {
    const node = (data: unknown) => ({ any: [{ id: "color-contrast", data }] });
    const good = { fgColor: "#111111", bgColor: "#ffffff", contrastRatio: 3, expectedContrastRatio: "4.5:1" };
    expect(colorPairOf(node(good), "color-contrast")?.required).toBe(4.5);
    expect(colorPairOf(node({ ...good, contrastRatio: 0 }), "color-contrast")).toBeUndefined();
    expect(colorPairOf(node({ ...good, contrastRatio: "3" }), "color-contrast")).toBeUndefined();
    expect(colorPairOf(node({ ...good, fgColor: undefined }), "color-contrast")).toBeUndefined();
    expect(colorPairOf(node({ ...good, expectedContrastRatio: "tall" }), "color-contrast")).toBeUndefined();
    expect(colorPairOf(node(good), "image-alt")).toBeUndefined();
  });

  it("reads the required ratio out of axe-core's string", () => {
    expect(requiredRatioOf("4.5:1")).toBe(4.5);
    expect(requiredRatioOf("3:1")).toBe(3);
    expect(requiredRatioOf("7:1")).toBe(7);
    expect(requiredRatioOf("4.5")).toBeUndefined();
    expect(requiredRatioOf(null)).toBeUndefined();
  });

  it("is named in scan.json and in report.md, with the number axe-core measured", () => {
    const record = buildScanRecord({
      tool: { name: "a11y-genie", version: "0.0.0" },
      browser: "chrome 1",
      fallback: false,
      url: "http://127.0.0.1:4173/impact-mix.html",
      pageKey: "impact-mix.html",
      startedAt: "2000-01-01T00:00:00Z",
      finishedAt: "2000-01-01T00:00:01Z",
      axe: mapAxeResults(recorded("impact-mix"), "impact-mix.html"),
    });
    const pair = record.findings.find((f) => f.rule.id === "color-contrast")?.elements[0]?.colorPair;
    expect(pair?.ratio).toBe(2.81);
    expect(renderReport(record)).toContain("`#9a9a9a on #ffffff, 2.81, needs 4.5`");
  });
});
