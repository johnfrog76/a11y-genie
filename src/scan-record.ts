/**
 * `scan.json`: the record every report is made from, and what `--json` prints. The shape is the spec's
 * (4.5) and is versioned: `schema` is `"<major>.<minor>"`. docs/JSON.md documents each field and
 * `schema/scan-1.json` is its JSON Schema.
 */

import type { AxeScan, Finding, FindingElement, Impact, NeedsReview, Rule } from "./finding.js";
import { IMPACTS } from "./finding.js";

export const SCHEMA_VERSION = "1.0";

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
  /** Always `new` until a scan is compared with the one before it. */
  status: "new";
}

export interface RecordNeedsReview extends Omit<NeedsReview, "elements"> {
  elements: (RecordElement & { reason: string })[];
}

export interface RecordPage {
  key: string;
  url: string;
  states: string[];
  notScanned: { state: string; reason: string }[];
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
}

export interface RecordInput {
  tool: { name: string; version: string };
  browser: string;
  /** True when Chrome was missing and Playwright's Chromium ran in its place. */
  fallback: boolean;
  url: string;
  pageKey: string;
  startedAt: string;
  finishedAt: string;
  axe: AxeScan;
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

function toRecordFinding(finding: Finding): RecordFinding {
  const help = oneLine(finding.rule.help);
  return {
    id: finding.id,
    rule: finding.rule,
    kind: finding.kind,
    impact: finding.impact,
    page: finding.page,
    title: `${help === "" ? finding.rule.id : help} on ${finding.page}`,
    plain: help === "" ? finding.rule.id : help,
    fix: fixOf(finding),
    elements: finding.elements.map((element) => ({ ...element, states: ["default"] })),
    status: "new",
  };
}

/** The origin of a URL, with no trailing slash. */
export function originOf(url: string): string {
  return new URL(url).origin;
}

export function buildScanRecord(input: RecordInput): ScanRecord {
  const findings = input.axe.findings.map(toRecordFinding);
  const needsReview: RecordNeedsReview[] = input.axe.needsReview.map((item) => ({
    ...item,
    elements: item.elements.map((element) => ({ ...element, states: ["default"] })),
  }));
  const violations = findings.filter((f) => f.kind === "violation");
  const count = (impact: Impact): number => violations.filter((f) => f.impact === impact).length;
  const [critical, serious, moderate, minor] = IMPACTS.map(count) as [number, number, number, number];
  return {
    schema: SCHEMA_VERSION,
    tool: input.tool,
    command: "scan",
    exit: violations.length > 0 ? 1 : 0,
    engine: {
      axeCore: input.axe.axeCore,
      browser: input.browser,
      fallback: input.fallback,
      tags: null,
      rulesRun: input.axe.rulesRun,
    },
    target: { origin: originOf(input.url), commit: null },
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    pages: [{ key: input.pageKey, url: input.url, states: ["default"], notScanned: [] }],
    summary: {
      critical,
      serious,
      moderate,
      minor,
      advice: findings.filter((f) => f.kind === "advice").length,
      needsReview: needsReview.length,
      notScanned: 0,
    },
    findings,
    needsReview,
    ignored: [],
    workflows: [],
    checklist: null,
    cannotSee: [...CANNOT_SEE],
  };
}
