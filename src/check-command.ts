/**
 * `a11y-genie check --baseline <scan> [<url>] [scan's flags]` (spec 4.6): scans as `scan` does with the same
 * flags, compares with the baseline (src/compare.ts), and exits 1 only on a new violation at or above
 * `--fail-on`, or on a page or state not scanned. A finding still open from the baseline never fails it.
 *
 * The baseline is a file this run did not write. It is read and checked whole (src/baseline.ts), and refused
 * when it is of another site or does not cover the same pages, states and tags as this check, all before a
 * browser is opened.
 */

import { readScanFile } from "./baseline.js";
import {
  checkLine,
  checkRecord,
  incomparable,
  neverScannedLine,
  unverifiedOf,
  type Incomparable,
} from "./compare.js";
import { printableLine } from "./printable.js";
import { Refusal } from "./refusal.js";
import { pageKeyOf } from "./map-axe.js";
import {
  finish,
  parseFlags,
  prepareScan,
  runPrepared,
  SCAN_FLAGS,
  scanLines,
  writeScan,
  type PreparedScan,
  type ScanFlagValues,
} from "./scan-command.js";
import type { ScanRecord } from "./scan-record.js";

export const CHECK_FLAGS = { ...SCAN_FLAGS, baseline: { type: "string" } } as const;

const SAME_ARGUMENTS_HINT =
  "run check with the arguments the baseline was scanned with: the same pages, the same states and the same --tags.";

/** A list from the baseline as a refusal may print it: one line, its controls stripped, and cut. */
function listed(items: readonly string[] | null): string {
  if (items === null) return "axe-core's default rule set";
  const text = items.length === 0 ? "none" : items.join(", ");
  return printableLine(text).slice(0, 200);
}

/** The refusal for a baseline that cannot be compared with this check. */
function incomparableRefusal(why: Incomparable): Refusal {
  const said =
    why.what === "pages"
      ? `it scanned the pages ${listed(why.earlier)}, and this check scans ${listed(why.now)}`
      : why.what === "states"
        ? `it scanned the page ${listed([why.page])} in the states ${listed(why.earlier)}, and this check scans it in ${listed(why.now)}`
        : `it ran ${why.earlier === null ? listed(null) : `the tags ${listed(why.earlier)}`}, and this check runs ${why.now === null ? listed(null) : `the tags ${listed(why.now)}`}`;
  return new Refusal(`--baseline is not comparable with this check: ${said}.`, SAME_ARGUMENTS_HINT);
}

/** Refuses a baseline of another site, or of other pages, states or tags than `prepared` will scan. */
export function checkComparable(baseline: ScanRecord, prepared: PreparedScan): void {
  const origin = new URL(prepared.plan.url).origin;
  if (baseline.target.origin !== origin) {
    throw new Refusal(
      `--baseline is a scan of ${printableLine(baseline.target.origin).slice(0, 200)}, and this check is of ${origin}.`,
      "comparing two sites' findings means nothing: give a baseline of the same site, or scan this one first for one.",
    );
  }
  const now = {
    pages: prepared.plan.pages.map((page) => ({
      key: page.key ?? pageKeyOf(page.url),
      states: ["default", ...page.states.map((state) => state.name)],
    })),
    tags: prepared.run.tags === undefined ? null : [...prepared.run.tags],
  };
  const earlier = {
    pages: baseline.pages.map((page) => ({ key: page.key, states: page.states })),
    tags: baseline.engine.tags,
  };
  const why = incomparable(earlier, now);
  if (why !== null) throw incomparableRefusal(why);
}

/** `check`'s lines for a person, after the first: what the comparison could not verify, then the scan's own. */
function checkLines(record: ScanRecord): string[] {
  const { thisTime: unverified } = unverifiedOf(record);
  const never = neverScannedLine(record);
  const lines: string[] = [];
  if (unverified > 0) {
    lines.push(
      unverified === 1
        ? "1 finding is still open and unverified: its page or state was not scanned this time, so it is not read as fixed."
        : `${unverified} findings are still open and unverified: their pages or states were not scanned this time, so they are not read as fixed.`,
    );
  }
  if (never !== undefined) lines.push(never);
  return lines;
}

export async function checkCommand(args: string[], helpHint: string): Promise<void> {
  const { values, positionals } = parseFlags(args, CHECK_FLAGS, helpHint);
  const baselinePath = values.baseline as string | undefined;
  if (baselinePath === undefined || baselinePath === "") {
    throw new Refusal(
      "check needs --baseline: the scan to compare with.",
      "scan first, then give its scan.json or its folder: a11y-genie check --baseline <scan> <url>",
    );
  }
  const prepared = prepareScan(values as ScanFlagValues, positionals, "check", helpHint);
  const baseline = readScanFile(baselinePath, "--baseline");
  checkComparable(baseline, prepared);

  const now = await runPrepared(prepared);
  const record = checkRecord(now, { path: baselinePath, record: baseline });
  const folder = writeScan(prepared, record);
  finish(record, prepared, [
    checkLine(record),
    ...checkLines(record),
    ...scanLines(record, prepared, folder),
  ]);
}
