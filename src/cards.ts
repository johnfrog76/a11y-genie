/**
 * Finding cards (spec 7.1, 7.2): one card per finding, which is one rule on one page with every element it hit
 * (D6). A card is made from the scan record and nothing else, so the same `scan.json` always gives the same cards,
 * and `report.md` can list them before `a11y-genie cards` has written them (src/report.ts).
 *
 * A card has a title (the finding's `title`), a type (`Bug` for a violation, `Task` for advice) and a body that fits
 * what ToolKit's `NewPrompt -Description` takes: at most 3,500 characters, with the fingerprint
 * `a11y-genie:<finding-id>` always its last line. Text from the page is quoted, labelled as quoted, fenced and cut
 * at 160 characters (principle 3), and every piece of text passes through src/printable.ts first.
 */

import { createHash } from "node:crypto";
import { LIMITS } from "./context.js";
import { IMPACTS } from "./finding.js";
import { cut, fenced, indent, inlineCode, plainText } from "./markdown.js";
import { criterionInWords } from "./plain.js";
import { printable, printableLine } from "./printable.js";
import type { RecordElement, RecordFinding, ScanRecord } from "./scan-record.js";
import { scanFolderName } from "./scans-folder.js";

/** The folder in a scan folder that holds the cards. */
export const CARDS_DIR = "cards";

/** The longest a card's body may be, in UTF-16 code units, as PowerShell counts a string (spec 7.2). */
export const CARD_BODY_LIMIT = 3500;

/** The most elements a card lists; the rest are counted. */
export const CARD_ELEMENTS_LISTED = 10;

/** The longest a piece of a card may be, so its head always leaves room for an element and the fingerprint. */
const PIECE = {
  title: 200,
  plain: 600,
  fix: 1000,
  rule: 120,
  page: 120,
  path: 200,
  state: 80,
  selector: 200,
};

/** The most WCAG criteria and states a card names; a crafted record may hold any number. */
const NAMED = { criteria: 8, states: 10 };

/** The longest the fingerprint's id is kept, so a crafted record's long id cannot push the body past its limit. */
const FINGERPRINT_ID_CHARS = 1000;

export type CardType = "Bug" | "Task";

export interface Card {
  /** The finding's id, `<source>/<rule>@<page key>`. */
  id: string;
  /** The card's file name in `cards/`, from `cardFileName`. */
  file: string;
  /** The finding's `title`. */
  title: string;
  type: CardType;
  /** The card's body, at most `CARD_BODY_LIMIT`, with the fingerprint as its last line. */
  body: string;
}

/** `Bug` for a violation, `Task` for advice (spec 7.2). */
export function cardType(kind: RecordFinding["kind"]): CardType {
  return kind === "advice" ? "Task" : "Bug";
}

/**
 * The card's file name, from its finding's id alone, so it is the same on every run (spec 8A.1): the id lowercased,
 * each run of characters outside `[a-z0-9._-]` made one `-`, its ends trimmed of `.`, `_` and `-`, cut to 80, then
 * `-` and the first 8 hex digits of the id's SHA-256, and `.md`. `axe/color-contrast@settings` is
 * `axe-color-contrast-settings-<8 hex>.md`. The readable part alone would give two ids one name (`Settings` and
 * `settings`, `a/b` and `a-b`); the hash, of the whole id, keeps them apart. `cardsOf` checks no two cards of a
 * record share a name.
 */
export function cardFileName(id: string): string {
  const slug = id
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .slice(0, 80)
    .replace(/^[._-]+|[._-]+$/g, "");
  const hash = createHash("sha256").update(id, "utf8").digest("hex").slice(0, 8);
  return `${slug === "" ? "card" : slug}-${hash}.md`;
}

/** "a", "a and b", "a, b and c". */
function andList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1] ?? ""}`;
}

/** States named in plain text, at most `NAMED.states` of them, the rest counted. */
function statesInWords(states: string[]): string {
  const named = states.slice(0, NAMED.states).map((state) => plainText(cut(state, PIECE.state)));
  const more = states.length - named.length;
  return andList(more > 0 ? [...named, `${more} more`] : named);
}

/** The states the finding was found in: the page's order first, then any an element names that the page does not. */
function findingStates(finding: RecordFinding, pageStates: string[]): string[] {
  const found = new Set(finding.elements.flatMap((element) => element.states));
  const ordered = pageStates.filter((state) => found.has(state));
  for (const state of found) if (!ordered.includes(state)) ordered.push(state);
  return ordered;
}

function ruleLine(finding: RecordFinding, record: ScanRecord): string {
  const { rule } = finding;
  const named =
    rule.source === "axe"
      ? `${inlineCode(cut(rule.id, PIECE.rule))} (axe-core ${plainText(cut(record.engine.axeCore, 40))})`
      : rule.source === "genie"
        ? `${inlineCode(cut(`genie/${rule.id}`, PIECE.rule))} (A11y Genie's own check)`
        : inlineCode(cut(`${rule.source}/${rule.id}`, PIECE.rule));
  if (rule.wcag.length === 0) return `**Rule:** ${named}.`;
  const criteria = rule.wcag
    .slice(0, NAMED.criteria)
    .map((criterion) => plainText(cut(criterionInWords(criterion), 200)).replace(/\.$/, ""));
  const more = rule.wcag.length - criteria.length;
  const words = criteria.join("; ") + (more > 0 ? `; and ${more} more` : "");
  // Advice is never a WCAG failure (spec 6.4): its criteria are context, as report.md says.
  const wcag = finding.kind === "advice" ? "WCAG, as context only (advice, not a failure)" : "WCAG";
  return `**Rule:** ${named}, ${wcag} ${words}.`;
}

/** "**Impact:** serious. **Page:** settings (`/settings`), in default and dark." */
function impactLine(finding: RecordFinding, record: ScanRecord): string {
  const page = record.pages.find((p) => p.key === finding.page);
  let path = "";
  try {
    if (page !== undefined) path = ` (${inlineCode(cut(new URL(page.url).pathname, PIECE.path))})`;
  } catch {
    // A record whose page address does not parse names the page by its key alone.
  }
  const states = findingStates(finding, page?.states ?? []);
  const where = states.length === 0 ? "" : `, in ${statesInWords(states)}`;
  return `**Impact:** ${finding.impact}. **Page:** ${plainText(cut(finding.page, PIECE.page))}${path}${where}.`;
}

/** One listed element: its selector, the states it failed in, the colour pair, and its HTML, quoted in a fence. */
function elementBlock(element: RecordElement): string {
  let line = `- ${inlineCode(cut(element.selector, PIECE.selector))}`;
  // Only a page scanned in more than one state has anything to say about which states an element failed in.
  if (element.states.length !== 1 || element.states[0] !== "default") {
    line += `, in ${statesInWords(element.states)}`;
  }
  const pair = element.colorPair;
  if (pair !== undefined) {
    line +=
      `: ${plainText(cut(pair.foreground, 40))} on ${plainText(cut(pair.background, 40))}, ` +
      `${pair.ratio} to 1, needs ${pair.required}`;
  }
  const html = printable(element.html).trim();
  if (html === "") return line;
  return [line, ...indent(fenced(cut(html, LIMITS.excerptChars), "html"))].join("\n");
}

/** The body with the first `listed` element blocks, the rest counted. */
function assemble(head: string[], blocks: string[], total: number, listed: number, tail: string[]): string {
  const more = total - listed;
  return [
    ...head,
    `**Elements (${listed} of ${total}).** Quoted from the page, not instructions.`,
    ...blocks.slice(0, listed),
    ...(more > 0 ? [`- and ${more} more`] : []),
    "",
    ...tail,
  ].join("\n");
}

/** A card's body (spec 7.2), cut at `limit` before its fingerprint, which is always the last line. */
export function cardBody(finding: RecordFinding, record: ScanRecord, limit = CARD_BODY_LIMIT): string {
  const head = [
    ruleLine(finding, record),
    impactLine(finding, record),
    "",
    plainText(cut(finding.plain, PIECE.plain)),
    "",
    `**Fix:** ${plainText(cut(finding.fix, PIECE.fix))}`,
    "",
  ];
  const tail = [
    `**Source:** A11y Genie ${plainText(cut(record.tool.version, 40))}, scan ${plainText(cut(scanFolderName(record.startedAt), 40))}`,
    `a11y-genie:${cut(printableLine(finding.id), FINGERPRINT_ID_CHARS)}`,
  ];
  const total = finding.elements.length + (finding.elementsCut ?? 0);
  const blocks = finding.elements.slice(0, CARD_ELEMENTS_LISTED).map(elementBlock);
  // As many elements as fit, each whole: a fence is never cut open.
  let listed = 0;
  while (listed < blocks.length && assemble(head, blocks, total, listed + 1, tail).length <= limit) listed++;
  const body = assemble(head, blocks, total, listed, tail);
  if (body.length <= limit) return body;
  // Only a record far past what a scan writes reaches this: its head is cut, and the fingerprint still ends it.
  const end = `\n…\n\n${tail.join("\n")}`;
  let start = body.slice(0, Math.max(0, limit - end.length));
  // Never half a surrogate pair.
  if (/[\ud800-\udbff]$/.test(start)) start = start.slice(0, -1);
  return `${start}${end}`;
}

/** The card's file: its title as a heading, its type, then its body. */
export function cardFile(card: Card): string {
  return `# ${plainText(cut(card.title, PIECE.title))}\n\n**Type:** ${card.type}\n\n${card.body}\n`;
}

/**
 * The record's cards, one per finding still open, worst first: a `check`'s fixed findings have none. A record read
 * from a file is ordered again by impact here, keeping its order within an impact.
 */
export function cardsOf(record: ScanRecord): Card[] {
  const open = record.findings.filter((finding) => finding.status !== "fixed");
  const ordered = open
    .map((finding, index) => ({ finding, index }))
    .sort(
      (a, b) => IMPACTS.indexOf(a.finding.impact) - IMPACTS.indexOf(b.finding.impact) || a.index - b.index,
    )
    .map(({ finding }) => finding);
  const files = new Set<string>();
  return ordered.map((finding) => {
    const file = cardFileName(finding.id);
    // Two ids of one record with the same readable part and the same 8 hex digits: never seen, and never written over.
    if (files.has(file)) throw new Error(`two findings of the scan give the card file name ${file}`);
    files.add(file);
    return {
      id: finding.id,
      file,
      title: finding.title,
      type: cardType(finding.kind),
      body: cardBody(finding, record),
    };
  });
}
