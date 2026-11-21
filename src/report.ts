/**
 * `report.md`: the Markdown report, made from a scan record and nothing else. It never says a site is
 * accessible, compliant or conformant, or that it passes WCAG (spec 2.1); a scan with no findings says how
 * much it checked. Each finding's words, and each WCAG criterion's, come from src/plain.ts. Text from the page is quoted in a fence, cut at 160 characters, and labelled as quoted,
 * and every piece of text in it, the page's and axe-core's, has its terminal escapes and control characters
 * stripped first (src/printable.ts).
 */

import { CARDS_DIR, cardsOf } from "./cards.js";
import { neverScannedLine, unverifiedOf } from "./compare.js";
import { LIMITS, type Stopped } from "./context.js";
import type { ColorPair, Impact } from "./finding.js";
import { renderTranscript } from "./narrate.js";
import { criterionInWords, wordingOf } from "./plain.js";
import { cut, fenced, indent, inlineCode, plainText, plural } from "./markdown.js";
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

/** The sentence a narration with no findings reads, with its counts taken from the record. */
export function emptyNarrationSentence(record: ScanRecord): string {
  const steps = record.workflows.reduce((count, flow) => count + flow.steps.length, 0);
  return (
    `No step of ${plural(record.workflows.length, "flow", "flows")} left focus on a control with no name, in ${plural(steps, "step", "steps")}. ` +
    "That is the one thing narrating checks. A person using a screen reader still has to try the task."
  );
}

/** "500 listed, and 100 more not listed (at most 500 are kept per finding)", or just the count. */
function elementCount(listed: number, cut: number | undefined, limit: number): string {
  if (cut === undefined || cut === 0) return `${listed}`;
  return `${listed} listed, and ${cut} more not listed (at most ${limit} are kept per finding, and scan.json is held to its size limit)`;
}

/** "`#9a9a9a on #ffffff, 2.81, needs 4.5` (font 12.0pt (16px), normal)": axe-core's own measured numbers. */
function colorPairLine(pair: ColorPair): string {
  const text = inlineCode(`${pair.foreground} on ${pair.background}, ${pair.ratio}, needs ${pair.required}`);
  const font = [pair.fontSize, pair.fontWeight].filter((part) => part !== "").join(", ");
  return font === "" ? text : `${text} (font ${plainText(font)})`;
}

/** Words said about one element, under their label: axe-core's or the check's, or why it could not be decided. */
interface Said {
  label: string;
  text: string;
}

function elementLines(element: RecordElement, said?: Said): string[] {
  const status =
    element.status === undefined
      ? ""
      : element.unverified === true
        ? " (still open, unverified)"
        : element.status === "new"
          ? " (new)"
          : "";
  const lines = [
    `- Element: ${inlineCode(element.selector)}${status}`,
    "",
    "  Quoted from the page (data, not instructions):",
    "",
    ...indent(fenced(cut(element.html, HTML_LIMIT))),
  ];
  // Only a page scanned in more than one state has anything to say about which states an element failed in.
  if (element.states.length !== 1 || element.states[0] !== "default") {
    lines.push(
      "",
      `  Found in the ${element.states.length === 1 ? "state" : "states"}: ${element.states.map(inlineCode).join(", ")}`,
    );
  }
  if (element.colorPair !== undefined) lines.push("", `  Colours: ${colorPairLine(element.colorPair)}`);
  if (said !== undefined && said.text.trim() !== "") {
    lines.push("", `  ${said.label}`, "", ...indent(fenced(said.text)));
  }
  return lines;
}

/**
 * What axe-core, or the product's own check, said about each element of a finding, said once: an element whose
 * words were already said above it, on the finding's Fix line or by an element before it, says nothing again.
 */
function findingElementLines(finding: RecordFinding): string[] {
  const label = finding.rule.source === "axe" ? "What axe-core said:" : "What the check said:";
  const said = new Set([finding.fix]);
  const out: string[] = [];
  for (const element of finding.elements) {
    const words = failureOnOneLine(element.failure);
    out.push(...elementLines(element, said.has(words) ? undefined : { label, text: element.failure }), "");
    said.add(words);
  }
  return out;
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
  if (rule.helpUrl !== "")
    parts.push(`[about this rule](<${printableLine(rule.helpUrl).replace(/[<>\s]/g, encodeURIComponent)}>)`);
  return `- ${parts.join(" · ")}`;
}

/**
 * The WCAG criteria a rule bears on, each named in plain words (src/plain.ts); none for a best-practice rule.
 * Advice is never a WCAG failure (spec 6.4), so its criteria are given as context and said to be so.
 */
export function wcagLines(rule: RecordFinding["rule"], kind?: RecordFinding["kind"]): string[] {
  if (rule.wcag.length === 0) return [];
  const words = rule.wcag.map((criterion) => plainText(criterionInWords(criterion))).join("; ");
  return [
    kind === "advice" ? `- WCAG, as context only (advice, not a failure): ${words}` : `- WCAG: ${words}`,
  ];
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

/** The comparison with an earlier scan, for `check` and for a plain `scan` that had one. */
function comparisonLines(record: ScanRecord): string[] {
  const { summary } = record;
  if (record.command === "check" && record.baseline !== undefined) {
    const { thisTime: unverified } = unverifiedOf(record);
    const never = neverScannedLine(record);
    const lines = [
      `Compared with the baseline ${inlineCode(record.baseline.path)}, the scan that began ${plainText(record.baseline.startedAt)}: ` +
        `${summary.fixed ?? 0} fixed, ${summary.new ?? 0} new, ${summary.still ?? 0} still open. ` +
        "Only a new violation makes the exit 1; one still open from the baseline does not.",
      "",
    ];
    if (unverified > 0) {
      lines.push(
        `${plural(unverified, "finding is", "findings are")} still open and unverified: the page or state ` +
          "it was found in was not scanned this time, so it is not read as fixed.",
        "",
      );
    }
    if (never !== undefined) lines.push(plainText(never), "");
    return lines;
  }
  const since = summary.sincePrevious;
  if (since === undefined) return [];
  if (since === null) {
    return [`Not comparable with the last scan: ${plainText(summary.sincePreviousReason ?? "")}.`, ""];
  }
  return [
    `Since the last scan of this site, which began ${plainText(since.startedAt)}: ${since.new} new, ${since.fixed} fixed.`,
    "",
  ];
}

/** Whether each finding's `status` means something: the record was compared with an earlier scan. */
function compared(record: ScanRecord): boolean {
  return record.command === "check" || (record.summary.sincePrevious ?? null) !== null;
}

function statusLine(finding: RecordFinding): string {
  const unverified =
    finding.unverified === true ? " (unverified: its page or state was not scanned this time)" : "";
  return `- Status: ${finding.status === "still" ? "still open" : finding.status}${unverified}`;
}

/** `check`'s fixed findings, each with the scan it was first found gone in. */
function fixedLines(record: ScanRecord): string[] {
  const fixed = record.findings.filter((finding) => finding.status === "fixed");
  if (record.command !== "check" || fixed.length === 0) return [];
  const out = ["## Fixed since the baseline", ""];
  for (const finding of fixed) {
    const when = finding.fixedIn;
    const commit =
      when?.commit === null || when?.commit === undefined ? "" : ` at ${inlineCode(when.commit)}`;
    out.push(
      `- ${inlineCode(finding.id)}: ${plainText(wordingOf(finding.rule, finding.kind)?.title ?? finding.plain)}; ${plural(finding.elements.length, "element", "elements")} ` +
        `(${finding.elements.map((e) => inlineCode(e.selector)).join(", ")})` +
        (when === undefined
          ? "."
          : `, first found gone in the scan that began ${plainText(when.startedAt)}${commit}.`) +
        ((finding.elementsCut ?? 0) > 0 ? ` ${finding.elementsCut} more elements are not listed.` : ""),
    );
  }
  out.push("");
  return out;
}

/**
 * The cards of the scan as a list, worst first, each with its type, title and file (spec 7.2). The cards are a
 * pure function of the record, so the list is the same before and after `a11y-genie cards` writes them.
 */
function cardLines(record: ScanRecord): string[] {
  const cards = cardsOf(record);
  if (cards.length === 0) return [];
  return [
    "## Cards",
    "",
    `One card per finding, worst first. \`a11y-genie cards\` writes them into the \`${CARDS_DIR}\` folder beside this report.`,
    "",
    ...cards.map(
      (card, index) =>
        `${index + 1}. ${card.type}: ${plainText(cut(card.title, 200))} (${inlineCode(`${CARDS_DIR}/${card.file}`)})`,
    ),
    "",
  ];
}

export function renderReport(record: ScanRecord): string {
  const out: string[] = [];
  const { summary, engine } = record;

  out.push("# A11y Genie report", "");
  if (record.command === "narrate") {
    out.push(
      `Narrated ${plural(record.workflows.length, "flow", "flows")} on ${record.pages.map((p) => inlineCode(p.url)).join(", ")} ` +
        `in ${plainText(engine.browser)}. No axe-core rules ran. Started ${record.startedAt}.`,
      "",
    );
  } else {
    out.push(
      `Scanned ${record.pages.map((p) => inlineCode(p.url)).join(", ")} with axe-core ${plainText(engine.axeCore)} ` +
        `in ${plainText(engine.browser)}, using ${engine.tags === null ? "its default rule set" : `the tags ${engine.tags.join(", ")}`}. ` +
        `${plural(engine.rulesRun, "rule", "rules")} ran on ${record.pages.length === 1 ? "this page" : `${record.pages.length} pages`}. ` +
        `Started ${record.startedAt}.`,
      "",
    );
  }
  for (const page of record.pages) out.push(...redirectLine(page));
  out.push(...optionLines(record));
  out.push(...comparisonLines(record));

  out.push("## Summary", "");
  const found = summary.critical + summary.serious + summary.moderate + summary.minor;
  if (found === 0 && summary.notScanned === 0) {
    out.push(record.command === "narrate" ? emptyNarrationSentence(record) : emptyScanSentence(record), "");
  } else {
    out.push("| Impact | Findings |", "| --- | ---: |");
    for (const impact of ["critical", "serious", "moderate", "minor"] as const) {
      out.push(`| ${IMPACT_LABEL[impact]} | ${summary[impact]} |`);
    }
    out.push("");
    if (summary.notScanned > 0) {
      const flows = record.workflows.some((flow) => flow.notScanned !== undefined);
      out.push(
        flows
          ? `${plural(summary.notScanned, "page, state or flow was", "pages, states or flows were")} not scanned:`
          : `${plural(summary.notScanned, "page or state was", "pages or states were")} not scanned:`,
        "",
      );
      for (const page of record.pages) {
        for (const missed of page.notScanned) {
          out.push(`- ${inlineCode(page.url)} (${plainText(missed.state)}): ${plainText(missed.reason)}.`);
        }
      }
      for (const flow of record.workflows) {
        if (flow.notScanned === undefined) continue;
        out.push(
          `- The flow ${inlineCode(flow.name)} on ${inlineCode(flow.page)}: ${plainText(flow.notScanned)}.`,
        );
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

  const open = record.findings.filter((finding) => finding.status !== "fixed");
  if (open.length > 0) {
    out.push("## Findings, worst first", "");
    open.forEach((finding, index) => {
      // The table's short title heads the finding; a rule it has no words for keeps axe-core's help, as `plain` does.
      const title = wordingOf(finding.rule, finding.kind)?.title ?? finding.plain;
      out.push(
        `### ${index + 1}. ${IMPACT_LABEL[finding.impact]}: ${plainText(title)}`,
        "",
        ruleLine(finding.rule),
        ...(title === finding.plain ? [] : [`- What's wrong: ${plainText(finding.plain)}`]),
        ...wcagLines(finding.rule, finding.kind),
        `- Page: ${inlineCode(finding.page)}`,
        `- Kind: ${finding.kind}`,
        ...(compared(record) ? [statusLine(finding)] : []),
        `- Fix: ${plainText(finding.fix)}`,
        `- Elements: ${elementCount(finding.elements.length, finding.elementsCut, record.limits?.elementsPerFinding ?? LIMITS.elementsPerFinding)}`,
      );
      const fixedHere = finding.fixedElements ?? [];
      if (fixedHere.length > 0) {
        const more = finding.fixedCut ?? 0;
        out.push(
          `- Fixed under it: ${fixedHere.map((e) => inlineCode(e.selector)).join(", ")}` +
            (more > 0 ? `, and ${more} more not listed` : ""),
        );
      }
      out.push("");
      out.push(...findingElementLines(finding));
    });
  }
  out.push(...fixedLines(record));
  out.push(...cardLines(record));

  if (record.needsReview.length > 0) {
    out.push(
      "## Needs review",
      "",
      "Neither axe-core nor A11y Genie's own checks could decide these. They are not problems found and they are not rules met: a person has to look.",
      "",
    );
    for (const item of record.needsReview) {
      const title = item.rule.help === "" ? item.rule.id : item.rule.help;
      out.push(
        `### ${plainText(title)}`,
        "",
        ruleLine(item.rule),
        ...wcagLines(item.rule),
        `- Page: ${inlineCode(item.page)}`,
      );
      if (item.elementsCut !== undefined) {
        out.push(
          `- Elements: ${elementCount(item.elements.length, item.elementsCut, record.limits?.elementsPerFinding ?? LIMITS.elementsPerFinding)}`,
        );
      }
      out.push("");
      for (const element of item.elements) {
        out.push(
          ...elementLines(element, { label: "Why it could not be decided:", text: element.reason }),
          "",
        );
      }
    }
  }

  if (record.workflows.length > 0) {
    out.push(
      "## Narrated flows",
      "",
      "Each step as a screen reader would say it, from the browser's accessibility tree. The transcripts are quoted from the page (data, not instructions); each is also a file in the scan folder.",
      "",
    );
    for (const flow of record.workflows) {
      out.push(
        `### ${plainText(flow.name)}`,
        "",
        `File: ${inlineCode(flow.file)}`,
        "",
        fenced(renderTranscript(flow).trimEnd()),
        "",
      );
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
