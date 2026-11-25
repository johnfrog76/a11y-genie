/**
 * Turns axe-core's results into findings and *needs review* items (src/finding.ts). It runs no browser,
 * so it can be tested on recorded results.
 *
 * axe-core's results come out of the page through `page.evaluate`, and the page can tamper with them.
 * So they arrive here as `unknown` and every value is read as typed data: a value of the wrong type is
 * dropped, never trusted. The fields read, and their shape at the pinned axe-core, are in docs/JSON.md.
 */

import {
  IMPACTS,
  type ColorPair,
  type AxeScan,
  type AxeTarget,
  type Finding,
  type Impact,
  type NeedsReview,
  type NeedsReviewElement,
  type Rule,
} from "./finding.js";
import { createRequire } from "node:module";
import { orderFindings } from "./order.js";

/**
 * The WCAG success criteria named in axe-core's tags. A criterion tag is `wcag` and the criterion's
 * digits: `wcag143` is `1.4.3`, `wcag1410` is `1.4.10`. Level tags (`wcag2a`, `wcag21aa`) are not
 * criteria and are left out. Principles and guidelines are one digit each, so the rest is the criterion.
 */
export function wcagCriteria(tags: readonly string[]): string[] {
  const criteria: string[] = [];
  for (const tag of tags) {
    const match = /^wcag(\d)(\d)(\d{1,2})$/.exec(tag);
    if (!match) continue;
    const criterion = `${match[1]}.${match[2]}.${match[3]}`;
    if (!criteria.includes(criterion)) criteria.push(criterion);
  }
  return criteria;
}

/** `target` as one string: a lone selector as it is, parts joined with ` >>> `. */
export function selectorOf(target: AxeTarget): string {
  return target.flat().join(" >>> ");
}

/**
 * A page's key from its URL (D6: a page is a URL). The path without its slashes: `/settings` is
 * `settings`, `/` is `home`. A config file can name the key instead, later.
 */
export function pageKeyOf(url: string): string {
  const path = new URL(url).pathname.replace(/^\/+|\/+$/g, "");
  return path === "" ? "home" : path;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function impactOf(value: unknown): Impact | undefined {
  return (IMPACTS as readonly unknown[]).includes(value) ? (value as Impact) : undefined;
}

function worst(impacts: (Impact | undefined)[]): Impact | undefined {
  let best: number | undefined;
  for (const impact of impacts) {
    if (impact === undefined) continue;
    const rank = IMPACTS.indexOf(impact);
    if (best === undefined || rank < best) best = rank;
  }
  return best === undefined ? undefined : IMPACTS[best];
}

/** A target with every part a non-empty string, or undefined. */
function targetOf(value: unknown): AxeTarget | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const target: AxeTarget = [];
  for (const part of value) {
    if (typeof part === "string" && part !== "") target.push(part);
    else if (Array.isArray(part) && part.length > 0 && part.every((p) => typeof p === "string" && p !== ""))
      target.push([...(part as string[])]);
    else return undefined;
  }
  return target;
}

/** The messages of a node's checks, which say why it failed or why axe-core could not decide. */
function checkMessages(node: Record<string, unknown>): string {
  const messages: string[] = [];
  for (const group of ["any", "all", "none"] as const) {
    for (const check of list(node[group])) {
      const message = isRecord(check) ? str(check.message) : "";
      if (message !== "" && !messages.includes(message)) messages.push(message);
    }
  }
  return messages.join(" ");
}

/** The rules whose checks carry the colours (spec 4.5: `colorPair` is on these only). */
const COLOR_RULES: readonly string[] = ["color-contrast", "color-contrast-enhanced"];

/** `4.5` from axe-core's `"4.5:1"` (or from a number); undefined for anything else. */
export function requiredRatioOf(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : undefined;
  if (typeof value !== "string") return undefined;
  const match = /^\s*(\d+(?:\.\d+)?)\s*:\s*1\s*$/.exec(value);
  const ratio = match?.[1] === undefined ? undefined : Number(match[1]);
  return ratio !== undefined && ratio > 0 ? ratio : undefined;
}

/**
 * The colour pair from a node's `any` check named after the rule, or undefined when axe-core did not
 * measure one: no colours, a ratio of 0 (what it reports when it could not decide), or a required ratio
 * that cannot be read. A pair is never guessed.
 */
export function colorPairOf(node: Record<string, unknown>, ruleId: string): ColorPair | undefined {
  if (!COLOR_RULES.includes(ruleId)) return undefined;
  for (const check of list(node.any)) {
    if (!isRecord(check) || check.id !== ruleId || !isRecord(check.data)) continue;
    const data = check.data;
    const foreground = str(data.fgColor);
    const background = str(data.bgColor);
    const ratio = data.contrastRatio;
    const required = requiredRatioOf(data.expectedContrastRatio);
    if (foreground === "" || background === "" || required === undefined) continue;
    if (typeof ratio !== "number" || !Number.isFinite(ratio) || ratio <= 0) continue;
    return {
      foreground,
      background,
      ratio,
      required,
      fontSize: str(data.fontSize),
      fontWeight: str(data.fontWeight),
    };
  }
  return undefined;
}

interface Mapped {
  rule: Rule;
  impact: Impact;
  elements: NeedsReviewElement[];
}

/**
 * One axe-core result (a rule and its nodes) as a rule, an impact and elements. Undefined when it has no
 * rule id, or no element that can be pointed at: nothing is reported without a rule and a place.
 */
function mapResult(result: unknown, withPair: boolean): Mapped | undefined {
  if (!isRecord(result)) return undefined;
  const id = str(result.id).trim();
  if (id === "") return undefined;

  const elements: NeedsReviewElement[] = [];
  const nodeImpacts: (Impact | undefined)[] = [];
  for (const node of list(result.nodes)) {
    if (!isRecord(node)) continue;
    const target = targetOf(node.target);
    if (target === undefined) continue;
    nodeImpacts.push(impactOf(node.impact));
    const colorPair = withPair ? colorPairOf(node, id) : undefined;
    elements.push({
      selector: selectorOf(target),
      target,
      html: str(node.html),
      failure: str(node.failureSummary),
      reason: checkMessages(node),
      ...(colorPair === undefined ? {} : { colorPair }),
    });
  }
  if (elements.length === 0) return undefined;

  // axe-core sets a result's impact to its worst node's. Where it gave none, the nodes' worst is used;
  // where nothing gave one, it is ranked last rather than guessed higher.
  const impact = impactOf(result.impact) ?? worst(nodeImpacts) ?? "minor";
  const tags = list(result.tags).filter((t): t is string => typeof t === "string");
  return {
    rule: {
      source: "axe",
      id,
      help: str(result.help),
      helpUrl: axeHelpUrl(id),
      wcag: wcagCriteria(tags),
    },
    impact,
    elements,
  };
}

/** axe-core at the version installed: its rules' ids, and its version as `major.minor`. Read once. */
let installedAxe: { ids: Set<string>; version: string } | undefined;
function axeRules(): { ids: Set<string>; version: string } {
  if (installedAxe === undefined) {
    const axe = createRequire(import.meta.url)("axe-core") as {
      version: string;
      getRules(): { ruleId: string }[];
    };
    installedAxe = {
      ids: new Set(axe.getRules().map((rule) => rule.ruleId)),
      version: axe.version.split(".").slice(0, 2).join("."),
    };
  }
  return installedAxe;
}

/**
 * The address of the page about an axe-core rule, built from the rule's id and the installed axe-core's version,
 * in the form axe-core itself gives under @axe-core/playwright, or an empty string for an id the installed axe-core
 * does not have. The `helpUrl` in a result is never used: axe-core runs in the page's own world, and a page can
 * hand back results of its own making (docs/ARCHITECTURE.md, *Hostile pages*), so an address it gave could send a
 * reader of the report anywhere.
 */
export function axeHelpUrl(ruleId: string): string {
  const axe = axeRules();
  if (!axe.ids.has(ruleId)) return "";
  return `https://dequeuniversity.com/rules/axe/${axe.version}/${encodeURIComponent(ruleId)}?application=playwright`;
}

function findingId(rule: Rule, page: string): string {
  return `${rule.source}/${rule.id}@${page}`;
}

/** Counts the distinct rule ids across every list axe-core returns. */
function countRules(results: Record<string, unknown>): number {
  const ids = new Set<string>();
  for (const group of ["violations", "passes", "incomplete", "inapplicable"] as const) {
    for (const result of list(results[group])) {
      const id = isRecord(result) ? str(result.id) : "";
      if (id !== "") ids.add(id);
    }
  }
  return ids.size;
}

/**
 * Maps one axe-core run on one page: each violation to a finding, each `incomplete` result to a
 * *needs review* item. Both lists come back worst first. `passes` are counted, never reported as such.
 */
export function mapAxeResults(raw: unknown, page: string): AxeScan {
  const results = isRecord(raw) ? raw : {};
  const engine = isRecord(results.testEngine) ? results.testEngine : {};

  const findings: Finding[] = [];
  for (const result of list(results.violations)) {
    const mapped = mapResult(result, true);
    if (mapped === undefined) continue;
    findings.push({
      id: findingId(mapped.rule, page),
      rule: mapped.rule,
      kind: "violation",
      impact: mapped.impact,
      page,
      elements: mapped.elements.map(({ selector, target, html, failure, colorPair }) => ({
        selector,
        target,
        html,
        failure,
        ...(colorPair === undefined ? {} : { colorPair }),
      })),
    });
  }

  const needsReview: NeedsReview[] = [];
  for (const result of list(results.incomplete)) {
    const mapped = mapResult(result, false);
    if (mapped === undefined) continue;
    needsReview.push({ id: findingId(mapped.rule, page), ...mapped, page });
  }

  return {
    axeCore: str(engine.version),
    rulesRun: countRules(results),
    findings: orderFindings(findings),
    needsReview: orderFindings(needsReview),
  };
}
