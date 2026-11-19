/**
 * `scan.json`: the record every report is made from, and what `--json` prints. The shape is the spec's
 * (4.5) and is versioned: `schema` is `"<major>.<minor>"`. docs/JSON.md documents each field and
 * `schema/scan-1.json` is its JSON Schema.
 */

import type { AxeScan, Finding, FindingElement, Impact, NeedsReview, Rule } from "./finding.js";
import { IMPACTS } from "./finding.js";
import { LIMITS, type Limits, type Stopped } from "./context.js";
import { escapeJsonControls } from "./printable.js";

/**
 * 1.1 added `pages[].requestedUrl`, `redirects` and `stopped`, `limits`, and `elementsCut` on findings.
 * 1.2 added `colorPair` on a `color-contrast` element.
 */
export const SCHEMA_VERSION = "1.2";

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
  /** The states of the page the element was found in. Always `["default"]` until states arrive. */
  states: string[];
}

export interface RecordFinding {
  id: string;
  rule: Rule;
  kind: Finding["kind"];
  impact: Impact;
  page: string;
  title: string;
  /** Until plain-language fixes are written, axe-core's `help`. */
  plain: string;
  /** Until plain-language fixes are written, axe-core's `failureSummary`. Never empty. */
  fix: string;
  elements: RecordElement[];
  /** How many of the finding's elements are not listed: past the limit per finding, or cut to fit. */
  elementsCut?: number;
  /** Always `new` until a scan is compared with the one before it. */
  status: "new";
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
  command: "scan";
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
  };
  findings: RecordFinding[];
  needsReview: RecordNeedsReview[];
  ignored: unknown[];
  workflows: unknown[];
  checklist: null;
  cannotSee: string[];
  /** Added in 1.1: a 1.0 record has none. */
  limits?: RecordLimits;
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
 * The fix for a finding, from axe-core's `failureSummary` for its first element; where axe-core gave
 * none, from its `help`. Never empty, so no finding is without a fix.
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
function keptElements<E extends FindingElement>(
  elements: E[],
  limits: Limits,
): { elements: (E & RecordElement)[]; cut: number } {
  const kept = elements.slice(0, limits.elementsPerFinding).map((element) => ({
    ...element,
    html: cutText(element.html, limits.excerptChars),
    states: ["default"],
  }));
  return { elements: kept, cut: elements.length - kept.length };
}

function toRecordFinding(finding: Finding, limits: Limits): RecordFinding {
  const help = oneLine(finding.rule.help);
  const { elements, cut } = keptElements(finding.elements, limits);
  return {
    id: finding.id,
    rule: finding.rule,
    kind: finding.kind,
    impact: finding.impact,
    page: finding.page,
    title: `${help === "" ? finding.rule.id : help} on ${finding.page}`,
    plain: help === "" ? finding.rule.id : help,
    fix: fixOf(finding),
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

  const page = fitted.pages[0];
  if (page !== undefined) {
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
    notScanned: 1,
  };
  fitted.exit = 1;
  return fitted;
}

export function buildScanRecord(input: RecordInput): ScanRecord {
  const limits = input.limits ?? LIMITS;
  const axe = input.axe;
  const findings = (axe?.findings ?? []).map((finding) => toRecordFinding(finding, limits));
  const needsReview: RecordNeedsReview[] = (axe?.needsReview ?? []).map((item) => {
    const { elements, cut } = keptElements(item.elements, limits);
    return { ...item, elements, ...(cut > 0 ? { elementsCut: cut } : {}) };
  });
  const notScanned = input.notScanned === undefined ? [] : [{ state: "default", reason: input.notScanned }];
  const requestedUrl = input.requestedUrl ?? input.url;
  const violations = findings.filter((f) => f.kind === "violation");
  const count = (impact: Impact): number => violations.filter((f) => f.impact === impact).length;
  const [critical, serious, moderate, minor] = IMPACTS.map(count) as [number, number, number, number];
  const record: ScanRecord = {
    schema: SCHEMA_VERSION,
    tool: input.tool,
    command: "scan",
    exit: violations.length > 0 || notScanned.length > 0 ? 1 : 0,
    engine: {
      axeCore: axe?.axeCore ?? input.axeCore ?? "",
      browser: input.browser,
      fallback: input.fallback,
      tags: null,
      rulesRun: axe?.rulesRun ?? 0,
    },
    // The target is the origin asked for, so a scan that is redirected elsewhere is filed under it.
    target: { origin: originOf(requestedUrl), commit: null },
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    pages: [
      {
        key: input.pageKey,
        url: input.url,
        requestedUrl,
        redirects: input.redirects ?? 0,
        states: ["default"],
        notScanned,
        stopped: input.stopped ?? [],
      },
    ],
    summary: {
      critical,
      serious,
      moderate,
      minor,
      advice: findings.filter((f) => f.kind === "advice").length,
      needsReview: needsReview.length,
      notScanned: notScanned.length,
    },
    findings,
    needsReview,
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
  };
  return fitToSize(record, limits.scanJsonBytes);
}
