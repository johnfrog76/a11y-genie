/**
 * Narrated workflows (spec 6.6): drive a flow of steps by the keyboard, and after each step write down what a
 * screen reader would say, from the browser's accessibility tree (src/a11y-tree.ts). The transcript is text
 * (`narration/<flow>.txt`); speaking it is a later milestone (D4).
 *
 * After each step the focused element is read: its role, name and states, and `spoken`, the line with the name
 * first. After a press of Enter or Space, or a click, the step also reports what the press produced, in the
 * order a screen reader would say it: a dialog that opened (its name), where focus went, and text that was
 * added to a live region (`aria-live`, `role="status"`, `role="alert"`, `role="log"`).
 *
 * A step that leaves focus on an element that has a role and no name is `genie/unnamed-step`.
 *
 * The page is hostile. Live regions and dialogs are read in an isolated world of this module's own, so the
 * page's scripts cannot change what is found; every value that comes back is checked before use, and page text
 * is made printable and cut to the excerpt limit before it reaches a transcript, a finding or `scan.json`.
 */

import type { CDPSession, Page } from "playwright-core";
import { accessibleOf, ROLE_WORDS, TreeReader, type FocusedAccessible } from "./a11y-tree.js";
import { LIMITS } from "./context.js";
import { runSteps, StepFailure } from "./drive.js";
import type { Finding, FindingElement } from "./finding.js";
import { registerGenieRule } from "./genie-rules.js";
import { printableLine } from "./printable.js";
import { cutText } from "./scan-record.js";
import { formatStep, type Step } from "./steps.js";
import { DEFAULT_MAX_TABS, DEEP_FOCUS } from "./walk.js";

export const UNNAMED_STEP_RULE = {
  source: "genie",
  id: "unnamed-step",
  help: "A step of a narrated flow puts keyboard focus on a control that has a role and no name.",
  helpUrl: "",
  wcag: ["4.1.2"],
} as const;

/**
 * The tags the rule carries, as `rules` lists them. They do not gate it: a flow someone asked to narrate is
 * always read, whatever `--tags` says. The `wcag2a` tag is left off on purpose: see docs/ARCHITECTURE.md.
 */
export const UNNAMED_STEP_TAGS = ["cat.name-role-value", "wcag412"] as const;

registerGenieRule({
  rule: { ...UNNAMED_STEP_RULE, wcag: [...UNNAMED_STEP_RULE.wcag] },
  impact: "serious",
  tags: [...UNNAMED_STEP_TAGS],
});

/** The name of the flow given with `--flow`, so its transcript is `narration/flow.txt`. */
export const FLOW_NAME = "flow";

/** The folder in the scan folder that holds the transcripts. */
export const NARRATION_DIR = "narration";

/** The most steps one flow may have. A flow is a task, not a script; the cap keeps `scan.json` small. */
export const MAX_FLOW_STEPS = 200;

/** The most things one press is read to have produced; the rest are dropped. */
const MAX_PRODUCED = 10;

/** How long after Enter, Space or a click the page is given to put its answer in a live region, in ms. */
export const ACTION_SETTLE_MS = 250;

/** The longest text read from one live region in the page, before it is made printable and cut. */
const LIVE_CHARS = 500;

/** The most elements the page is searched through for live regions and dialogs. */
const SURVEY_ELEMENTS = 20_000;

/** A flow to narrate, and the page it starts on. */
export interface WorkflowSpec {
  /** `flow` for `--flow`; the workflow's name in a config file. */
  name: string;
  /** The key of the page it is run on (it is loaded fresh). */
  page: string;
  steps: Step[];
}

/** What a step produced: where focus went, a dialog that opened, or text a live region announced. */
export interface Produced {
  /**
   * `dialog`: a dialog opened, and this is its name and role. `focus`: focus moved to another element, or to
   * none (then `spoken` is empty). `change`: focus stayed, and what is said of it changed (a menu button that
   * opened). `live`: text added to a live region. `page`: the step went to another page, and this is its title.
   */
  kind: "dialog" | "focus" | "change" | "live" | "page";
  spoken: string;
}

/** One step of a narrated flow, as `scan.json` keeps it. */
export interface NarratedStep {
  /** The step, as it is written in the grammar (`Tab`, `Tab to button 'Save'`). */
  key: string;
  /** The focused element's role as the tree names it; null when focus is on no element. */
  role: string | null;
  /** Its name; empty when it has none. */
  name: string;
  states: string[];
  /** The line a screen reader would say for the focused element, name first; empty when focus is on none. */
  spoken: string;
  /** The step brought focus to an element that has a role that is said, and no name. */
  unnamed: boolean;
  /** The focused element's selector (src/map-axe.ts); null when focus is on no element. */
  selector: string | null;
  /** After Enter, Space or a click only: what the press produced, in the order it is said. Empty when nothing. */
  produced?: Produced[];
}

/** What a finding needs of an unnamed step's element, which `scan.json`'s step does not keep. */
export interface UnnamedEvidence {
  /** The step's number, from 1. */
  number: number;
  key: string;
  spoken: string;
  target: FindingElement["target"];
  selector: string;
  html: string;
}

/** What one narrated flow gave. */
export interface WorkflowResult {
  name: string;
  /** The page's key. */
  page: string;
  steps: NarratedStep[];
  /** Why the flow stopped before its last step (or never started); absent when it ran to the end. */
  notScanned?: string;
  evidence: UnnamedEvidence[];
}

/** The key's last part, which is the key pressed (`Shift+Enter` presses Enter). */
function lastKeyOf(key: string): string {
  return key.split("+").pop() || "+";
}

const ACTION_KEYS: ReadonlySet<string> = new Set(["Enter", "NumpadEnter", "Space", " "]);

/** Whether a step is read for what it produced: a press of Enter or Space, or a click (spec 6.6). */
export function producesResult(step: Step): boolean {
  return step.kind === "click" || (step.kind === "press" && ACTION_KEYS.has(lastKeyOf(step.key)));
}

/** Runs in the isolated world: the shared parts of the survey of live regions and dialogs. */
const SURVEY = `
  const MAX = ${SURVEY_ELEMENTS};
  const shown = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
  const textOf = (el) => {
    const raw = typeof el.innerText === "string" ? el.innerText : (el.textContent || "");
    return raw.replace(/\\s+/g, " ").trim().slice(0, ${LIVE_CHARS});
  };
  const liveRole = (el) => {
    const live = el.getAttribute("aria-live");
    const role = el.getAttribute("role");
    if (live === "polite" || live === "assertive") {
      return role === "status" || role === "alert" || role === "log" ? role : "";
    }
    if (live !== null) return null;
    if (role === "status" || role === "alert" || role === "log") return role;
    return el.localName === "output" ? "status" : null;
  };
  const isDialog = (el) => {
    const role = el.getAttribute("role");
    return (el.localName === "dialog" || role === "dialog" || role === "alertdialog") && shown(el);
  };
  const survey = () => {
    const all = [];
    const collect = (root) => {
      for (const el of root.querySelectorAll("*")) {
        if (all.length >= MAX) return;
        all.push(el);
        if (el.shadowRoot) collect(el.shadowRoot);
      }
    };
    collect(document);
    const live = new Map();
    const dialogs = new Set();
    for (const el of all) {
      const role = liveRole(el);
      if (role !== null && shown(el)) live.set(el, { text: textOf(el), role });
      if (isDialog(el)) dialogs.add(el);
    }
    return { live, dialogs };
  };
`;

/** Runs in the isolated world: remembers the live regions' text and the dialogs that are open. */
const SNAPSHOT = `(() => {
  ${SURVEY}
  const now = survey();
  globalThis.__genieNarrate = { live: now.live, dialogs: now.dialogs, fresh: [] };
})()`;

/** Runs in the isolated world: what changed since `SNAPSHOT`, then remembers the new state. */
const CHANGES = `(() => {
  ${SURVEY}
  const was = globalThis.__genieNarrate;
  if (!was) return { live: [], dialogs: 0 };
  const now = survey();
  const live = [];
  for (const [el, region] of now.live) {
    const before = was.live.get(el);
    const earlier = before ? before.text : "";
    if (region.text === "" || region.text === earlier) continue;
    const added = earlier !== "" && region.text.startsWith(earlier) ? region.text.slice(earlier.length).trim() : region.text;
    if (added !== "") live.push({ text: added, role: region.role });
  }
  const fresh = [...now.dialogs].filter((el) => !was.dialogs.has(el));
  globalThis.__genieNarrate = { live: now.live, dialogs: now.dialogs, fresh };
  return { live: live.slice(0, ${MAX_PRODUCED}), dialogs: fresh.length };
})()`;

/** Runs in the isolated world: a short HTML excerpt of the focused element, as the traps' findings quote one. */
const FOCUSED_HTML = `(() => {
  const el = ${DEEP_FOCUS};
  if (!el) return "";
  const open = el.cloneNode(false).outerHTML;
  const close = "</" + el.localName + ">";
  const inner = open.endsWith(close) ? open.slice(0, -close.length) : open;
  const text = (el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 80);
  return (inner + (el.children.length > 0 ? "…" + text : text) + close).slice(0, 300);
})()`;

/** How many new dialogs have their names read from one press. */
const MAX_DIALOGS = 3;

/** What the isolated-world survey found changed after a press. */
interface Changes {
  live: { text: string; role: string }[];
  dialogs: string[];
}

/** The role words for a live region's `role`, or none for a plain `aria-live` region. */
function liveLine(text: string, role: string): string {
  const said = printableLine(text.slice(0, LIVE_CHARS));
  const words = role === "" ? "" : (ROLE_WORDS[role] ?? "");
  const line = words === "" ? said : `${said}, ${words}`;
  return cutText(line, LIMITS.excerptChars);
}

/**
 * Reads live regions and dialogs, through a DevTools Protocol session and an isolated world of its own.
 * `snapshot()` before a press and `changes()` after it say what the press produced.
 */
class PressObserver {
  private constructor(
    private readonly session: CDPSession,
    private readonly contextId: number,
  ) {}

  static async open(page: Page): Promise<PressObserver> {
    const session = await page.context().newCDPSession(page);
    try {
      const { frameTree } = await session.send("Page.getFrameTree");
      const { executionContextId } = await session.send("Page.createIsolatedWorld", {
        frameId: frameTree.frame.id,
        worldName: "a11y-genie-narrate",
      });
      return new PressObserver(session, executionContextId);
    } catch (error) {
      await session.detach().catch(() => undefined);
      throw error;
    }
  }

  private async evaluate(expression: string, byValue: boolean) {
    const answer = await this.session.send("Runtime.evaluate", {
      expression,
      contextId: this.contextId,
      returnByValue: byValue,
      objectGroup: "a11y-genie-narrate",
    });
    if (answer.exceptionDetails !== undefined) throw new Error("the narration could not read the page");
    return answer.result;
  }

  async snapshot(): Promise<void> {
    await this.evaluate(SNAPSHOT, true);
  }

  /** The focused element's HTML, cut; empty when focus is on none. */
  async focusedHtml(): Promise<string> {
    const value = (await this.evaluate(FOCUSED_HTML, true)).value as unknown;
    return typeof value === "string" ? value.slice(0, 300) : "";
  }

  /** What changed since `snapshot()`: text added to live regions, and the names of dialogs that opened. */
  async changes(): Promise<Changes> {
    const group = "a11y-genie-narrate";
    try {
      const value = (await this.evaluate(CHANGES, true)).value as
        { live?: unknown; dialogs?: unknown } | undefined;
      const live = Array.isArray(value?.live)
        ? (value.live as unknown[]).flatMap((entry) => {
            if (typeof entry !== "object" || entry === null) return [];
            const { text, role } = entry as { text?: unknown; role?: unknown };
            return typeof text === "string" && typeof role === "string" ? [{ text, role }] : [];
          })
        : [];
      const count =
        typeof value?.dialogs === "number" && Number.isInteger(value.dialogs)
          ? Math.min(value.dialogs, MAX_DIALOGS)
          : 0;
      const dialogs: string[] = [];
      for (let at = 0; at < count; at += 1) {
        const handle = await this.evaluate(`globalThis.__genieNarrate.fresh[${at}]`, false);
        if (handle.objectId === undefined) continue;
        const answer: unknown = await this.session
          .send("Accessibility.getPartialAXTree", { objectId: handle.objectId, fetchRelatives: false })
          .catch(() => undefined);
        const nodes = (answer as { nodes?: unknown } | undefined)?.nodes;
        const node: unknown = Array.isArray(nodes) ? (nodes as unknown[])[0] : undefined;
        dialogs.push(accessibleOf(node).spoken || "dialog");
      }
      return { live, dialogs };
    } finally {
      await this.session.send("Runtime.releaseObjectGroup", { objectGroup: group }).catch(() => undefined);
    }
  }

  async close(): Promise<void> {
    await this.session.detach().catch(() => undefined);
  }
}

/** An address without its fragment, so a jump within the page is not read as going to another page. */
function withoutFragment(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.href;
  } catch {
    return url;
  }
}

/** What `narrateSteps` needs of the run. */
export interface NarrateOptions {
  /** How long the flow has left, in milliseconds. */
  msLeft: () => number;
  /** `--max-tabs`: the most presses a `Tab to` step makes. */
  maxTabs?: number;
  /**
   * Asked after each step: why the page may no longer be read (a network rule stopped it, or it went to an
   * address that is not `http:` or `https:`), or undefined. The flow then stops, reading *not scanned*.
   */
  halted: () => string | undefined;
}

/**
 * Runs `steps` on a loaded page, one at a time, and appends what each said to `into`. Returns why the flow
 * stopped before its last step, or undefined when it ran to the end. A step that fails on the page stops it
 * with the driver's own words (src/drive.ts); `into` keeps the steps that were read before.
 */
export async function narrateSteps(
  page: Page,
  steps: readonly Step[],
  options: NarrateOptions,
  into: { steps: NarratedStep[]; evidence: UnnamedEvidence[] },
): Promise<string | undefined> {
  let tree = await TreeReader.open(page);
  let observer = await PressObserver.open(page);
  let here = withoutFragment(page.url());
  let previous: FocusedAccessible | null;
  try {
    previous = await tree.read();
    for (const [index, step] of steps.entries()) {
      const key = formatStep(step);
      const acts = producesResult(step);
      if (acts) await observer.snapshot();
      try {
        await runSteps(page, [step], options.msLeft, options.maxTabs ?? DEFAULT_MAX_TABS);
      } catch (error) {
        if (error instanceof StepFailure) {
          return `step ${index + 1} (${key}) failed: ${error.reason}`;
        }
        throw error;
      }
      if (acts)
        await page.waitForTimeout(Math.min(ACTION_SETTLE_MS, options.msLeft())).catch(() => undefined);
      const stopped = options.halted();
      if (stopped !== undefined) return stopped;

      // A step that went to another page: its readers belong to the old one, so open them again.
      const there = withoutFragment(page.url());
      const moved = there !== here;
      if (moved) {
        await tree.close();
        await observer.close();
        tree = await TreeReader.open(page);
        observer = await PressObserver.open(page);
        here = there;
        previous = null;
      }

      const focus = await tree.read();
      const produced: Produced[] = [];
      if (acts) {
        if (moved) {
          const title = printableLine(await page.title().catch(() => ""));
          produced.push({
            kind: "page",
            spoken: cutText(title === "" ? "untitled page" : `${title}, document`, LIMITS.excerptChars),
          });
        } else {
          const changed = await observer.changes();
          for (const dialog of changed.dialogs) produced.push({ kind: "dialog", spoken: dialog });
          const dialogLines = new Set(produced.map((entry) => entry.spoken));
          if (focus?.selector !== previous?.selector) {
            const spoken = focus?.spoken ?? "";
            if (!dialogLines.has(spoken) || spoken === "") produced.push({ kind: "focus", spoken });
          } else if (focus !== null && previous !== null && focus.spoken !== previous.spoken) {
            produced.push({ kind: "change", spoken: focus.spoken });
          }
          for (const region of changed.live)
            produced.push({ kind: "live", spoken: liveLine(region.text, region.role) });
        }
      }

      const unnamed = focus !== null && focus.unnamed && focus.selector !== previous?.selector;
      if (unnamed && focus !== null) {
        const html = focus.activeDescendant === true ? "" : await observer.focusedHtml().catch(() => "");
        into.evidence.push({
          number: index + 1,
          key,
          spoken: focus.spoken,
          target: focus.target,
          selector: focus.selector,
          html: html === "" ? `<${focus.tag}>` : html,
        });
      }
      into.steps.push({
        key,
        role: focus?.role ?? null,
        name: focus?.name ?? "",
        states: focus?.states ?? [],
        spoken: focus?.spoken ?? "",
        unnamed,
        selector: focus?.selector ?? null,
        ...(acts ? { produced: produced.slice(0, MAX_PRODUCED) } : {}),
      });
      previous = focus;
    }
    return undefined;
  } finally {
    await tree.close();
    await observer.close();
  }
}

/** A step that has no name, as a finding element. */
function unnamedElement(workflow: string, evidence: UnnamedEvidence): FindingElement {
  return {
    selector: evidence.selector,
    target: evidence.target,
    html: evidence.html,
    failure:
      "Fix all of the following:\n" +
      `  Step ${evidence.number} (${evidence.key}) of the flow "${workflow}" puts focus on this element, and it has no name: ` +
      `a screen reader says only "${evidence.spoken}".`,
  };
}

/**
 * The page's `genie/unnamed-step` finding, from every flow that ran on it: one element for each element that
 * was reached unnamed, in the order the flows are given, naming the first step that reached it. Undefined when
 * no step did.
 */
export function unnamedStepFinding(
  pageKey: string,
  workflows: readonly WorkflowResult[],
): Finding | undefined {
  const elements: FindingElement[] = [];
  const seen = new Set<string>();
  for (const workflow of workflows) {
    for (const evidence of workflow.evidence) {
      const id = JSON.stringify(evidence.target);
      if (seen.has(id)) continue;
      seen.add(id);
      elements.push(unnamedElement(workflow.name, evidence));
    }
  }
  if (elements.length === 0) return undefined;
  return {
    id: `genie/unnamed-step@${pageKey}`,
    rule: { ...UNNAMED_STEP_RULE, wcag: [...UNNAMED_STEP_RULE.wcag] },
    kind: "violation",
    impact: "serious",
    page: pageKey,
    elements,
  };
}

/** A workflow's name as a file name: letters, digits, `.`, `_` and `-`, so it is one safe path part. */
export function narrationFileStem(name: string): string {
  const stem = printableLine(name)
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[.-]+/, "")
    .replace(/-+$/, "")
    .slice(0, 64);
  return stem === "" ? "workflow" : stem;
}

/**
 * The transcript file of each workflow, `narration/<stem>.txt`, in the order given. Two workflows whose names
 * come to one stem get `-2`, `-3` after it, so no transcript overwrites another.
 */
export function narrationFiles(names: readonly string[]): string[] {
  const used = new Set<string>();
  return names.map((name) => {
    const stem = narrationFileStem(name);
    let file = stem;
    for (let n = 2; used.has(file.toLowerCase()); n += 1) file = `${stem}-${n}`;
    used.add(file.toLowerCase());
    return `${NARRATION_DIR}/${file}.txt`;
  });
}

/** What the transcript needs of a workflow, which `scan.json`'s record has. */
export interface Transcribable {
  name: string;
  page: string;
  steps: readonly NarratedStep[];
  notScanned?: string | undefined;
}

/** The line a step's `produced` entry is written as. Focus on no element has no words, so it is said in ours. */
function producedLine(entry: Produced): string {
  return entry.kind === "focus" && entry.spoken === "" ? "(focus is on no element)" : entry.spoken;
}

/**
 * The transcript, in the spec's format: a heading line, then one line a step with its number, the step and what
 * a screen reader would say, and under a step with no name a line that says so. A press that produced nothing
 * reads "(nothing is said)"; one that produced several lines continues them under the first.
 *
 *     flow, on workflow.html
 *     1  Tab    Email, edit text, required
 *     2  Tab    button
 *        ^ This step has no name. A screen reader says "button", and stops.
 *
 * Page text in it is already printable and cut. It ends with a newline.
 */
export function renderTranscript(workflow: Transcribable): string {
  const lines = [`${printableLine(workflow.name)}, on ${printableLine(workflow.page)}`];
  const numberWidth = String(workflow.steps.length).length;
  const keyWidth = Math.max(0, ...workflow.steps.map((step) => printableLine(step.key).length));
  const gap = "  ";
  const indent = " ".repeat(numberWidth + gap.length);
  const said = (step: NarratedStep): string[] => {
    if (step.produced !== undefined) {
      return step.produced.length === 0 ? ["(nothing is said)"] : step.produced.map(producedLine);
    }
    return [step.spoken === "" ? "(focus is on no element)" : step.spoken];
  };
  workflow.steps.forEach((step, index) => {
    const [first, ...rest] = said(step) as [string, ...string[]];
    const head = `${String(index + 1).padEnd(numberWidth)}${gap}${printableLine(step.key).padEnd(keyWidth)}${gap}`;
    lines.push(`${head}${first}`);
    for (const more of rest) lines.push(`${" ".repeat(head.length)}${more}`);
    if (step.unnamed) {
      lines.push(`${indent}^ This step has no name. A screen reader says "${step.spoken}", and stops.`);
    }
  });
  if (workflow.notScanned !== undefined) {
    lines.push("", `Not narrated past this point: ${printableLine(workflow.notScanned)}.`);
  }
  return `${lines.join("\n")}\n`;
}

/** The transcript as lines for the terminal: a blank line, then the transcript, then a blank line. */
export function narrationLines(workflow: Transcribable): string[] {
  return [...renderTranscript(workflow).trimEnd().split("\n"), ""];
}
