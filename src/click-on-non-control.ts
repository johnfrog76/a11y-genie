/**
 * `genie/click-on-non-control` (spec 6.2): an element that does something on a click, but that a keyboard
 * cannot reach and a screen reader does not name as a control. axe-core has no rule for a `div` with an
 * `onclick`.
 *
 * A candidate is an element that is not a control: not `a[href]`, `button`, `input`, `select`, `textarea`,
 * `summary`, `label` or `option`, not given one of ARIA's widget roles, and not focusable by `tabindex >= 0`.
 * A candidate is flagged when it has a click handler of its own: an inline `onclick` attribute, or a `click`
 * listener on the element itself, read through the DevTools Protocol (`DOMDebugger.getEventListeners`).
 * Listeners are asked for only where the computed `cursor` is `pointer`, which bounds the cost (V8 in
 * docs/ARCHITECTURE.md), and for at most `MAX_LISTENER_QUERIES` elements.
 *
 * A candidate that sets a pointer cursor but has no handler of its own goes to *needs review*, never to the
 * findings: a framework such as React attaches one listener at the root, and from the element alone that
 * cannot be told from a pointer cursor that does nothing (spec 13, G3).
 *
 * The page is hostile. The script that finds candidates runs in an isolated world of its own, so a page that
 * replaces `getComputedStyle` or `Element.prototype.matches` cannot change what it reads, and what it gives
 * back is checked field by field. It reads the page's own document: not its frames, and not inside shadow
 * roots.
 */

import type { CDPSession, Page } from "playwright-core";
import type { Finding, FindingElement, NeedsReview, NeedsReviewElement } from "./finding.js";
import { registerGenieRule } from "./genie-rules.js";

export const CLICK_ON_NON_CONTROL_RULE = {
  source: "genie",
  id: "click-on-non-control",
  help: "An element reacts to a click, but it is not a control: a keyboard cannot reach it and a screen reader does not name it.",
  helpUrl: "",
  wcag: ["2.1.1", "4.1.2"],
} as const;

/** `serious`, as spec 6.2 sets it. */
const IMPACT = "serious";

/** The tags it runs under: a `--tags` list with none of them leaves it out, as axe-core's rules are. */
export const CLICK_ON_NON_CONTROL_TAGS = ["cat.keyboard", "wcag2a", "wcag211", "wcag412"] as const;

registerGenieRule({
  rule: { ...CLICK_ON_NON_CONTROL_RULE, wcag: [...CLICK_ON_NON_CONTROL_RULE.wcag] },
  impact: IMPACT,
  tags: [...CLICK_ON_NON_CONTROL_TAGS],
});

/**
 * The most elements whose listeners are asked for on one page. Each costs one DevTools Protocol call; past
 * this many, a pointer-cursor element is not asked, and goes to *needs review* saying so. Measured in V8.
 */
export const MAX_LISTENER_QUERIES = 2000;

/** The most candidates the page script hands back at all, so a page of a million elements stays bounded. */
export const MAX_CANDIDATES = 5000;

/** How many characters of an element's HTML the page script hands back; the record cuts it further. */
const HTML_CHARS = 500;

/** The controls of spec 6.2, by tag. `a` only with an `href`. */
export const CONTROL_SELECTOR = "a[href], button, input, select, textarea, summary, label, option";

/** ARIA's widget roles, the composite ones among them (WAI-ARIA 1.2, 5.3.2). An element given one is a control. */
export const WIDGET_ROLES = [
  "button",
  "checkbox",
  "combobox",
  "grid",
  "gridcell",
  "link",
  "listbox",
  "menu",
  "menubar",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "progressbar",
  "radio",
  "radiogroup",
  "scrollbar",
  "searchbox",
  "separator",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "tablist",
  "tabpanel",
  "textbox",
  "tree",
  "treegrid",
  "treeitem",
] as const;

const FAILURE =
  "Fix all of the following:\n" +
  "  The element reacts to a click, but it has no control's role and cannot take keyboard focus. " +
  "Make it a <button> with the same handler and the same text. If it must stay as it is, give it " +
  'role="button" and tabindex="0", and run the same handler on Enter and Space.';

/** What a candidate's own listeners came to: a click handler, none, past the cap, or a call that failed. */
type Own = "handler" | "none" | "unasked" | "unread";

const LOOKS = "It looks clickable (its cursor is a pointer), has no role and cannot take focus";
const CHECK = "Check whether it does something; if it does, make it a <button>.";

/** Why a candidate with no handler found is *needs review*, by what its listeners came to. */
const REASONS: Record<Exclude<Own, "handler">, string> = {
  none:
    `${LOOKS}, and it has no click handler of its own. A handler further up the page, such as one a ` +
    `framework attaches at the root, may still act on it. ${CHECK}`,
  unasked:
    `${LOOKS}. The page has more such elements than the ${MAX_LISTENER_QUERIES} whose listeners a scan ` +
    `asks for, so this one was not asked. ${CHECK}`,
  unread: `${LOOKS}. Its listeners could not be read: the page may have changed while it was scanned. ${CHECK}`,
};

/** The one line for the candidates past `MAX_CANDIDATES`, which are not described at all. */
function notListedReason(count: number): string {
  return (
    `The page has ${count} more elements that look clickable or carry an onclick than the ` +
    `${MAX_CANDIDATES} a scan looks at, and they are not listed. Look for any that react to a click and ` +
    `are not controls; make each a <button>.`
  );
}

/**
 * Runs in the page's isolated world, so the page's own scripts cannot change what it reads. Returns
 * `{ elements, info, more }`: the candidates, one plain description of each, and how many were left out
 * past `MAX_CANDIDATES`.
 */
const CANDIDATES_SCRIPT = `(() => {
  const CONTROL = ${JSON.stringify(CONTROL_SELECTOR)};
  const WIDGET = new Set(${JSON.stringify(WIDGET_ROLES)});
  const MAX = ${MAX_CANDIDATES};
  const HTML_CHARS = ${HTML_CHARS};
  const isControl = (el) => {
    if (el.matches(CONTROL)) return true;
    const role = (el.getAttribute("role") || "").trim().toLowerCase().split(/\\s+/);
    if (role.some((r) => WIDGET.has(r))) return true;
    return el.hasAttribute("tabindex") && el.tabIndex >= 0;
  };
  const pointer = (el) => el instanceof Element && getComputedStyle(el).cursor === "pointer";
  // Each id counted once, and each parent's children numbered once, so a selector costs the element's depth.
  const ids = new Map();
  for (const el of document.querySelectorAll("[id]")) ids.set(el.id, (ids.get(el.id) || 0) + 1);
  const numbered = new WeakMap();
  const placeOf = (node) => {
    const parent = node.parentElement;
    let places = numbered.get(parent);
    if (places === undefined) {
      places = new Map();
      const seen = new Map();
      for (const child of parent.children) {
        const n = (seen.get(child.localName) || 0) + 1;
        seen.set(child.localName, n);
        places.set(child, n);
      }
      places.set(null, seen);
      numbered.set(parent, places);
    }
    return { n: places.get(node), of: places.get(null).get(node.localName) };
  };
  const selectorOf = (el) => {
    const parts = [];
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
      if (node.id && ids.get(node.id) === 1) {
        parts.unshift("#" + CSS.escape(node.id));
        break;
      }
      const tag = CSS.escape(node.localName);
      if (!node.parentElement) {
        parts.unshift(tag);
        break;
      }
      const { n, of } = placeOf(node);
      parts.unshift(of === 1 ? tag : tag + ":nth-of-type(" + n + ")");
    }
    return parts.join(" > ");
  };
  // The opening tag, the first of its text and the closing tag: never the whole subtree, which can be large.
  const htmlOf = (el) => {
    const open = el.cloneNode(false).outerHTML;
    const close = "</" + el.localName + ">";
    const inner = open.endsWith(close) ? open.slice(0, -close.length) : open;
    const text = (el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 80);
    return (inner + (el.children.length > 0 ? "…" + text : text) + close).slice(0, HTML_CHARS);
  };
  const elements = [];
  const info = [];
  let more = 0;
  const all = document.body ? document.body.querySelectorAll("*") : [];
  for (const el of all) {
    const inline = el.hasAttribute("onclick");
    const isPointer = pointer(el);
    if (!inline && !isPointer) continue;
    if (isControl(el)) continue;
    if (typeof el.checkVisibility === "function" && !el.checkVisibility()) continue;
    if (elements.length >= MAX) {
      more += 1;
      continue;
    }
    elements.push(el);
    info.push({
      selector: selectorOf(el),
      html: htmlOf(el),
      inline,
      setsPointer: isPointer && !pointer(el.parentElement),
    });
  }
  return { elements, info, more };
})()`;

/** One candidate as the page script describes it. */
interface Candidate {
  selector: string;
  html: string;
  /** It carries an inline `onclick` attribute. */
  inline: boolean;
  /** Its cursor is a pointer and its parent's is not: it is the element that sets it, not one that inherits it. */
  setsPointer: boolean;
}

function isCandidate(value: unknown): value is Candidate {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.selector === "string" &&
    v.selector !== "" &&
    typeof v.html === "string" &&
    typeof v.inline === "boolean" &&
    typeof v.setsPointer === "boolean"
  );
}

/** What the check found on one page: at most one finding and one *needs review* item. */
export interface ClickOnNonControl {
  finding?: Finding;
  needsReview?: NeedsReview;
  /** How many elements had their listeners asked for, and how many were left out past a cap. For V8. */
  cost: { candidates: number; asked: number; pastCap: number; ms: number };
}

function element(candidate: Candidate, failure: string): FindingElement {
  return { selector: candidate.selector, target: [candidate.selector], html: candidate.html, failure };
}

/** Whether a `DOMDebugger.getEventListeners` answer has a `click` listener in it. */
function hasClickListener(answer: unknown): boolean {
  if (typeof answer !== "object" || answer === null) return false;
  const listeners = (answer as { listeners?: unknown }).listeners;
  return (
    Array.isArray(listeners) &&
    listeners.some((l) => typeof l === "object" && l !== null && (l as { type?: unknown }).type === "click")
  );
}

/** Each array index's remote object id, from `Runtime.getProperties` on the array. */
async function objectIdsOf(session: CDPSession, arrayId: string, count: number): Promise<string[]> {
  const { result } = await session.send("Runtime.getProperties", { objectId: arrayId, ownProperties: true });
  const ids: string[] = new Array<string>(count).fill("");
  for (const property of result) {
    const index = Number(property.name);
    const id = property.value?.objectId;
    if (Number.isInteger(index) && index >= 0 && index < count && typeof id === "string") ids[index] = id;
  }
  return ids;
}

/**
 * The element's own listeners. A listener belongs to the world that added it, and `getEventListeners` answers
 * for the world of the object it is given, so the isolated world's object lists none of the page's (V8). The
 * element is resolved again in the page's main world, by its backend node id, and asked there: three calls.
 * Undefined when any of them fails, such as for an element the page has just removed.
 */
async function listenersOf(session: CDPSession, isolatedId: string, group: string): Promise<unknown> {
  try {
    const { node } = await session.send("DOM.describeNode", { objectId: isolatedId });
    const { object } = await session.send("DOM.resolveNode", {
      backendNodeId: node.backendNodeId,
      objectGroup: group,
    });
    if (object.objectId === undefined) return undefined;
    return await session.send("DOMDebugger.getEventListeners", { objectId: object.objectId });
  } catch {
    return undefined;
  }
}

/**
 * Asks the page for click handlers on elements that are not controls. `pageKey` names the page. It opens a
 * DevTools Protocol session of its own and closes it before it returns.
 */
export async function checkClickOnNonControl(page: Page, pageKey: string): Promise<ClickOnNonControl> {
  const started = Date.now();
  const session = await page.context().newCDPSession(page);
  const group = "a11y-genie-click";
  try {
    const { frameTree } = await session.send("Page.getFrameTree");
    const { executionContextId } = await session.send("Page.createIsolatedWorld", {
      frameId: frameTree.frame.id,
      worldName: "a11y-genie",
    });
    const evaluated = await session.send("Runtime.evaluate", {
      expression: CANDIDATES_SCRIPT,
      contextId: executionContextId,
      objectGroup: group,
      returnByValue: false,
    });
    const resultId = evaluated.result.objectId;
    if (evaluated.exceptionDetails !== undefined || resultId === undefined) {
      throw new Error("the click check's page script failed");
    }
    const parts = await session.send("Runtime.callFunctionOn", {
      objectId: resultId,
      functionDeclaration: "function () { return { info: this.info, more: this.more }; }",
      returnByValue: true,
    });
    const plain = parts.result.value as { info?: unknown; more?: unknown } | undefined;
    const raw: unknown[] = Array.isArray(plain?.info) ? (plain.info as unknown[]) : [];
    const more = typeof plain?.more === "number" ? plain.more : 0;
    const elementsArray = await session.send("Runtime.callFunctionOn", {
      objectId: resultId,
      functionDeclaration: "function () { return this.elements; }",
      objectGroup: group,
      returnByValue: false,
    });
    const arrayId = elementsArray.result.objectId;
    const ids = arrayId === undefined ? [] : await objectIdsOf(session, arrayId, raw.length);

    const flagged: FindingElement[] = [];
    const review: NeedsReviewElement[] = [];
    let asked = 0;
    // Asked together, so the round trips overlap. "unasked" is past the cap; "unread" is a call that failed.
    const answers = await Promise.all(
      raw.map(async (value, index): Promise<[Candidate, Own] | undefined> => {
        if (!isCandidate(value)) return undefined;
        if (value.inline) return [value, "handler"];
        const objectId = ids[index];
        if (objectId === undefined || objectId === "") return [value, "unread"];
        if (asked >= MAX_LISTENER_QUERIES) return [value, "unasked"];
        asked += 1;
        const answer = await listenersOf(session, objectId, group);
        if (answer === undefined) return [value, "unread"];
        return [value, hasClickListener(answer) ? "handler" : "none"];
      }),
    );
    let pastCap = 0;
    for (const answer of answers) {
      if (answer === undefined) continue;
      const [candidate, own] = answer;
      if (own === "unasked") pastCap += 1;
      if (own === "handler") flagged.push(element(candidate, FAILURE));
      // Only the element that sets the pointer: the ones inside it inherit the cursor and say nothing more.
      else if (candidate.setsPointer) {
        const reason = REASONS[own];
        review.push({ ...element(candidate, reason), reason });
      }
    }
    if (more > 0) {
      const reason = notListedReason(more);
      review.push({ selector: "body", target: ["body"], html: "<body>", failure: reason, reason });
    }

    const rule = () => ({ ...CLICK_ON_NON_CONTROL_RULE, wcag: [...CLICK_ON_NON_CONTROL_RULE.wcag] });
    const id = `genie/${CLICK_ON_NON_CONTROL_RULE.id}@${pageKey}`;
    return {
      ...(flagged.length > 0
        ? {
            finding: {
              id,
              rule: rule(),
              kind: "violation",
              impact: IMPACT,
              page: pageKey,
              elements: flagged,
            },
          }
        : {}),
      ...(review.length > 0
        ? { needsReview: { id, rule: rule(), impact: IMPACT, page: pageKey, elements: review } }
        : {}),
      cost: { candidates: raw.length + more, asked, pastCap: pastCap + more, ms: Date.now() - started },
    };
  } finally {
    await session.send("Runtime.releaseObjectGroup", { objectGroup: group }).catch(() => undefined);
    await session.detach().catch(() => undefined);
  }
}
