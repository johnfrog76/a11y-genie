/**
 * Page text, made safe to put in `report.html` (spec 8A.1, "Text from the page in our outputs"). A scanned page
 * chooses its own markup, names, live text and addresses, and a baseline `scan.json` is untrusted input too, so
 * every piece of text the report shows goes through `escapeHtml`: first `printable` (src/printable.ts) takes
 * out terminal escapes and control characters, then the five characters HTML gives a meaning to become
 * character references. The result is text in an element or in a quoted attribute, and never markup.
 *
 * `markup` is a tagged template that does this to every value put into it, so a value cannot be left unescaped
 * by forgetting to: only an `Html` value (one `markup` made) goes in as it is.
 */

import { printable } from "./printable.js";

const REFERENCES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** `text`, printable, with `& < > " '` as character references: safe in an element and in a quoted attribute. */
export function escapeHtml(text: string): string {
  return printable(text).replace(/[&<>"']/g, (char) => REFERENCES[char] ?? char);
}

/** Markup this tool made. Only `markup` makes one, so a page's text cannot become one. */
export class Html {
  readonly #markup: string;
  private constructor(markup: string) {
    this.#markup = markup;
  }
  /** For `markup` alone: markup already built from escaped parts. */
  static trusted(markup: string): Html {
    return new Html(markup);
  }
  toString(): string {
    return this.#markup;
  }
}

/** A value `markup` accepts: text (escaped), a number, markup, a list of them, or nothing. */
export type HtmlValue = string | number | Html | readonly HtmlValue[] | undefined | null | false;

function part(value: HtmlValue): string {
  if (value === undefined || value === null || value === false) return "";
  if (value instanceof Html) return value.toString();
  if (Array.isArray(value)) return value.map(part).join("");
  return escapeHtml(String(value));
}

/** Markup from a template: every value is escaped with `escapeHtml`, except an `Html` value, which goes in as it is. */
export function markup(strings: TemplateStringsArray, ...values: HtmlValue[]): Html {
  let out = strings[0] ?? "";
  values.forEach((value, index) => {
    out += part(value) + (strings[index + 1] ?? "");
  });
  return Html.trusted(out);
}

/**
 * Whether an address may be a link in the report: `https:` only, so a `javascript:`, `data:` or `file:` address,
 * or anything else a page or a baseline could put there, is shown as text and never followed.
 */
export function linkable(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}
