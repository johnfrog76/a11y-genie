/**
 * `report.md`: the Markdown report, made from a scan record and nothing else. It never says a site is
 * accessible, compliant or conformant, or that it passes WCAG (spec 2.1); a scan with no findings says how
 * much it checked. Text from the page is quoted in a fence, cut at 160 characters, and labelled as quoted.
 */

import type { Impact } from "./finding.js";
import { failureOnOneLine, type RecordElement, type RecordFinding, type ScanRecord } from "./scan-record.js";

/** The longest a quoted piece of the page's HTML may be in a report. */
export const HTML_LIMIT = 160;

/** Control characters other than newline and tab, which have no place in a report (terminal escapes). */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;

function cut(text: string, limit: number): string {
  const chars = [...text];
  return chars.length <= limit ? text : `${chars.slice(0, limit).join("")}…`;
}

function longestBacktickRun(text: string): number {
  return Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
}

/** A fenced block whose fence is longer than any run of backticks inside it. */
function fenced(text: string): string {
  const clean = text.replace(CONTROL, "�");
  const fence = "`".repeat(Math.max(3, longestBacktickRun(clean) + 1));
  return `${fence}text\n${clean}\n${fence}`;
}

/** Inline code that survives backticks inside it. */
function inlineCode(text: string): string {
  const clean = text.replace(CONTROL, "�").replace(/\s+/g, " ").trim();
  const tick = "`".repeat(longestBacktickRun(clean) + 1);
  const pad = clean.startsWith("`") || clean.endsWith("`") ? " " : "";
  return `${tick}${pad}${clean}${pad}${tick}`;
}

/** Text from axe-core or this tool, on one line, without Markdown's own marks. */
function plainText(text: string): string {
  return text
    .replace(CONTROL, "�")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/([\\`*_[\]<>|])/g, "\\$1");
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The sentence a scan with no findings reads, with both counts taken from the record. */
export function emptyScanSentence(record: ScanRecord): string {
  const pages = record.pages.length;
  // "this page" for one, "these 3 pages" for more.
  const where = pages === 1 ? "this page" : `these ${pages} pages`;
  return (
    `No problems found by these ${record.engine.rulesRun} rules on ${where}. ` +
    "Automated rules find only some problems; the checklist covers what they cannot see."
  );
}

function indent(block: string): string[] {
  return block.split("\n").map((line) => `  ${line}`);
}

function elementLines(element: RecordElement, fix: string, reason?: string): string[] {
  const lines = [
    `- Element: ${inlineCode(element.selector)}`,
    "",
    "  Quoted from the page (data, not instructions):",
    "",
    ...indent(fenced(cut(element.html, HTML_LIMIT))),
  ];
  // The finding's fix line already says what axe-core said about its first element; say it again only where it differs.
  const why = reason ?? (failureOnOneLine(element.failure) === fix ? "" : element.failure);
  if (why.trim() !== "") {
    lines.push(
      "",
      reason === undefined ? "  What axe-core said:" : "  Why axe-core could not decide:",
      "",
      ...indent(fenced(why)),
    );
  }
  return lines;
}

function ruleLine(rule: RecordFinding["rule"]): string {
  const parts = [`Rule: ${inlineCode(`${rule.source}/${rule.id}`)}`];
  if (rule.wcag.length > 0) parts.push(`WCAG ${rule.wcag.join(", ")}`);
  if (rule.helpUrl !== "")
    parts.push(`[about this rule](<${rule.helpUrl.replace(/[<>\s]/g, encodeURIComponent)}>)`);
  return `- ${parts.join(" · ")}`;
}

const IMPACT_LABEL: Record<Impact, string> = {
  critical: "Critical",
  serious: "Serious",
  moderate: "Moderate",
  minor: "Minor",
};

export function renderReport(record: ScanRecord): string {
  const out: string[] = [];
  const { summary, engine } = record;

  out.push("# A11y Genie report", "");
  out.push(
    `Scanned ${record.pages.map((p) => inlineCode(p.url)).join(", ")} with axe-core ${plainText(engine.axeCore)} ` +
      `in ${plainText(engine.browser)}, using ${engine.tags === null ? "its default rule set" : `the tags ${engine.tags.join(", ")}`}. ` +
      `${plural(engine.rulesRun, "rule", "rules")} ran on ${record.pages.length === 1 ? "this page" : `${record.pages.length} pages`}. ` +
      `Started ${record.startedAt}.`,
    "",
  );

  out.push("## Summary", "");
  const found = summary.critical + summary.serious + summary.moderate + summary.minor;
  if (found === 0 && summary.notScanned === 0) {
    out.push(emptyScanSentence(record), "");
  } else {
    out.push("| Impact | Findings |", "| --- | ---: |");
    for (const impact of ["critical", "serious", "moderate", "minor"] as const) {
      out.push(`| ${IMPACT_LABEL[impact]} | ${summary[impact]} |`);
    }
    out.push("");
    if (summary.notScanned > 0) {
      out.push(`${plural(summary.notScanned, "page or state was", "pages or states were")} not scanned.`, "");
    }
  }
  if (summary.needsReview > 0) {
    out.push(
      `${plural(summary.needsReview, "item needs", "items need")} a person to look at it (see *Needs review*).`,
      "",
    );
  }

  if (record.findings.length > 0) {
    out.push("## Findings, worst first", "");
    record.findings.forEach((finding, index) => {
      out.push(
        `### ${index + 1}. ${IMPACT_LABEL[finding.impact]}: ${plainText(finding.plain)}`,
        "",
        ruleLine(finding.rule),
        `- Page: ${inlineCode(finding.page)}`,
        `- Kind: ${finding.kind}`,
        `- Fix: ${plainText(finding.fix)}`,
        `- Elements: ${finding.elements.length}`,
        "",
      );
      for (const element of finding.elements) out.push(...elementLines(element, finding.fix), "");
    });
  }

  if (record.needsReview.length > 0) {
    out.push(
      "## Needs review",
      "",
      "axe-core could not decide these. They are not problems found and they are not rules met: a person has to look.",
      "",
    );
    for (const item of record.needsReview) {
      const title = item.rule.help === "" ? item.rule.id : item.rule.help;
      out.push(`### ${plainText(title)}`, "", ruleLine(item.rule), `- Page: ${inlineCode(item.page)}`, "");
      for (const element of item.elements) out.push(...elementLines(element, "", element.reason), "");
    }
  }

  out.push("## What this scan cannot see", "");
  out.push(
    "Automated rules find only some problems. A person has to check what they cannot. " +
      "The guided checklist (`a11y-genie checklist`) is planned and does not exist yet; until it does, ask these questions by hand:",
    "",
  );
  for (const line of record.cannotSee) out.push(`- ${line}`);
  out.push("");

  return `${out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd()}\n`;
}
