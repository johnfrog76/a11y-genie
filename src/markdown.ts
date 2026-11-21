/**
 * The few Markdown pieces `report.md` and the cards are written with (src/report.ts, src/cards.ts). Every piece
 * strips terminal escapes and control characters first (src/printable.ts), and the fences and inline code are
 * longer than any run of backticks inside them, so text from the page cannot close them early.
 */

import { printable, printableLine } from "./printable.js";

/** `text` cut to `limit` characters (whole code points), with `…` when anything was cut. */
export function cut(text: string, limit: number): string {
  const chars = [...text];
  return chars.length <= limit ? text : `${chars.slice(0, limit).join("")}…`;
}

function longestBacktickRun(text: string): number {
  return Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
}

/** A fenced block, of the language `lang`, whose fence is longer than any run of backticks inside it. */
export function fenced(text: string, lang = "text"): string {
  const clean = printable(text);
  const fence = "`".repeat(Math.max(3, longestBacktickRun(clean) + 1));
  return `${fence}${lang}\n${clean}\n${fence}`;
}

/** Inline code that survives backticks inside it. */
export function inlineCode(text: string): string {
  const clean = printableLine(text);
  const tick = "`".repeat(longestBacktickRun(clean) + 1);
  const pad = clean.startsWith("`") || clean.endsWith("`") ? " " : "";
  return `${tick}${pad}${clean}${pad}${tick}`;
}

/** Text from axe-core or this tool, on one line, without Markdown's own marks. */
export function plainText(text: string): string {
  return printableLine(text).replace(/([\\`*_[\]<>|])/g, "\\$1");
}

/** Each line of `block`, indented two spaces, as the body of a list item. */
export function indent(block: string): string[] {
  return block.split("\n").map((line) => `  ${line}`);
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
