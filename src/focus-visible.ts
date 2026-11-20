/**
 * `genie/focus-visible` (spec 6.3): an element the keyboard moves focus to, and nothing changes on screen.
 *
 * axe-core has no rule for it. The check looks at the keyboard walk's stops (src/walk.ts), at each one while
 * focus is still on it (the walk's `onStop`), and compares the element focused and unfocused in two ways:
 *
 * 1. the computed `outline-style`, `outline-width`, `outline-color`, `box-shadow`, `border-color`,
 *    `background-color` and `text-decoration` of the element and of its first two ancestors; and
 * 2. a screenshot of the element padded by `PAD_PX` on each side, first as the Tab key left it (so
 *    `:focus-visible` applies), then with focus taken off it. Both are taken with the page held
 *    still (a finite animation or transition is set to its end while paused, so an animated ring
 *    is judged as it ends, then put back as it was), the caret hidden, and a style that turns transitions off.
 *
 * A pixel has changed when one of its red, green and blue differs by more than `PIXEL_TOLERANCE`. When at least
 * `VISIBLE_SHARE` of the padded box's pixels changed, focus is visible. When no pixel changed and none of the
 * styles did either, the element is a finding: serious, WCAG 2.4.7. Anything between is *needs review*, never a
 * finding: styles that change too faintly to show, or a few changed pixels with no style behind them. The
 * check proves only that focus produced no visible change, not that a change is enough: the contrast of the
 * indicator stays on the list of what a scan cannot see. docs/ARCHITECTURE.md (*Focus visible*) has the
 * measurements the numbers were tuned on (V4).
 *
 * The page must not notice. Focus is taken off with `blur()` and given back with `focus()`, in an isolated
 * world, while a guard (src/focus-guard.ts), installed at document start and so ahead of any listener of the
 * page's own, stops the `blur`, `focusout`, `focus` and `focusin` events before the page's handlers see them. Focus ends where the Tab key put it, so the walk
 * and the trap check read on as if nothing happened.
 *
 * The screenshots stay in memory, are compared, and are dropped. None is written to disk or to the record.
 *
 * The cost: two screenshots and a handful of DevTools Protocol calls a stop, for the first
 * `MAX_SCREENSHOT_STOPS` stops of each walk. The stops after that are *needs review*, not looked at.
 */

import type { Page } from "playwright-core";
import type { Finding, FindingElement, NeedsReview, NeedsReviewElement } from "./finding.js";
import type { FocusGuard } from "./focus-guard.js";
import { registerGenieRule } from "./genie-rules.js";
import { changedPixels, decodePng } from "./png.js";
import { FocusReader, type WalkStop } from "./walk.js";

export const FOCUS_VISIBLE_RULE = {
  source: "genie",
  id: "focus-visible",
  help: "Keyboard focus moves to this element, and nothing about it changes on screen.",
  helpUrl: "",
  wcag: ["2.4.7"],
} as const;

/** The tags that run it: 2.4.7 is WCAG level AA, so `wcag2aa`, as axe-core tags its own AA rules. */
export const FOCUS_VISIBLE_TAGS = ["cat.keyboard", "wcag2aa", "wcag247"] as const;

const IMPACT = "serious";

registerGenieRule({
  rule: { ...FOCUS_VISIBLE_RULE, wcag: [...FOCUS_VISIBLE_RULE.wcag] },
  impact: IMPACT,
  tags: [...FOCUS_VISIBLE_TAGS],
});

/** How far past the element's box each screenshot reaches, in CSS pixels: room for an outline or a shadow. */
export const PAD_PX = 4;

/**
 * How much one of a pixel's red, green and blue must differ, out of 255, for the pixel to count as changed.
 * Below it a change is too faint for many people to notice: `focus-faint.html` changes a white background to
 * `#f4f4f4` (11 levels), and is not counted. Tuned in M8 (docs/ARCHITECTURE.md, V4).
 */
export const PIXEL_TOLERANCE = 16;

/** The share of the padded box's pixels that must change for focus to count as visible: the spec's 1%. */
export const VISIBLE_SHARE = 0.01;

/** How many stops of one walk get the screenshot pair; the stops after them are *needs review*. */
export const MAX_SCREENSHOT_STOPS = 100;

/** The style properties compared, on the element and its first two ancestors (spec 6.3). */
export const COMPARED_STYLES = [
  "outline-style",
  "outline-width",
  "outline-color",
  "box-shadow",
  "border-color",
  "background-color",
  "text-decoration",
] as const;

/** The longest HTML excerpt read for an element, in characters; the record cuts it further. */
const HTML_CHARS = 300;

/** Turns transitions off while a screenshot is taken. Playwright applies it inside shadow roots and frames too. */
const NO_TRANSITIONS =
  "*, *::before, *::after { transition-duration: 0s !important; transition-delay: 0s !important; " +
  "caret-color: transparent !important; }";

/** The name, in the isolated world's own global object, under which the element and the event guard are kept. */
const HELD = "__a11yGenieFocusHeld";

const NO_CHANGE_FAILURE =
  "Fix all of the following:\n" +
  "  Focus produced no visible change: Tab moved focus here, and neither its outline, box-shadow, border, " +
  "background and text-decoration nor a screenshot of it changed.";

/** Shared by the functions run in the isolated world: an element's styles, box and HTML excerpt. */
const HELPERS = `
  const PROPS = ${JSON.stringify(COMPARED_STYLES)};
  const stylesOf = (el) => {
    const out = [];
    let node = el;
    for (let depth = 0; depth < 3 && node; depth++) {
      const cs = node.ownerDocument.defaultView.getComputedStyle(node);
      const row = PROPS.map((p) => cs.getPropertyValue(p));
      // An outline whose style is none is not drawn, whatever its width and colour say.
      if (row[0] === "none") { row[1] = ""; row[2] = ""; }
      out.push(row);
      if (node.parentElement) { node = node.parentElement; continue; }
      const root = node.getRootNode();
      node = root instanceof ShadowRoot ? root.host : null;
    }
    return out;
  };
  const boxOf = (el) => {
    const r = el.getBoundingClientRect();
    let x = r.left, y = r.top;
    let win = el.ownerDocument.defaultView;
    for (;;) {
      let frame = null;
      try { frame = win.frameElement; } catch (e) { frame = null; }
      if (!frame) break;
      const fr = frame.getBoundingClientRect();
      const fs = frame.ownerDocument.defaultView.getComputedStyle(frame);
      x += fr.left + frame.clientLeft + (parseFloat(fs.paddingLeft) || 0);
      y += fr.top + frame.clientTop + (parseFloat(fs.paddingTop) || 0);
      win = frame.ownerDocument.defaultView;
    }
    const root = document.documentElement;
    return { x, y, width: r.width, height: r.height, viewWidth: root.clientWidth, viewHeight: root.clientHeight };
  };
  const htmlOf = (el) => {
    const open = el.cloneNode(false).outerHTML;
    const close = "</" + el.localName + ">";
    const inner = open.endsWith(close) ? open.slice(0, -close.length) : open;
    const text = (el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 80);
    return (inner + (el.children.length > 0 ? "…" + text : text) + close).slice(0, ${HTML_CHARS});
  };
`;

/**
 * With `this` as the focused element: keeps it, and gives back its box, its HTML excerpt and its styles
 * focused. It is kept in the isolated world's own global object, which the page cannot see.
 */
const HOLD = `function () {
  ${HELPERS}
  globalThis.${HELD} = { el: this, paused: [] };
  return { box: boxOf(this), html: htmlOf(this), styles: stylesOf(this) };
}`;

/** The kept element's styles. */
const STYLES = `function () {
  ${HELPERS}
  const held = globalThis.${HELD};
  return held ? stylesOf(held.el) : null;
}`;

/** Takes focus off the kept element, with the guard held by the caller. Returns whether focus left it. */
const BLUR = `function () {
  const held = globalThis.${HELD};
  if (!held) return false;
  held.el.blur();
  const root = held.el.getRootNode();
  return root.activeElement !== held.el;
}`;

/**
 * Gives focus back to the kept element, with the guard still held by the caller, and forgets the element.
 * Returns whether focus is on it again.
 */
const REFOCUS = `function () {
  const held = globalThis.${HELD};
  if (!held) return false;
  let back = false;
  try {
    held.el.focus({ preventScroll: true });
    back = held.el.getRootNode().activeElement === held.el;
  } finally {
    delete globalThis.${HELD};
  }
  return back;
}`;

/**
 * Holds the page still for a screenshot, in the page and its same-origin frames (shadow roots included). Each
 * running animation and transition is paused, its `currentTime` kept, and a finite one is set to its end while
 * paused, so a ring that grows in is judged as it ends. A paused animation set to its end is not finished, so
 * no `finish`, `animationend` or `transitionend` event is heard. An infinite one is paused where it is.
 * `RESUME` puts every one back. Playwright's own `animations: "disabled"` is not used, because it finishes the
 * finite ones for good and cancels an infinite one back to the element's style without it, which hides a
 * pulsing ring (V4).
 */
const STILL = `function (only) {
  const held = globalThis.${HELD};
  const kept = held ? held.paused : [];
  const docs = [document];
  for (let i = 0; i < docs.length && i < 50; i++) {
    for (const frame of docs[i].querySelectorAll("iframe, frame")) {
      let inner = null;
      try { inner = frame.contentDocument; } catch (e) { inner = null; }
      if (inner) docs.push(inner);
    }
  }
  // The shadow roots on the kept element's way up: a focus animation inside one is found there for certain.
  for (let node = held ? held.el : null; node; ) {
    const root = node.getRootNode();
    if (!(root instanceof ShadowRoot)) break;
    docs.push(root);
    node = root.host;
  }
  for (const doc of new Set(docs)) {
    let animations = [];
    try { animations = doc.getAnimations(); } catch (e) { animations = []; }
    for (const animation of animations) {
      try {
        if (animation.playState !== "running") continue;
        const name = animation.animationName ?? animation.transitionProperty ?? "";
        // Asked with no names: only reads which are running. Asked with names: holds just those, which the
        // guard was told to listen for before this call, so none of their events can slip past it.
        if (only === null) { kept.push({ name }); continue; }
        if (!only.includes(name)) continue;
        const end = animation.effect ? animation.effect.getComputedTiming().endTime : 0;
        const time = animation.currentTime;
        const rate = animation.playbackRate;
        animation.pause();
        kept.push({ animation, time, rate, at: performance.now(), name });
        if (typeof end === "number" && end !== Infinity) animation.currentTime = rate < 0 ? 0 : end;
      } catch (e) {}
    }
  }
  return only === null ? kept.splice(0).map((k) => k.name) : true;
}`;

/** Puts back what `STILL` held: each animation at the time it was paused at, plus the time since, playing again. */
const RESUME = `function () {
  const held = globalThis.${HELD};
  if (!held) return;
  for (const { animation, time, rate, at } of held.paused.splice(0)) {
    try {
      if (animation.playbackRate === rate) {
        // Put back at the time it was paused at, plus the time that has passed since, as it would have run.
        const end = animation.effect ? animation.effect.getComputedTiming().endTime : 0;
        const now = time + (performance.now() - at) * rate;
        animation.currentTime = typeof end === "number" ? Math.max(0, Math.min(now, end)) : now;
      }
      animation.play();
    } catch (e) {}
  }
}`;

/** The element's box in the top page's window, and the window's size, as read and checked. */
interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
  viewWidth: number;
  viewHeight: number;
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function boxOf(value: unknown): Box | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const v = value as Record<string, unknown>;
  const { x, y, width, height, viewWidth, viewHeight } = v;
  if (![x, y, width, height, viewWidth, viewHeight].every(isNumber)) return undefined;
  return { x, y, width, height, viewWidth, viewHeight } as Box;
}

/** Styles as read: rows of strings, one row an element. Anything else reads as undefined. */
function stylesOf(value: unknown): string[][] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > 3) return undefined;
  const rows: string[][] = [];
  for (const row of value) {
    if (!Array.isArray(row) || row.length !== COMPARED_STYLES.length) return undefined;
    if (!row.every((cell) => typeof cell === "string")) return undefined;
    rows.push((row as string[]).map((cell) => cell.slice(0, 500)));
  }
  return rows;
}

/** The names of the properties that differ, on any of the elements, in `COMPARED_STYLES` order. */
export function changedStyles(focused: string[][], unfocused: string[][]): string[] {
  const changed = new Set<string>();
  for (let row = 0; row < Math.min(focused.length, unfocused.length); row += 1) {
    COMPARED_STYLES.forEach((name, i) => {
      if (focused[row]?.[i] !== unfocused[row]?.[i]) changed.add(name);
    });
  }
  if (focused.length !== unfocused.length) for (const name of COMPARED_STYLES) changed.add(name);
  return COMPARED_STYLES.filter((name) => changed.has(name));
}

/** The padded box, in whole CSS pixels and inside the window, or undefined when none of it is in the window. */
export function clipOf(box: Box): { x: number; y: number; width: number; height: number } | undefined {
  const left = Math.max(0, Math.floor(box.x - PAD_PX));
  const top = Math.max(0, Math.floor(box.y - PAD_PX));
  const right = Math.min(box.viewWidth, Math.ceil(box.x + box.width + PAD_PX));
  const bottom = Math.min(box.viewHeight, Math.ceil(box.y + box.height + PAD_PX));
  if (right - left < 1 || bottom - top < 1) return undefined;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** What the check makes of one stop. */
export type Verdict = { kind: "visible" } | { kind: "hidden" } | { kind: "review"; reason: string };

/** Percent, as the reasons print it: `0.4%`. */
function percent(share: number): string {
  return `${(Math.round(share * 1000) / 10).toString()}%`;
}

/**
 * The decision, from what was measured: the share of the padded box's pixels that changed, and the names of the
 * styles that did.
 */
export function verdictOf(share: number, styles: readonly string[]): Verdict {
  if (share >= VISIBLE_SHARE) return { kind: "visible" };
  if (share === 0 && styles.length === 0) return { kind: "hidden" };
  if (styles.length > 0) {
    return {
      kind: "review",
      reason:
        `Focus changes this element's ${styles.join(", ")}, but a screenshot of it focused by the keyboard differs ` +
        `from one unfocused in ${percent(share)} of its pixels, under the ${percent(VISIBLE_SHARE)} a scan takes ` +
        "as visible: the change may be too faint to see. Tab to it and look.",
    };
  }
  return {
    kind: "review",
    reason:
      `Focus changed ${percent(share)} of the pixels around this element, under the ${percent(VISIBLE_SHARE)} a ` +
      "scan takes as visible, and none of the styles a scan reads. Tab to it and look.",
  };
}

const OUTSIDE_REASON =
  "Focus is on this element, but it is outside the window, so no screenshot of it could be taken. Tab to it " +
  "and check that you can see where focus is.";

const NOT_MEASURED_REASON =
  "A scan could not take or compare the screenshots of this element focused and unfocused. Tab to it and " +
  "check that you can see where focus is.";

const STOPPED_REASON =
  "Not looked at: on this page a scan could not give focus back after it photographed an earlier Tab stop, so " +
  "it took no more screenshots. Tab to it and check that you can see where focus is.";

function pastCapReason(): string {
  return (
    `Not looked at: a scan takes screenshots of the first ${MAX_SCREENSHOT_STOPS.toString()} Tab stops of a ` +
    "page in each state, and this one comes after them. Tab to it and check that you can see where focus is."
  );
}

/** What the check found on one page in one state. */
export interface FocusVisibleResult {
  finding?: Finding;
  needsReview?: NeedsReview;
}

/**
 * The check on one walk. Make it before the walk with a `FocusReader` open on the page, call `atStop` from the
 * walk's `onStop` (while focus is on the stop), then `result`; the reader's owner closes the reader.
 */
export class FocusVisibleCheck {
  private readonly hidden: FindingElement[] = [];
  private readonly review: NeedsReviewElement[] = [];
  private shots = 0;
  /** Set when focus could not be given back: the check takes no more screenshots on this walk. */
  private stopped = false;

  /** `reader` is the scan's own, which the skip-link check shares; the check does not close it. */
  constructor(
    private readonly page: Page,
    private readonly pageKey: string,
    private readonly reader: FocusReader,
    private readonly guard: FocusGuard,
  ) {}

  /** Looks at the stop focus is on now. Never throws for what the page does: a stop it cannot measure is *needs review*. */
  async atStop(stop: WalkStop): Promise<void> {
    // Focus inside a frame of another origin cannot be read, so there is nothing to compare.
    if (stop.opaque === true) return;
    const element = (html: string): FindingElement => ({
      selector: stop.selector,
      target: stop.target,
      html,
      failure: "",
    });
    if (this.stopped || this.shots >= MAX_SCREENSHOT_STOPS) {
      const reason = this.stopped ? STOPPED_REASON : pastCapReason();
      this.review.push({ ...element(`<${stop.tag}>`), reason });
      return;
    }
    const held = await this.reader.callOnFocused(HOLD).catch(() => undefined);
    const read = typeof held === "object" && held !== null ? (held as Record<string, unknown>) : {};
    const html = typeof read.html === "string" ? read.html.slice(0, HTML_CHARS) : `<${stop.tag}>`;
    const box = boxOf(read.box);
    const clip = box === undefined ? undefined : clipOf(box);
    if (held === undefined || box === undefined) {
      await this.forget();
      this.review.push({ ...element(html), reason: NOT_MEASURED_REASON });
      return;
    }
    if (clip === undefined) {
      await this.forget();
      this.review.push({ ...element(html), reason: OUTSIDE_REASON });
      return;
    }
    this.shots += 1;
    let verdict: Verdict;
    try {
      // Each shot is taken with the page held still, and its styles read in that same stillness, so an animated
      // ring is judged as it ends; the animations are put back before the next thing happens.
      const shot = async (): Promise<{ png: Buffer; styles: string[][] | undefined }> => {
        // Which animations are running, read first with nothing held; the guard is told to stop their events
        // before any of them is set to its end, so no event can be dispatched between the two. Those are the
        // ones held; they are let through again once they have been put back and the browser has caught up.
        const running = await this.reader.call(STILL, null);
        const names = Array.isArray(running) ? running.filter((n): n is string => typeof n === "string") : [];
        await this.guard.still(names);
        await this.reader.call(STILL, names);
        try {
          // `caret: "initial"`: Playwright's own caret hiding writes a style attribute on every field and leaves
          // it behind, empty; the caret is hidden by `NO_TRANSITIONS` instead.
          const png = await this.page.screenshot({
            clip,
            caret: "initial",
            scale: "css",
            style: NO_TRANSITIONS,
          });
          return { png, styles: stylesOf(await this.reader.call(STYLES)) };
        } finally {
          await this.reader.call(RESUME);
          await this.guard.settle();
        }
      };
      const focused = await shot();
      await this.guard.hold(true);
      if ((await this.reader.call(BLUR)) !== true) throw new Error("focus did not leave the element");
      const unfocused = await shot();
      await this.giveBack();
      const focusedStyles = focused.styles;
      const unfocusedStyles = unfocused.styles;
      if (focusedStyles === undefined || unfocusedStyles === undefined) throw new Error("unreadable styles");
      const focusedShot = focused.png;
      const unfocusedShot = unfocused.png;
      const a = decodePng(focusedShot);
      const b = decodePng(unfocusedShot);
      const share = changedPixels(a, b, PIXEL_TOLERANCE) / (a.width * a.height);
      verdict = verdictOf(share, changedStyles(focusedStyles, unfocusedStyles));
    } catch {
      await this.giveBack();
      verdict = { kind: "review", reason: NOT_MEASURED_REASON };
    }
    if (verdict.kind === "hidden") this.hidden.push({ ...element(html), failure: NO_CHANGE_FAILURE });
    else if (verdict.kind === "review") this.review.push({ ...element(html), reason: verdict.reason });
  }

  /** Puts focus back on the kept element, if it is kept; when that fails, the check stops taking screenshots. */
  private async giveBack(): Promise<void> {
    const back = await this.reader.call(REFOCUS).catch(() => false);
    // Last: the events the refocus fired have been stopped before the guard is let go.
    await this.guard.hold(false).catch(() => undefined);
    if (back !== true) this.stopped = true;
  }

  /** Forgets the kept element without moving focus (nothing was blurred yet). */
  private async forget(): Promise<void> {
    await this.reader.call(`function () { delete globalThis.${HELD}; }`).catch(() => undefined);
  }

  result(): FocusVisibleResult {
    const rule = (): Finding["rule"] => ({ ...FOCUS_VISIBLE_RULE, wcag: [...FOCUS_VISIBLE_RULE.wcag] });
    const id = `genie/focus-visible@${this.pageKey}`;
    return {
      ...(this.hidden.length === 0
        ? {}
        : {
            finding: {
              id,
              rule: rule(),
              kind: "violation",
              impact: IMPACT,
              page: this.pageKey,
              elements: [...this.hidden],
            },
          }),
      ...(this.review.length === 0
        ? {}
        : {
            needsReview: { id, rule: rule(), impact: IMPACT, page: this.pageKey, elements: [...this.review] },
          }),
    };
  }
}
