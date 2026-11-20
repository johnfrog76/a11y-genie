/**
 * `scan.json`: the record every report is made from, and what `--json` prints. The shape is the spec's
 * (4.5) and is versioned: `schema` is `"<major>.<minor>"`. docs/JSON.md documents each field and
 * `schema/scan-1.json` is its JSON Schema.
 */

import type { AxeScan, Finding, FindingElement, Impact, NeedsReview, Rule } from "./finding.js";
import { IMPACTS } from "./finding.js";
import { LIMITS, type Limits, type Stopped } from "./context.js";
import { atOrAbove, DEFAULT_FAIL_ON } from "./rule-flags.js";
import { mergeStates } from "./merge-states.js";
import { orderFindings } from "./order.js";
import { wordingOf } from "./plain.js";
import { escapeJsonControls } from "./printable.js";

/**
 * 1.1 added `pages[].requestedUrl`, `redirects` and `stopped`, `limits`, and `elementsCut` on findings.
 * 1.2 added `colorPair` on a `color-contrast` element.
 * 1.3 added `options` (`failOn`, `sameOrigin`, `offline`), and the `offline` and `other-origin` kinds of
 * `pages[].stopped`.
 * 1.4 made `states` real: a page lists every state it was asked to scan, `notScanned` names each state that
 * could not be scanned, and an element lists the states it was found in. A 1.3 record has `["default"]` in each.
 * 1.5 added `check`'s record (`command: "check"`, `baseline`, `summary.new`, `still` and `fixed`, and on findings
 * `fixedIn`, `fixedElements`, `unverified`, and an element's `status`), plain `scan`'s `summary.sincePrevious`
 * and `sincePreviousReason`, and `target.commit` from `--commit`. A 1.4 record has none of them.
 */
export const SCHEMA_VERSION = "1.5";

/**
 * What a scan cannot see: the questions a person has to answer, because automated rules cannot. Fixed
 * text, the same in every report, with any number of findings or none. It is the guided checklist's seed
 * list (spec 6.7), in the checklist's order.
 */
export const CANNOT_SEE: readonly string[] = [
  "Whether focus follows the reading order when you press Tab (WCAG 2.4.3).",
  "Whether the focus indicator is easy to see against every background it lands on (WCAG 2.4.7, 1.4.11).",
  "Whether every image's alternative text says what the image is for (WCAG 1.1.1).",
  "Whether headings and labels describe what follows them (WCAG 2.4.6).",
  "Whether anything is shown by colour alone (WCAG 1.4.1).",
  "Whether everything is still readable and usable at 200% zoom (WCAG 1.4.4).",
  "Whether the page works at 320 px wide without scrolling sideways (WCAG 1.4.10).",
  "Whether error messages say which field and how to fix it (WCAG 3.3.1, 3.3.3).",
  "Whether video and audio have captions or a transcript (WCAG 1.2.2, 1.2.3).",
  "Whether moving content pauses, and whether motion respects the reduced-motion setting (WCAG 2.2.2).",
  "Whether a person using a real screen reader can finish the page's main task (WCAG 4.1.2).",
];

export interface RecordElement extends FindingElement {
  /** The states of the page the element was found in, in the order they were scanned. `default` comes first. */
  states: string[];
  /** On a `check` only: whether the element is new since the baseline, still failing, or fixed. */
  status?: FindingStatus;
  /** On a `check` only: a baseline element whose page or state was not scanned this time, so it reads `still`. */
  unverified?: true;
}

/**
 * A finding against an earlier scan (spec 4.5, 4.6). `new`: not in it, or with an element it did not have. `still`:
 * in both. `fixed`: in it, and not found now; only a `check` lists fixed findings.
 */
export type FindingStatus = "new" | "still" | "fixed";

/** The scan a finding was first found gone in. */
export interface FixedIn {
  startedAt: string;
  commit: string | null;
}

export interface RecordFinding {
  id: string;
  rule: Rule;
  kind: Finding["kind"];
  impact: Impact;
  page: string;
  title: string;
  /** What is wrong and who it hurts, from src/plain.ts; axe-core's `help` for a rule it has no words for. */
  plain: string;
  /** What to change, from src/plain.ts; axe-core's `failureSummary` for a rule it has no words for. Never empty. */
  fix: string;
  elements: RecordElement[];
  /** How many of the finding's elements are not listed: past the limit per finding, or cut to fit. */
  elementsCut?: number;
  /** `new` with no earlier scan to compare with; otherwise against it (src/compare.ts). */
  status: FindingStatus;
  /** On a `check`, a fixed finding: the scan it was first found gone in, and that scan's `--commit`. */
  fixedIn?: FixedIn;
  /** On a `check`, a finding still open: the baseline's elements that no longer fail. */
  fixedElements?: RecordElement[];
  /** On a `check`: a finding of the baseline on a page or state not scanned this time. It reads `still`. */
  unverified?: true;
}

export interface RecordNeedsReview extends Omit<NeedsReview, "elements"> {
  elements: (RecordElement & { reason: string })[];
  elementsCut?: number;
}

export interface RecordPage {
  key: string;
  /** The address the page ended on, after redirects; the address asked for when it was not scanned. */
  url: string;
  /** The address asked for. Added in 1.1, like `redirects` and `stopped`: a 1.0 record has none of them. */
  requestedUrl?: string;
  /** How many redirects were followed from `requestedUrl` to `url`. */
  redirects?: number;
  /** Every state the page was asked to scan, `default` first. A state in `notScanned` too was not scanned. */
  states: string[];
  notScanned: { state: string; reason: string }[];
  /** What the page tried that the scan stopped: dialogs, pop-ups and downloads (src/context.ts). */
  stopped?: Stopped[];
}

/** The limits the scan held the page to, as `scan.json` records them. */
export interface RecordLimits {
  pageSeconds: number;
  redirects: number;
  elementsPerFinding: number;
  excerptChars: number;
  scanJsonBytes: number;
}

export interface ScanRecord {
  schema: string;
  tool: { name: string; version: string };
  command: "scan" | "check";
  exit: 0 | 1;
  engine: { axeCore: string; browser: string; fallback: boolean; tags: string[] | null; rulesRun: number };
  target: { origin: string; commit: string | null };
  startedAt: string;
  finishedAt: string;
  pages: RecordPage[];
  summary: {
    critical: number;
    serious: number;
    moderate: number;
    minor: number;
    advice: number;
    needsReview: number;
    notScanned: number;
    /** On a `check`: how many findings are new, still open and fixed against the baseline. */
    new?: number;
    still?: number;
    fixed?: number;
    /**
     * On a plain `scan` with an earlier scan of the site: what is new and what is gone since it, or null when the
     * two are not comparable (`sincePreviousReason` says why). Absent when there is no earlier scan.
     */
    sincePrevious?: SincePrevious | null;
    sincePreviousReason?: string;
  };
  findings: RecordFinding[];
  needsReview: RecordNeedsReview[];
  ignored: unknown[];
  workflows: unknown[];
  checklist: null;
  cannotSee: string[];
  /** Added in 1.1: a 1.0 record has none. */
  limits?: RecordLimits;
  /** Added in 1.3: the flags that changed what the scan did or how it exited. A 1.2 record has none. */
  options?: RecordOptions;
  /** On a `check`: the baseline it was compared with, as `--baseline` named it, and when that scan began. */
  baseline?: {
    path: string;
    startedAt: string;
    commit: string | null;
    /** The states the baseline asked for and did not scan, by page: a finding found only there reads unverified. */
    notScanned?: { page: string; state: string }[];
  };
}

/** Plain `scan` against the site's previous scan: findings new since it, and findings of it not found now. */
export interface SincePrevious {
  new: number;
  fixed: number;
  /** When the previous scan began. */
  startedAt: string;
}

/** The flags that shape a scan, as `scan.json` records them. (`--tags` is `engine.tags`.) */
export interface RecordOptions {
  /** The lowest impact that makes the exit 1; `minor` unless `--fail-on` said otherwise. */
  failOn: Impact;
  /** `--same-origin` was given: requests to other origins were aborted. */
  sameOrigin: boolean;
  /** `--offline` was given: only loopback was allowed. */
  offline: boolean;
}

export interface RecordInput {
  tool: { name: string; version: string };
  browser: string;
  /** True when Chrome was missing and Playwright's Chromium ran in its place. */
  fallback: boolean;
  /** The address the page ended on. */
  url: string;
  /** The address asked for; `url` when not given. */
  requestedUrl?: string;
  redirects?: number;
  pageKey: string;
  startedAt: string;
  finishedAt: string;
  /** axe-core's results, or null when the page was not scanned. */
  axe: AxeScan | null;
  /** axe-core's version when `axe` is null; otherwise the one axe-core reported is used. */
  axeCore?: string;
  /** Why the page was not scanned. */
  notScanned?: string;
  stopped?: Stopped[];
  limits?: Limits;
  /** `--tags`: the axe-core tags that ran; null for axe-core's default rule set. */
  tags?: readonly string[] | null;
  failOn?: Impact;
  sameOrigin?: boolean;
  offline?: boolean;
}

/** One line: whitespace runs, newlines included, become a single space. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * axe-core's `failureSummary` on one line: "Fix any of the following:" then its messages, one per line,
 * which are joined with semicolons.
 */
export function failureOnOneLine(text: string): string {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const head = lines[0];
  if (head === undefined) return "";
  if (!head.endsWith(":")) return oneLine(text);
  return lines.length === 1 ? head : `${head} ${lines.slice(1).join("; ")}`;
}

/**
 * The fix for a finding whose rule src/plain.ts has no words for: axe-core's `failureSummary` for its first
 * element; where axe-core gave none, its `help`. Never empty, so no finding is without a fix.
 */
export function fixOf(finding: Finding): string {
  for (const element of finding.elements) {
    const failure = failureOnOneLine(element.failure);
    if (failure !== "") return failure;
  }
  const help = oneLine(finding.rule.help).replace(/\.+$/, "");
  const base = help === "" ? `Fix the problem that rule ${finding.rule.id} describes` : help;
  return finding.rule.helpUrl === "" ? `${base}.` : `${base}. See ${finding.rule.helpUrl}`;
}

/** The first `limit` characters of `text`, with `…` when there were more. */
export function cutText(text: string, limit: number): string {
  const chars = [...text];
  return chars.length <= limit ? text : `${chars.slice(0, limit).join("")}…`;
}

/** Elements kept to the limit per finding, each element's HTML cut to the excerpt limit. */
function keptElements<E extends FindingElement & { states?: string[] }>(
  elements: E[],
  limits: Limits,
): { elements: (E & RecordElement)[]; cut: number } {
  const kept = elements.slice(0, limits.elementsPerFinding).map((element) => ({
    ...element,
    html: cutText(element.html, limits.excerptChars),
    states: element.states ?? ["default"],
  }));
  return { elements: kept, cut: elements.length - kept.length };
}

function toRecordFinding(
  finding: Omit<Finding, "elements"> & { elements: (FindingElement & { states?: string[] })[] },
  limits: Limits,
): RecordFinding {
  const help = oneLine(finding.rule.help);
  const { elements, cut } = keptElements(finding.elements, limits);
  const words = wordingOf(finding.rule, finding.kind);
  return {
    id: finding.id,
    rule: finding.rule,
    kind: finding.kind,
    impact: finding.impact,
    page: finding.page,
    title: `${help === "" ? finding.rule.id : help} on ${finding.page}`,
    plain: words?.plain ?? (help === "" ? finding.rule.id : help),
    fix: words?.fix ?? fixOf(finding as Finding),
    elements,
    ...(cut > 0 ? { elementsCut: cut } : {}),
    status: "new",
  };
}

/** The origin of a URL, with no trailing slash. */
export function originOf(url: string): string {
  return new URL(url).origin;
}

/**
 * `scan.json` as it is written: two-space JSON and a newline. The page's text is kept exactly; the control
 * characters JSON.stringify leaves raw (DEL, C1, the bidirectional controls) are written as `\u` escapes,
 * so neither the file nor `--json` on a terminal carries one (src/printable.ts).
 */
export function scanJson(record: ScanRecord): string {
  return `${escapeJsonControls(JSON.stringify(record, null, 2))}\n`;
}

function bytesOf(record: ScanRecord): number {
  return Buffer.byteLength(scanJson(record), "utf8");
}

/** An element's bytes in `scan.json`, where it sits eight spaces in and is followed by a comma and newline. */
function elementBytes(element: unknown): number {
  const text = JSON.stringify(element, null, 2);
  return Buffer.byteLength(text, "utf8") + text.split("\n").length * 8 + 2;
}

/**
 * Holds `scan.json` under the size limit. Elements are dropped from the end, least severe first (the
 * needs-review items, then the findings from the last up), each kept to at least one element and every
 * dropped one counted in `elementsCut`. If even that is too big, the page reads *not scanned*.
 */
export function fitToSize(record: ScanRecord, maxBytes: number): ScanRecord {
  let size = bytesOf(record);
  if (size <= maxBytes) return record;
  const fitted = structuredClone(record);
  const items: { elements: unknown[]; elementsCut?: number }[] = [
    ...[...fitted.needsReview].reverse(),
    ...[...fitted.findings].reverse(),
  ];
  const dropOne = (item: (typeof items)[number]): number => {
    const bytes = elementBytes(item.elements.pop());
    // The `"elementsCut": n,` line is added the first time.
    const added = item.elementsCut === undefined ? 32 : 0;
    item.elementsCut = (item.elementsCut ?? 0) + 1;
    return bytes - added;
  };
  for (const item of items) {
    while (item.elements.length > 1 && size > maxBytes) size -= dropOne(item);
    if (size <= maxBytes) break;
  }
  // The running count is close, not exact: finish against the real size.
  for (const item of items) {
    while (item.elements.length > 1 && bytesOf(fitted) > maxBytes) dropOne(item);
  }
  if (bytesOf(fitted) <= maxBytes) return fitted;

  // Nothing of any page is left to show, so every page reads *not scanned*, not as having nothing found.
  for (const page of fitted.pages) {
    page.notScanned = [
      {
        state: "default",
        reason: `its results were larger than the ${maxBytes} byte limit on scan.json, even cut down`,
      },
    ];
  }
  fitted.findings = [];
  fitted.needsReview = [];
  fitted.engine.rulesRun = 0;
  fitted.summary = {
    ...fitted.summary,
    critical: 0,
    serious: 0,
    moderate: 0,
    minor: 0,
    advice: 0,
    needsReview: 0,
    notScanned: fitted.pages.length,
  };
  fitted.exit = 1;
  return fitted;
}

/** What one state of one page gave: axe-core's results, or why the state was not scanned. */
export interface StateResult {
  name: string;
  /** axe-core's results, or null when the state was not scanned. */
  axe: AxeScan | null;
  /** Why the state was not scanned. */
  notScanned?: string;
}

/** One page and every state asked of it, `default` first. */
export interface PageResult {
  key: string;
  /** Where the page ended, after redirects. */
  url: string;
  /** The address asked for; `url` when not given. */
  requestedUrl?: string;
  redirects?: number;
  stopped?: Stopped[];
  states: StateResult[];
}

export interface PagesInput {
  tool: { name: string; version: string };
  browser: string;
  fallback: boolean;
  startedAt: string;
  finishedAt: string;
  /** axe-core's version when no state of any page was scanned. */
  axeCore?: string;
  pages: PageResult[];
  limits?: Limits;
  /** `--tags`: the axe-core tags that ran; null for axe-core's default rule set. */
  tags?: readonly string[] | null;
  failOn?: Impact;
  sameOrigin?: boolean;
  offline?: boolean;
}

/**
 * The record of a whole run: every page, each in every state asked of it. A page's states are merged into
 * one finding per rule (src/merge-states.ts), so a finding is one rule on one page and each element says
 * which states it was found in.
 */
export function buildPagesRecord(input: PagesInput): ScanRecord {
  const limits = input.limits ?? LIMITS;
  const firstPage = input.pages[0];
  if (firstPage === undefined) throw new Error("a scan needs at least one page");

  const findings: RecordFinding[] = [];
  const needsReview: RecordNeedsReview[] = [];
  const pages: RecordPage[] = [];
  let axeCore = input.axeCore ?? "";
  let rulesRun = 0;
  for (const page of input.pages) {
    const scanned = page.states.flatMap((state) =>
      state.axe === null ? [] : [{ state: state.name, axe: state.axe }],
    );
    for (const { axe } of scanned) {
      if (axeCore === "" || axeCore === input.axeCore) axeCore = axe.axeCore;
      rulesRun = Math.max(rulesRun, axe.rulesRun);
    }
    const asked = page.states.map((state) => state.name);
    findings.push(
      ...mergeStates(
        scanned.map(({ state, axe }) => ({ state, items: axe.findings })),
        asked,
      ).map((finding) => toRecordFinding(finding, limits)),
    );
    needsReview.push(
      ...mergeStates(
        scanned.map(({ state, axe }) => ({ state, items: axe.needsReview })),
        asked,
      ).map((item) => {
        const { elements, cut } = keptElements(item.elements, limits);
        return { ...item, elements, ...(cut > 0 ? { elementsCut: cut } : {}) };
      }),
    );
    const requestedUrl = page.requestedUrl ?? page.url;
    pages.push({
      key: page.key,
      url: page.url,
      requestedUrl,
      redirects: page.redirects ?? 0,
      states: page.states.map((state) => state.name),
      notScanned: page.states.flatMap((state) =>
        state.notScanned === undefined ? [] : [{ state: state.name, reason: state.notScanned }],
      ),
      stopped: page.stopped ?? [],
    });
  }
  const pageOrder = pages.map((page) => page.key);
  const ordered = orderFindings(findings, pageOrder);
  const orderedReview = orderFindings(needsReview, pageOrder);
  const notScanned = pages.reduce((count, page) => count + page.notScanned.length, 0);
  const violations = ordered.filter((f) => f.kind === "violation");
  const failOn = input.failOn ?? DEFAULT_FAIL_ON;
  const count = (impact: Impact): number => violations.filter((f) => f.impact === impact).length;
  const [critical, serious, moderate, minor] = IMPACTS.map(count) as [number, number, number, number];
  const record: ScanRecord = {
    schema: SCHEMA_VERSION,
    tool: input.tool,
    command: "scan",
    // Advice and needs-review items never change the exit; a violation does at or above `--fail-on`.
    exit: violations.some((f) => atOrAbove(f.impact, failOn)) || notScanned > 0 ? 1 : 0,
    engine: {
      axeCore,
      browser: input.browser,
      fallback: input.fallback,
      tags: input.tags === undefined || input.tags === null ? null : [...input.tags],
      rulesRun,
    },
    // The target is the origin asked for, so a scan that is redirected elsewhere is filed under it.
    target: { origin: originOf(firstPage.requestedUrl ?? firstPage.url), commit: null },
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    pages,
    summary: {
      critical,
      serious,
      moderate,
      minor,
      advice: ordered.filter((f) => f.kind === "advice").length,
      needsReview: orderedReview.length,
      notScanned,
    },
    findings: ordered,
    needsReview: orderedReview,
    ignored: [],
    workflows: [],
    checklist: null,
    cannotSee: [...CANNOT_SEE],
    limits: {
      pageSeconds: limits.pageMs / 1000,
      redirects: limits.redirects,
      elementsPerFinding: limits.elementsPerFinding,
      excerptChars: limits.excerptChars,
      scanJsonBytes: limits.scanJsonBytes,
    },
    options: { failOn, sameOrigin: input.sameOrigin ?? false, offline: input.offline ?? false },
  };
  return fitToSize(record, limits.scanJsonBytes);
}

/** The record of one page in one state, `default`: what a scan of a single address gives. */
export function buildScanRecord(input: RecordInput): ScanRecord {
  return buildPagesRecord({
    tool: input.tool,
    browser: input.browser,
    fallback: input.fallback,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    ...(input.axeCore === undefined ? {} : { axeCore: input.axeCore }),
    ...(input.limits === undefined ? {} : { limits: input.limits }),
    ...(input.tags === undefined ? {} : { tags: input.tags }),
    ...(input.failOn === undefined ? {} : { failOn: input.failOn }),
    ...(input.sameOrigin === undefined ? {} : { sameOrigin: input.sameOrigin }),
    ...(input.offline === undefined ? {} : { offline: input.offline }),
    pages: [
      {
        key: input.pageKey,
        url: input.url,
        ...(input.requestedUrl === undefined ? {} : { requestedUrl: input.requestedUrl }),
        ...(input.redirects === undefined ? {} : { redirects: input.redirects }),
        ...(input.stopped === undefined ? {} : { stopped: input.stopped }),
        states: [
          {
            name: "default",
            axe: input.axe,
            ...(input.notScanned === undefined ? {} : { notScanned: input.notScanned }),
          },
        ],
      },
    ],
  });
}
