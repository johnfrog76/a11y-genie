import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { latestScanFolder, previousScan, readScanFile } from "../../src/baseline.js";
import { Refusal } from "../../src/refusal.js";
import { UNFINISHED_PREFIX } from "../../src/scans-folder.js";
import { goldenPath, readGolden } from "../helpers/goldens.js";
import { controlsIn } from "../helpers/controls.js";

// The baseline is a file this run did not write (spec 8A.1): read whole, held to the size limit, checked against
// the schema before any field is used, and refused in words that never quote what it held.

const made: string[] = [];
afterAll(() => {
  for (const folder of made) rmSync(folder, { recursive: true, force: true });
});
function fresh(): string {
  const folder = mkdtempSync(join(tmpdir(), "a11y-genie-baseline-"));
  made.push(folder);
  return folder;
}
function file(text: string | Buffer): string {
  const path = join(fresh(), "scan.json");
  writeFileSync(path, text);
  return path;
}
const golden = (): Record<string, unknown> & { findings: Record<string, unknown>[] } =>
  JSON.parse(readGolden("impact-mix", "scan.json")) as never;

/** The refusal `readScanFile` throws for `path`, as the two lines the command would print. */
function refusal(path: string, limit?: number): { error: string; hint: string } {
  try {
    readScanFile(path, "--baseline", limit);
  } catch (error) {
    if (error instanceof Refusal) return { error: error.message, hint: error.hint };
    throw error;
  }
  throw new Error("not refused");
}

describe("readScanFile", () => {
  it("reads a scan.json, or the scan folder it is in", () => {
    expect(readScanFile(goldenPath("impact-mix", "scan.json"), "--baseline").findings.length).toBeGreaterThan(
      0,
    );
    const folder = fresh();
    writeFileSync(join(folder, "scan.json"), readGolden("impact-mix", "scan.json"));
    expect(readScanFile(folder, "--baseline").schema).toBe("1.10");
  });

  it("reads a 1.4 record, and one from a later minor version with fields it does not know", () => {
    const record = { ...golden(), schema: "1.9", addedLater: { anything: true } };
    expect(readScanFile(file(JSON.stringify(record)), "--baseline").schema).toBe("1.9");
    expect(readScanFile(file(JSON.stringify({ ...golden(), schema: "1.4" })), "--baseline").schema).toBe(
      "1.4",
    );
  });

  it("refuses a path that is missing, a folder with no scan.json, and something that is not a file", () => {
    expect(refusal(join(fresh(), "nope.json")).error).toMatch(
      /^--baseline cannot be read: .*nope\.json \(ENOENT\)$/,
    );
    expect(refusal(fresh()).error).toMatch(/^--baseline cannot be read: .*scan\.json \(ENOENT\)$/);
    expect(refusal("/dev/null").error).toBe("--baseline is not a file: /dev/null");
  });

  it("refuses a file over the size limit without reading it", () => {
    expect(refusal(file("x".repeat(101)), 100).error).toMatch(
      /^--baseline is over the 100 byte limit on scan\.json: /,
    );
  });

  it("refuses a file that is not JSON, or not UTF-8", () => {
    expect(refusal(file("{ not json")).error).toMatch(/^--baseline is not a scan\.json: .* is not JSON\.$/);
    expect(refusal(file(Buffer.from([0x7b, 0xff, 0xfe, 0x7d]))).error).toMatch(/is not JSON\.$/);
    expect(refusal(file("[]")).error).toMatch(/has no schema version\.$/);
  });

  it("refuses another major version, and the hint names the one it reads", () => {
    const { error, hint } = refusal(file(JSON.stringify({ ...golden(), schema: "2.0" })));
    expect(error).toBe(
      `--baseline is a scan.json of schema 2, and this version of A11y Genie reads schema 1 (1.x).`,
    );
    expect(hint).toMatch(/^scan again with this version/);
  });

  it("refuses a record the schema does not hold, naming where and never the value", () => {
    const record = golden();
    (record.findings[0] as Record<string, unknown>).impact = "\u001b]0;owned\u0007\u001b[31mhuge";
    const { error, hint } = refusal(file(JSON.stringify(record)));
    expect(error).toMatch(
      /^--baseline is not a scan\.json A11y Genie wrote: .* does not match schema\/scan-1\.json at \.findings\[0\]\.impact\.$/,
    );
    expect(error).not.toContain("huge");
    expect(controlsIn(error + hint)).toEqual([]);
    expect(hint).toMatch(/^give a scan\.json that a11y-genie scan wrote/);
  });

  it("refuses a record that lists one finding id twice", () => {
    const record = golden();
    record.findings.push(record.findings[0] as Record<string, unknown>);
    expect(refusal(file(JSON.stringify(record))).error).toMatch(/lists the finding axe\/.+ twice\.$/);
  });

  it("strips the controls from a path it names", () => {
    const { error } = refusal(join(fresh(), "\u001b[2Jnope\u0007.json"));
    expect(controlsIn(error)).toEqual([]);
  });
});

describe("the last scan of a site", () => {
  it("is the newest scan folder, a second's -2, -10 after its -9", () => {
    const root = fresh();
    const site = join(root, "127.0.0.1-4173");
    for (const name of [
      "2026-11-19T20-14-03Z",
      "2026-11-19T20-14-04Z",
      "2026-11-19T20-14-04Z-2",
      "2026-11-19T20-14-04Z-10",
      "2026-11-19T20-14-04Z-9",
      "filed.json",
      "zzz",
    ]) {
      mkdirSync(join(site, name), { recursive: true });
    }
    expect(latestScanFolder(root, "http://127.0.0.1:4173")).toBe(join(site, "2026-11-19T20-14-04Z-10"));
    expect(latestScanFolder(root, "http://127.0.0.1:4174")).toBeUndefined();
  });

  it("is never a folder a crash left unfinished, even one that holds a whole scan.json", () => {
    const root = fresh();
    const site = join(root, "127.0.0.1-4173");
    const earlier = join(site, "2026-11-19T20-14-03Z");
    // As a crash part way through a later write would leave it (src/scans-folder.ts).
    const unfinished = join(site, `${UNFINISHED_PREFIX}2026-11-19T20-14-04Z-AbC123`);
    for (const folder of [earlier, unfinished]) {
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, "scan.json"), readGolden("impact-mix", "scan.json"));
    }
    expect(latestScanFolder(root, "http://127.0.0.1:4173")).toBe(earlier);
    rmSync(earlier, { recursive: true });
    expect(latestScanFolder(root, "http://127.0.0.1:4173")).toBeUndefined();
    expect(previousScan(root, "http://127.0.0.1:4173")).toBeUndefined();
  });

  it("reads as not comparable when it cannot be read, and as none when there is none", () => {
    const root = fresh();
    expect(previousScan(root, "http://127.0.0.1:4173")).toBeUndefined();
    const folder = join(root, "127.0.0.1-4173", "2026-11-19T20-14-03Z");
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "scan.json"), "{ broken");
    expect(previousScan(root, "http://127.0.0.1:4173")).toEqual({
      reason: "it cannot be read as a scan.json of this version",
    });
  });
});

// A named pipe opens only when something writes to it, so a baseline or a scan that is one must be found out
// without being opened (issue 185). A regression would block the whole test process, where no timeout can fire, so
// each test starts a writer that opens the pipe after three seconds: a call that opened it returns then, and fails
// on the time it took, instead of hanging the run.
describe.skipIf(process.platform === "win32")("a named pipe given as a scan", () => {
  function pipe(name: string, folder = fresh()): string {
    const path = join(folder, name);
    execFileSync("mkfifo", [path]);
    return path;
  }

  /** Runs `call` with a writer standing by to free the pipe, and holds that it returned well before the writer. */
  function unopened<T>(path: string, call: () => T): T {
    const writer = spawn("sh", ["-c", 'sleep 3; : > "$1"', "sh", path], { stdio: "ignore" });
    const started = Date.now();
    try {
      return call();
    } finally {
      writer.kill("SIGKILL");
      expect(Date.now() - started, "the pipe was opened").toBeLessThan(2000);
    }
  }

  it("is refused as a baseline, as a file that is not a file, without being opened", () => {
    const path = pipe("scan.json");
    expect(unopened(path, () => refusal(path)).error).toBe(`--baseline is not a file: ${path}`);
  });

  it("is refused when a scan folder's scan.json is one", () => {
    const folder = fresh();
    const path = pipe("scan.json", folder);
    expect(unopened(path, () => refusal(folder)).error).toContain("is not a file");
  });

  it("is passed over as the last scan, with a reason", () => {
    const root = fresh();
    const site = join(root, "localhost-5173", "2026-11-19T20-14-03Z");
    mkdirSync(site, { recursive: true });
    const path = pipe("scan.json", site);
    expect(unopened(path, () => previousScan(root, "http://localhost:5173"))).toEqual({
      reason: "it cannot be read as a scan.json of this version",
    });
  });
});
