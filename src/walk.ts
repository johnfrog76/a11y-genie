/**
 * The keyboard walk (docs/CHECKS.md, *The keyboard walk*): from the top of the page, press Tab up to `--max-tabs` times and record where
 * focus lands after each press, through open shadow roots and same-origin frames. It ends when focus returns
 * to the first stop, when it leaves the document, or at the limit. The walk is data, not a finding: the skip
 * link (6.4) reads its first stops, and the trap (6.5) and focus-visible (6.3) checks read the same walk.
 *
 * How headless Chrome moves focus past the last element (V5, docs/ARCHITECTURE.md): the first Tab past it
 * takes focus out of the document, to the browser's own controls (`document.activeElement` is `body` and
 * `document.hasFocus()` is false), and the next Tab comes back to the first element. Once a lap has wrapped
 * that way, the next lap goes straight from the last element to the first. So the walk ends on whichever it
 * sees: focus on no element (`left`), or the first stop again (`wrapped`).
 *
 * It also ends when focus goes round a later part of the page (`cycled`): a press lands on a stop already
 * recorded that is not the first, and the presses after it go round the same stops in the same order back to
 * it. That second lap is the proof; a page that sends focus back once and then moves on is walked on. Focus
 * that does not move at all is the shortest cycle: the same element after three presses. The trap check
 * (src/keyboard-trap.ts) reads a cycle, and a `wrapped` walk, as where focus may be held.
 *
 * The page is hostile. What reads focus runs in an isolated world of its own (`Page.createIsolatedWorld`),
 * so a page that replaces `document.activeElement` or `Element.prototype.matches` cannot change what it
 * reads, and what comes back is checked field by field. Role and name come from the browser's own
 * accessibility tree (`Accessibility.getPartialAXTree`), not from the page.
 */

import type { CDPSession, Page } from "playwright-core";
import type { AxeTarget } from "./finding.js";
import { selectorOf } from "./map-axe.js";
import { printableLine } from "./printable.js";

/** The walk's limit when `--max-tabs` is not given; `Tab to` steps give up after it too. */
export const DEFAULT_MAX_TABS = 200;

/** The largest `--max-tabs` taken. Past a thousand presses a page has something else wrong. */
export const MAX_MAX_TABS = 1000;

/** The longest selector part kept, in characters. A longer one (a page nested thousands deep) is cut with `…`. */
export const SELECTOR_CHARS = 1000;

/** The longest accessible name the walk reads, in characters; the record cuts it further, to the excerpt limit. */
const NAME_CHARS = 500;

/**
 * Why the walk ended. `wrapped`: focus came back to the first stop. `left`: focus went to no element (out of
 * the document, to the browser's own controls). `cycled`: focus went twice round stops after the first, from
 * `cycleFrom` to the last stop, and never back to the first. `max-tabs`: the limit was reached first, so the
 * walk is cut and the page may have more stops.
 */
export type WalkEnd = "wrapped" | "left" | "cycled" | "max-tabs";

/** Where focus was after one Tab press. */
export interface WalkStop {
  /** Which press landed here, from 1. */
  index: number;
  /** `target` as one string, as a finding's element has it: parts joined with ` >>> `. */
  selector: string;
  /** One entry per document, outermost first; an entry that is an array is a path through shadow roots. */
  target: AxeTarget;
  /** The element's tag name, lower case. */
  tag: string;
  /** The role in the browser's accessibility tree, such as `button` or `link`; null when it gave none. */
  role: string | null;
  /** The accessible name the browser computed, on one line and printable; empty when it has none. */
  name: string;
  /**
   * Whether the element matches `:focus-visible`: the browser would show a focus indicator if the page's
   * styles let it. Not whether one is seen; that is `genie/focus-visible`'s question.
   */
  focusVisible: boolean;
  /** Present when focus is inside a frame of another origin, which the walk cannot read: the stop is that frame. */
  opaque?: true;
}

/** One walk of one page in one state. */
export interface Walk {
  stops: WalkStop[];
  end: WalkEnd;
  /** How many times Tab was pressed. */
  tabs: number;
  /** The limit it was held to. */
  maxTabs: number;
  /** Only when `end` is `cycled`: the `index` of the stop the cycle starts at. It runs from there to the last stop. */
  cycleFrom?: number;
}

/** What `FocusReader.read` found: an element (a stop without its index), or focus on no element. */
export type Focused = Omit<WalkStop, "index"> | null;

/** Runs in the isolated world: the element focus is on, through open shadow roots and same-origin frames. */
export const DEEP_FOCUS = `(() => {
  let el = document.activeElement;
  for (;;) {
    if (!el) return null;
    const shadow = el.shadowRoot;
    if (shadow && shadow.activeElement) { el = shadow.activeElement; continue; }
    if (el.localName === "iframe" || el.localName === "frame") {
      let inner = null;
      try { inner = el.contentDocument; } catch (e) { inner = null; }
      const active = inner ? inner.activeElement : null;
      if (active && active !== inner.body && active !== inner.documentElement) { el = active; continue; }
    }
    break;
  }
  if (el === document.body || el === document.documentElement) return null;
  return el;
})()`;

/**
 * Runs in the isolated world: takes focus off whatever has it, and moves the place Tab starts from to the
 * top of the page. Blurring alone is not enough: Chrome starts the next Tab from the element that last had
 * focus or was clicked, so after a state's steps the walk would begin part way down. Focusing the root
 * element (made focusable for a moment by `tabindex="-1"`, then put back as it was) moves that place to the
 * top. That is still not the start: from an element outside the Tab order, Chrome goes to the next one in
 * source order, and so skips a `tabindex="1"` that comes after a `tabindex="2"`. So `fromTheTop` then presses
 * Shift+Tab once, which from the top takes focus out of the page, and the next Tab enters it where a person's
 * first Tab would, positive `tabindex` first (V5).
 */
const FROM_THE_TOP = `(() => {
  const chain = [];
  let el = document.activeElement;
  while (el) {
    chain.push(el);
    const shadow = el.shadowRoot;
    if (shadow && shadow.activeElement) { el = shadow.activeElement; continue; }
    let inner = null;
    if (el.localName === "iframe" || el.localName === "frame") {
      try { inner = el.contentDocument; } catch (e) { inner = null; }
    }
    el = inner ? inner.activeElement : null;
  }
  for (const e of chain.reverse()) if (typeof e.blur === "function") e.blur();
  const root = document.documentElement;
  if (!root) return;
  const had = root.getAttribute("tabindex");
  root.setAttribute("tabindex", "-1");
  root.focus({ preventScroll: true });
  root.blur();
  if (had === null) root.removeAttribute("tabindex");
  else root.setAttribute("tabindex", had);
})()`;

/**
 * Runs in the isolated world with `this` as the focused element: where it is, as a `target`, and what it is.
 * Each part is the element's id when that id is unique in its own root, or a path of `:nth-of-type` steps
 * up to one, as the click check's selectors are. An element at the top of a shadow root is anchored with
 * `:host >`, so the part matches it and nothing deeper. Exported so a check that runs its own function in the
 * reader's world (`FocusReader.call`) names elements the way the walk's stops are named.
 */
export const DESCRIBE = `function () {
  const MAX = ${SELECTOR_CHARS};
  // A part over MAX keeps its end, which names the element itself (its own :nth-of-type steps), behind a short hash
  // of the whole part, so two different deep elements never cut to the same part (a stop is told by its target).
  const cut = (s) => {
    if (s.length <= MAX) return s;
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    const head = "…[" + h.toString(16) + "] ";
    return head + s.slice(s.length - (MAX - head.length));
  };
  const partIn = (el, root) => {
    const parts = [];
    for (let node = el; node; ) {
      if (node.id && node.id.length <= 100) {
        const id = "#" + CSS.escape(node.id);
        if (root.querySelectorAll(id).length === 1) { parts.unshift(id); break; }
      }
      const tag = CSS.escape(node.localName);
      const parent = node.parentElement;
      const siblings = parent ? parent.children : node.parentNode ? node.parentNode.children : [node];
      let n = 0, of = 0;
      for (const sibling of siblings) {
        if (sibling.localName !== node.localName) continue;
        of += 1;
        if (sibling === node) n = of;
      }
      const step = of === 1 ? tag : tag + ":nth-of-type(" + n + ")";
      if (!parent) {
        parts.unshift(root instanceof ShadowRoot ? ":host > " + step : step);
        break;
      }
      parts.unshift(step);
      node = parent;
    }
    return cut(parts.join(" > "));
  };
  const target = [];
  let el = this;
  for (;;) {
    const shadowPath = [];
    let root = el.getRootNode();
    while (root instanceof ShadowRoot) {
      shadowPath.unshift(partIn(el, root));
      el = root.host;
      root = el.getRootNode();
    }
    shadowPath.unshift(partIn(el, root));
    target.unshift(shadowPath.length === 1 ? shadowPath[0] : shadowPath);
    let frame = null;
    try { frame = root.defaultView ? root.defaultView.frameElement : null; } catch (e) { frame = null; }
    if (!frame) break;
    el = frame;
  }
  let opaque = false;
  if (this.localName === "iframe" || this.localName === "frame") {
    try { opaque = !this.contentDocument; } catch (e) { opaque = true; }
  }
  let visible = false;
  try { visible = this.matches(":focus-visible"); } catch (e) { visible = false; }
  return { target, tag: this.localName, focusVisible: visible, opaque };
}`;

function isPart(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

/** A `target` as the page script gave it, checked: one entry per document, strings or arrays of strings. */
export function targetOf(value: unknown): AxeTarget | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const target: AxeTarget = [];
  for (const entry of value) {
    if (isPart(entry)) target.push(entry);
    else if (Array.isArray(entry) && entry.length > 0 && entry.every(isPart)) target.push([...entry]);
    else return undefined;
  }
  return target;
}

/** The role and name the browser's accessibility tree gives the node, read as typed data. */
function roleAndName(answer: unknown): { role: string | null; name: string } {
  const nodes = (answer as { nodes?: unknown } | undefined)?.nodes;
  const node: unknown = Array.isArray(nodes) ? nodes[0] : undefined;
  if (typeof node !== "object" || node === null) return { role: null, name: "" };
  const valueOf = (field: unknown): unknown =>
    typeof field === "object" && field !== null ? (field as { value?: unknown }).value : undefined;
  const role = valueOf((node as { role?: unknown }).role);
  const name = valueOf((node as { name?: unknown }).name);
  return {
    role: typeof role === "string" && role !== "" ? role.slice(0, 100) : null,
    name: typeof name === "string" ? printableLine(name.slice(0, NAME_CHARS)) : "",
  };
}

/** Whether two stops are the same element: the same `target`. */
export function sameStop(a: Pick<WalkStop, "target">, b: Pick<WalkStop, "target">): boolean {
  return JSON.stringify(a.target) === JSON.stringify(b.target);
}

/**
 * Reads where focus is on one page, through a DevTools Protocol session of its own and an isolated world.
 * The walk uses it, and so can a check that presses other keys (Shift+Tab, Escape) and reads again.
 * Close it when done.
 */
export class FocusReader {
  private constructor(
    private readonly session: CDPSession,
    private readonly contextId: number,
  ) {}

  static async open(page: Page): Promise<FocusReader> {
    const session = await page.context().newCDPSession(page);
    try {
      const { frameTree } = await session.send("Page.getFrameTree");
      const { executionContextId } = await session.send("Page.createIsolatedWorld", {
        frameId: frameTree.frame.id,
        worldName: "a11y-genie-walk",
      });
      return new FocusReader(session, executionContextId);
    } catch (error) {
      await session.detach().catch(() => undefined);
      throw error;
    }
  }

  /**
   * Takes focus off everything and out of the page, so the next Tab lands where a person's first Tab would.
   * It presses Shift+Tab once (see `FROM_THE_TOP`).
   */
  async fromTheTop(page: Page): Promise<void> {
    const { exceptionDetails } = await this.session.send("Runtime.evaluate", {
      expression: FROM_THE_TOP,
      contextId: this.contextId,
      returnByValue: true,
    });
    if (exceptionDetails !== undefined) throw new Error("the walk could not move focus to the top");
    await page.keyboard.press("Shift+Tab");
  }

  /** Where focus is now: the element, or null when it is on no element. */
  async read(): Promise<Focused> {
    const group = "a11y-genie-walk";
    try {
      const found = await this.session.send("Runtime.evaluate", {
        expression: DEEP_FOCUS,
        contextId: this.contextId,
        objectGroup: group,
        returnByValue: false,
      });
      if (found.exceptionDetails !== undefined) throw new Error("the walk could not read focus");
      const objectId = found.result.objectId;
      if (found.result.subtype === "null" || objectId === undefined) return null;
      const described = await this.session.send("Runtime.callFunctionOn", {
        objectId,
        functionDeclaration: DESCRIBE,
        returnByValue: true,
      });
      const value = described.result.value as Record<string, unknown> | undefined;
      const target = targetOf(value?.target);
      if (described.exceptionDetails !== undefined || value === undefined || target === undefined) {
        throw new Error("the walk could not describe the focused element");
      }
      const ax: unknown = await this.session
        .send("Accessibility.getPartialAXTree", { objectId, fetchRelatives: false })
        .catch(() => undefined);
      return {
        selector: selectorOf(target),
        target,
        tag: typeof value.tag === "string" ? value.tag.slice(0, 100) : "",
        ...roleAndName(ax),
        focusVisible: value.focusVisible === true,
        ...(value.opaque === true ? { opaque: true as const } : {}),
      };
    } finally {
      await this.session.send("Runtime.releaseObjectGroup", { objectGroup: group }).catch(() => undefined);
    }
  }

  /**
   * Runs `functionDeclaration` in the reader's isolated world, with `args` (plain JSON values) as its
   * arguments, and returns what it returns, by value. What comes back is the page's: check it before use.
   * A check that needs more than `read` gives (src/keyboard-trap.ts) asks the page this way, out of reach of
   * the page's own scripts.
   */
  async call(functionDeclaration: string, ...args: unknown[]): Promise<unknown> {
    const answer = await this.session.send("Runtime.callFunctionOn", {
      functionDeclaration,
      executionContextId: this.contextId,
      arguments: args.map((value) => ({ value })),
      returnByValue: true,
      // A function may wait for the next frame (the focus check's scroll mark); one that returns at once is unchanged.
      awaitPromise: true,
    });
    if (answer.exceptionDetails !== undefined) throw new Error("a check could not read the page");
    return answer.result.value as unknown;
  }

  /**
   * As `call`, with the element focus is on (through shadow roots and same-origin frames, as `read` finds it)
   * as `this`. Undefined when focus is on no element.
   */
  async callOnFocused(functionDeclaration: string, ...args: unknown[]): Promise<unknown> {
    const group = "a11y-genie-walk";
    try {
      const found = await this.session.send("Runtime.evaluate", {
        expression: DEEP_FOCUS,
        contextId: this.contextId,
        objectGroup: group,
        returnByValue: false,
      });
      const objectId = found.result.objectId;
      if (found.exceptionDetails !== undefined) throw new Error("the walk could not read focus");
      if (found.result.subtype === "null" || objectId === undefined) return undefined;
      const answer = await this.session.send("Runtime.callFunctionOn", {
        objectId,
        functionDeclaration,
        arguments: args.map((value) => ({ value })),
        returnByValue: true,
      });
      if (answer.exceptionDetails !== undefined)
        throw new Error("a check could not read the focused element");
      return answer.result.value as unknown;
    } finally {
      await this.session.send("Runtime.releaseObjectGroup", { objectGroup: group }).catch(() => undefined);
    }
  }

  async close(): Promise<void> {
    await this.session.detach().catch(() => undefined);
  }
}

export interface WalkOptions {
  /** `--max-tabs`: the most Tab presses. Default `DEFAULT_MAX_TABS`. */
  maxTabs?: number;
  /** Called after each stop is read, while focus is still on it, so a check can look at it there. */
  onStop?: (stop: WalkStop) => Promise<void>;
  /** Called just before each Tab press, so a check can see the page as it was before focus moved. */
  beforePress?: () => Promise<void>;
}

/**
 * Walks the page with the Tab key from the top, and leaves focus where the walk ended. It moves focus and
 * presses keys (Shift+Tab once to start, then Tab), so it runs after every check that reads the page as it
 * loaded.
 */
export async function walkPage(page: Page, options: WalkOptions = {}): Promise<Walk> {
  const maxTabs = options.maxTabs ?? DEFAULT_MAX_TABS;
  const reader = await FocusReader.open(page);
  try {
    await reader.fromTheTop(page);
    const stops: WalkStop[] = [];
    let end: WalkEnd = "max-tabs";
    let tabs = 0;
    // While focus goes round stops already recorded: where the cycle starts, and the stop the next press must reach.
    let lap: { from: number; next: number } | undefined;
    while (tabs < maxTabs) {
      await options.beforePress?.();
      await page.keyboard.press("Tab");
      tabs += 1;
      const focused = await reader.read();
      if (focused === null) {
        end = "left";
        break;
      }
      const first = stops[0];
      // A frame of another origin is the same stop while focus moves inside it, so it is never the wrap.
      if (first !== undefined && focused.opaque !== true && sameStop(focused, first)) {
        end = "wrapped";
        break;
      }
      if (lap !== undefined) {
        const expected = stops[lap.next];
        if (expected !== undefined && sameStop(focused, expected)) {
          if (lap.next === lap.from) {
            end = "cycled";
            break;
          }
          lap = { from: lap.from, next: lap.next + 1 < stops.length ? lap.next + 1 : lap.from };
          continue;
        }
        lap = undefined;
      }
      // A stop already recorded, other than the first, starts a lap: it is not recorded again.
      const seen =
        focused.opaque === true ? -1 : stops.findIndex((s) => s.opaque !== true && sameStop(s, focused));
      if (seen > 0) {
        lap = { from: seen, next: seen + 1 < stops.length ? seen + 1 : seen };
        continue;
      }
      const stop: WalkStop = { index: tabs, ...focused };
      stops.push(stop);
      await options.onStop?.(stop);
    }
    const cycleStart = end === "cycled" && lap !== undefined ? stops[lap.from] : undefined;
    return {
      stops,
      end,
      tabs,
      maxTabs,
      ...(cycleStart === undefined ? {} : { cycleFrom: cycleStart.index }),
    };
  } finally {
    await reader.close();
  }
}
