/**
 * Reading the accessibility tree for narration (docs/ARCHITECTURE.md, *Reading the accessibility tree*). For the element keyboard focus is on, found
 * through open shadow roots and same-origin frames as the keyboard walk finds it (src/walk.ts), this reads
 * what the browser's own accessibility tree says of it: role, name, value, heading level, states (expanded,
 * checked, pressed, selected, disabled, read only, required, invalid) and its position in a set ("2 of 5"),
 * and builds the line a screen reader would say, name first: `Save, button`; `Email, edit text, required`.
 *
 * The source is the DevTools Protocol's `Accessibility.getPartialAXTree`, not Playwright's
 * `locator.ariaSnapshot()`: the snapshot leaves out `required`, a collapsed state and a menu button's popup,
 * and neither gives a position in a set, which is worked out here from the tree (V6, docs/ARCHITECTURE.md).
 *
 * The page is hostile. Focus is found in an isolated world of the reader's own, so the page's scripts cannot
 * change what it finds, and every field the protocol gives back is checked before use. Names and values are
 * page text: they are made printable and cut to the excerpt limit before they reach the spoken line.
 */

import type { CDPSession, Page } from "playwright-core";
import { LIMITS } from "./context.js";
import type { AxeTarget } from "./finding.js";
import { selectorOf } from "./map-axe.js";
import { printableLine } from "./printable.js";
import { cutText } from "./scan-record.js";
import { DEEP_FOCUS, DESCRIBE, targetOf } from "./walk.js";

/** The longest name or value read from the tree before it is made printable, in characters. */
const READ_CHARS = 500;

/** The most nested sets looked into when counting the members of one set. Past it, no position is given. */
const MAX_NESTED_SETS = 50;

/**
 * The words said for each role in the browser's accessibility tree. A role not listed is said as the tree
 * names it, its words split and in lower case. `generic`, `none` and `presentation` say nothing.
 */
export const ROLE_WORDS: Readonly<Record<string, string>> = Object.freeze({
  alert: "alert",
  alertdialog: "alert dialog",
  article: "article",
  banner: "banner",
  button: "button",
  cell: "cell",
  checkbox: "check box",
  columnheader: "column header",
  combobox: "combo box",
  complementary: "complementary",
  contentinfo: "content info",
  dialog: "dialog",
  document: "document",
  form: "form",
  generic: "",
  grid: "grid",
  gridcell: "cell",
  group: "grouping",
  heading: "heading",
  Iframe: "frame",
  image: "image",
  img: "image",
  link: "link",
  list: "list",
  listbox: "list box",
  listitem: "list item",
  log: "log",
  main: "main",
  menu: "menu",
  menubar: "menu bar",
  menuitem: "menu item",
  menuitemcheckbox: "menu item check box",
  menuitemradio: "menu item radio button",
  meter: "meter",
  navigation: "navigation",
  none: "",
  option: "option",
  presentation: "",
  progressbar: "progress bar",
  radio: "radio button",
  radiogroup: "radio group",
  region: "region",
  RootWebArea: "document",
  row: "row",
  rowheader: "row header",
  scrollbar: "scroll bar",
  search: "search",
  searchbox: "search edit text",
  separator: "separator",
  slider: "slider",
  spinbutton: "spin button",
  status: "status",
  switch: "switch",
  tab: "tab",
  table: "table",
  tablist: "tab list",
  tabpanel: "tab panel",
  textbox: "edit text",
  timer: "timer",
  toolbar: "tool bar",
  tooltip: "tool tip",
  tree: "tree",
  treegrid: "tree grid",
  treeitem: "tree item",
});

/** For each role whose items are counted in a set, the roles of the sets they are counted in. */
const SET_CONTAINERS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  option: ["listbox"],
  menuitem: ["menu", "menubar", "group"],
  menuitemcheckbox: ["menu", "menubar", "group"],
  menuitemradio: ["menu", "menubar", "group"],
  radio: ["radiogroup"],
  tab: ["tablist"],
  treeitem: ["tree", "group"],
});

/** The roles whose value is a number in a range, and may be given in words by `aria-valuetext`. */
const RANGE_ROLES: readonly string[] = ["meter", "progressbar", "scrollbar", "slider", "spinbutton"];

/** The roles whose level is said ("level 2"). Every role's level is kept in `level`. */
const SAYS_LEVEL: readonly string[] = ["heading", "treeitem"];

/** Where an element sits in its set: `position` of `size`, both from 1. */
export interface SetPosition {
  position: number;
  size: number;
}

/** What the accessibility tree says of one element, and the line a screen reader would say for it. */
export interface Accessible {
  /** The role as the browser's tree names it, such as `textbox` or `button`; null when it gave none. */
  role: string | null;
  /** The words said for the role, such as `edit text` or `menu button`; empty when the role says nothing. */
  roleWords: string;
  /** The accessible name, on one line, printable and cut to the excerpt limit; empty when it has none. */
  name: string;
  /** The value (a text field's text, a slider's value text), printable and cut; empty when it has none. */
  value: string;
  /** The level, for a heading or a tree item. */
  level?: number;
  /** The states said, in the order they are said: `expanded` or `collapsed`, `checked`, `required`... */
  states: string[];
  /** Its position in a set: a radio button in its group, an option in its list box, a tab in its tab list. */
  setPosition?: SetPosition;
  /** It has a role that is said, and no name: a screen reader says only what it is, and stops. */
  unnamed: boolean;
  /** The line a screen reader would say, name first, the parts joined with `, `. */
  spoken: string;
}

/** The focused element: where it is, as the walk's stops name it, and what the tree says of it. */
export interface FocusedAccessible extends Accessible {
  /** `target` as one string, as a finding's element has it. */
  selector: string;
  /** One entry per document, outermost first; an entry that is an array is a path through shadow roots. */
  target: AxeTarget;
  /** The element's tag name, lower case. */
  tag: string;
  /**
   * Present when focus is on a widget that points at one of its items with `aria-activedescendant` (a combo
   * box and its options): what is read and named is that item, as a screen reader reads it.
   */
  activeDescendant?: true;
}

/** One node of the protocol's accessibility tree, as far as this module reads it. Every field is checked. */
type AXNodeLike = Record<string, unknown>;

/** What a node's `role`, `name`, `value` or a property holds. */
function axValue(field: unknown): unknown {
  return typeof field === "object" && field !== null ? (field as { value?: unknown }).value : undefined;
}

/** A node's properties, by name, as their values. */
function propertiesOf(node: AXNodeLike): Map<string, unknown> {
  const out = new Map<string, unknown>();
  const list = node.properties;
  if (!Array.isArray(list)) return out;
  for (const entry of list as unknown[]) {
    if (typeof entry !== "object" || entry === null) continue;
    const name = (entry as { name?: unknown }).name;
    if (typeof name === "string") out.set(name, axValue((entry as { value?: unknown }).value));
  }
  return out;
}

/** Page text for the spoken line: printable, on one line, cut to the excerpt limit. */
function pageText(value: unknown): string {
  const text = typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
  return cutText(printableLine(text.slice(0, READ_CHARS)), LIMITS.excerptChars);
}

/** The words said for a role the table does not list: `LabelText` is `label text`. */
function wordsOfUnlisted(role: string): string {
  const words = role.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return cutText(printableLine(words), 100);
}

/** The words said for `role`, given the node's properties (a button with a menu is a menu button). */
export function roleWordsOf(role: string | null, properties: ReadonlyMap<string, unknown>): string {
  if (role === null) return "";
  if (role === "button") {
    const popup = properties.get("hasPopup");
    if (popup === "menu" || popup === "true") return "menu button";
    if (properties.has("pressed")) return "toggle button";
  }
  return Object.hasOwn(ROLE_WORDS, role) ? (ROLE_WORDS[role] ?? "") : wordsOfUnlisted(role);
}

/** A tri-state property (`checked`, `pressed`) as words: `checked`, `not checked`, `partly checked`. */
function triState(value: unknown, word: string): string | undefined {
  if (value === "true" || value === true) return word;
  if (value === "false" || value === false) return `not ${word}`;
  if (value === "mixed") return `partly ${word}`;
  return undefined;
}

/**
 * The states said, in this order: the control's own state (expanded or collapsed, checked, pressed,
 * selected), then what limits it (disabled, read only), then what its value needs (required, invalid).
 * A state the tree does not give is not said, and `selected`, `disabled`, `read only`, `required` and
 * `invalid` are said only when they hold.
 */
export function statesOf(properties: ReadonlyMap<string, unknown>): string[] {
  const states: string[] = [];
  const expanded = properties.get("expanded");
  if (expanded === true) states.push("expanded");
  else if (expanded === false) states.push("collapsed");
  const checked = triState(properties.get("checked"), "checked");
  if (checked !== undefined) states.push(checked);
  const pressed = triState(properties.get("pressed"), "pressed");
  if (pressed !== undefined) states.push(pressed);
  if (properties.get("selected") === true) states.push("selected");
  if (properties.get("disabled") === true) states.push("disabled");
  if (properties.get("readonly") === true) states.push("read only");
  if (properties.get("required") === true) states.push("required");
  const invalid = properties.get("invalid");
  if (invalid === "true" || invalid === "grammar" || invalid === "spelling") states.push("invalid");
  return states;
}

/**
 * The spoken line: the name, the role's words, the level, the states, the position in the set, then the
 * value, each part left out when empty, joined with `, `. With no name it starts at the role: `button`.
 */
export function spokenLine(read: Omit<Accessible, "spoken" | "unnamed">): string {
  const parts = [read.name, read.roleWords];
  if (read.level !== undefined && read.role !== null && SAYS_LEVEL.includes(read.role)) {
    parts.push(`level ${read.level}`);
  }
  parts.push(...read.states);
  if (read.setPosition !== undefined) parts.push(`${read.setPosition.position} of ${read.setPosition.size}`);
  if (read.value !== read.name) parts.push(read.value);
  return parts.filter((part) => part !== "").join(", ");
}

/** What `TreeReader` works out apart, because the tree's node does not carry it (V6). */
export interface WorkedOut {
  setPosition?: SetPosition;
  /** `aria-valuetext`, which the tree gives as empty at Chrome 158. */
  valueText?: string;
}

/**
 * What one node of the protocol's accessibility tree says, as an `Accessible`, with what was worked out apart.
 */
export function accessibleOf(node: unknown, worked: WorkedOut = {}): Accessible {
  const ax: AXNodeLike = typeof node === "object" && node !== null ? (node as AXNodeLike) : {};
  const properties = propertiesOf(ax);
  const rawRole = axValue(ax.role);
  const role = typeof rawRole === "string" && rawRole !== "" ? rawRole.slice(0, 100) : null;
  const valueText = worked.valueText ?? properties.get("valuetext");
  const level = properties.get("level");
  const read: Omit<Accessible, "spoken" | "unnamed"> = {
    role,
    roleWords: roleWordsOf(role, properties),
    name: pageText(axValue(ax.name)),
    value: pageText(typeof valueText === "string" && valueText !== "" ? valueText : axValue(ax.value)),
    ...(typeof level === "number" && Number.isInteger(level) && level > 0 ? { level } : {}),
    states: statesOf(properties),
    ...(worked.setPosition === undefined ? {} : { setPosition: worked.setPosition }),
  };
  return { ...read, unnamed: read.name === "" && read.roleWords !== "", spoken: spokenLine(read) };
}

/**
 * Runs in the isolated world with `this` as the element: `aria-posinset`, `aria-setsize` and
 * `aria-valuetext` when the page gives them, and for a native radio button with a name, its place among the radio buttons of its group (the
 * same name, the same form owner and the same document or shadow root, rendered), as HTML groups them.
 */
const FROM_ATTRIBUTES = `function () {
  const count = (name) => {
    const text = this.getAttribute(name);
    if (text === null || !/^\\s*[0-9]{1,6}\\s*$/.test(text)) return null;
    const n = Number(text);
    return n >= 1 ? n : null;
  };
  let radio = null;
  if (this.localName === "input" && this.type === "radio" && this.name !== "") {
    const form = this.form;
    const candidates = form ? Array.from(form.elements) : Array.from(this.getRootNode().querySelectorAll("input"));
    const group = candidates.filter((e) =>
      e.localName === "input" && e.type === "radio" && e.name === this.name && e.form === form &&
      e.getRootNode() === this.getRootNode() && e.checkVisibility());
    const at = group.indexOf(this);
    if (at >= 0) radio = { position: at + 1, size: group.length };
  }
  const valuetext = this.getAttribute("aria-valuetext");
  return {
    posinset: count("aria-posinset"),
    setsize: count("aria-setsize"),
    valuetext: typeof valuetext === "string" ? valuetext.slice(0, ${READ_CHARS}) : null,
    radio,
  };
}`;

function isPosition(value: unknown): value is SetPosition {
  if (typeof value !== "object" || value === null) return false;
  const { position, size } = value as { position?: unknown; size?: unknown };
  return (
    Number.isInteger(position) &&
    Number.isInteger(size) &&
    (position as number) >= 1 &&
    (position as number) <= (size as number)
  );
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : undefined;
}

function nodesOf(answer: unknown): AXNodeLike[] {
  const nodes = (answer as { nodes?: unknown } | undefined)?.nodes;
  return Array.isArray(nodes)
    ? (nodes as unknown[]).filter((n): n is AXNodeLike => typeof n === "object" && n !== null)
    : [];
}

function backendOf(node: AXNodeLike): number | undefined {
  return positiveInteger(node.backendDOMNodeId);
}

function roleOf(node: AXNodeLike): unknown {
  return axValue(node.role);
}

/**
 * Reads the focused element from the accessibility tree, through a DevTools Protocol session of its own and
 * an isolated world. Narration opens one per page and reads after each key. Close it when done.
 */
export class TreeReader {
  private constructor(
    private readonly session: CDPSession,
    private readonly contextId: number,
  ) {}

  static async open(page: Page): Promise<TreeReader> {
    const session = await page.context().newCDPSession(page);
    try {
      const { frameTree } = await session.send("Page.getFrameTree");
      const { executionContextId } = await session.send("Page.createIsolatedWorld", {
        frameId: frameTree.frame.id,
        worldName: "a11y-genie-tree",
      });
      return new TreeReader(session, executionContextId);
    } catch (error) {
      await session.detach().catch(() => undefined);
      throw error;
    }
  }

  /** What the tree says of the element focus is on now, or null when focus is on no element. */
  async read(): Promise<FocusedAccessible | null> {
    const group = "a11y-genie-tree";
    try {
      const found = await this.session.send("Runtime.evaluate", {
        expression: DEEP_FOCUS,
        contextId: this.contextId,
        objectGroup: group,
        returnByValue: false,
      });
      if (found.exceptionDetails !== undefined) throw new Error("the narration could not read focus");
      let objectId = found.result.objectId;
      if (found.result.subtype === "null" || objectId === undefined) return null;

      let ax = await this.partialTree({ objectId });
      let node = ax[0];
      // A widget that points at one of its items: the item is what is read.
      let activeDescendant = false;
      const pointed = node === undefined ? undefined : this.activeDescendantOf(node);
      if (pointed !== undefined) {
        const item = await this.partialTree({ backendNodeId: pointed });
        const resolved = await this.session
          .send("DOM.resolveNode", {
            backendNodeId: pointed,
            executionContextId: this.contextId,
            objectGroup: group,
          })
          .catch(() => undefined);
        if (item[0] !== undefined && resolved?.object.objectId !== undefined) {
          ax = item;
          node = item[0];
          objectId = resolved.object.objectId;
          activeDescendant = true;
        }
      }

      const described = await this.session.send("Runtime.callFunctionOn", {
        objectId,
        functionDeclaration: DESCRIBE,
        returnByValue: true,
      });
      const value = described.result.value as Record<string, unknown> | undefined;
      const target = targetOf(value?.target);
      if (described.exceptionDetails !== undefined || value === undefined || target === undefined) {
        throw new Error("the narration could not describe the focused element");
      }
      const worked = node === undefined ? {} : await this.workedOut(objectId, node, ax);
      return {
        selector: selectorOf(target),
        target,
        tag: typeof value.tag === "string" ? value.tag.slice(0, 100) : "",
        ...accessibleOf(node, worked),
        ...(activeDescendant ? { activeDescendant: true as const } : {}),
      };
    } finally {
      await this.session.send("Runtime.releaseObjectGroup", { objectGroup: group }).catch(() => undefined);
    }
  }

  async close(): Promise<void> {
    await this.session.detach().catch(() => undefined);
  }

  /** The node and its ancestors (the node first), or nothing when the tree has no node for it. */
  private async partialTree(of: { objectId: string } | { backendNodeId: number }): Promise<AXNodeLike[]> {
    const answer: unknown = await this.session
      .send("Accessibility.getPartialAXTree", { ...of, fetchRelatives: true })
      .catch(() => undefined);
    return nodesOf(answer);
  }

  /** The DOM node `aria-activedescendant` points at, as the tree resolved it. */
  private activeDescendantOf(node: AXNodeLike): number | undefined {
    const list = node.properties;
    if (!Array.isArray(list)) return undefined;
    for (const entry of list as unknown[]) {
      if (typeof entry !== "object" || entry === null) continue;
      if ((entry as { name?: unknown }).name !== "activedescendant") continue;
      const related = ((entry as { value?: unknown }).value as { relatedNodes?: unknown } | undefined)
        ?.relatedNodes;
      if (!Array.isArray(related)) return undefined;
      const first: unknown = related[0];
      return typeof first === "object" && first !== null
        ? positiveInteger((first as { backendDOMNodeId?: unknown }).backendDOMNodeId)
        : undefined;
    }
    return undefined;
  }

  /**
   * What the node does not carry. `aria-valuetext`, for a role with a range value. Its position in its set:
   * `aria-posinset` and `aria-setsize` when the page gives them; a native radio
   * button's place in its group; otherwise, for an item role (an option, a menu item, a tab, a tree item, a
   * radio button by role), its place among the items of the same role in its nearest set in the tree (a list
   * box, a menu, a tab list...), leaving out the items of sets nested in it. A part the page gives overrides
   * the part worked out.
   */
  private async workedOut(objectId: string, node: AXNodeLike, relatives: AXNodeLike[]): Promise<WorkedOut> {
    const attributes = await this.session
      .send("Runtime.callFunctionOn", { objectId, functionDeclaration: FROM_ATTRIBUTES, returnByValue: true })
      .catch(() => undefined);
    const given = (attributes?.exceptionDetails === undefined ? attributes?.result.value : undefined) as
      { posinset?: unknown; setsize?: unknown; valuetext?: unknown; radio?: unknown } | undefined;
    const role = roleOf(node);
    const valueText =
      typeof role === "string" && RANGE_ROLES.includes(role) && typeof given?.valuetext === "string"
        ? given.valuetext
        : undefined;
    const posinset = positiveInteger(given?.posinset);
    const setsize = positiveInteger(given?.setsize);
    const worked = isPosition(given?.radio) ? given.radio : await this.positionInTree(node, relatives);
    const position = posinset ?? worked?.position;
    const size = setsize ?? worked?.size;
    const setPosition = { position, size };
    return {
      ...(isPosition(setPosition) ? { setPosition } : {}),
      ...(valueText === undefined || valueText.trim() === "" ? {} : { valueText }),
    };
  }

  private async positionInTree(node: AXNodeLike, relatives: AXNodeLike[]): Promise<SetPosition | undefined> {
    const role = roleOf(node);
    const own = backendOf(node);
    if (typeof role !== "string" || own === undefined || !Object.hasOwn(SET_CONTAINERS, role))
      return undefined;
    const containers = SET_CONTAINERS[role] ?? [];
    const byId = new Map<unknown, AXNodeLike>(relatives.map((n) => [n.nodeId, n]));
    let set: AXNodeLike | undefined;
    for (let at = byId.get(node.parentId); at !== undefined; at = byId.get(at.parentId)) {
      const atRole = roleOf(at);
      if (at.ignored !== true && typeof atRole === "string" && containers.includes(atRole)) {
        set = at;
        break;
      }
    }
    const setNode = set === undefined ? undefined : backendOf(set);
    if (setNode === undefined) return undefined;
    const query = async (backendNodeId: number, of: string): Promise<AXNodeLike[]> =>
      nodesOf(
        await this.session
          .send("Accessibility.queryAXTree", { backendNodeId, role: of })
          .catch(() => undefined),
      ).filter((n) => n.ignored !== true);
    const items = await query(setNode, role);
    const nested: AXNodeLike[] = [];
    for (const container of containers) {
      nested.push(...(await query(setNode, container)).filter((n) => backendOf(n) !== setNode));
    }
    if (nested.length > MAX_NESTED_SETS) return undefined;
    const elsewhere = new Set<number>();
    for (const inner of nested) {
      const innerNode = backendOf(inner);
      if (innerNode === undefined) continue;
      for (const item of await query(innerNode, role)) {
        const id = backendOf(item);
        if (id !== undefined) elsewhere.add(id);
      }
    }
    const members = items.map(backendOf).filter((id): id is number => id !== undefined && !elsewhere.has(id));
    const at = members.indexOf(own);
    return at < 0 ? undefined : { position: at + 1, size: members.length };
  }
}
