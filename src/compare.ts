/**
 * Scan, fix, rescan (spec 4.6): a scan compared with an earlier one, by finding `id` and then by element
 * `selector` within a finding. `check` compares with the baseline it is given and lists what is fixed; plain
 * `scan` compares with the site's previous scan for one line and `summary.sincePrevious`, and lists nothing fixed.
 * Everything here is a pure function of two records; src/baseline.ts reads and validates the earlier one first.
 */

import { atOrAbove, DEFAULT_FAIL_ON } from "./rule-flags.js";
import { IMPACTS, type Impact } from "./finding.js";
import { orderFindings } from "./order.js";
import {
  cutText,
  fitToSize,
  type FixedIn,
  type RecordElement,
  type RecordFinding,
  type ScanRecord,
} from "./scan-record.js";
import { LIMITS } from "./context.js";

/** What makes two scans comparable: the same pages, each in the same states, under the same `--tags`. */
export interface ScanShape {
  pages: { key: string; states: readonly string[] }[];
  tags: readonly string[] | null;
}

/** Why two scans cannot be compared, or null when they can. */
export type Incomparable =
  | { what: "pages"; earlier: string[]; now: string[] }
  | { what: "states"; page: string; earlier: string[]; now: string[] }
  | { what: "tags"; earlier: string[] | null; now: string[] | null };

export function shapeOf(record: ScanRecord): ScanShape {
  return {
    pages: record.pages.map((page) => ({ key: page.key, states: page.states })),
    tags: record.engine.tags,
  };
}

const sorted = (items: readonly string[]): string[] => [...new Set(items)].sort();
const same = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((item, i) => item === b[i]);

/**
 * Whether `earlier` and `now` covered the same pages (by key, in any order), each in the same states (by name),
 * under the same tags (in any order; null for axe-core's default rule set). A finding's id names its page, and its
 * elements name their states, so scans that differ in these cannot be read against each other.
 */
export function incomparable(earlier: ScanShape, now: ScanShape): Incomparable | null {
  const earlierPages = sorted(earlier.pages.map((page) => page.key));
  const nowPages = sorted(now.pages.map((page) => page.key));
  if (!same(earlierPages, nowPages)) return { what: "pages", earlier: earlierPages, now: nowPages };
  for (const page of now.pages) {
    const before = earlier.pages.find((p) => p.key === page.key);
    const earlierStates = sorted(before?.states ?? []);
    const nowStates = sorted(page.states);
    if (!same(earlierStates, nowStates)) {
      return { what: "states", page: page.key, earlier: earlierStates, now: nowStates };
    }
  }
  const earlierTags = earlier.tags === null ? null : sorted(earlier.tags);
  const nowTags = now.tags === null ? null : sorted(now.tags);
  if (earlierTags === null || nowTags === null ? earlierTags !== nowTags : !same(earlierTags, nowTags)) {
    return { what: "tags", earlier: earlierTags, now: nowTags };
  }
  return null;
}

/** The findings of a record that were open in it: a `check` record also lists the ones it found fixed. */
function openFindings(record: ScanRecord): RecordFinding[] {
  return record.findings.filter((finding) => finding.status !== "fixed");
}

/** The states of each page that were not scanned in `record`. */
function notScannedStates(record: ScanRecord): Map<string, Set<string>> {
  return new Map(
    record.pages.map((page) => [page.key, new Set(page.notScanned.map((missed) => missed.state))]),
  );
}

/**
 * An earlier element as a new record keeps it, with its status. Only the fields this version knows are copied, and the
 * HTML is cut to the excerpt limit again: an earlier element comes from a file this run did not write.
 */
function carried(element: RecordElement, status: RecordElement["status"], unverified = false): RecordElement {
  const out: RecordElement = {
    selector: element.selector,
    target: element.target,
    html: cutText(element.html, LIMITS.excerptChars),
    failure: element.failure,
    states: element.states,
  };
  if (element.colorPair !== undefined) out.colorPair = element.colorPair;
  if (status !== undefined) out.status = status;
  if (unverified) out.unverified = true;
  return out;
}

/** An earlier finding's own fields, the ones this version knows, without its elements or its comparison. */
function findingOf(was: RecordFinding): Omit<RecordFinding, "status" | "elements"> {
  const { source, id, help, helpUrl, wcag } = was.rule;
  return {
    id: was.id,
    rule: { source, id, help, helpUrl, wcag },
    kind: was.kind,
    impact: was.impact,
    page: was.page,
    title: was.title,
    plain: was.plain,
    fix: was.fix,
    ...(was.elementsCut === undefined ? {} : { elementsCut: was.elementsCut }),
  };
}

/** What a comparison found, before it is written into a record. */
export interface Comparison {
  /** Every finding found now, with its status, and the earlier ones carried in as `still` or `fixed`. */
  findings: RecordFinding[];
  new: number;
  still: number;
  fixed: number;
  /** How many findings read `still` only because their page or state was not scanned now. */
  unverified: number;
}

/**
 * Compares `now` with `earlier`, finding by finding (spec 4.6):
 *
 * - a finding found now and not open in `earlier` is **new**, and so is one `earlier` had that now has an element
 *   it did not have;
 * - a finding in both is **still**: the elements still failing are listed, and the earlier elements that no longer
 *   fail are listed under it as `fixedElements`;
 * - a finding open in `earlier` and not found now is **fixed**, named with the scan it was found gone in
 *   (`fixedIn`); a finding `earlier` already had as fixed and that is still gone keeps the `fixedIn` it had.
 *
 * Elements are matched by `selector`. When the elements left unmatched on each side are as many as each other,
 * they are read as the same elements under selectors that moved (spec R11), so the finding reads `still`, never
 * fixed plus new. An earlier element whose page or state was not scanned now is never read as fixed: it stays,
 * as `still` with `unverified: true`, and so does its finding.
 */
export function compareScans(earlier: ScanRecord, now: ScanRecord): Comparison {
  const missed = notScannedStates(now);
  const unseen = (page: string, element: RecordElement): boolean =>
    element.states.some((state) => missed.get(page)?.has(state) === true);
  const before = new Map(openFindings(earlier).map((finding) => [finding.id, finding]));
  const fixedIn: FixedIn = { startedAt: now.startedAt, commit: now.target.commit };
  const open: RecordFinding[] = [];
  const fixed: RecordFinding[] = [];
  let unverified = 0;

  for (const finding of openFindings(now)) {
    const was = before.get(finding.id);
    if (was === undefined) {
      open.push({
        ...finding,
        status: "new",
        elements: finding.elements.map((e) => ({ ...e, status: "new" as const })),
      });
      continue;
    }
    before.delete(finding.id);
    const earlierBySelector = new Map(was.elements.map((element) => [element.selector, element]));
    const nowSelectors = new Set(finding.elements.map((element) => element.selector));
    const unmatchedNow = finding.elements.filter((element) => !earlierBySelector.has(element.selector));
    const unmatchedBefore = was.elements.filter((element) => !nowSelectors.has(element.selector));
    // As many on each side: the same elements, read under selectors that moved (R11).
    const moved = unmatchedNow.length === unmatchedBefore.length;
    const elements: RecordElement[] = finding.elements.map((element) =>
      // An element found now is this run's own: kept whole, with its status.
      ({
        ...element,
        status: moved || earlierBySelector.has(element.selector) ? ("still" as const) : ("new" as const),
      }),
    );
    const gone = moved ? [] : unmatchedBefore;
    const stillUnseen = gone.filter((element) => unseen(finding.page, element));
    const fixedElements = gone
      .filter((element) => !unseen(finding.page, element))
      .map((e) => carried(e, "fixed"));
    elements.push(...stillUnseen.map((element) => carried(element, "still", true)));
    const status = elements.some((element) => element.status === "new") ? "new" : "still";
    if (stillUnseen.length > 0) unverified += 1;
    open.push({
      ...finding,
      status,
      elements,
      ...(fixedElements.length > 0 ? { fixedElements } : {}),
      ...(stillUnseen.length > 0 ? { unverified: true as const } : {}),
    });
  }

  // Open before, and not found now.
  for (const was of before.values()) {
    const stillUnseen = was.elements.filter((element) => unseen(was.page, element));
    const rest = findingOf(was);
    if (stillUnseen.length > 0) {
      unverified += 1;
      const fixedElements = was.elements
        .filter((element) => !unseen(was.page, element))
        .map((element) => carried(element, "fixed"));
      open.push({
        ...rest,
        status: "still",
        elements: stillUnseen.map((element) => carried(element, "still", true)),
        ...(fixedElements.length > 0 ? { fixedElements } : {}),
        unverified: true,
      });
    } else {
      fixed.push({
        ...rest,
        status: "fixed",
        elements: was.elements.map((e) => carried(e, "fixed")),
        fixedIn,
      });
    }
  }

  // Fixed before, and still gone: it keeps the scan it was first found gone in.
  const foundNow = new Set(openFindings(now).map((finding) => finding.id));
  for (const was of earlier.findings) {
    if (was.status !== "fixed" || foundNow.has(was.id)) continue;
    fixed.push({
      ...findingOf(was),
      status: "fixed",
      elements: was.elements.map((e) => carried(e, "fixed")),
      fixedIn: was.fixedIn ?? { startedAt: earlier.startedAt, commit: earlier.target.commit },
    });
  }

  const pageOrder = now.pages.map((page) => page.key);
  const ordered = orderFindings(open, pageOrder);
  return {
    findings: [...ordered, ...orderFindings(fixed, pageOrder)],
    new: ordered.filter((f) => f.status === "new").length,
    still: ordered.filter((f) => f.status === "still").length,
    fixed: fixed.length,
    unverified,
  };
}

/** How `--baseline` is named in a `check` record. */
export interface BaselineInfo {
  /** The path as it was given. */
  path: string;
  record: ScanRecord;
}

/**
 * `check`'s record: the scan just run, compared with the baseline. It lists every finding with its status, the
 * fixed ones last, and counts violations by impact over the findings still open (new and still). It exits 1 on
 * a new violation at or above `--fail-on`, or on a page or state not scanned; a finding still open from the
 * baseline never fails it (spec 4.3).
 */
export function checkRecord(now: ScanRecord, baseline: BaselineInfo): ScanRecord {
  const compared = compareScans(baseline.record, now);
  const failOn = now.options?.failOn ?? DEFAULT_FAIL_ON;
  const open = compared.findings.filter((f) => f.status !== "fixed");
  const violations = open.filter((f) => f.kind === "violation");
  const count = (impact: Impact): number => violations.filter((f) => f.impact === impact).length;
  const [critical, serious, moderate, minor] = IMPACTS.map(count) as [number, number, number, number];
  const failing = violations.some((f) => f.status === "new" && atOrAbove(f.impact, failOn));
  const record: ScanRecord = {
    ...now,
    command: "check",
    exit: failing || now.summary.notScanned > 0 ? 1 : 0,
    summary: {
      ...now.summary,
      critical,
      serious,
      moderate,
      minor,
      advice: open.filter((f) => f.kind === "advice").length,
      new: compared.new,
      still: compared.still,
      fixed: compared.fixed,
    },
    findings: compared.findings,
    baseline: {
      path: baseline.path,
      startedAt: baseline.record.startedAt,
      commit: baseline.record.target.commit,
    },
  };
  return fitToSize(record, now.limits?.scanJsonBytes ?? LIMITS.scanJsonBytes);
}

/** The words for a plain `scan` whose previous scan cannot be compared with it (spec 4.6). */
export const NOT_COMPARABLE_REASON = "different pages, states or tags";

/**
 * Plain `scan`, with the site's previous scan: each finding `new` or `still` against it, and
 * `summary.sincePrevious` counting what is new and what is gone. It lists no fixed finding and changes nothing
 * else: the exit reads only the scan just run. `previous` is null when there is one and it cannot be compared;
 * `reason` then says why.
 */
export function withPrevious(
  now: ScanRecord,
  previous: { record: ScanRecord } | { reason: string },
): ScanRecord {
  if ("reason" in previous) {
    return { ...now, summary: { ...now.summary, sincePrevious: null, sincePreviousReason: previous.reason } };
  }
  const earlier = previous.record;
  if (earlier.target.origin !== now.target.origin || incomparable(shapeOf(earlier), shapeOf(now)) !== null) {
    return withPrevious(now, { reason: NOT_COMPARABLE_REASON });
  }
  const compared = compareScans(earlier, now);
  const status = new Map(compared.findings.map((finding) => [finding.id, finding.status]));
  return {
    ...now,
    summary: {
      ...now.summary,
      sincePrevious: { new: compared.new, fixed: compared.fixed, startedAt: earlier.startedAt },
    },
    findings: now.findings.map((finding) => ({
      ...finding,
      status: status.get(finding.id) === "new" ? "new" : "still",
    })),
  };
}

/** `2 fixed, 0 new, 3 still open (worst: serious, color-contrast on settings)`: `check`'s first line. */
export function checkLine(record: ScanRecord): string {
  const { new: added = 0, still = 0, fixed = 0 } = record.summary;
  const worst = record.findings.find((f) => f.status !== "fixed" && f.kind === "violation");
  const rule =
    worst === undefined
      ? ""
      : worst.rule.source === "axe"
        ? worst.rule.id
        : `${worst.rule.source}/${worst.rule.id}`;
  const tail = worst === undefined ? "" : ` (worst: ${worst.impact}, ${rule} on ${worst.page})`;
  return `${fixed} fixed, ${added} new, ${still} still open${tail}`;
}

/** `4 new, 2 fixed since the last scan`, or why there is no such line: plain `scan`'s first line. */
export function sincePreviousLine(record: ScanRecord): string | undefined {
  const since = record.summary.sincePrevious;
  if (since === undefined) return undefined;
  if (since === null)
    return `Not comparable with the last scan: ${record.summary.sincePreviousReason ?? NOT_COMPARABLE_REASON}.`;
  return `${since.new} new, ${since.fixed} fixed since the last scan`;
}
