import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import type { ScanRecord } from "../../src/scan-record.js";

/** `test/goldens/<fixture page, without .html>/scan.json` and `report.md`. */
export const GOLDEN_DIR = fileURLToPath(new URL("../goldens/", import.meta.url));

/** The pages the goldens cover: the four first ones in the order the spec lists them, then `no-landmarks`. */
export const GOLDEN_PAGES = [
  "clean",
  "contrast",
  "icon-button",
  "impact-mix",
  "no-landmarks",
  "states",
] as const;

/**
 * The `--states` values a golden scans the page with, besides `default`. A page not named here is scanned in
 * its default state only. `states.html` is scanned with the menu open, and then dark with the menu open, so the
 * unnamed menu button fails in both and its element lists both states.
 */
export const GOLDEN_STATES: Readonly<Record<string, readonly string[]>> = {
  states: [
    "menu-open: click button 'Menu'; wait menu",
    "menu-dark: colorScheme dark; click button 'Menu'; wait menu",
  ],
};

export function goldenPath(page: string, file: "scan.json" | "report.md"): string {
  return `${GOLDEN_DIR}${page}/${file}`;
}

export function readGolden(page: string, file: "scan.json" | "report.md"): string {
  return readFileSync(goldenPath(page, file), "utf8");
}

export function readGoldenRecord(page: string): ScanRecord {
  return JSON.parse(readGolden(page, "scan.json")) as ScanRecord;
}

/** A time that is valid against the schema, standing in for the run's own. */
const NORMAL_TIME = "2000-01-01T00:00:00Z";

/**
 * Takes out what changes from run to run, so a golden changes only when the output does: the fixture
 * server's port, the times, and the versions of this tool, axe-core and the browser. Rule counts and
 * everything else stay, so an axe-core upgrade shows in the diff.
 */
export function normalise(record: ScanRecord): ScanRecord {
  const text = JSON.stringify(record)
    .replaceAll(/127\.0\.0\.1:\d+/g, "127.0.0.1:0000")
    .replaceAll(/\/rules\/axe\/\d+\.\d+\//g, "/rules/axe/0.0/");
  const copy = JSON.parse(text) as ScanRecord;
  copy.tool.version = "0.0.0";
  copy.engine.axeCore = "0.0.0";
  copy.engine.browser = copy.engine.browser.replace(/\d+(\.\d+)*$/, "0.0.0.0");
  copy.startedAt = NORMAL_TIME;
  copy.finishedAt = NORMAL_TIME;
  return copy;
}

/** Compares `actual` with the golden file; with `UPDATE_GOLDENS=1` it rewrites the file instead. */
export function expectGolden(page: string, file: "scan.json" | "report.md", actual: string): void {
  const path = goldenPath(page, file);
  if (process.env.UPDATE_GOLDENS === "1") {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, actual, "utf8");
    return;
  }
  expect(
    actual,
    `${file} for ${page}.html differs from its golden; review it and run UPDATE_GOLDENS=1 npm test`,
  ).toBe(readFileSync(path, "utf8"));
}
