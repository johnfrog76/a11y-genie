import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { Refusal } from "../../src/refusal.js";
import { writeScan, type PreparedScan } from "../../src/scan-command.js";
import { writeScanFile } from "../../src/scans-folder.js";
import { readGoldenRecord } from "../helpers/goldens.js";

// A scan is written whole or not at all (issue #161): a write that fails part way, such as a full disk, is
// refused and leaves nothing behind, in the scans folder and in `--out` alike.

const made: string[] = [];
afterAll(() => {
  for (const folder of made) rmSync(folder, { recursive: true, force: true });
});
function fresh(): string {
  const folder = mkdtempSync(join(tmpdir(), "a11y-genie-write-"));
  made.push(folder);
  return folder;
}

const record = readGoldenRecord("impact-mix");
const SITE = "127.0.0.1-0";

function prepared(root: string): PreparedScan {
  return { root, formats: new Set(["json", "md"]) } as unknown as PreparedScan;
}

/** Writes `scan.json`, then fails on `report.md` as a full disk would. */
function fullDiskOnReport(folder: string, name: string, text: string): void {
  if (name === "report.md") throw Object.assign(new Error("no space left on device"), { code: "ENOSPC" });
  writeScanFile(folder, name, text);
}

/** The refusal `writeScan` throws, as the two lines the command prints before it exits 2. */
function refusal(root: string): { error: string; hint: string } {
  try {
    writeScan(prepared(root), record, fullDiskOnReport);
  } catch (error) {
    if (error instanceof Refusal) return { error: error.message, hint: error.hint };
    throw error;
  }
  throw new Error("not refused");
}

/** Every path under `folder`, hidden ones included. */
function tree(folder: string): string[] {
  return readdirSync(folder, { recursive: true }).map(String).sort();
}

describe("a scan that cannot be written whole", () => {
  it("leaves the scans folder as it was: no scan folder, no unfinished folder", () => {
    const root = fresh();
    const earlier = join(root, SITE, "2026-11-19T20-14-03Z");
    mkdirSync(earlier, { recursive: true });
    const before = tree(root);
    expect(refusal(root)).toEqual({
      error: `cannot write the scan under ${root}: ENOSPC`,
      hint: "choose another folder with --out.",
    });
    expect(tree(root)).toEqual(before);
  });

  it("does not leave a site folder it made for the scan", () => {
    const root = fresh();
    refusal(root);
    expect(tree(root)).toEqual([]);
  });

  it("does not leave an --out folder it made for the scan", () => {
    const out = join(fresh(), "new-out");
    refusal(out);
    expect(existsSync(out)).toBe(false);
  });
});

describe("a scan written whole", () => {
  it("is renamed into place with every file, and nothing unfinished beside it", () => {
    const root = fresh();
    const folder = writeScan(prepared(root), record);
    expect(folder).toBe(join(root, SITE, "2000-01-01T00-00-00Z"));
    expect(tree(join(root, SITE))).toEqual([
      "2000-01-01T00-00-00Z",
      join("2000-01-01T00-00-00Z", "report.md"),
      join("2000-01-01T00-00-00Z", "scan.json"),
    ]);
  });

  it("takes the next free name when a scan began the same second", () => {
    const root = fresh();
    const first = writeScan(prepared(root), record);
    const second = writeScan(prepared(root), record);
    expect(second).toBe(`${first}-2`);
    expect(readdirSync(join(root, SITE)).sort()).toEqual(["2000-01-01T00-00-00Z", "2000-01-01T00-00-00Z-2"]);
  });
});
