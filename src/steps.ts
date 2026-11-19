/**
 * The step grammar (spec 4.1), shared by `--states`, `--flow` and the config file's steps: text in, typed steps
 * out. It only reads text. It runs nothing, opens no browser and builds no selector: a step names its element by
 * role and accessible name, or by one CSS selector checked here, and the code that drives the page (not this
 * file) turns that into a Playwright locator. docs/STEPS.md is the grammar for people, with every error.
 *
 * A step that does not parse is a refusal (exit 2): `StepError` is a `Refusal` whose `Error:` line names where
 * the steps came from, the step's number, the step itself and the column, and whose `Hint:` line says what was
 * expected.
 */
import type { Page } from "playwright-core";
import { KEY_NAMES, MODIFIER_KEYS } from "./keys.js";
import { printableLine } from "./printable.js";
import { Refusal } from "./refusal.js";

/** A role `getByRole()` accepts, from playwright-core's own types. */
export type AriaRole = NonNullable<Parameters<Page["getByRole"]>[0]>;

/** The element a step acts on: by role and accessible name (the name optional only in `wait`), or by CSS. */
export type Target = { by: "role"; role: AriaRole; name?: string } | { by: "css"; selector: string };

/** One parsed step. `formatStep` writes it back as text that parses to the same step. */
export type Step =
  /** `Tab`, `Shift+Tab`, `Enter`: one key, or modifiers and a key, exactly as Playwright's `press()` takes it. */
  | { kind: "press"; key: string }
  /** `Tab to combobox 'Time zone'`: press Tab until focus is on the target. */
  | { kind: "tabTo"; target: Target }
  /** `click button 'Menu'`, `click css '#menu'`. */
  | { kind: "click"; target: Target }
  /** `type 'Ada'`: type the text into the focused element. */
  | { kind: "type"; text: string }
  /** `wait dialog`, `wait dialog 'Delete account'`: wait for the target to be visible. */
  | { kind: "wait"; target: Target }
  /** The media steps, in states only. */
  | { kind: "colorScheme"; scheme: "light" | "dark" }
  | { kind: "viewport"; width: number; height: number }
  | { kind: "reducedMotion" };

/** A state from `--states "<name>: <steps>"`. */
export interface State {
  name: string;
  steps: Step[];
}

/** Where steps are used. The media steps set a state's media, so they are refused in a flow. */
export type StepUse = "state" | "flow";

export interface StepOptions {
  /** Where the text came from, as the `Error:` line names it: `--flow`, or a config file and its line. */
  source: string;
  use: StepUse;
}

/** The widest and tallest `viewport` a step may set, in CSS pixels. */
export const MAX_VIEWPORT = 10_000;

/** The longest state name. */
export const MAX_STATE_NAME = 64;

/** Which rule a step broke, for tests and for code that wants to tell the refusals apart. */
export type StepErrorCode =
  | "no-steps"
  | "empty-step"
  | "one-step-only"
  | "unclosed-quote"
  | "control-character"
  | "not-a-step"
  | "not-a-key"
  | "extra"
  | "no-target"
  | "no-role"
  | "not-a-role"
  | "no-name"
  | "no-text"
  | "no-selector"
  | "not-quoted"
  | "wrong-quote"
  | "empty-quoted"
  | "selector-chain"
  | "selector-engine"
  | "not-a-color-scheme"
  | "not-a-viewport"
  | "media-in-flow"
  | "no-colon"
  | "no-state-name"
  | "not-a-state-name"
  | "reserved-state-name";

/** A step that does not parse: a refusal whose `Error:` line names the step and where in the text it went wrong. */
export class StepError extends Refusal {
  readonly code: StepErrorCode;
  /** Where the text came from, such as `--flow`. */
  readonly source: string;
  /** The step's number, from 1; `undefined` for a config step (one per string) and a state's name. */
  readonly step: number | undefined;
  /** The column the problem starts at, from 1, counted in characters from the start of the whole text given. */
  readonly column: number;
  /** The problem alone, without where it is. */
  readonly problem: string;

  constructor(
    code: StepErrorCode,
    at: { source: string; step: number | undefined; text: string; column: number },
    problem: string,
    hint: string,
  ) {
    const step = at.step === undefined ? "" : ` step ${at.step}`;
    const text = at.text === "" ? "" : ` ${quoted(at.text)}`;
    super(`${at.source}${step}${text}, column ${at.column}: ${problem}`, hint);
    this.name = "StepError";
    this.code = code;
    this.source = at.source;
    this.step = at.step;
    this.column = at.column;
    this.problem = problem;
  }
}

// Every role getByRole() takes. A Record, so the type checker fails when playwright-core adds or drops a role.
const ROLE_TABLE: Record<AriaRole, true> = {
  alert: true,
  alertdialog: true,
  application: true,
  article: true,
  banner: true,
  blockquote: true,
  button: true,
  caption: true,
  cell: true,
  checkbox: true,
  code: true,
  columnheader: true,
  combobox: true,
  complementary: true,
  contentinfo: true,
  definition: true,
  deletion: true,
  dialog: true,
  directory: true,
  document: true,
  emphasis: true,
  feed: true,
  figure: true,
  form: true,
  generic: true,
  grid: true,
  gridcell: true,
  group: true,
  heading: true,
  img: true,
  insertion: true,
  link: true,
  list: true,
  listbox: true,
  listitem: true,
  log: true,
  main: true,
  marquee: true,
  math: true,
  meter: true,
  menu: true,
  menubar: true,
  menuitem: true,
  menuitemcheckbox: true,
  menuitemradio: true,
  navigation: true,
  none: true,
  note: true,
  option: true,
  paragraph: true,
  presentation: true,
  progressbar: true,
  radio: true,
  radiogroup: true,
  region: true,
  row: true,
  rowgroup: true,
  rowheader: true,
  scrollbar: true,
  search: true,
  searchbox: true,
  separator: true,
  slider: true,
  spinbutton: true,
  status: true,
  strong: true,
  subscript: true,
  superscript: true,
  switch: true,
  tab: true,
  table: true,
  tablist: true,
  tabpanel: true,
  term: true,
  textbox: true,
  time: true,
  timer: true,
  toolbar: true,
  tooltip: true,
  tree: true,
  treegrid: true,
  treeitem: true,
};

/** Every ARIA role a step may name. */
export const ROLES: ReadonlySet<string> = new Set(Object.keys(ROLE_TABLE));

const STEP_WORDS = ["click", "type", "wait", "colorScheme", "viewport", "reducedMotion"];
const MEDIA_WORDS = new Set(["colorScheme", "viewport", "reducedMotion"]);
const COLOR_SCHEMES = new Set(["light", "dark"]);
const STATE_NAME = /^[a-z0-9][a-z0-9_-]*$/;
const RESERVED_STATE = "default";

// A name or text may not hold these: every C0 control (tab and newline included), DEL, the C1 controls, and the
// bidirectional embeddings, overrides and isolates, which make text read in an order other than the one it is in.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/;
const SPACE = /\s/;
const QUOTE = "'";
// Quotes people paste from documents and other languages, in place of the straight single quote.
const WRONG_QUOTES = ['"', "‘", "’", "“", "”", "`"];

const STEP_HINT =
  "a step is a key (Tab, Shift+Tab, Enter, Space, Escape, ArrowDown), Tab to, click, type, wait, colorScheme, viewport or reducedMotion.";
const QUOTE_HINT = "write it in ' quotes, such as 'Save changes', and a ' inside it twice: 'Don''t save'.";
const TARGET_HINT = "name the element by role and name, such as button 'Menu', or by selector: css '#menu'.";
const STATE_HINT = 'write --states "<name>: <steps>", such as --states "menu-open: click button \'Menu\'".';

// Case-insensitive lookups, for "did you mean" on a word written in the wrong case.
const KEY_BY_LOWER = new Map(
  [...KEY_NAMES].filter((key) => key.length > 1).map((key) => [key.toLowerCase(), key] as const),
);
const WORD_BY_LOWER = new Map(STEP_WORDS.map((word) => [word.toLowerCase(), word] as const));

interface Token {
  kind: "word" | "quoted";
  value: string;
  /** The token as written, quotes included. */
  raw: string;
  /** Index into the whole text's characters. */
  at: number;
}

interface Span {
  start: number;
  end: number;
}

// What every error inside one step needs to say where it is.
interface StepContext {
  source: string;
  use: StepUse;
  chars: readonly string[];
  step: number | undefined;
  span: Span;
}

/** A selector that starts like `xpath=//a`, `text=Menu` or `id=foo`: Playwright's own engine prefixes. */
const SELECTOR_ENGINE = /^[a-z-]+=/;

/** Parses `;`-separated steps, as `--flow` gives them. */
export function parseSteps(text: string, options: StepOptions): Step[] {
  const chars = [...text];
  return parseRange(chars, { start: 0, end: chars.length }, options, "");
}

/** Parses one step, as a config file gives them (one string per step, so a `;` in it is refused). */
export function parseStep(text: string, options: StepOptions): Step {
  const chars = [...text];
  const { spans, separators } = splitSteps(chars, { start: 0, end: chars.length }, options.source, false);
  const first = separators[0];
  if (first !== undefined) {
    throw new StepError(
      "one-step-only",
      { source: options.source, step: undefined, text, column: first + 1 },
      'a config step is one step, and this one has a ";" in it.',
      'put each step in a string of its own: steps: ["Tab", "Enter"].',
    );
  }
  const span = trimmed(chars, spans[0] ?? { start: 0, end: 0 });
  if (span.start === span.end) {
    throw new StepError(
      "empty-step",
      { source: options.source, step: undefined, text: "", column: span.start + 1 },
      "the step is empty.",
      STEP_HINT,
    );
  }
  return parseOne({ source: options.source, use: options.use, chars, step: undefined, span });
}

/** Parses one `--states` value, `<name>: <steps>`. The steps may include the media steps. */
export function parseState(text: string, options: { source?: string } = {}): State {
  const source = options.source ?? "--states";
  const chars = [...text];
  const colon = chars.indexOf(":");
  const quote = chars.indexOf(QUOTE);
  if (colon === -1 || (quote !== -1 && quote < colon)) {
    throw new StepError(
      "no-colon",
      { source, step: undefined, text, column: 1 },
      `${source} needs a state name and a ":" before the steps.`,
      STATE_HINT,
    );
  }
  const nameSpan = trimmed(chars, { start: 0, end: colon });
  const name = chars.slice(nameSpan.start, nameSpan.end).join("");
  checkStateName(name, { source, text, column: nameSpan.start + 1 });
  const steps = parseRange(chars, { start: colon + 1, end: chars.length }, { source, use: "state" }, text);
  return { name, steps };
}

/**
 * Checks a state's name, for a config file's `states[].name`, and returns it. A name is lower-case letters,
 * digits, `-` and `_`, starts with a letter or a digit, and is at most 64 characters. `default` is the state
 * every page is scanned in first, so no other state may take it.
 */
export function parseStateName(name: string, source: string): string {
  checkStateName(name, { source, text: name, column: 1 });
  return name;
}

/** Writes one step as text. `parseStep(formatStep(step))` is the same step. */
export function formatStep(step: Step): string {
  switch (step.kind) {
    case "press":
      return step.key;
    case "tabTo":
      return `Tab to ${formatTarget(step.target)}`;
    case "click":
      return `click ${formatTarget(step.target)}`;
    case "type":
      return `type ${quote(step.text)}`;
    case "wait":
      return `wait ${formatTarget(step.target)}`;
    case "colorScheme":
      return `colorScheme ${step.scheme}`;
    case "viewport":
      return `viewport ${step.width}x${step.height}`;
    case "reducedMotion":
      return "reducedMotion";
  }
}

/** Writes steps as `--flow` takes them, separated by `; `. */
export function formatSteps(steps: readonly Step[]): string {
  return steps.map(formatStep).join("; ");
}

/** Writes a state as `--states` takes it. */
export function formatState(state: State): string {
  return `${state.name}: ${formatSteps(state.steps)}`;
}

/** A name, text or selector in quotes, with each `'` in it written twice. */
export function quote(text: string): string {
  return `${QUOTE}${text.replaceAll(QUOTE, QUOTE + QUOTE)}${QUOTE}`;
}

function formatTarget(target: Target): string {
  if (target.by === "css") return `css ${quote(target.selector)}`;
  return target.name === undefined ? target.role : `${target.role} ${quote(target.name)}`;
}

// --- Parsing ---------------------------------------------------------------------------------------------------

// `whole` is the text an error before the first step quotes: a state's whole value, or nothing for a flow.
function parseRange(chars: readonly string[], range: Span, options: StepOptions, whole: string): Step[] {
  const { source } = options;
  const steps = trimmed(chars, range);
  if (steps.start === steps.end) {
    throw new StepError(
      "no-steps",
      { source, step: undefined, text: whole, column: steps.start + 1 },
      options.use === "state" ? "the state has no steps after its name." : "there are no steps.",
      options.use === "state"
        ? "give the state at least one step, such as --states \"menu-open: click button 'Menu'\"."
        : "give at least one step, such as: Tab; Enter",
    );
  }
  const { spans } = splitSteps(chars, range, source, true);
  return spans.map((raw, index) => {
    const span = trimmed(chars, raw);
    const step = index + 1;
    if (span.start === span.end) {
      throw new StepError(
        "empty-step",
        { source, step, text: "", column: span.start + 1 },
        "the step is empty.",
        'remove the extra ";", or write a step between the two.',
      );
    }
    return parseOne({ source, use: options.use, chars, step, span });
  });
}

// Splits at each `;` outside quotes. A quote left open is refused here, since it hides every `;` after it.
function splitSteps(
  chars: readonly string[],
  range: Span,
  source: string,
  numbered: boolean,
): { spans: Span[]; separators: number[] } {
  const spans: Span[] = [];
  const separators: number[] = [];
  let start = range.start;
  let open = -1;
  for (let i = range.start; i < range.end; i++) {
    const char = chars[i];
    if (open !== -1) {
      if (char !== QUOTE) continue;
      if (i + 1 < range.end && chars[i + 1] === QUOTE) i++;
      else open = -1;
    } else if (char === QUOTE) {
      open = i;
    } else if (char === ";") {
      spans.push({ start, end: i });
      separators.push(i);
      start = i + 1;
    }
  }
  if (open !== -1) {
    const span = trimmed(chars, { start, end: range.end });
    throw new StepError(
      "unclosed-quote",
      {
        source,
        step: numbered ? spans.length + 1 : undefined,
        text: chars.slice(span.start, span.end).join(""),
        column: open + 1,
      },
      "this quote is never closed.",
      QUOTE_HINT,
    );
  }
  spans.push({ start, end: range.end });
  return { spans, separators };
}

function parseOne(ctx: StepContext): Step {
  const tokens = tokenize(ctx);
  const [first, ...rest] = tokens as [Token, ...Token[]];
  if (first.kind === "quoted") {
    throw fail(
      ctx,
      "not-a-step",
      first,
      `a step starts with a word, not with ${quoted(first.raw)}.`,
      STEP_HINT,
    );
  }
  const word = first.value;
  if (MEDIA_WORDS.has(word) && ctx.use === "flow") {
    throw fail(
      ctx,
      "media-in-flow",
      first,
      `${word} sets a state's media, and a flow has no media.`,
      'put it in a state instead: --states "dark: colorScheme dark", or a state\'s steps in the config.',
    );
  }
  switch (word) {
    case "click":
      return { kind: "click", target: parseTarget(ctx, first, rest, true) };
    case "wait":
      return { kind: "wait", target: parseTarget(ctx, first, rest, false) };
    case "type":
      return { kind: "type", text: parseType(ctx, first, rest) };
    case "colorScheme":
      return { kind: "colorScheme", scheme: parseColorScheme(ctx, first, rest) };
    case "viewport":
      return { kind: "viewport", ...parseViewport(ctx, first, rest) };
    case "reducedMotion":
      noMore(ctx, first, rest, 0);
      return { kind: "reducedMotion" };
  }
  const second = rest[0];
  if (word === "Tab" && second?.kind === "word" && second.value === "to") {
    return { kind: "tabTo", target: parseTarget(ctx, second, rest.slice(1), true, "Tab to") };
  }
  const key = parseKey(ctx, first);
  noMore(ctx, first, rest, 0);
  return { kind: "press", key };
}

// Words and quoted strings, separated by white space. A quote also ends a word: button'Menu' is two tokens.
function tokenize(ctx: StepContext): Token[] {
  const { chars, span } = ctx;
  const tokens: Token[] = [];
  let i = span.start;
  while (i < span.end) {
    const char = chars[i] as string;
    if (SPACE.test(char)) {
      i++;
    } else if (char === QUOTE) {
      const at = i;
      let value = "";
      i++;
      for (;;) {
        // splitSteps has already refused a quote that is never closed.
        const inner = chars[i] as string;
        if (inner === QUOTE) {
          if (chars[i + 1] === QUOTE) {
            value += QUOTE;
            i += 2;
            continue;
          }
          i++;
          break;
        }
        if (CONTROL.test(inner)) {
          throw new StepError(
            "control-character",
            { source: ctx.source, step: ctx.step, text: stepText(ctx), column: i + 1 },
            `a quoted name or text cannot hold a control character, and this one holds ${codeOf(inner)}.`,
            "write it as one line of plain text; to press Enter or Tab, make that a step of its own.",
          );
        }
        value += inner;
        i++;
      }
      tokens.push({ kind: "quoted", value, raw: chars.slice(at, i).join(""), at });
    } else {
      const at = i;
      while (i < span.end && !SPACE.test(chars[i] as string) && chars[i] !== QUOTE) i++;
      const value = chars.slice(at, i).join("");
      tokens.push({ kind: "word", value, raw: value, at });
    }
  }
  return tokens;
}

function parseTarget(
  ctx: StepContext,
  after: Token,
  rest: readonly Token[],
  needsName: boolean,
  step = after.value,
): Target {
  const first = rest[0];
  if (first === undefined) {
    throw fail(ctx, "no-target", after, `${step} needs an element after it.`, TARGET_HINT);
  }
  if (first.kind === "quoted") {
    throw fail(
      ctx,
      "no-role",
      first,
      `${step} needs a role before the name, such as ${step} button ${first.raw}.`,
      TARGET_HINT,
    );
  }
  if (first.value === "css") {
    const selector = expectQuoted(
      ctx,
      first,
      rest[1],
      "no-selector",
      `css needs a selector after it, in quotes.`,
    );
    if (selector.value === "") {
      throw fail(ctx, "empty-quoted", selector, "the selector is empty.", TARGET_HINT);
    }
    const raw = [...selector.raw];
    const chain = raw.findIndex((char, i) => char === ">" && raw[i + 1] === ">");
    if (chain !== -1) {
      throw new StepError(
        "selector-chain",
        { source: ctx.source, step: ctx.step, text: stepText(ctx), column: selector.at + chain + 1 },
        'a selector cannot hold ">>", which Playwright reads as a chain into another kind of selector.',
        "write one CSS selector, such as css 'nav > ul > li', or name the element by role and name.",
      );
    }
    // The driver passes a selector as `css=<selector>`, so an engine prefix is only invalid CSS there. It is
    // refused here as well, so the mistake reads as a refusal before anything runs.
    const engine = SELECTOR_ENGINE.exec(selector.value);
    if (engine !== null) {
      throw new StepError(
        "selector-engine",
        { source: ctx.source, step: ctx.step, text: stepText(ctx), column: selector.at + 2 },
        `a selector cannot start with "${engine[0]}", which Playwright reads as another kind of selector.`,
        "write one CSS selector, such as css '#menu', or name the element by role and name.",
      );
    }
    noMore(ctx, selector, rest, 2);
    return { by: "css", selector: selector.value };
  }
  if (!ROLES.has(first.value)) {
    const lower = first.value.toLowerCase();
    const meant = ROLES.has(lower) ? ` Did you mean ${lower}?` : "";
    throw fail(
      ctx,
      "not-a-role",
      first,
      `${quoted(first.value)} is not an ARIA role.${meant}`,
      "use a role such as button, link, textbox, combobox, checkbox, menu or dialog, or a selector: css '#menu'.",
    );
  }
  const role = first.value as AriaRole;
  const nameToken = rest[1];
  if (nameToken === undefined && !needsName) return { by: "role", role };
  const words = rest
    .slice(1)
    .map((token) => token.value)
    .join(" ");
  const name = expectQuoted(
    ctx,
    first,
    nameToken,
    "no-name",
    `${step} ${role} needs the element's name after the role, in quotes.`,
    `write it as ${step} ${role} ${quote(words || "Name")}.`,
  );
  if (name.value === "") {
    throw fail(
      ctx,
      "empty-quoted",
      name,
      "the name is empty.",
      "write the element's accessible name in the quotes.",
    );
  }
  noMore(ctx, name, rest, 2);
  return { by: "role", role, name: name.value };
}

function parseType(ctx: StepContext, first: Token, rest: readonly Token[]): string {
  const words = rest.map((token) => token.value).join(" ");
  const text = expectQuoted(
    ctx,
    first,
    rest[0],
    "no-text",
    "type needs the text to type after it, in quotes.",
    `write it as type ${quote(words || "text")}.`,
  );
  if (text.value === "") {
    throw fail(
      ctx,
      "empty-quoted",
      text,
      "the text to type is empty.",
      "write the text to type in the quotes.",
    );
  }
  noMore(ctx, text, rest, 1);
  return text.value;
}

function parseColorScheme(ctx: StepContext, first: Token, rest: readonly Token[]): "light" | "dark" {
  const value = rest[0];
  if (value === undefined || value.kind !== "word" || !COLOR_SCHEMES.has(value.value)) {
    const found = value === undefined ? "" : `, not ${quoted(value.raw)}`;
    throw fail(
      ctx,
      "not-a-color-scheme",
      value ?? first,
      `colorScheme takes light or dark${found}.`,
      "write colorScheme dark, or colorScheme light.",
    );
  }
  noMore(ctx, value, rest, 1);
  return value.value as "light" | "dark";
}

function parseViewport(
  ctx: StepContext,
  first: Token,
  rest: readonly Token[],
): { width: number; height: number } {
  const value = rest[0];
  const size = value?.kind === "word" ? /^(\d+)x(\d+)$/.exec(value.value) : null;
  const width = Number(size?.[1]);
  const height = Number(size?.[2]);
  const fits = (n: number) => n >= 1 && n <= MAX_VIEWPORT;
  if (value === undefined || size === null || !fits(width) || !fits(height)) {
    const found = value === undefined ? "" : `, not ${quoted(value.raw)}`;
    throw fail(
      ctx,
      "not-a-viewport",
      value ?? first,
      `viewport takes a width and a height in CSS pixels, from 1 to ${MAX_VIEWPORT}${found}.`,
      "write it as viewport 1280x800, or viewport 390x844 for a phone.",
    );
  }
  noMore(ctx, value, rest, 1);
  return { width, height };
}

// A key or a combination, split at "+" the way Playwright's press() splits it: a "+" right at the start of a
// part is the "+" key itself, so "+" and "Shift++" are keys.
function parseKey(ctx: StepContext, token: Token): string {
  const parts: string[] = [];
  let part = "";
  for (const char of token.value) {
    if (char === "+" && part !== "") {
      parts.push(part);
      part = "";
    } else {
      part += char;
    }
  }
  parts.push(part);
  const key = parts.at(-1) as string;
  const modifiers = parts.slice(0, -1);
  const keyHint =
    "keys are written as Playwright names them, such as Tab, Shift+Tab, Enter, Escape, ArrowDown or Control+a.";
  if (parts.length === 1 && !KEY_NAMES.has(key)) {
    const meant = WORD_BY_LOWER.get(key.toLowerCase()) ?? suggestKey(parts);
    const suggestion = meant === undefined ? "" : ` Did you mean ${meant}?`;
    throw fail(ctx, "not-a-step", token, `${quoted(token.value)} is not a step.${suggestion}`, STEP_HINT);
  }
  const meant = suggestKey(parts);
  if (meant !== undefined && meant !== token.value) {
    throw fail(
      ctx,
      "not-a-key",
      token,
      `${quoted(token.value)} is not a key. Did you mean ${meant}?`,
      keyHint,
    );
  }
  if (key === "") {
    throw fail(ctx, "not-a-key", token, `${quoted(token.value)} has no key after its last "+".`, keyHint);
  }
  const notModifier = modifiers.find((modifier) => !MODIFIER_KEYS.has(modifier));
  if (notModifier !== undefined) {
    throw fail(
      ctx,
      "not-a-key",
      token,
      `in ${quoted(token.value)}, ${quoted(notModifier)} is not a modifier; only Shift, Control, Alt, Meta and ControlOrMeta come before a "+".`,
      keyHint,
    );
  }
  if (!KEY_NAMES.has(key)) {
    throw fail(ctx, "not-a-key", token, `in ${quoted(token.value)}, ${quoted(key)} is not a key.`, keyHint);
  }
  return token.value;
}

// The key or combination with each part in its right case, if that makes every part a key.
function suggestKey(parts: readonly string[]): string | undefined {
  const fixed = parts.map((part) => (KEY_NAMES.has(part) ? part : KEY_BY_LOWER.get(part.toLowerCase())));
  if (fixed.some((part) => part === undefined)) return undefined;
  const modifiers = fixed.slice(0, -1);
  if (!modifiers.every((modifier) => MODIFIER_KEYS.has(modifier as string))) return undefined;
  return fixed.join("+");
}

function expectQuoted(
  ctx: StepContext,
  before: Token,
  token: Token | undefined,
  code: StepErrorCode,
  missing: string,
  hint = QUOTE_HINT,
): Token {
  if (token === undefined) throw fail(ctx, code, before, missing, hint);
  if (token.kind === "quoted") return token;
  const wrong = WRONG_QUOTES.find((mark) => token.value.startsWith(mark));
  if (wrong !== undefined) {
    throw fail(
      ctx,
      "wrong-quote",
      token,
      `names, text and selectors go in straight single quotes ('), and this one starts with ${wrong}.`,
      QUOTE_HINT,
    );
  }
  throw fail(ctx, "not-quoted", token, `${quoted(token.value)} must be in quotes.`, hint);
}

function noMore(ctx: StepContext, last: Token, rest: readonly Token[], used: number): void {
  const extra = rest[used];
  if (extra === undefined) return;
  const step = slice(ctx, ctx.span.start, last.at + [...last.raw].length);
  throw fail(
    ctx,
    "extra",
    extra,
    `${quoted(extra.raw)} is more than the step takes; the step ${quoted(step)} ends before it.`,
    "separate steps with \";\", as in Tab; Enter. To move focus to an element: Tab to button 'Save'.",
  );
}

function fail(ctx: StepContext, code: StepErrorCode, token: Token, problem: string, hint: string): StepError {
  return new StepError(
    code,
    { source: ctx.source, step: ctx.step, text: stepText(ctx), column: token.at + 1 },
    problem,
    hint,
  );
}

function checkStateName(name: string, at: { source: string; text: string; column: number }): void {
  const where = { source: at.source, step: undefined, text: at.text, column: at.column };
  if (name === "") {
    throw new StepError("no-state-name", where, 'the state has no name before the ":".', STATE_HINT);
  }
  if (name === RESERVED_STATE) {
    throw new StepError(
      "reserved-state-name",
      where,
      'the state cannot be called "default": that is the state every page is scanned in first.',
      "give it a name of its own, such as menu-open or dark.",
    );
  }
  if (!STATE_NAME.test(name) || [...name].length > MAX_STATE_NAME) {
    const kebab = name
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^[-_]+|-+$/g, "")
      .slice(0, MAX_STATE_NAME);
    const like = STATE_NAME.test(kebab) && kebab !== RESERVED_STATE ? kebab : "menu-open";
    throw new StepError(
      "not-a-state-name",
      where,
      `${quoted(name)} is not a state name: a name is lower-case letters, digits, "-" and "_", up to ${MAX_STATE_NAME} characters, starting with a letter or a digit.`,
      `name it like ${like}.`,
    );
  }
}

// --- Helpers ---------------------------------------------------------------------------------------------------

function trimmed(chars: readonly string[], span: Span): Span {
  let { start, end } = span;
  while (start < end && SPACE.test(chars[start] as string)) start++;
  while (end > start && SPACE.test(chars[end - 1] as string)) end--;
  return { start, end };
}

function slice(ctx: StepContext, start: number, end: number): string {
  return ctx.chars.slice(start, end).join("");
}

function stepText(ctx: StepContext): string {
  return slice(ctx, ctx.span.start, ctx.span.end);
}

const SHOWN = 60;

// Text from the person, made safe to print on one line and cut short, in double quotes.
function quoted(text: string): string {
  const line = [...printableLine(text)];
  const shown = line.length > SHOWN ? `${line.slice(0, SHOWN - 3).join("")}...` : line.join("");
  return `"${shown}"`;
}

function codeOf(char: string): string {
  return `U+${(char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}`;
}
