/**
 * Reading an earlier `scan.json`: `check`'s `--baseline`, and plain `scan`'s previous scan of the site. Either is a
 * file this run did not write, so it is untrusted input (spec 8A.1): it is held to the size limit on `scan.json`,
 * parsed as JSON and nothing else, checked against `schema/scan-1.json` before any field is read, and only then
 * used. Nothing in it is run, and nothing of it is printed except through `printable`, by the caller.
 */

import { closeSync, fstatSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import { LIMITS } from "./context.js";
import { scanSchema, validate } from "./json-schema.js";
import { printableLine } from "./printable.js";
import { Refusal } from "./refusal.js";
import type { ScanRecord } from "./scan-record.js";
import { oldOriginKey, originKey } from "./scans-folder.js";

/** The major version of `scan.json` this version reads. */
export const SCHEMA_MAJOR = 1;

const BASELINE_HINT =
  "give a scan.json that a11y-genie scan wrote, or the scan folder it is in, such as <scans>/http_localhost-5173/2026-11-19T20-14-03Z.";

/** A path as a refusal may print it: one line, its controls stripped, and cut. */
function shown(path: string): string {
  return printableLine(path).slice(0, 200);
}

/** Reads the file in chunks, and stops past `limit` bytes, so a larger file is found without reading it all. */
function readCapped(path: string, limit: number): Buffer | "too large" | "not a file" {
  const fd = openSync(path, "r");
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) return "not a file";
    if (stat.size > limit) return "too large";
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const chunk = Buffer.alloc(1024 * 1024);
      const read = readSync(fd, chunk, 0, chunk.length, null);
      if (read === 0) return Buffer.concat(chunks, total);
      total += read;
      // The file may have grown since it was measured.
      if (total > limit) return "too large";
      chunks.push(chunk.subarray(0, read));
    }
  } finally {
    closeSync(fd);
  }
}

/**
 * The record in `path`, a `scan.json` or a scan folder holding one, checked whole; otherwise a refusal naming
 * `flag` (`--baseline`). Refused: a path that cannot be read, is not a file, or is over the 50 MB limit on
 * `scan.json`; a file that is not JSON; a `schema` of another major version; anything the schema does not hold;
 * and a finding id given twice.
 */
export function readScanFile(path: string, flag: string, limit: number = LIMITS.scanJsonBytes): ScanRecord {
  let file = path;
  let bytes: ReturnType<typeof readCapped>;
  try {
    if (statSync(path).isDirectory()) file = join(path, "scan.json");
    bytes = readCapped(file, limit);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "unreadable";
    throw new Refusal(`${flag} cannot be read: ${shown(file)} (${code})`, BASELINE_HINT);
  }
  if (bytes === "not a file") throw new Refusal(`${flag} is not a file: ${shown(file)}`, BASELINE_HINT);
  if (bytes === "too large") {
    throw new Refusal(`${flag} is over the ${limit} byte limit on scan.json: ${shown(file)}`, BASELINE_HINT);
  }
  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Refusal(`${flag} is not a scan.json: ${shown(file)} is not JSON.`, BASELINE_HINT);
  }
  const schema =
    typeof data === "object" && data !== null ? (data as { schema?: unknown }).schema : undefined;
  const major = typeof schema === "string" ? /^([0-9]{1,6})\.[0-9]{1,6}$/.exec(schema)?.[1] : undefined;
  if (major === undefined) {
    throw new Refusal(`${flag} is not a scan.json: ${shown(file)} has no schema version.`, BASELINE_HINT);
  }
  if (Number(major) !== SCHEMA_MAJOR) {
    throw new Refusal(
      `${flag} is a scan.json of schema ${major}, and this version of A11y Genie reads schema ${SCHEMA_MAJOR} (${SCHEMA_MAJOR}.x).`,
      `scan again with this version to make a baseline it can read, or run the version that wrote it.`,
    );
  }
  const problems = validate(scanSchema(), data);
  if (problems.length > 0) {
    // The path only: the value that failed is the file's own, and is never printed.
    const where = (problems[0] ?? "").split(":")[0] ?? "";
    const more = problems.length > 1 ? `, and ${problems.length - 1} more` : "";
    throw new Refusal(
      `${flag} is not a scan.json A11y Genie wrote: ${shown(file)} does not match schema/scan-1.json at ${shown(where)}${more}.`,
      BASELINE_HINT,
    );
  }
  const record = data as ScanRecord;
  const ids = new Set<string>();
  for (const finding of record.findings) {
    if (ids.has(finding.id)) {
      throw new Refusal(
        `${flag} is not a scan.json A11y Genie wrote: ${shown(file)} lists the finding ${shown(finding.id).slice(0, 120)} twice.`,
        BASELINE_HINT,
      );
    }
    ids.add(finding.id);
  }
  return record;
}

/** A scan folder's name: its start time, with `-2`, `-3` when two began the same second (src/scans-folder.ts). */
const SCAN_FOLDER = /^([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}-[0-9]{2}-[0-9]{2}Z)(?:-([0-9]{1,6}))?$/;

/**
 * The newest scan folder of the site `origin` under `root`, leaving out those in `skip`; undefined when there is none.
 * It looks in the site's folder (`originKey`), or in the folder of the old name (`oldOriginKey`) with `old`.
 */
export function latestScanFolder(
  root: string,
  origin: string,
  skip: ReadonlySet<string> = new Set(),
  old = false,
): string | undefined {
  const site = join(root, old ? oldOriginKey(origin) : originKey(origin));
  let names: string[];
  try {
    names = readdirSync(site);
  } catch {
    return undefined;
  }
  let best: { name: string; time: string; n: number } | undefined;
  for (const name of names) {
    const match = SCAN_FOLDER.exec(name);
    if (match === null || skip.has(join(site, name))) continue;
    const time = match[1] as string;
    const n = match[2] === undefined ? 1 : Number(match[2]);
    if (best === undefined || time > best.time || (time === best.time && n > best.n))
      best = { name, time, n };
  }
  return best === undefined ? undefined : join(site, best.name);
}

/**
 * Plain `scan`'s previous scan of the site: its record, or why it cannot be read, or undefined when there is none.
 * A `narrate` run is skipped: it has no axe-core results, so it is not a scan to compare with. So is a scan whose
 * own `target.origin` is another origin's.
 *
 * The site's folder is read first. When it holds no scan, the folder of the old name is read (scans written before
 * issue #162): that name was shared by `http` and `https`, so a scan in it is used only when its own
 * `target.origin` is this origin, and one that cannot be read is passed over, since it cannot say whose it is.
 */
export function previousScan(
  root: string,
  origin: string,
): { record: ScanRecord } | { reason: string } | undefined {
  for (const old of [false, true]) {
    let skip = new Set<string>();
    for (;;) {
      const folder = latestScanFolder(root, origin, skip, old);
      if (folder === undefined) break;
      skip = new Set([...skip, folder]);
      let record: ScanRecord;
      try {
        record = readScanFile(folder, "the last scan");
      } catch (error) {
        if (!(error instanceof Refusal)) throw error;
        if (old) continue;
        return { reason: "it cannot be read as a scan.json of this version" };
      }
      if (record.command !== "narrate" && record.target.origin === origin) return { record };
    }
  }
  return undefined;
}
