/**
 * `genie/keyboard-trap` and `genie/focus-not-returned` (docs/CHECKS.md, *`genie/keyboard-trap`*), read from the keyboard walk (src/walk.ts).
 *
 * axe-core has no rule for either. The walk has already pressed Tab from the top of the page. Focus may be held
 * where the walk went round without leaving the page:
 *
 * - `cycled`: focus went twice round stops after the first and never came back to it. The stops before the
 *   cycle are outside it, so the cycle is a strict part of the page. Focus that does not move at all is a
 *   cycle of one: the same element after three Tab presses.
 * - `wrapped`: focus came back to the first stop. On most pages that is the whole Tab order, and nothing is
 *   held. It is a strict part only when the page has a tabbable element the walk never reached (below).
 *
 * The check then tries to leave, from the cycle's first element, where the walk left focus: Shift+Tab, once for
 * each element of the cycle, and then Escape, and Tab once more after it (an editor that keeps Tab for
 * indenting gives it back after Escape). If any press puts focus on an element outside the cycle, or on no
 * element (out of the page), a keyboard can leave, and nothing is flagged. If none does, the cycle's elements
 * are `genie/keyboard-trap`, critical, WCAG 2.1.2.
 *
 * A modal dialog keeps focus inside on purpose. When every element of the cycle is inside one visible dialog
 * (`role="dialog"` or `"alertdialog"`, or a `dialog` element) that is modal (`aria-modal="true"`), and Escape
 * closes it, it is not a trap. A native `dialog` opened with `showModal()` is not checked at all: Chrome hands
 * Tab out of it to the browser's own controls, so `scanPage` skips this check while one is open, and the
 * record names it in `cannotSee` (`nativeModalOpen`, `nativeModalLine`). Then focus must come back to the control
 * that opened it. Focus on no element after the dialog closed is `genie/focus-not-returned`, moderate, WCAG
 * 2.4.3; so is focus on another element when exactly one element outside the dialog names it in
 * `aria-controls`, which makes that element its opener. With no such element, focus on any element outside
 * the dialog counts as returned: the check cannot know the opener, and does not guess.
 *
 * The cost is bounded: the walk's second lap of the cycle (inside `--max-tabs`), then at most as many Shift+Tab
 * presses as the cycle has elements, one Escape and one Tab. A walk that ends `left` or `max-tabs` costs nothing.
 *
 * The page is hostile: everything is read through the walk's `FocusReader`, in its isolated world, and what
 * comes back is checked field by field.
 */

import type { Page } from "playwright-core";
import type { AxeTarget, Finding, FindingElement } from "./finding.js";
import { registerGenieRule } from "./genie-rules.js";
import { selectorOf } from "./map-axe.js";
import { DESCRIBE, FocusReader, sameStop, type Focused, type Walk, type WalkStop } from "./walk.js";

export const KEYBOARD_TRAP_RULE = {
  source: "genie",
  id: "keyboard-trap",
  help: "Keyboard focus moves into part of the page, and Tab, Shift+Tab and Escape cannot move it out.",
  helpUrl: "",
  wcag: ["2.1.2"],
} as const;

export const FOCUS_NOT_RETURNED_RULE = {
  source: "genie",
  id: "focus-not-returned",
  help: "Escape closes a modal dialog, but focus does not go back to the control that opened it.",
  helpUrl: "",
  wcag: ["2.4.3"],
} as const;

/** The tags that run each rule: a `--tags` list with none of a rule's leaves it out. Both are WCAG level A. */
export const KEYBOARD_TRAP_TAGS = ["cat.keyboard", "wcag2a", "wcag212"] as const;
export const FOCUS_NOT_RETURNED_TAGS = ["cat.keyboard", "wcag2a", "wcag243"] as const;

registerGenieRule({
  rule: { ...KEYBOARD_TRAP_RULE, wcag: [...KEYBOARD_TRAP_RULE.wcag] },
  impact: "critical",
  tags: [...KEYBOARD_TRAP_TAGS],
});

registerGenieRule({
  rule: { ...FOCUS_NOT_RETURNED_RULE, wcag: [...FOCUS_NOT_RETURNED_RULE.wcag] },
  impact: "moderate",
  tags: [...FOCUS_NOT_RETURNED_TAGS],
});

/** The longest HTML excerpt read for an element, in characters; the record cuts it further. */
const HTML_CHARS = 300;

/** The most elements the page's tabbable list is read for, to bound the cost on a very large page. */
const TABBABLE_READ = 5000;

const STUCK_FAILURE =
  "Fix all of the following:\n" +
  "  Focus does not move: Tab leaves it on this element, and neither Shift+Tab nor Escape moves it on.";

function cycleFailure(count: number): string {
  return (
    "Fix all of the following:\n" +
    `  Focus is held here: Tab keeps it among these ${count} elements, and neither Shift+Tab nor Escape moves it out.`
  );
}

const NOT_RETURNED_FAILURE =
  "Fix all of the following:\n" +
  "  Escape closed this dialog, and focus went to no element. Move focus back to the control that opened it.";

const NOT_RETURNED_TO_OPENER_FAILURE =
  "Fix all of the following:\n" +
  "  Escape closed this dialog, and focus went to another element than the one that names it in aria-controls. " +
  "Move focus back to that control.";

/** Shared by the functions run in the page: whether an element is shown, and its HTML excerpt. */
const HELPERS = `
  const describe = ${DESCRIBE};
  const shown = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
  const htmlOf = (el) => {
    const open = el.cloneNode(false).outerHTML;
    const close = "</" + el.localName + ">";
    const inner = open.endsWith(close) ? open.slice(0, -close.length) : open;
    const text = (el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 80);
    return (inner + (el.children.length > 0 ? "…" + text : text) + close).slice(0, ${HTML_CHARS});
  };
  const isModalDialog = (el) => {
    const role = el.getAttribute("role");
    const dialog = el.localName === "dialog" || role === "dialog" || role === "alertdialog";
    if (!dialog) return false;
    let modal = el.getAttribute("aria-modal") === "true";
    if (!modal && el.localName === "dialog") { try { modal = el.matches(":modal"); } catch (e) { modal = false; } }
    return modal && shown(el);
  };
  const resolve = (target) => {
    let root = document;
    let found = null;
    for (let i = 0; i < target.length; i++) {
      const chain = typeof target[i] === "string" ? [target[i]] : target[i];
      for (let j = 0; j < chain.length; j++) {
        try { found = root.querySelector(chain[j]); } catch (e) { return null; }
        if (!found) return null;
        if (j < chain.length - 1) { if (!found.shadowRoot) return null; root = found.shadowRoot; }
      }
      if (i < target.length - 1) {
        let inner = null;
        try { inner = found.contentDocument; } catch (e) { inner = null; }
        if (!inner) return null;
        root = inner;
      }
    }
    return found;
  };
`;

/** With `this` as the focused element: its HTML excerpt. */
const FOCUSED_HTML = `function () {
  ${HELPERS}
  return htmlOf(this);
}`;

/**
 * With `this` as the focused element: the visible modal dialog it is in (through shadow roots and same-origin
 * frames), as `{ target, html, opener }`, or null. `opener` is the `target` of the one element outside the
 * dialog that names its id in `aria-controls`, or null when there is not exactly one.
 */
const DIALOG_OF_FOCUSED = `function () {
  ${HELPERS}
  let node = this;
  while (node) {
    if (node.nodeType === 1 && isModalDialog(node)) break;
    if (node.parentElement) { node = node.parentElement; continue; }
    const root = node.getRootNode();
    if (root instanceof ShadowRoot) { node = root.host; continue; }
    let frame = null;
    try { frame = root.defaultView ? root.defaultView.frameElement : null; } catch (e) { frame = null; }
    node = frame;
  }
  if (!node) return null;
  const dialog = node;
  let opener = null;
  if (dialog.id) {
    const named = [];
    for (const el of dialog.getRootNode().querySelectorAll("[aria-controls]")) {
      if (dialog.contains(el)) continue;
      if ((el.getAttribute("aria-controls") || "").split(/\\s+/).includes(dialog.id)) named.push(el);
    }
    if (named.length === 1) opener = describe.call(named[0]).target;
  }
  return { target: describe.call(dialog).target, html: htmlOf(dialog), opener };
}`;

/** With `this` as the focused element: whether it is still shown. */
const FOCUSED_SHOWN = `function () {
  ${HELPERS}
  return shown(this);
}`;

/** Whether the dialog at `target` is still shown and modal. */
const DIALOG_STILL_OPEN = `function (target) {
  ${HELPERS}
  const el = resolve(target);
  return el !== null && isModalDialog(el);
}`;

/**
 * Whether the page's own document has a tabbable element that is none of `targets` (each as JSON). Only the
 * top document's light DOM is read, and only elements that plainly take Tab: shown, enabled, not inert,
 * `tabIndex` 0 or more, not a frame and not a shadow host (focus goes inside those, under another target),
 * and not a radio button (only one of a group is a Tab stop). Leaving the doubtful ones out can only make a
 * trap read as no trap, never the other way round.
 */
const TABBABLE_OUTSIDE = `function (targets) {
  ${HELPERS}
  const known = new Set(targets);
  const sel = "a[href], button, input:not([type=hidden]):not([type=radio]), select, textarea, summary, [tabindex], [contenteditable=true]";
  let read = 0;
  for (const el of document.querySelectorAll(sel)) {
    if (++read > ${TABBABLE_READ}) break;
    if (el.tabIndex < 0 || el.shadowRoot || el.localName === "iframe" || el.localName === "frame") continue;
    if (el.closest("[inert]")) continue;
    try { if (el.matches(":disabled")) continue; } catch (e) {}
    if (!shown(el)) continue;
    if (!known.has(JSON.stringify(describe.call(el).target))) return true;
  }
  return false;
}`;

function isPart(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

/** A `target` from the page, checked: one entry per document, strings or arrays of strings. */
function targetOf(value: unknown): AxeTarget | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const target: AxeTarget = [];
  for (const entry of value) {
    if (isPart(entry)) target.push(entry);
    else if (Array.isArray(entry) && entry.length > 0 && entry.every(isPart)) target.push([...entry]);
    else return undefined;
  }
  return target;
}

/** A modal dialog focus is in, as read from the page and checked. */
interface Dialog {
  target: AxeTarget;
  html: string;
  opener: AxeTarget | null;
}

function dialogOf(value: unknown): Dialog | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const target = targetOf(v.target);
  if (target === undefined || typeof v.html !== "string") return null;
  return { target, html: v.html.slice(0, HTML_CHARS), opener: targetOf(v.opener) ?? null };
}

/** Whether the page's own document has a native `dialog` open as a modal, by `showModal()`. */
const NATIVE_MODAL_OPEN = `function () {
  try { return document.querySelector("dialog:modal") !== null; } catch (e) { return false; }
}`;

/**
 * Whether a native `dialog` is open as a modal (`dialog:modal`), read in the walk's isolated world. Chrome
 * lets Tab and Shift+Tab out of such a dialog to the browser's own controls, so the walk cannot show whether
 * the dialog holds focus. `scanPage` does not run the trap check on a page with one open, and the record
 * says so in `cannotSee` instead (`nativeModalLine`). Only the page's own document is read.
 */
export async function nativeModalOpen(page: Page): Promise<boolean> {
  const reader = await FocusReader.open(page);
  try {
    return (await reader.call(NATIVE_MODAL_OPEN)) === true;
  } finally {
    await reader.close();
  }
}

/**
 * The line added to "What this scan cannot see" for a page with a native modal dialog open in `states`. The
 * page key and the state names come from the run (the address and the --states names), not from the page.
 */
export function nativeModalLine(pageKey: string, states: readonly string[]): string {
  const where = states.length === 1 ? `the state ${states[0]}` : `the states ${states.join(", ")}`;
  return (
    `A dialog on ${pageKey} (in ${where}) was opened with showModal(); A11y Genie cannot walk the keyboard ` +
    "inside a native modal dialog, so check by hand that Tab stays in it and Escape closes it (WCAG 2.1.2)."
  );
}

/** What the check found on one page in one state: at most one finding of each rule. */
export interface KeyboardTrapResult {
  trap?: Finding;
  notReturned?: Finding;
}

/** The stops focus went round: the whole walk when it wrapped, from `cycleFrom` when it cycled; else none. */
export function cycleOf(walk: Walk): WalkStop[] {
  if (walk.end === "wrapped") return walk.stops;
  if (walk.end === "cycled" && walk.cycleFrom !== undefined) {
    const from = walk.stops.findIndex((s) => s.index === walk.cycleFrom);
    return from < 0 ? [] : walk.stops.slice(from);
  }
  return [];
}

/**
 * Runs right after the walk, with focus where the walk left it: on the first stop of the cycle. It presses
 * keys and may close a dialog, so nothing that reads the page as it was runs after it.
 */
export async function checkKeyboardTrap(
  page: Page,
  pageKey: string,
  walk: Walk,
): Promise<KeyboardTrapResult> {
  const cycle = cycleOf(walk);
  // Nothing went round; or a frame of another origin is part of it, and focus inside it cannot be read.
  if (cycle.length === 0 || cycle.some((s) => s.opaque === true)) return {};
  const inCycle = (stop: { target: AxeTarget }): boolean => cycle.some((s) => sameStop(s, stop));
  const reader = await FocusReader.open(page);
  try {
    const start = await reader.read();
    // The page moved focus after the walk's last press: what went round is no longer where focus is.
    if (start === null || !inCycle(start)) return {};
    const strict =
      walk.end === "cycled" ||
      (await reader.call(
        TABBABLE_OUTSIDE,
        cycle.map((s) => JSON.stringify(s.target)),
      )) === true;
    let dialog = dialogOf(await reader.callOnFocused(DIALOG_OF_FOCUSED));
    // A whole page that wraps is no trap; it is read further only if it is a modal dialog, for where focus goes.
    if (!strict && dialog === null) return {};

    const html = new Map<string, string>();
    const keepHtml = async (stop: { selector: string }): Promise<void> => {
      const value = await reader.callOnFocused(FOCUSED_HTML);
      if (typeof value === "string" && !html.has(stop.selector))
        html.set(stop.selector, value.slice(0, HTML_CHARS));
    };
    await keepHtml(start);

    // Shift+Tab, once for each element of the cycle.
    for (let i = 0; i < cycle.length; i += 1) {
      await page.keyboard.press("Shift+Tab");
      const focused = await reader.read();
      if (focused === null || !inCycle(focused)) return {};
      await keepHtml(focused);
      if (dialog !== null) {
        const here = dialogOf(await reader.callOnFocused(DIALOG_OF_FOCUSED));
        if (here === null || JSON.stringify(here.target) !== JSON.stringify(dialog.target)) dialog = null;
      }
    }

    // Escape, then Tab once more. A dialog Escape hid can leave focus on its hidden element until the browser
    // moves it to the page itself; an element that is no longer shown counts as focus on no element.
    const where = async (): Promise<Focused> => {
      const focused = await reader.read();
      return focused !== null && (await reader.callOnFocused(FOCUSED_SHOWN)) === false ? null : focused;
    };
    await page.keyboard.press("Escape");
    let afterEscape = await where();
    let left = afterEscape === null || !inCycle(afterEscape);
    if (!left) {
      await page.keyboard.press("Tab");
      const focused = await where();
      left = focused === null || !inCycle(focused);
      if (left) afterEscape = focused;
    }

    if (!left) {
      if (!strict) return {};
      return { trap: trapFinding(pageKey, cycle, html) };
    }
    if (dialog === null) return {};
    if ((await reader.call(DIALOG_STILL_OPEN, dialog.target)) === true) return {};
    // The dialog closed. Where did focus go?
    if (afterEscape === null)
      return { notReturned: notReturnedFinding(pageKey, dialog, NOT_RETURNED_FAILURE) };
    if (dialog.opener !== null && !sameStop(afterEscape, { target: dialog.opener })) {
      return { notReturned: notReturnedFinding(pageKey, dialog, NOT_RETURNED_TO_OPENER_FAILURE) };
    }
    return {};
  } finally {
    await reader.close();
  }
}

function trapFinding(pageKey: string, cycle: WalkStop[], html: Map<string, string>): Finding {
  const failure = cycle.length === 1 ? STUCK_FAILURE : cycleFailure(cycle.length);
  const elements: FindingElement[] = cycle.map((stop) => ({
    selector: stop.selector,
    target: stop.target,
    html: html.get(stop.selector) ?? `<${stop.tag}>`,
    failure,
  }));
  return {
    id: `genie/keyboard-trap@${pageKey}`,
    rule: { ...KEYBOARD_TRAP_RULE, wcag: [...KEYBOARD_TRAP_RULE.wcag] },
    kind: "violation",
    impact: "critical",
    page: pageKey,
    elements,
  };
}

function notReturnedFinding(pageKey: string, dialog: Dialog, failure: string): Finding {
  return {
    id: `genie/focus-not-returned@${pageKey}`,
    rule: { ...FOCUS_NOT_RETURNED_RULE, wcag: [...FOCUS_NOT_RETURNED_RULE.wcag] },
    kind: "violation",
    impact: "moderate",
    page: pageKey,
    elements: [{ selector: selectorOf(dialog.target), target: dialog.target, html: dialog.html, failure }],
  };
}
