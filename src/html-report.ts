/**
 * `report.html`: the people's view of a scan (D3), made from the record and nothing else, in the order and the
 * words of `report.md` (src/report.ts). One self-contained file that opens from disk: no framework, no web font,
 * no image file, no request of any kind. Its one stylesheet is inline and allowed by its hash in a content
 * security policy that allows nothing else (`default-src 'none'`), so even markup that got in could load and run
 * nothing. It has no script; a later one goes in by hash the same way (`contentSecurityPolicy`).
 *
 * Every piece of text in it, the page's, a baseline's and axe-core's, goes through `escapeHtml`
 * (src/html-escape.ts), by way of the `markup` template, and only `https:` addresses are links. It never calls a
 * site accessible, compliant or conformant, or says it passes WCAG (spec 2.1).
 *
 * The templates are tagged `markup`, not `html`, on purpose: a formatter that knows the `html` tag rewrites the
 * text inside it, which would change the stylesheet's hash and the whitespace in `<pre>`.
 */

import { createHash } from "node:crypto";
import { neverScannedLine, unverifiedOf } from "./compare.js";
import { LIMITS } from "./context.js";
import type { ColorPair } from "./finding.js";
import { Html, linkable, markup, type HtmlValue } from "./html-escape.js";
import { REPORT_CSS } from "./html-report-style.js";
import { renderTranscript } from "./narrate.js";
import { criterionInWords, wordingOf } from "./plain.js";
import { printable, printableLine } from "./printable.js";
import {
  compared,
  elementCount,
  emptyNarrationSentence,
  emptyScanSentence,
  HTML_LIMIT,
  IMPACT_LABEL,
  plural,
  sameOrigin,
  STOPPED_LABEL,
} from "./report.js";
import {
  cutText,
  failureOnOneLine,
  type RecordElement,
  type RecordFinding,
  type RecordPage,
  type ScanRecord,
} from "./scan-record.js";

/** `'sha256-<base64>'`: a CSP source that allows exactly this inline style or script text. */
export function cspHash(text: string): string {
  return `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;
}

/**
 * The report's content security policy: nothing by default, and only the inline styles and scripts given, each
 * by its hash. No script means `script-src 'none'`. No image, font, frame, connection, form target or base URL
 * is allowed, so the page can make no request.
 */
export function contentSecurityPolicy(styles: readonly string[], scripts: readonly string[] = []): string {
  const sources = (texts: readonly string[]) =>
    texts.length === 0 ? "'none'" : texts.map(cspHash).join(" ");
  return [
    "default-src 'none'",
    `style-src ${sources(styles)}`,
    `script-src ${sources(scripts)}`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

const NOTHING = markup``;

/** Text in `<code>`. */
function code(text: string): Html {
  return markup`<code>${text}</code>`;
}

/** A list of code spans, joined by commas. */
function codes(texts: readonly string[]): Html[] {
  return texts.map((text, index) => markup`${index === 0 ? "" : ", "}${code(text)}`);
}

/** Text quoted from the page, or said by axe-core, in a block, under its label. */
function quoted(label: string, text: string): Html {
  return markup`<p class="label">${label}</p>
<pre><code>${text}</code></pre>`;
}

/** A colour as a swatch may draw it: `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`, and nothing else. */
const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** A square of `color`, for the eye only: its hex is written beside it. Not a hex, no square. */
function swatch(color: string, role: string): Html {
  const square = HEX.test(color)
    ? markup`<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect width="24" height="24" fill="${color}"/></svg>`
    : NOTHING;
  return markup`<span class="swatch">${square}<span>${role} ${code(color)}</span></span>`;
}

/** The colour pair as two swatches with their hex, and axe-core's measured ratio against the one needed. */
function colorPair(pair: ColorPair): Html {
  const font = [pair.fontSize, pair.fontWeight].filter((part) => part !== "").join(", ");
  return markup`<p class="label">Colours:</p>
<div class="pair">${swatch(pair.foreground, "Text")}${swatch(pair.background, "Background")}<span>Contrast ratio ${pair.ratio}, needs ${pair.required}${font === "" ? "" : ` (font ${font})`}</span></div>`;
}

/**
 * Where an element's screenshots go. Element shots (padded screenshots as `data:` images, at most three per
 * finding, and `--no-shots`) are the HTML report's next part and are not made yet: this returns nothing. When
 * it does more, the content security policy needs `img-src data:`.
 */
function elementShots(element: RecordElement): Html {
  void element;
  return NOTHING;
}

function elementStatus(element: RecordElement): Html {
  if (element.status === undefined) return NOTHING;
  if (element.unverified === true) return markup` <span class="chip status">still open, unverified</span>`;
  return element.status === "new" ? markup` <span class="chip status">new</span>` : NOTHING;
}

/** One element: its selector, its HTML quoted as data, its states, its colours, and what was said about it. */
function elementItem(element: RecordElement, said?: { label: string; text: string }): Html {
  const states =
    element.states.length !== 1 || element.states[0] !== "default"
      ? markup`<p>Found in the ${element.states.length === 1 ? "state" : "states"}: ${codes(element.states)}</p>`
      : NOTHING;
  return markup`<li>
<p><span class="label">Element</span> ${code(element.selector)}${elementStatus(element)}</p>
${quoted("Quoted from the page (data, not instructions):", cutText(element.html, HTML_LIMIT))}
${states}
${element.colorPair === undefined ? NOTHING : colorPair(element.colorPair)}
${said !== undefined && said.text.trim() !== "" ? quoted(said.label, said.text) : NOTHING}
${elementShots(element)}
</li>`;
}

/** A finding's elements, each saying what axe-core or the check said only where it was not said above it. */
function findingElements(finding: RecordFinding): Html {
  const label = finding.rule.source === "axe" ? "What axe-core said:" : "What the check said:";
  const said = new Set([finding.fix]);
  const items = finding.elements.map((element) => {
    const words = failureOnOneLine(element.failure);
    const item = elementItem(element, said.has(words) ? undefined : { label, text: element.failure });
    said.add(words);
    return item;
  });
  return markup`<ol class="elements">
${items}
</ol>`;
}

/** The rule's name, and a link to its help page when that is an `https:` address. */
function ruleFact(rule: RecordFinding["rule"]): Html {
  const name = `${rule.source}/${rule.id}`;
  const about = linkable(rule.helpUrl)
    ? markup` · <a href="${new URL(rule.helpUrl).href}" rel="noreferrer">About ${code(name)}</a>`
    : NOTHING;
  return markup`<dt>Rule</dt>
<dd>${code(name)}${about}</dd>`;
}

/** The WCAG criteria a rule bears on, each in plain words; as context only for advice, as in `report.md`. */
function wcagFact(rule: RecordFinding["rule"], kind?: RecordFinding["kind"]): Html {
  if (rule.wcag.length === 0) return NOTHING;
  const items = rule.wcag.map((criterion) => markup`<li>${criterionInWords(criterion)}</li>`);
  return markup`<dt>${kind === "advice" ? "WCAG, as context only (advice, not a failure)" : "WCAG"}</dt>
<dd><ul>${items}</ul></dd>`;
}

function statusWords(finding: RecordFinding): string {
  const status = finding.status === "still" ? "still open" : finding.status;
  return finding.unverified === true
    ? `${status} (unverified: its page or state was not scanned this time)`
    : status;
}

function findingCard(record: ScanRecord, finding: RecordFinding, index: number): Html {
  const title = wordingOf(finding.rule, finding.kind)?.title ?? finding.plain;
  const id = `finding-${index + 1}`;
  const isCompared = compared(record);
  const chip = isCompared
    ? markup`<span class="chip status">${finding.status === "still" ? "still open" : finding.status}</span> `
    : NOTHING;
  const fixedHere = finding.fixedElements ?? [];
  const fixedMore = finding.fixedCut ?? 0;
  const limit = record.limits?.elementsPerFinding ?? LIMITS.elementsPerFinding;
  const wrong =
    title === finding.plain
      ? NOTHING
      : markup`<dt>What's wrong</dt>
<dd>${finding.plain}</dd>`;
  const status = isCompared
    ? markup`<dt>Status</dt>
<dd>${statusWords(finding)}</dd>`
    : NOTHING;
  const fixedUnder =
    fixedHere.length === 0
      ? NOTHING
      : markup`<dt>Fixed under it</dt>
<dd>${codes(fixedHere.map((element) => element.selector))}${fixedMore > 0 ? `, and ${fixedMore} more not listed` : ""}</dd>`;
  return markup`<section class="card" aria-labelledby="${id}">
<h3 id="${id}">${index + 1}. <span class="chip impact-${finding.impact}">${IMPACT_LABEL[finding.impact]}</span> ${chip}${title}</h3>
<dl class="facts">
${ruleFact(finding.rule)}
${wrong}
${wcagFact(finding.rule, finding.kind)}
<dt>Page</dt>
<dd>${code(finding.page)}</dd>
<dt>Kind</dt>
<dd>${finding.kind}</dd>
${status}
<dt>Fix</dt>
<dd class="fix">${finding.fix}</dd>
<dt>Elements</dt>
<dd>${elementCount(finding.elements.length, finding.elementsCut, limit)}</dd>
${fixedUnder}
</dl>
${findingElements(finding)}
</section>`;
}

/** What was scanned and with what: the banner's line. */
function scannedLine(record: ScanRecord): Html {
  const { engine } = record;
  const urls = codes(record.pages.map((page) => page.url));
  if (record.command === "narrate") {
    return markup`Narrated ${plural(record.workflows.length, "flow", "flows")} on ${urls} in ${engine.browser}. No axe-core rules ran. Started ${record.startedAt}.`;
  }
  const rules = engine.tags === null ? "its default rule set" : `the tags ${engine.tags.join(", ")}`;
  const where = record.pages.length === 1 ? "this page" : `${record.pages.length} pages`;
  return markup`Scanned ${urls} with axe-core ${engine.axeCore} in ${engine.browser}, using ${rules}. ${plural(engine.rulesRun, "rule", "rules")} ran on ${where}. Started ${record.startedAt}.`;
}

function redirectParagraph(page: RecordPage): Html {
  const requested = page.requestedUrl ?? page.url;
  const redirects = page.redirects ?? 0;
  if (requested === page.url && redirects === 0) return NOTHING;
  const other = sameOrigin(requested, page.url) === false;
  return markup`<p>Asked for ${code(requested)}; after ${plural(redirects, "redirect", "redirects")} it ended on ${code(page.url)}${other ? ", which is another origin than the one asked for" : ""}.</p>`;
}

/** What the flags changed about this scan, in the words of `report.md`. */
function optionParagraphs(record: ScanRecord): Html[] {
  const options = record.options;
  if (options === undefined) return [];
  const out: Html[] = [];
  if (options.sameOrigin) {
    out.push(
      markup`<p>It was run with ${code("--same-origin")}: every request to an origin other than the page's own was aborted, so some of the page's content (scripts, styles, images, frames) may be missing from what was scanned.</p>`,
    );
  }
  if (options.offline) {
    out.push(
      markup`<p>It was run with ${code("--offline")}: only addresses on this machine were allowed, and every request off this machine was aborted, so some of the page's content may be missing from what was scanned.</p>`,
    );
  }
  if (options.failOn !== "minor") {
    out.push(
      markup`<p>The exit code counts only findings at or above ${options.failOn} (${code("--fail-on")}); the findings below it are still listed.</p>`,
    );
  }
  return out;
}

/** The comparison with the baseline, for `check`, or with the last scan, for a plain `scan` that had one. */
function comparisonParagraphs(record: ScanRecord): Html[] {
  const { summary } = record;
  if (record.command === "check" && record.baseline !== undefined) {
    const { thisTime: unverified } = unverifiedOf(record);
    const never = neverScannedLine(record);
    const out = [
      markup`<p>Compared with the baseline ${code(record.baseline.path)}, the scan that began ${record.baseline.startedAt}: ${summary.fixed ?? 0} fixed, ${summary.new ?? 0} new, ${summary.still ?? 0} still open. Only a new violation makes the exit 1; one still open from the baseline does not.</p>`,
    ];
    if (unverified > 0) {
      out.push(
        markup`<p>${plural(unverified, "finding is", "findings are")} still open and unverified: the page or state it was found in was not scanned this time, so it is not read as fixed.</p>`,
      );
    }
    if (never !== undefined) out.push(markup`<p>${never}</p>`);
    return out;
  }
  const since = summary.sincePrevious;
  if (since === undefined) return [];
  if (since === null) {
    return [markup`<p>Not comparable with the last scan: ${summary.sincePreviousReason ?? ""}.</p>`];
  }
  return [
    markup`<p>Since the last scan of this site, which began ${since.startedAt}: ${since.new} new, ${since.fixed} fixed.</p>`,
  ];
}

function summarySection(record: ScanRecord): Html {
  const { summary } = record;
  const found = summary.critical + summary.serious + summary.moderate + summary.minor;
  const parts: HtmlValue[] = [];
  if (found === 0 && summary.notScanned === 0) {
    const sentence =
      record.command === "narrate" ? emptyNarrationSentence(record) : emptyScanSentence(record);
    parts.push(markup`<p>${sentence}</p>`);
  } else {
    const rows = (["critical", "serious", "moderate", "minor"] as const).map(
      (impact) =>
        markup`<tr><th scope="row"><span class="chip impact-${impact}">${IMPACT_LABEL[impact]}</span></th><td>${summary[impact]}</td></tr>`,
    );
    parts.push(markup`<table class="summary">
<caption class="label">Findings by impact</caption>
<thead><tr><th scope="col">Impact</th><th scope="col">Findings</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>`);
    if (summary.notScanned > 0) {
      const flows = record.workflows.some((flow) => flow.notScanned !== undefined);
      const items: Html[] = [];
      for (const page of record.pages) {
        for (const missed of page.notScanned) {
          items.push(markup`<li>${code(page.url)} (${missed.state}): ${missed.reason}.</li>`);
        }
      }
      for (const flow of record.workflows) {
        if (flow.notScanned === undefined) continue;
        items.push(markup`<li>The flow ${code(flow.name)} on ${code(flow.page)}: ${flow.notScanned}.</li>`);
      }
      const head = flows
        ? `${plural(summary.notScanned, "page, state or flow was", "pages, states or flows were")} not scanned:`
        : `${plural(summary.notScanned, "page or state was", "pages or states were")} not scanned:`;
      parts.push(markup`<p>${head}</p>
<ul>${items}</ul>`);
    }
  }
  if (summary.needsReview > 0) {
    parts.push(
      markup`<p>${plural(summary.needsReview, "item needs", "items need")} a person to look at it (see <a href="#needs-review">Needs review</a>).</p>`,
    );
  }
  return markup`<section aria-labelledby="summary">
<h2 id="summary">Summary</h2>
${parts}
</section>`;
}

/** `check`'s fixed findings, each with the scan it was first found gone in. */
function fixedSection(record: ScanRecord): Html {
  const fixed = record.findings.filter((finding) => finding.status === "fixed");
  if (record.command !== "check" || fixed.length === 0) return NOTHING;
  const items = fixed.map((finding) => {
    const when = finding.fixedIn;
    const commit =
      when?.commit === null || when?.commit === undefined ? NOTHING : markup` at ${code(when.commit)}`;
    const title = wordingOf(finding.rule, finding.kind)?.title ?? finding.plain;
    const gone =
      when === undefined
        ? markup`.`
        : markup`, first found gone in the scan that began ${when.startedAt}${commit}.`;
    const more =
      (finding.elementsCut ?? 0) > 0 ? ` ${finding.elementsCut} more elements are not listed.` : "";
    const selectors = codes(finding.elements.map((element) => element.selector));
    return markup`<li>${code(finding.id)}: ${title}; ${plural(finding.elements.length, "element", "elements")} (${selectors})${gone}${more}</li>`;
  });
  return markup`<section aria-labelledby="fixed">
<h2 id="fixed">Fixed since the baseline</h2>
<ul class="fixed">${items}</ul>
</section>`;
}

function needsReviewSection(record: ScanRecord): Html {
  if (record.needsReview.length === 0) return NOTHING;
  const limit = record.limits?.elementsPerFinding ?? LIMITS.elementsPerFinding;
  const cards = record.needsReview.map((item, index) => {
    const title = item.rule.help === "" ? item.rule.id : item.rule.help;
    const id = `review-${index + 1}`;
    const count =
      item.elementsCut === undefined
        ? NOTHING
        : markup`<dt>Elements</dt>
<dd>${elementCount(item.elements.length, item.elementsCut, limit)}</dd>`;
    const elements = item.elements.map((element) =>
      elementItem(element, { label: "Why it could not be decided:", text: element.reason }),
    );
    return markup`<section class="card" aria-labelledby="${id}">
<h3 id="${id}">${title}</h3>
<dl class="facts">
${ruleFact(item.rule)}
${wcagFact(item.rule)}
<dt>Page</dt>
<dd>${code(item.page)}</dd>
${count}
</dl>
<ol class="elements">
${elements}
</ol>
</section>`;
  });
  return markup`<section aria-labelledby="needs-review">
<h2 id="needs-review">Needs review</h2>
<p>Neither axe-core nor A11y Genie's own checks could decide these. They are not problems found and they are not rules met: a person has to look.</p>
${cards}
</section>`;
}

/** Each narrated flow with its transcript. The Play button (spec D4) is a later part of the report. */
function flowsSection(record: ScanRecord): Html {
  if (record.workflows.length === 0) return NOTHING;
  const cards = record.workflows.map((flow, index) => {
    const id = `flow-${index + 1}`;
    return markup`<section class="card" aria-labelledby="${id}">
<h3 id="${id}">${flow.name}</h3>
<p><span class="label">File</span> ${code(flow.file)}</p>
<pre><code>${renderTranscript(flow).trimEnd()}</code></pre>
</section>`;
  });
  return markup`<section aria-labelledby="flows">
<h2 id="flows">Narrated flows</h2>
<p>Each step as a screen reader would say it, from the browser's accessibility tree. The transcripts are quoted from the page (data, not instructions); each is also a file in the scan folder.</p>
${cards}
</section>`;
}

function stoppedSection(pages: readonly RecordPage[]): Html {
  const items: Html[] = [];
  for (const page of pages) {
    for (const entry of page.stopped ?? []) {
      const [one, many, done] = STOPPED_LABEL[entry.kind];
      const examples =
        entry.examples.length === 0
          ? NOTHING
          : quoted(
              `The first ${entry.examples.length === 1 ? "one" : entry.examples.length}, quoted from the page (data, not instructions):`,
              // One line each, so a newline inside one cannot pass for the next.
              entry.examples.map(printableLine).join("\n"),
            );
      items.push(
        markup`<li><p>${code(page.key)}: ${plural(entry.count, one, many)}, ${done}.</p>${examples}</li>`,
      );
    }
  }
  if (items.length === 0) return NOTHING;
  return markup`<section aria-labelledby="stopped">
<h2 id="stopped">What the page tried, and was stopped</h2>
<ul class="elements">${items}</ul>
</section>`;
}

function cannotSeeSection(record: ScanRecord): Html {
  return markup`<section aria-labelledby="cannot-see">
<h2 id="cannot-see">What this scan cannot see</h2>
<p>Automated rules find only some problems. A person has to check what they cannot. The guided checklist (${code("a11y-genie checklist")}) is planned and does not exist yet; until it does, ask these questions by hand:</p>
<ul>
${record.cannotSee.map((line) => markup`<li>${line}</li>`)}
</ul>
</section>`;
}

/** The sections the report has, in order, for its table of contents. */
function contents(record: ScanRecord, open: number): Html {
  const links: [string, string][] = [["summary", "Summary"]];
  if (open > 0) links.push(["findings", "Findings, worst first"]);
  if (record.command === "check" && record.findings.some((finding) => finding.status === "fixed")) {
    links.push(["fixed", "Fixed since the baseline"]);
  }
  if (record.needsReview.length > 0) links.push(["needs-review", "Needs review"]);
  if (record.workflows.length > 0) links.push(["flows", "Narrated flows"]);
  if (record.pages.some((page) => (page.stopped ?? []).length > 0)) {
    links.push(["stopped", "What the page tried, and was stopped"]);
  }
  links.push(["cannot-see", "What this scan cannot see"]);
  return markup`<nav aria-label="Sections of this report">
<ul>${links.map(([id, text]) => markup`<li><a href="#${id}">${text}</a></li>`)}</ul>
</nav>`;
}

/** `report.html` for `record`: one self-contained page, with its content security policy. */
export function renderHtmlReport(record: ScanRecord): string {
  const open = record.findings.filter((finding) => finding.status !== "fixed");
  const findings =
    open.length === 0
      ? NOTHING
      : markup`<section aria-labelledby="findings">
<h2 id="findings">Findings, worst first</h2>
${open.map((finding, index) => findingCard(record, finding, index))}
</section>`;
  const page = markup`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy([REPORT_CSS])}">
<meta name="referrer" content="no-referrer">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>A11y Genie report: ${record.target.origin}</title>
<style>${Html.trusted(REPORT_CSS)}</style>
</head>
<body>
<a class="skip" href="#main">Skip to the report</a>
<div class="page">
<header class="banner">
<p class="brand">A11y Genie</p>
<h1>Report</h1>
<p>${scannedLine(record)}</p>
</header>
${contents(record, open.length)}
<main id="main" tabindex="-1">
${record.pages.map(redirectParagraph)}
${optionParagraphs(record)}
${comparisonParagraphs(record)}
${summarySection(record)}
${findings}
${fixedSection(record)}
${needsReviewSection(record)}
${flowsSection(record)}
${stoppedSection(record.pages)}
${cannotSeeSection(record)}
</main>
<footer>
<p>Written by A11y Genie ${record.tool.version} from this scan's ${code("scan.json")}. It quotes HTML and text from the scanned pages, as data: read what it holds before you share it.</p>
</footer>
</div>
</body>
</html>
`;
  // Every value above is already escaped and printable; this pass holds the whole file to it. Blank lines left by
  // empty parts are dropped, outside a <pre> only: page text is escaped, so no "</pre>" can come from it.
  return printable(page.toString())
    .split(/(<pre>[\s\S]*?<\/pre>)/)
    .map((part) => (part.startsWith("<pre>") ? part : part.replace(/\n\s*\n/g, "\n")))
    .join("");
}
