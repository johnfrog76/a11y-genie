import { describe, expect, it } from "vitest";
import { Refusal } from "../../src/refusal.js";
import {
  type Step,
  type StepErrorCode,
  type StepUse,
  StepError,
  formatState,
  formatStep,
  formatSteps,
  parseState,
  parseStateName,
  parseStep,
  parseSteps,
  quote,
} from "../../src/steps.js";

// The step grammar (spec 4.1), shared by --states, --flow and the config file. docs/STEPS.md is the same
// grammar in words; every form and every error there has a row here.

const flow = (text: string) => parseSteps(text, { source: "--flow", use: "flow" });
const state = (text: string) => parseSteps(text, { source: "--states", use: "state" });

function refusal(run: () => unknown): StepError {
  try {
    run();
  } catch (error) {
    if (error instanceof StepError) return error;
    throw error;
  }
  throw new Error("expected a StepError, and nothing was thrown");
}

describe("every step form", () => {
  it.each<[string, StepUse, Step]>([
    // Keys, any name Playwright presses, alone or with modifiers.
    ["Tab", "flow", { kind: "press", key: "Tab" }],
    ["Shift+Tab", "flow", { kind: "press", key: "Shift+Tab" }],
    ["Enter", "flow", { kind: "press", key: "Enter" }],
    ["Space", "flow", { kind: "press", key: "Space" }],
    ["Escape", "flow", { kind: "press", key: "Escape" }],
    ["ArrowDown", "flow", { kind: "press", key: "ArrowDown" }],
    ["PageDown", "flow", { kind: "press", key: "PageDown" }],
    ["F6", "flow", { kind: "press", key: "F6" }],
    ["a", "flow", { kind: "press", key: "a" }],
    ["A", "flow", { kind: "press", key: "A" }],
    ["?", "flow", { kind: "press", key: "?" }],
    ["Semicolon", "flow", { kind: "press", key: "Semicolon" }],
    ["Quote", "flow", { kind: "press", key: "Quote" }],
    ["Control+a", "flow", { kind: "press", key: "Control+a" }],
    ["ControlOrMeta+KeyA", "flow", { kind: "press", key: "ControlOrMeta+KeyA" }],
    ["Control+Alt+Delete", "flow", { kind: "press", key: "Control+Alt+Delete" }],
    ["+", "flow", { kind: "press", key: "+" }],
    ["Shift++", "flow", { kind: "press", key: "Shift++" }],
    // Tab to an element.
    [
      "Tab to combobox 'Time zone'",
      "flow",
      { kind: "tabTo", target: { by: "role", role: "combobox", name: "Time zone" } },
    ],
    ["Tab to tab 'Billing'", "flow", { kind: "tabTo", target: { by: "role", role: "tab", name: "Billing" } }],
    ["Tab to css '#save'", "flow", { kind: "tabTo", target: { by: "css", selector: "#save" } }],
    // Click.
    ["click button 'Menu'", "state", { kind: "click", target: { by: "role", role: "button", name: "Menu" } }],
    [
      "click link 'Sign in'",
      "flow",
      { kind: "click", target: { by: "role", role: "link", name: "Sign in" } },
    ],
    ["click css '#menu-toggle'", "state", { kind: "click", target: { by: "css", selector: "#menu-toggle" } }],
    // Type.
    ["type 'Ada Lovelace'", "flow", { kind: "type", text: "Ada Lovelace" }],
    // Wait, with or without a name.
    ["wait menu", "state", { kind: "wait", target: { by: "role", role: "menu" } }],
    [
      "wait dialog 'Delete account'",
      "state",
      { kind: "wait", target: { by: "role", role: "dialog", name: "Delete account" } },
    ],
    ["wait css '.toast'", "state", { kind: "wait", target: { by: "css", selector: ".toast" } }],
    // The media steps, in states only.
    ["colorScheme dark", "state", { kind: "colorScheme", scheme: "dark" }],
    ["colorScheme light", "state", { kind: "colorScheme", scheme: "light" }],
    ["viewport 390x844", "state", { kind: "viewport", width: 390, height: 844 }],
    ["viewport 1x10000", "state", { kind: "viewport", width: 1, height: 10_000 }],
    ["reducedMotion", "state", { kind: "reducedMotion" }],
  ])("%s", (text, use, step) => {
    expect(parseSteps(text, { source: "--flow", use })).toEqual([step]);
    expect(parseStep(text, { source: "a11y-genie.yaml line 3", use })).toEqual(step);
    expect(formatStep(step)).toBe(text);
  });
});

describe("steps together", () => {
  it("parses the spec's flow", () => {
    expect(flow("Tab to combobox 'Time zone'; ArrowDown; Tab; Enter")).toEqual([
      { kind: "tabTo", target: { by: "role", role: "combobox", name: "Time zone" } },
      { kind: "press", key: "ArrowDown" },
      { kind: "press", key: "Tab" },
      { kind: "press", key: "Enter" },
    ]);
  });

  it("parses the spec's states", () => {
    expect(parseState("menu-open: click button 'Menu'")).toEqual({
      name: "menu-open",
      steps: [{ kind: "click", target: { by: "role", role: "button", name: "Menu" } }],
    });
    expect(parseState("dark: colorScheme dark")).toEqual({
      name: "dark",
      steps: [{ kind: "colorScheme", scheme: "dark" }],
    });
  });

  it("parses the spec's config steps one string at a time", () => {
    const steps = ["Tab to combobox 'Time zone'", "ArrowDown", "Tab to button 'Save'", "Enter"];
    const parsed = steps.map((text) => parseStep(text, { source: "a11y-genie.yaml line 20", use: "flow" }));
    expect(parsed).toEqual(flow(steps.join("; ")));
  });

  it("keeps the steps in the order written", () => {
    expect(state("click button 'Menu'; colorScheme dark; wait menu").map((step) => step.kind)).toEqual([
      "click",
      "colorScheme",
      "wait",
    ]);
  });

  it("takes any white space around steps and between words", () => {
    expect(flow("  Tab ;Enter;\tTab   to\tbutton   'Save'  ")).toEqual([
      { kind: "press", key: "Tab" },
      { kind: "press", key: "Enter" },
      { kind: "tabTo", target: { by: "role", role: "button", name: "Save" } },
    ]);
    expect(parseState("  dark  :   colorScheme dark ")).toEqual({
      name: "dark",
      steps: [{ kind: "colorScheme", scheme: "dark" }],
    });
  });

  it("does not need a space before a quote", () => {
    expect(flow("click button'Menu'")).toEqual(flow("click button 'Menu'"));
  });
});

describe("quoting", () => {
  it.each<[string, string, string]>([
    ["a ' written twice is one '", "type 'Don''t save'", "Don't save"],
    ["a name that is only a '", "type ''''", "'"],
    ["two in a row", "type 'a''''b'", "a''b"],
    ["a ; inside quotes is not a separator", "type 'a; b'", "a; b"],
    ["a : inside quotes", "type 'Time: now'", "Time: now"],
    ["a backslash is an ordinary character", "type 'C:\\Users'", "C:\\Users"],
    ["a double quote is an ordinary character", "type 'say \"hi\"'", 'say "hi"'],
    ["spaces at the ends are kept", "type '  padded  '", "  padded  "],
    ["other scripts and emoji", "type 'café 日本語 🧞'", "café 日本語 🧞"],
  ])("%s", (_what, text, typed) => {
    expect(flow(text)).toEqual([{ kind: "type", text: typed }]);
  });

  it("keeps a CSS selector exactly, escapes and quotes included", () => {
    const selector = String.raw`a:hover > li[data-x="1"]:nth-child(2n+1) #a\:b`;
    expect(flow(`click css ${quote(selector)}`)).toEqual([
      { kind: "click", target: { by: "css", selector } },
    ]);
    expect(flow("click css 'input[value=''it''''s'']'")).toEqual([
      { kind: "click", target: { by: "css", selector: "input[value='it''s']" } },
    ]);
  });

  it("quote() writes each ' twice", () => {
    expect(quote("Don't")).toBe("'Don''t'");
    expect(quote("")).toBe("''");
  });
});

describe("the round trip", () => {
  const tricky: Step[] = [
    { kind: "press", key: "Shift+Tab" },
    { kind: "press", key: "+" },
    { kind: "tabTo", target: { by: "role", role: "combobox", name: "It's ; here: ok" } },
    { kind: "click", target: { by: "css", selector: "a[title='x''y'] > b" } },
    { kind: "type", text: "''" },
    { kind: "wait", target: { by: "role", role: "dialog" } },
    { kind: "wait", target: { by: "role", role: "alert", name: " spaced " } },
    { kind: "colorScheme", scheme: "light" },
    { kind: "viewport", width: 1280, height: 800 },
    { kind: "reducedMotion" },
  ];

  it("parses what it formats into the same steps", () => {
    expect(state(formatSteps(tricky))).toEqual(tricky);
    for (const step of tricky)
      expect(parseStep(formatStep(step), { source: "x", use: "state" })).toEqual(step);
  });

  it("formats a state as --states takes it", () => {
    const parsed = parseState("menu-open:click button 'Menu';wait   menu");
    expect(formatState(parsed)).toBe("menu-open: click button 'Menu'; wait menu");
    expect(parseState(formatState(parsed))).toEqual(parsed);
  });

  it("writes steps the way people do, in a canonical form", () => {
    expect(formatSteps(flow("Tab;Enter ;  click   button'Menu'"))).toBe("Tab; Enter; click button 'Menu'");
  });
});

describe("parseStateName", () => {
  it.each(["menu-open", "dark", "delete-dialog", "step_2", "2col", "a".repeat(64)])("takes %s", (name) => {
    expect(parseStateName(name, "a11y-genie.yaml line 9")).toBe(name);
  });

  it.each<[string, StepErrorCode]>([
    ["", "no-state-name"],
    ["default", "reserved-state-name"],
    ["Menu", "not-a-state-name"],
    ["menu open", "not-a-state-name"],
    ["-menu", "not-a-state-name"],
    ["menu.open", "not-a-state-name"],
    ["a".repeat(65), "not-a-state-name"],
  ])("refuses %j", (name, code) => {
    expect(refusal(() => parseStateName(name, "a11y-genie.yaml line 9")).code).toBe(code);
  });
});

// Every error: its code, its column, and its exact Error: and Hint: lines.
interface ErrorRow {
  text: string;
  run: (text: string) => unknown;
  code: StepErrorCode;
  step: number | undefined;
  column: number;
  error: string;
  hint: string;
}

const STEP_HINT =
  "a step is a key (Tab, Shift+Tab, Enter, Space, Escape, ArrowDown), Tab to, click, type, wait, colorScheme, viewport or reducedMotion.";
const KEY_HINT =
  "keys are written as Playwright names them, such as Tab, Shift+Tab, Enter, Escape, ArrowDown or Control+a.";
const TARGET_HINT = "name the element by role and name, such as button 'Menu', or by selector: css '#menu'.";
const QUOTE_HINT = "write it in ' quotes, such as 'Save changes', and a ' inside it twice: 'Don''t save'.";
const EXTRA_HINT =
  "separate steps with \";\", as in Tab; Enter. To move focus to an element: Tab to button 'Save'.";
const STATE_HINT = 'write --states "<name>: <steps>", such as --states "menu-open: click button \'Menu\'".';
const ROLE_HINT =
  "use a role such as button, link, textbox, combobox, checkbox, menu or dialog, or a selector: css '#menu'.";

const configStep = (text: string) => parseStep(text, { source: "a11y-genie.yaml line 12", use: "flow" });
const states = (text: string) => parseState(text);

const ERRORS: ErrorRow[] = [
  {
    text: "",
    run: flow,
    code: "no-steps",
    step: undefined,
    column: 1,
    error: "--flow, column 1: there are no steps.",
    hint: "give at least one step, such as: Tab; Enter",
  },
  {
    text: "   ",
    run: flow,
    code: "no-steps",
    step: undefined,
    column: 4,
    error: "--flow, column 4: there are no steps.",
    hint: "give at least one step, such as: Tab; Enter",
  },
  {
    text: "Tab;",
    run: flow,
    code: "empty-step",
    step: 2,
    column: 5,
    error: "--flow step 2, column 5: the step is empty.",
    hint: 'remove the extra ";", or write a step between the two.',
  },
  {
    text: "Tab; ;Enter",
    run: flow,
    code: "empty-step",
    step: 2,
    column: 6,
    error: "--flow step 2, column 6: the step is empty.",
    hint: 'remove the extra ";", or write a step between the two.',
  },
  {
    text: "; Tab",
    run: flow,
    code: "empty-step",
    step: 1,
    column: 1,
    error: "--flow step 1, column 1: the step is empty.",
    hint: 'remove the extra ";", or write a step between the two.',
  },
  {
    text: "Tab; Enter",
    run: configStep,
    code: "one-step-only",
    step: undefined,
    column: 4,
    error:
      'a11y-genie.yaml line 12 "Tab; Enter", column 4: a config step is one step, and this one has a ";" in it.',
    hint: 'put each step in a string of its own: steps: ["Tab", "Enter"].',
  },
  {
    text: "  ",
    run: configStep,
    code: "empty-step",
    step: undefined,
    column: 3,
    error: "a11y-genie.yaml line 12, column 3: the step is empty.",
    hint: STEP_HINT,
  },
  {
    text: "Tab; click button 'Menu; Enter",
    run: flow,
    code: "unclosed-quote",
    step: 2,
    column: 19,
    error: '--flow step 2 "click button \'Menu; Enter", column 19: this quote is never closed.',
    hint: QUOTE_HINT,
  },
  {
    text: "type 'it''",
    run: flow,
    code: "unclosed-quote",
    step: 1,
    column: 6,
    error: "--flow step 1 \"type 'it''\", column 6: this quote is never closed.",
    hint: QUOTE_HINT,
  },
  {
    text: "type 'a\tb'",
    run: flow,
    code: "control-character",
    step: 1,
    column: 8,
    error:
      "--flow step 1 \"type 'a b'\", column 8: a quoted name or text cannot hold a control character, and this one holds U+0009.",
    hint: "write it as one line of plain text; to press Enter or Tab, make that a step of its own.",
  },
  {
    text: "type 'line\nbreak'",
    run: flow,
    code: "control-character",
    step: 1,
    column: 11,
    error:
      "--flow step 1 \"type 'line break'\", column 11: a quoted name or text cannot hold a control character, and this one holds U+000A.",
    hint: "write it as one line of plain text; to press Enter or Tab, make that a step of its own.",
  },
  {
    text: "click button 'a\u202eb'",
    run: flow,
    code: "control-character",
    step: 1,
    column: 16,
    error:
      "--flow step 1 \"click button 'ab'\", column 16: a quoted name or text cannot hold a control character, and this one holds U+202E.",
    hint: "write it as one line of plain text; to press Enter or Tab, make that a step of its own.",
  },
  {
    text: "Tab; clik button 'Menu'",
    run: flow,
    code: "not-a-step",
    step: 2,
    column: 6,
    error: '--flow step 2 "clik button \'Menu\'", column 6: "clik" is not a step.',
    hint: STEP_HINT,
  },
  {
    text: "enter",
    run: flow,
    code: "not-a-step",
    step: 1,
    column: 1,
    error: '--flow step 1 "enter", column 1: "enter" is not a step. Did you mean Enter?',
    hint: STEP_HINT,
  },
  {
    text: "Click button 'Menu'",
    run: flow,
    code: "not-a-step",
    step: 1,
    column: 1,
    error: '--flow step 1 "Click button \'Menu\'", column 1: "Click" is not a step. Did you mean click?',
    hint: STEP_HINT,
  },
  {
    text: "tab to button 'Save'",
    run: flow,
    code: "not-a-step",
    step: 1,
    column: 1,
    error: '--flow step 1 "tab to button \'Save\'", column 1: "tab" is not a step. Did you mean Tab?',
    hint: STEP_HINT,
  },
  {
    text: "'Menu'",
    run: flow,
    code: "not-a-step",
    step: 1,
    column: 1,
    error: "--flow step 1 \"'Menu'\", column 1: a step starts with a word, not with \"'Menu'\".",
    hint: STEP_HINT,
  },
  {
    text: "shift+tab",
    run: flow,
    code: "not-a-key",
    step: 1,
    column: 1,
    error: '--flow step 1 "shift+tab", column 1: "shift+tab" is not a key. Did you mean Shift+Tab?',
    hint: KEY_HINT,
  },
  {
    text: "Shift+Tabb",
    run: flow,
    code: "not-a-key",
    step: 1,
    column: 1,
    error: '--flow step 1 "Shift+Tabb", column 1: in "Shift+Tabb", "Tabb" is not a key.',
    hint: KEY_HINT,
  },
  {
    text: "a+b",
    run: flow,
    code: "not-a-key",
    step: 1,
    column: 1,
    error:
      '--flow step 1 "a+b", column 1: in "a+b", "a" is not a modifier; only Shift, Control, Alt, Meta and ControlOrMeta come before a "+".',
    hint: KEY_HINT,
  },
  {
    text: "Tab; Shift+",
    run: flow,
    code: "not-a-key",
    step: 2,
    column: 6,
    error: '--flow step 2 "Shift+", column 6: "Shift+" has no key after its last "+".',
    hint: KEY_HINT,
  },
  {
    text: "Tab Enter",
    run: flow,
    code: "extra",
    step: 1,
    column: 5,
    error:
      '--flow step 1 "Tab Enter", column 5: "Enter" is more than the step takes; the step "Tab" ends before it.',
    hint: EXTRA_HINT,
  },
  {
    text: "Shift+Tab to button 'Save'",
    run: flow,
    code: "extra",
    step: 1,
    column: 11,
    error:
      '--flow step 1 "Shift+Tab to button \'Save\'", column 11: "to" is more than the step takes; the step "Shift+Tab" ends before it.',
    hint: EXTRA_HINT,
  },
  {
    text: "click button 'Menu' wait menu",
    run: flow,
    code: "extra",
    step: 1,
    column: 21,
    error:
      '--flow step 1 "click button \'Menu\' wait menu", column 21: "wait" is more than the step takes; the step "click button \'Menu\'" ends before it.',
    hint: EXTRA_HINT,
  },
  {
    text: "click",
    run: flow,
    code: "no-target",
    step: 1,
    column: 1,
    error: '--flow step 1 "click", column 1: click needs an element after it.',
    hint: TARGET_HINT,
  },
  {
    text: "Tab to",
    run: flow,
    code: "no-target",
    step: 1,
    column: 5,
    error: '--flow step 1 "Tab to", column 5: Tab to needs an element after it.',
    hint: TARGET_HINT,
  },
  {
    text: "click 'Menu'",
    run: flow,
    code: "no-role",
    step: 1,
    column: 7,
    error:
      "--flow step 1 \"click 'Menu'\", column 7: click needs a role before the name, such as click button 'Menu'.",
    hint: TARGET_HINT,
  },
  {
    text: "click buton 'Menu'",
    run: flow,
    code: "not-a-role",
    step: 1,
    column: 7,
    error: '--flow step 1 "click buton \'Menu\'", column 7: "buton" is not an ARIA role.',
    hint: ROLE_HINT,
  },
  {
    text: "wait Dialog",
    run: flow,
    code: "not-a-role",
    step: 1,
    column: 6,
    error: '--flow step 1 "wait Dialog", column 6: "Dialog" is not an ARIA role. Did you mean dialog?',
    hint: ROLE_HINT,
  },
  {
    text: "click button",
    run: flow,
    code: "no-name",
    step: 1,
    column: 7,
    error:
      '--flow step 1 "click button", column 7: click button needs the element\'s name after the role, in quotes.',
    hint: "write it as click button 'Name'.",
  },
  {
    text: "Tab to combobox",
    run: flow,
    code: "no-name",
    step: 1,
    column: 8,
    error:
      '--flow step 1 "Tab to combobox", column 8: Tab to combobox needs the element\'s name after the role, in quotes.',
    hint: "write it as Tab to combobox 'Name'.",
  },
  {
    text: "click button Save changes",
    run: flow,
    code: "not-quoted",
    step: 1,
    column: 14,
    error: '--flow step 1 "click button Save changes", column 14: "Save" must be in quotes.',
    hint: "write it as click button 'Save changes'.",
  },
  {
    text: 'click button "Save"',
    run: flow,
    code: "wrong-quote",
    step: 1,
    column: 14,
    error:
      '--flow step 1 "click button "Save"", column 14: names, text and selectors go in straight single quotes (\'), and this one starts with ".',
    hint: QUOTE_HINT,
  },
  {
    text: "click button \u2018Save\u2019",
    run: flow,
    code: "wrong-quote",
    step: 1,
    column: 14,
    error:
      '--flow step 1 "click button \u2018Save\u2019", column 14: names, text and selectors go in straight single quotes (\'), and this one starts with \u2018.',
    hint: QUOTE_HINT,
  },
  {
    text: "click button ''",
    run: flow,
    code: "empty-quoted",
    step: 1,
    column: 14,
    error: "--flow step 1 \"click button ''\", column 14: the name is empty.",
    hint: "write the element's accessible name in the quotes.",
  },
  {
    text: "type",
    run: flow,
    code: "no-text",
    step: 1,
    column: 1,
    error: '--flow step 1 "type", column 1: type needs the text to type after it, in quotes.',
    hint: "write it as type 'text'.",
  },
  {
    text: "type Ada",
    run: flow,
    code: "not-quoted",
    step: 1,
    column: 6,
    error: '--flow step 1 "type Ada", column 6: "Ada" must be in quotes.',
    hint: "write it as type 'Ada'.",
  },
  {
    text: "type ''",
    run: flow,
    code: "empty-quoted",
    step: 1,
    column: 6,
    error: "--flow step 1 \"type ''\", column 6: the text to type is empty.",
    hint: "write the text to type in the quotes.",
  },
  {
    text: "click css",
    run: flow,
    code: "no-selector",
    step: 1,
    column: 7,
    error: '--flow step 1 "click css", column 7: css needs a selector after it, in quotes.',
    hint: QUOTE_HINT,
  },
  {
    text: "click css #menu",
    run: flow,
    code: "not-quoted",
    step: 1,
    column: 11,
    error: '--flow step 1 "click css #menu", column 11: "#menu" must be in quotes.',
    hint: QUOTE_HINT,
  },
  {
    text: "click css ''",
    run: flow,
    code: "empty-quoted",
    step: 1,
    column: 11,
    error: "--flow step 1 \"click css ''\", column 11: the selector is empty.",
    hint: TARGET_HINT,
  },
  {
    text: "click css 'nav >> text=Menu'",
    run: flow,
    code: "selector-chain",
    step: 1,
    column: 16,
    error:
      '--flow step 1 "click css \'nav >> text=Menu\'", column 16: a selector cannot hold ">>", which Playwright reads as a chain into another kind of selector.',
    hint: "write one CSS selector, such as css 'nav > ul > li', or name the element by role and name.",
  },
  {
    text: "colorScheme dark",
    run: flow,
    code: "media-in-flow",
    step: 1,
    column: 1,
    error:
      '--flow step 1 "colorScheme dark", column 1: colorScheme sets a state\'s media, and a flow has no media.',
    hint: 'put it in a state instead: --states "dark: colorScheme dark", or a state\'s steps in the config.',
  },
  {
    text: "Tab; viewport 390x844",
    run: flow,
    code: "media-in-flow",
    step: 2,
    column: 6,
    error:
      '--flow step 2 "viewport 390x844", column 6: viewport sets a state\'s media, and a flow has no media.',
    hint: 'put it in a state instead: --states "dark: colorScheme dark", or a state\'s steps in the config.',
  },
  {
    text: "reducedMotion",
    run: configStep,
    code: "media-in-flow",
    step: undefined,
    column: 1,
    error:
      'a11y-genie.yaml line 12 "reducedMotion", column 1: reducedMotion sets a state\'s media, and a flow has no media.',
    hint: 'put it in a state instead: --states "dark: colorScheme dark", or a state\'s steps in the config.',
  },
  {
    text: "x: reducedMotion please",
    run: states,
    code: "extra",
    step: 1,
    column: 18,
    error:
      '--states step 1 "reducedMotion please", column 18: "please" is more than the step takes; the step "reducedMotion" ends before it.',
    hint: EXTRA_HINT,
  },
  {
    text: "x: colorScheme",
    run: states,
    code: "not-a-color-scheme",
    step: 1,
    column: 4,
    error: '--states step 1 "colorScheme", column 4: colorScheme takes light or dark.',
    hint: "write colorScheme dark, or colorScheme light.",
  },
  {
    text: "x: colorScheme Dark",
    run: states,
    code: "not-a-color-scheme",
    step: 1,
    column: 16,
    error: '--states step 1 "colorScheme Dark", column 16: colorScheme takes light or dark, not "Dark".',
    hint: "write colorScheme dark, or colorScheme light.",
  },
  {
    text: "x: colorScheme 'dark'",
    run: states,
    code: "not-a-color-scheme",
    step: 1,
    column: 16,
    error:
      "--states step 1 \"colorScheme 'dark'\", column 16: colorScheme takes light or dark, not \"'dark'\".",
    hint: "write colorScheme dark, or colorScheme light.",
  },
  ...["1280", "1280X800", "1280 x 800", "0x800", "1280x10001", "-1x5", "1.5x2"].map((size): ErrorRow => ({
    text: `x: viewport ${size}`,
    run: states,
    code: "not-a-viewport",
    step: 1,
    column: 13,
    error: `--states step 1 "viewport ${size}", column 13: viewport takes a width and a height in CSS pixels, from 1 to 10000, not "${size.split(" ")[0] ?? ""}".`,
    hint: "write it as viewport 1280x800, or viewport 390x844 for a phone.",
  })),
  {
    text: "x: viewport",
    run: states,
    code: "not-a-viewport",
    step: 1,
    column: 4,
    error:
      '--states step 1 "viewport", column 4: viewport takes a width and a height in CSS pixels, from 1 to 10000.',
    hint: "write it as viewport 1280x800, or viewport 390x844 for a phone.",
  },
  {
    text: "click button 'Menu'",
    run: states,
    code: "no-colon",
    step: undefined,
    column: 1,
    error:
      '--states "click button \'Menu\'", column 1: --states needs a state name and a ":" before the steps.',
    hint: STATE_HINT,
  },
  {
    text: "click css 'a:hover'",
    run: states,
    code: "no-colon",
    step: undefined,
    column: 1,
    error:
      '--states "click css \'a:hover\'", column 1: --states needs a state name and a ":" before the steps.',
    hint: STATE_HINT,
  },
  {
    text: " : Tab",
    run: states,
    code: "no-state-name",
    step: undefined,
    column: 2,
    error: '--states ": Tab", column 2: the state has no name before the ":".',
    hint: STATE_HINT,
  },
  {
    text: "default: Tab",
    run: states,
    code: "reserved-state-name",
    step: undefined,
    column: 1,
    error:
      '--states "default: Tab", column 1: the state cannot be called "default": that is the state every page is scanned in first.',
    hint: "give it a name of its own, such as menu-open or dark.",
  },
  {
    text: "  Menu Open: click button 'Menu'",
    run: states,
    code: "not-a-state-name",
    step: undefined,
    column: 3,
    error:
      '--states "Menu Open: click button \'Menu\'", column 3: "Menu Open" is not a state name: a name is lower-case letters, digits, "-" and "_", up to 64 characters, starting with a letter or a digit.',
    hint: "name it like menu-open.",
  },
  {
    text: "dark:",
    run: states,
    code: "no-steps",
    step: undefined,
    column: 6,
    error: '--states "dark:", column 6: the state has no steps after its name.',
    hint: "give the state at least one step, such as --states \"menu-open: click button 'Menu'\".",
  },
  {
    text: "menu-open: click button 'Menu'; clik",
    run: states,
    code: "not-a-step",
    step: 2,
    column: 33,
    error: '--states step 2 "clik", column 33: "clik" is not a step.',
    hint: STEP_HINT,
  },
];

describe("every error", () => {
  it.each(ERRORS.map((row) => [row.text, row] as const))("%j", (_text, row) => {
    const error = refusal(() => row.run(row.text));
    expect(error.code).toBe(row.code);
    expect(error.step).toBe(row.step);
    expect(error.column).toBe(row.column);
    expect(error.message).toBe(row.error);
    expect(error.hint).toBe(row.hint);
  });

  it("covers every error code", () => {
    const codes = new Set(ERRORS.map((row) => row.code));
    const all: Record<StepErrorCode, true> = {
      "no-steps": true,
      "empty-step": true,
      "one-step-only": true,
      "unclosed-quote": true,
      "control-character": true,
      "not-a-step": true,
      "not-a-key": true,
      extra: true,
      "no-target": true,
      "no-role": true,
      "not-a-role": true,
      "no-name": true,
      "no-text": true,
      "no-selector": true,
      "not-quoted": true,
      "wrong-quote": true,
      "empty-quoted": true,
      "selector-chain": true,
      "not-a-color-scheme": true,
      "not-a-viewport": true,
      "media-in-flow": true,
      "no-colon": true,
      "no-state-name": true,
      "not-a-state-name": true,
      "reserved-state-name": true,
    };
    expect([...codes].sort()).toEqual(Object.keys(all).sort());
  });

  it("is a refusal, so the command exits 2 with one Error: line and one Hint: line", () => {
    for (const row of ERRORS) {
      const error = refusal(() => row.run(row.text));
      expect(error).toBeInstanceOf(Refusal);
      expect(error.message).not.toMatch(/[\r\n]/);
      expect(error.hint).not.toMatch(/[\r\n]/);
    }
  });

  it("counts columns in characters, so text before the problem in another script does not move it", () => {
    expect(refusal(() => flow("type '日本🧞'; clik")).column).toBe(13);
  });

  it("prints the person's text safely: no terminal escape reaches the Error: line", () => {
    const esc = String.fromCharCode(0x1b);
    const error = refusal(() => flow(`${esc}]0;pwned${String.fromCharCode(7)}Tab`));
    expect(error.code).toBe("not-a-step");
    expect(error.message).not.toContain(esc);
  });

  it("cuts a long step short in the Error: line", () => {
    const error = refusal(() => flow(`type '${"x".repeat(200)}' more`));
    expect(error.message).not.toContain("x".repeat(61));
    expect(error.message).toContain("...");
  });
});

describe("page text is never code", () => {
  it("keeps a name exactly as data, whatever it looks like", () => {
    const names = [
      "${process.exit(1)}",
      "'); alert(1); ('",
      "<script>alert(1)</script>",
      "button >> css=x",
      "a\\'b",
    ];
    for (const name of names) {
      const [step] = flow(`click button ${quote(name)}`);
      expect(step).toEqual({ kind: "click", target: { by: "role", role: "button", name } });
    }
  });

  it("takes a role only from the list getByRole() accepts", () => {
    expect(refusal(() => flow("click constructor 'x'")).code).toBe("not-a-role");
    expect(refusal(() => flow("click __proto__ 'x'")).code).toBe("not-a-role");
  });

  it("refuses a selector that could switch Playwright to another selector engine", () => {
    expect(refusal(() => flow("click css 'div >> xpath=//a'")).code).toBe("selector-chain");
  });
});
