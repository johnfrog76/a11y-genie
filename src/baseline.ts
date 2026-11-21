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
import { originKey } from "./scans-folder.js";

/** The major version of `scan.json` this version reads. */
export const SCHEMA_MAJOR = 1;

const BASELINE_HINT =
  "give a scan.json that a11y-genie scan wrote, or the scan folder it is in, such as <scans>/localhost-5173/2026-11-19T20-14-03Z.";

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

/** The newest scan folder in the site folder `site`, leaving out those in `skip`; undefined when there is none. */
function latestScanIn(site: string, skip: ReadonlySet<string> = new Set()): string | undefined {
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

/** The newest scan folder of the site `origin` under `root`, leaving out those in `skip`; undefined when there is none. */
export function latestScanFolder(
  root: string,
  origin: string,
  skip: ReadonlySet<string> = new Set(),
): string | undefined {
  return latestScanIn(join(root, originKey(origin)), skip);
}

/** Each site folder under `root` that holds at least one scan folder, by name, with its newest scan. */
export function sitesIn(root: string): { site: string; latest: string }[] {
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return [];
  }
  const sites: { site: string; latest: string }[] = [];
  for (const name of names.sort()) {
    const latest = latestScanIn(join(root, name));
    if (latest !== undefined) sites.push({ site: name, latest });
  }
  return sites;
}

/**
 * The latest scan of the only site in the scans folder `root`, for a command given no `<scan>` (spec 4.1); a
 * refusal when it holds no scan, or scans of more than one site, whose hint lists them.
 */
export function latestScanOfOnlySite(root: string, command: string): string {
  const sites = sitesIn(root);
  const [only] = sites;
  if (only === undefined) {
    throw new Refusal(
      `there is no scan in the scans folder for ${command} to read: ${shown(root)}`,
      `scan first: a11y-genie scan <url>. A scan written under --out is read by giving its folder: a11y-genie ${command} <scan>`,
    );
  }
  if (sites.length > 1) {
    const named = sites.slice(0, 10).map((s) => shown(s.site));
    const more = sites.length - named.length;
    throw new Refusal(
      `the scans folder holds scans of ${sites.length} sites, so ${command} cannot tell which one to read.`,
      `give the scan folder to read, such as a11y-genie ${command} "${shown(only.latest)}". ` +
        `The sites: ${named.join(", ")}${more > 0 ? `, and ${more} more` : ""}.`,
    );
  }
  return only.latest;
}

/**
 * Plain `scan`'s previous scan of the site: its record, or why it cannot be read, or undefined when there is none.
 * A `narrate` run is skipped: it has no axe-core results, so it is not a scan to compare with.
 */
export function previousScan(
  root: string,
  origin: string,
): { record: ScanRecord } | { reason: string } | undefined {
  let skip = new Set<string>();
  for (;;) {
    const folder = latestScanFolder(root, origin, skip);
    if (folder === undefined) return undefined;
    try {
      const record = readScanFile(folder, "the last scan");
      if (record.command !== "narrate") return { record };
      skip = new Set([...skip, folder]);
    } catch (error) {
      if (error instanceof Refusal) return { reason: "it cannot be read as a scan.json of this version" };
      throw error;
    }
  }
}
