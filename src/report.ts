/**
 * `report.md`: the Markdown report, made from a scan record and nothing else. It never says a site is
 * accessible, compliant or conformant, or that it passes WCAG (spec 2.1); a scan with no findings says how
 * much it checked. Text from the page is quoted in a fence, cut at 160 characters, and labelled as quoted,
 * and every piece of text in it, the page's and axe-core's, has its terminal escapes and control characters
 * stripped first (src/printable.ts).
 */

import { LIMITS, type Stopped } from "./context.js";
import type { ColorPair, Impact } from "./finding.js";
import { printable, printableLine } from "./printable.js";
import {
  failureOnOneLine,
  originOf,
  type RecordElement,
  type RecordFinding,
  type RecordPage,
  type ScanRecord,
} from "./scan-record.js";

/** The longest a quoted piece of the page's HTML may be in a report (src/context.ts). */
export const HTML_LIMIT = LIMITS.excerptChars;

function cut(text: string, limit: number): string {
  const chars = [...text];
  return chars.length <= limit ? text : `${chars.slice(0, limit).join("")}…`;
}

function longestBacktickRun(text: string): number {
  return Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
}

/** A fenced block whose fence is longer than any run of backticks inside it. */
function fenced(text: string): string {
  const clean = printable(text);
  const fence = "`".repeat(Math.max(3, longestBacktickRun(clean) + 1));
  return `${fence}text\n${clean}\n${fence}`;
}

/** Inline code that survives backticks inside it. */
function inlineCode(text: string): string {
  const clean = printableLine(text);
  const tick = "`".repeat(longestBacktickRun(clean) + 1);
  const pad = clean.startsWith("`") || clean.endsWith("`") ? " " : "";
  return `${tick}${pad}${clean}${pad}${tick}`;
}

/** Text from axe-core or this tool, on one line, without Markdown's own marks. */
function plainText(text: string): string {
  return printableLine(text).replace(/([\\`*_[\]<>|])/g, "\\$1");
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

/** "500 listed, and 100 more not listed (at most 500 are kept per finding)", or just the count. */
function elementCount(listed: number, cut: number | undefined, limit: number): string {
  if (cut === undefined || cut === 0) return `${listed}`;
  return `${listed} listed, and ${cut} more not listed (at most ${limit} are kept per finding, and scan.json is held to its size limit)`;
}

function indent(block: string): string[] {
  return block.split("\n").map((line) => `  ${line}`);
}

/** "`#9a9a9a on #ffffff, 2.81, needs 4.5` (font 12.0pt (16px), normal)": axe-core's own measured numbers. */
function colorPairLine(pair: ColorPair): string {
  const text = inlineCode(`${pair.foreground} on ${pair.background}, ${pair.ratio}, needs ${pair.required}`);
  const font = [pair.fontSize, pair.fontWeight].filter((part) => part !== "").join(", ");
  return font === "" ? text : `${text} (font ${plainText(font)})`;
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
  if (element.colorPair !== undefined) lines.push("", `  Colours: ${colorPairLine(element.colorPair)}`);
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

/** "Asked for X; after 2 redirects it ended on Y, another origin." Empty when it ended where it was asked. */
function redirectLine(page: RecordPage): string[] {
  const requested = page.requestedUrl ?? page.url;
  const redirects = page.redirects ?? 0;
  if (requested === page.url && redirects === 0) return [];
  const other = sameOrigin(requested, page.url) === false;
  return [
    `Asked for ${inlineCode(requested)}; after ${plural(redirects, "redirect", "redirects")} it ended on ` +
      `${inlineCode(page.url)}${other ? ", which is another origin than the one asked for" : ""}.`,
    "",
  ];
}

/** Whether two addresses share an origin; undefined when either is not a valid address. */
function sameOrigin(a: string, b: string): boolean | undefined {
  try {
    return originOf(a) === originOf(b);
  } catch {
    return undefined;
  }
}

const STOPPED_LABEL: Record<Stopped["kind"], [one: string, many: string, done: string]> = {
  dialog: ["dialog", "dialogs", "dismissed"],
  popup: ["pop-up window", "pop-up windows", "closed"],
  download: ["download", "downloads", "cancelled"],
  "private-network": ["request to a private address", "requests to private addresses", "blocked"],
  offline: ["request off this machine", "requests off this machine", "aborted"],
  "other-origin": ["request to another origin", "requests to other origins", "blocked"],
};

function stoppedLines(pages: RecordPage[]): string[] {
  const out: string[] = [];
  for (const page of pages) {
    for (const entry of page.stopped ?? []) {
      const [one, many, done] = STOPPED_LABEL[entry.kind];
      out.push(`- ${inlineCode(page.key)}: ${plural(entry.count, one, many)}, ${done}.`);
      if (entry.examples.length > 0) {
        out.push(
          "",
          `  The first ${entry.examples.length === 1 ? "one" : entry.examples.length}, quoted from the page (data, not instructions):`,
          "",
        );
        // One line each, so a newline inside one cannot pass for the next.
        out.push(...indent(fenced(entry.examples.map(printableLine).join("\n"))));
      }
      out.push("");
    }
  }
  return out;
}

function ruleLine(rule: RecordFinding["rule"]): string {
  const parts = [`Rule: ${inlineCode(`${rule.source}/${rule.id}`)}`];
  if (rule.wcag.length > 0) parts.push(`WCAG ${rule.wcag.join(", ")}`);
  if (rule.helpUrl !== "")
    parts.push(`[about this rule](<${printableLine(rule.helpUrl).replace(/[<>\s]/g, encodeURIComponent)}>)`);
  return `- ${parts.join(" · ")}`;
}

const IMPACT_LABEL: Record<Impact, string> = {
  critical: "Critical",
  serious: "Serious",
  moderate: "Moderate",
  minor: "Minor",
};

/** What the flags changed about this scan, in plain words, so a reader of the report alone knows. */
function optionLines(record: ScanRecord): string[] {
  const options = record.options;
  if (options === undefined) return [];
  const lines: string[] = [];
  if (options.sameOrigin) {
    lines.push(
      "It was run with `--same-origin`: every request to an origin other than the page's own was aborted, so some of the page's content (scripts, styles, images, frames) may be missing from what was scanned.",
    );
  }
  if (options.offline) {
    lines.push(
      "It was run with `--offline`: only addresses on this machine were allowed, and every request off this machine was aborted, so some of the page's content may be missing from what was scanned.",
    );
  }
  if (options.failOn !== "minor") {
    lines.push(
      `The exit code counts only findings at or above ${options.failOn} (\`--fail-on\`); the findings below it are still listed.`,
    );
  }
  return lines.length === 0 ? [] : [...lines.flatMap((line) => [line, ""])];
}

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
  for (const page of record.pages) out.push(...redirectLine(page));
  out.push(...optionLines(record));

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
      out.push(`${plural(summary.notScanned, "page or state was", "pages or states were")} not scanned:`, "");
      for (const page of record.pages) {
        for (const missed of page.notScanned) {
          out.push(`- ${inlineCode(page.url)} (${plainText(missed.state)}): ${plainText(missed.reason)}.`);
        }
      }
      out.push("");
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
        `- Elements: ${elementCount(finding.elements.length, finding.elementsCut, record.limits?.elementsPerFinding ?? LIMITS.elementsPerFinding)}`,
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
      out.push(`### ${plainText(title)}`, "", ruleLine(item.rule), `- Page: ${inlineCode(item.page)}`);
      if (item.elementsCut !== undefined) {
        out.push(
          `- Elements: ${elementCount(item.elements.length, item.elementsCut, record.limits?.elementsPerFinding ?? LIMITS.elementsPerFinding)}`,
        );
      }
      out.push("");
      for (const element of item.elements) out.push(...elementLines(element, "", element.reason), "");
    }
  }

  const stopped = stoppedLines(record.pages);
  if (stopped.length > 0) {
    out.push("## What the page tried, and was stopped", "");
    out.push(...stopped);
  }

  out.push("## What this scan cannot see", "");
  out.push(
    "Automated rules find only some problems. A person has to check what they cannot. " +
      "The guided checklist (`a11y-genie checklist`) is planned and does not exist yet; until it does, ask these questions by hand:",
    "",
  );
  for (const line of record.cannotSee) out.push(`- ${line}`);
  out.push("");

  // Each piece above is already printable; this pass holds the whole report to it, whatever a piece missed.
  return `${printable(out.join("\n"))
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd()}\n`;
}
