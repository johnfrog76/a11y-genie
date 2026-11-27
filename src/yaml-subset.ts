/**
 * A strict reader for the small part of YAML the config file uses (docs/CONFIG.md), so the config needs no new
 * runtime dependency. It reads text and builds plain data: no tags, no anchors or aliases, no merge keys, no
 * block scalars, no documents, nothing that runs. Anything outside the subset is a refusal that names the
 * line, so a file that reads differently in a full YAML parser is never read half-right here.
 *
 * What it reads:
 * - block mappings (`key: value`) and block sequences (`- item`), nested by indenting with spaces;
 * - `- key: value` as the start of a mapping inside a sequence;
 * - a value that is a string: plain (`/settings`, `http://localhost:5173`), double-quoted with JSON's escapes,
 *   or single-quoted with `''` for a `'`;
 * - a flow sequence of such strings on one line: `["Tab", "click button 'Menu'"]` or `[]`;
 * - comments after a `#` that starts a line or follows a space.
 *
 * Every value is a string or a collection: `8080` and `true` are the strings "8080" and "true", and the
 * config's own validation says what each key takes. JSON written in this shape, a flow sequence for its lists,
 * reads too. docs/CONFIG.md shows the file.
 */

import { printableLine } from "./printable.js";
import { Refusal } from "./refusal.js";

/** A value with the line it came from (from 1), for the refusals that name it. */
export type YamlNode =
  | { kind: "string"; value: string; line: number }
  | { kind: "null"; line: number }
  | { kind: "sequence"; items: YamlNode[]; line: number }
  | { kind: "mapping"; entries: YamlEntry[]; line: number };

export interface YamlEntry {
  key: string;
  /** The line the key is on. */
  line: number;
  value: YamlNode;
}

const MAX_LINES = 5_000;
const MAX_DEPTH = 20;

interface Line {
  /** From 1. */
  number: number;
  indent: number;
  /** The text after the indent, with any comment cut off and trailing space removed. */
  text: string;
}

export class YamlError extends Refusal {
  constructor(
    readonly line: number,
    readonly problem: string,
    hint = 'the config file takes the YAML shown in docs/CONFIG.md: keys, "- " lists, and quoted strings.',
  ) {
    super(`line ${line}: ${problem}`, hint);
    this.name = "YamlError";
  }
}

function fail(line: number, problem: string, hint?: string): never {
  throw new YamlError(line, printableLine(problem), hint);
}

/** `text` without a trailing comment: a `#` that starts it or follows a space, outside quotes. */
function withoutComment(text: string, line: number): string {
  let quote: string | undefined;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i] as string;
    if (quote === undefined) {
      if (char === '"' || char === "'") {
        // A quote opens a string only at the start of a value; elsewhere it is an ordinary character.
        const before = text.slice(0, i).trimEnd();
        if (before === "" || /(^|\s)-$|:$|\[$|,$/.test(before)) quote = char;
      } else if (char === "#" && (i === 0 || text[i - 1] === " ")) {
        return text.slice(0, i).trimEnd();
      }
    } else if (quote === '"' && char === "\\") {
      i += 1;
    } else if (char === quote) {
      if (quote === "'" && text[i + 1] === "'") i += 1;
      else quote = undefined;
    }
  }
  if (quote !== undefined) fail(line, "a quote is never closed.");
  return text.trimEnd();
}

function splitLines(source: string): Line[] {
  const raw = source.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/);
  if (raw.length > MAX_LINES) fail(MAX_LINES + 1, `the file is longer than ${MAX_LINES} lines.`);
  const lines: Line[] = [];
  raw.forEach((text, index) => {
    const number = index + 1;
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) {
      fail(number, "a control character is in the file.");
    }
    const indent = text.length - text.trimStart().length;
    if (text.slice(0, indent).includes("\t")) fail(number, "a tab is used to indent: use spaces.");
    const body = withoutComment(text.slice(indent), number);
    if (body === "") return;
    lines.push({ number, indent, text: body });
  });
  return lines;
}

/** Where the `key:` ends in `text`: the first `:` followed by a space or the end, outside quotes. -1 if none. */
function colonOf(text: string): number {
  const first = text[0];
  if (first === '"' || first === "'") {
    const end = quotedEnd(text, 0);
    if (end === -1) return -1;
    const after = text.slice(end);
    return after === ":" || after.startsWith(": ") ? end : -1;
  }
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === ":" && (i + 1 === text.length || text[i + 1] === " ")) return i;
  }
  return -1;
}

/** The index just past the quoted string that starts at `start`, or -1 when it never closes. */
function quotedEnd(text: string, start: number): number {
  const quote = text[start];
  for (let i = start + 1; i < text.length; i += 1) {
    const char = text[i];
    if (quote === '"' && char === "\\") i += 1;
    else if (char === quote) {
      if (quote === "'" && text[i + 1] === "'") i += 1;
      else return i + 1;
    }
  }
  return -1;
}

/** One scalar: a quoted string whole, or a plain one. */
function scalar(text: string, line: number): YamlNode {
  const first = text[0];
  if (first === '"') {
    const end = quotedEnd(text, 0);
    if (end !== text.length) fail(line, "text follows a closing quote on the same line.");
    try {
      return { kind: "string", value: JSON.parse(text) as string, line };
    } catch {
      return fail(line, "this double-quoted string has an escape YAML and JSON do not both take.");
    }
  }
  if (first === "'") {
    const end = quotedEnd(text, 0);
    if (end !== text.length) fail(line, "text follows a closing quote on the same line.");
    return { kind: "string", value: text.slice(1, -1).replaceAll("''", "'"), line };
  }
  if (first !== undefined && "&*!|>%@`{}".includes(first)) {
    fail(
      line,
      `"${first}" starts something this file does not take: no tags, anchors, aliases or block text.`,
    );
  }
  if (first === "?" || (first === "-" && (text.length === 1 || text[1] === " "))) {
    fail(line, "a list item or a key mark is not where a value goes.");
  }
  if (text.startsWith("[")) return flowSequence(text, line);
  if (colonOf(text) !== -1) fail(line, 'a ": " is in this value; put the value in quotes.');
  if (text === "~" || text === "null") return { kind: "null", line };
  return { kind: "string", value: text, line };
}

/** `[a, "b", 'c']` on one line. */
function flowSequence(text: string, line: number): YamlNode {
  if (!text.endsWith("]")) fail(line, 'a "[" list must close with "]" on the same line.');
  const inner = text.slice(1, -1).trim();
  const items: YamlNode[] = [];
  if (inner !== "") {
    let rest = inner;
    for (;;) {
      let end: number;
      if (rest[0] === '"' || rest[0] === "'") {
        end = quotedEnd(rest, 0);
        if (end === -1) fail(line, "a quote is never closed.");
      } else {
        const comma = rest.indexOf(",");
        end = comma === -1 ? rest.length : comma;
        if (/[[\]{}]/.test(rest.slice(0, end))) fail(line, "a list inside a list is not taken here.");
      }
      const item = rest.slice(0, end).trim();
      if (item === "") fail(line, "a list item is empty.");
      items.push(scalar(item, line));
      rest = rest.slice(end).trimStart();
      if (rest === "") break;
      if (rest[0] !== ",") fail(line, 'list items are separated by ",".');
      rest = rest.slice(1).trimStart();
      if (rest === "") fail(line, "a list item is empty.");
    }
  }
  return { kind: "sequence", items, line };
}

/** `entries`, refusing a key given twice: a full YAML parser would keep the last, and which one is meant is a guess. */
function unique(entries: YamlEntry[]): YamlEntry[] {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.key)) fail(entry.line, `the key "${entry.key}" is given twice.`);
    seen.add(entry.key);
  }
  return entries;
}

class Reader {
  private position = 0;
  constructor(private readonly lines: Line[]) {}

  peek(): Line | undefined {
    return this.lines[this.position];
  }

  /** The block that starts at the next line, which must be indented by at least `min`. */
  block(min: number, depth: number): YamlNode {
    if (depth > MAX_DEPTH) fail(this.peek()?.number ?? 1, `the file nests deeper than ${MAX_DEPTH} levels.`);
    const first = this.peek();
    if (first === undefined)
      fail(this.lines.at(-1)?.number ?? 1, "a value is missing at the end of the file.");
    if (first.indent < min) fail(first.number, "this line is not indented under its key.");
    return first.text === "-" || first.text.startsWith("- ")
      ? this.sequence(first.indent, depth)
      : this.mapping(first.indent, depth);
  }

  private mapping(indent: number, depth: number): YamlNode {
    const entries: YamlEntry[] = [];
    const startLine = this.peek()?.number ?? 1;
    for (;;) {
      const line = this.peek();
      if (line === undefined || line.indent < indent) break;
      if (line.indent > indent) fail(line.number, "this line is indented more than the lines around it.");
      if (line.text === "-" || line.text.startsWith("- ")) {
        fail(line.number, "a list item cannot sit among keys; indent the list under its key.");
      }
      this.position += 1;
      entries.push(this.entry(line, line.text, indent, depth));
    }
    return { kind: "mapping", entries: unique(entries), line: startLine };
  }

  /** A `key: value` whose text is `text`, on `line`; `indent` is the column of the key. */
  private entry(line: Line, text: string, indent: number, depth: number): YamlEntry {
    const colon = colonOf(text);
    if (colon === -1) fail(line.number, `"${text.slice(0, 40)}" is not a "key: value" pair.`);
    const keyText = text.slice(0, colon).trim();
    if (keyText === "") fail(line.number, "a key is empty.");
    const key =
      keyText[0] === '"' || keyText[0] === "'"
        ? (scalar(keyText, line.number) as { value: string }).value
        : keyText;
    if (/^[&*!|>%@`{}[?]/.test(keyText) && keyText[0] !== '"' && keyText[0] !== "'") {
      fail(line.number, `"${keyText[0]}" starts something this file does not take.`);
    }
    const rest = text.slice(colon + 1).trim();
    let value: YamlNode;
    if (rest !== "") {
      value = scalar(rest, line.number);
    } else {
      const next = this.peek();
      // `key:` then a deeper block, or a list at the key's own indent (YAML allows that), or nothing.
      const sameIndentList =
        next !== undefined && next.indent === indent && (next.text === "-" || next.text.startsWith("- "));
      if (next !== undefined && (next.indent > indent || sameIndentList)) {
        value = this.block(sameIndentList ? indent : indent + 1, depth + 1);
      } else {
        value = { kind: "null", line: line.number };
      }
    }
    return { key, line: line.number, value };
  }

  private sequence(indent: number, depth: number): YamlNode {
    const items: YamlNode[] = [];
    const startLine = this.peek()?.number ?? 1;
    for (;;) {
      const line = this.peek();
      if (line === undefined || line.indent < indent) break;
      if (line.indent > indent) fail(line.number, "this line is indented more than the lines around it.");
      if (!(line.text === "-" || line.text.startsWith("- "))) break;
      this.position += 1;
      const rest = line.text.slice(1).trimStart();
      const offset = indent + (line.text.length - rest.length);
      if (rest === "") {
        const next = this.peek();
        items.push(
          next !== undefined && next.indent > indent
            ? this.block(indent + 1, depth + 1)
            : { kind: "null", line: line.number },
        );
      } else if (colonOf(rest) !== -1 && rest[0] !== "[") {
        // `- key: value`: a mapping whose first key is on this line and whose others line up under it.
        const first = this.entry(line, rest, offset, depth + 1);
        const entries = [first];
        for (;;) {
          const next = this.peek();
          if (next === undefined || next.indent !== offset) {
            if (next !== undefined && next.indent > indent && next.indent !== offset) {
              fail(next.number, "this line is not lined up with the keys of its list item.");
            }
            break;
          }
          if (next.text === "-" || next.text.startsWith("- ")) break;
          this.position += 1;
          entries.push(this.entry(next, next.text, offset, depth + 1));
        }
        items.push({ kind: "mapping", entries: unique(entries), line: line.number });
      } else {
        items.push(scalar(rest, line.number));
      }
    }
    return { kind: "sequence", items, line: startLine };
  }
}

/** Reads `source` as the config subset of YAML. An empty file is a `null` node. */
export function parseYamlSubset(source: string): YamlNode {
  const lines = splitLines(source);
  const first = lines[0];
  if (first === undefined) return { kind: "null", line: 1 };
  if (first.text === "---" || first.text === "...")
    fail(first.number, "document markers are not taken: one document per file.");
  const reader = new Reader(lines);
  const node = reader.block(0, 0);
  const extra = reader.peek();
  if (extra !== undefined) fail(extra.number, "this line is not part of the file's top level.");
  return node;
}
