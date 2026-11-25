/**
 * The guard that keeps the page from hearing the focus-visible check take focus off an element and give it back.
 *
 * The check blurs each stop and focuses it again (src/focus-visible.ts). While it does, `blur`, `focusout`,
 * `focus` and `focusin` must reach no handler of the page's. A listener on `window` in the capture phase runs
 * first, in the order listeners were added, so a guard added only when the check runs is behind any listener the
 * page added at load. This one is installed at document start, dormant, in an isolated world of its own, through
 * `Page.addScriptToEvaluateOnNewDocument`: it is first in line in every document the page opens, frames
 * included. While the check holds it (`hold`), each of its listeners calls `stopImmediatePropagation()`;
 * otherwise it does nothing.
 *
 * The listeners are added from an isolated world, but they are on the page's own `window`, and the browser keeps
 * one list of listeners per target: a listener of the isolated world that stops an event stops the page's
 * own main-world listeners after it (test/browser/focus-visible.test.ts, `focus-listening.html`).
 *
 * `FocusGuard.install(page)` must run before the page navigates, for the guard to be first. `FocusGuard.of(page)`
 * is what the scan uses: the guard installed on that page, or, for a page that has already loaded (a caller
 * that did not install one), a late guard added to the documents now open, behind whatever the page added.
 */

import type { CDPSession, Page } from "playwright-core";

/** The isolated world the guard lives in; the reader's world (src/walk.ts) is another. */
export const GUARD_WORLD = "a11y-genie-guard";

/** Where, in the isolated world's own global object, the guard keeps whether it is held. */
const STATE = "__a11yGenieGuard";

/** The events of animations and transitions that setting an animation to its end and back can fire. */
const ANIMATION_EVENTS = [
  "animationstart",
  "animationiteration",
  "animationend",
  "animationcancel",
  "transitionrun",
  "transitionstart",
  "transitionend",
  "transitioncancel",
];

/** Runs in each document, in the guard's world. Idempotent: a second run adds nothing. */
const SOURCE = `(() => {
  if (globalThis.${STATE}) return;
  const state = { held: false, names: [] };
  Object.defineProperty(globalThis, ${JSON.stringify(STATE)}, { value: state });
  const stop = (event) => { if (state.held) event.stopImmediatePropagation(); };
  // DOMFocusIn and DOMFocusOut too: Chrome still fires them, beside focusin and focusout (checked at Chrome 159).
  for (const type of ["blur", "focusout", "focus", "focusin", "DOMFocusIn", "DOMFocusOut"]) {
    window.addEventListener(type, stop, true);
  }
  // The animation and transition events the check provokes by holding the page still: only those of the
  // animations it named, and only while it names them.
  const stopNamed = (event) => {
    const name = event.animationName ?? event.propertyName;
    if (state.names.includes(name)) event.stopImmediatePropagation();
  };
  for (const type of ${JSON.stringify(ANIMATION_EVENTS)}) window.addEventListener(type, stopNamed, true);
})();`;

/** The longest `settle` waits for frames that do not come, in milliseconds. */
const FRAME_CAP_MS = 10_000;

const sessions = new WeakMap<Page, Promise<FocusGuard>>();

export class FocusGuard {
  /**
   * True when this guard was not in place before the page loaded: the early install did not happen, or it
   * failed. It then sits behind the page's own window-level listeners, which can hear the check's blur and
   * refocus, so `hold` cannot promise the page heard nothing. The focus-visible check reads this.
   */
  late = false;

  /** The guard's worlds now alive: the page's documents, one each. */
  private readonly contexts = new Set<number>();

  private constructor(private readonly session: CDPSession) {
    session.on("Runtime.executionContextCreated", ({ context }) => {
      if (context.name === GUARD_WORLD) this.contexts.add(context.id);
    });
    session.on("Runtime.executionContextDestroyed", ({ executionContextId }) => {
      this.contexts.delete(executionContextId);
    });
    session.on("Runtime.executionContextsCleared", () => {
      this.contexts.clear();
    });
  }

  /** Installs the guard for every document `page` opens from now on. Call it before `page.goto`. */
  static install(page: Page): Promise<FocusGuard> {
    let found = sessions.get(page);
    if (found === undefined) {
      found = FocusGuard.open(page);
      sessions.set(page, found);
      found.catch(() => sessions.delete(page));
    }
    return found;
  }

  /** The guard installed on `page`, or a late one on the documents it has open now. */
  static async of(page: Page): Promise<FocusGuard> {
    // An install that failed was removed from `sessions`, so a page without a settled early install is late.
    const early = sessions.has(page);
    const guard = await FocusGuard.install(page);
    if (!early) guard.late = true;
    await guard.reach();
    return guard;
  }

  private static async open(page: Page): Promise<FocusGuard> {
    const session = await page.context().newCDPSession(page);
    try {
      const guard = new FocusGuard(session);
      await session.send("Page.enable");
      await session.send("Runtime.enable");
      await session.send("Page.addScriptToEvaluateOnNewDocument", { source: SOURCE, worldName: GUARD_WORLD });
      return guard;
    } catch (error) {
      await session.detach().catch(() => undefined);
      throw error;
    }
  }

  /**
   * Makes sure every open document has the guard: when it was installed before the page loaded they all do, and
   * this is one call; on a page that loaded without it, each frame gets the guard now.
   */
  private async reach(): Promise<void> {
    if (this.contexts.size > 0) return;
    const { frameTree } = await this.session.send("Page.getFrameTree");
    const frames = [frameTree];
    for (let i = 0; i < frames.length; i++) frames.push(...(frames[i]?.childFrames ?? []));
    for (const { frame } of frames) {
      try {
        const { executionContextId } = await this.session.send("Page.createIsolatedWorld", {
          frameId: frame.id,
          worldName: GUARD_WORLD,
        });
        this.contexts.add(executionContextId);
        await this.session.send("Runtime.evaluate", { expression: SOURCE, contextId: executionContextId });
      } catch {
        // A frame that went away, or one in another process, is not one the check can read either.
      }
    }
  }

  /**
   * Switches the guard on (`true`) or off in every document: while on, the page hears no focus event. Switching
   * on throws when it could not reach every document, so the check does not blur a page it cannot shield.
   */
  async hold(held: boolean): Promise<void> {
    let failed = this.contexts.size === 0;
    for (const contextId of [...this.contexts]) {
      try {
        const { exceptionDetails } = await this.session.send("Runtime.evaluate", {
          expression: `globalThis.${STATE}.held = ${held ? "true" : "false"}`,
          contextId,
        });
        if (exceptionDetails !== undefined) failed = true;
      } catch {
        this.contexts.delete(contextId);
        failed = true;
      }
    }
    if (held && failed) throw new Error("the focus guard could not be switched on");
  }

  /** Whether `still` named any animation, so `settle` has events to wait for. */
  private named = false;

  /**
   * Names the animations and transitions (by `animationName` and `propertyName`) whose events the page must not
   * hear while the check holds them still: until `settle`. An empty list names none.
   */
  async still(names: readonly string[]): Promise<void> {
    this.named = names.length > 0;
    await this.everywhere(`globalThis.${STATE}.names = ${JSON.stringify(names)}`, false);
  }

  /**
   * Lets the named events through again, once the browser has dispatched the ones that were queued. The wait
   * follows frames and not a clock: the browser dispatches an animation's events in the step that opens a frame,
   * before that frame's `requestAnimationFrame` callbacks, so when the third callback registered after the
   * animations were put back has run, every event their restore queued has been dispatched, however slow the
   * machine. The only time limit is a ten-second cap for a page whose frames never come (a hidden page), where
   * the wait ends and the events are let through.
   */
  async settle(): Promise<void> {
    if (this.named) {
      await this.everywhere(
        `new Promise((done) => { setTimeout(done, ${FRAME_CAP_MS.toString()}); ` +
          `requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(done))); })`,
        true,
      );
    }
    this.named = false;
    await this.everywhere(`globalThis.${STATE}.names = []`, false);
  }

  private async everywhere(expression: string, awaitPromise: boolean): Promise<void> {
    for (const contextId of [...this.contexts]) {
      await this.session
        .send("Runtime.evaluate", { expression, contextId, awaitPromise })
        .catch(() => this.contexts.delete(contextId));
    }
  }
}
