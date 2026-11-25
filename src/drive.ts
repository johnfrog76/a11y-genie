/**
 * Runs a state's steps in the browser (spec 5.2: apply the state's options, load, run its steps). Each step
 * of src/steps.ts becomes Playwright calls here, and only here:
 *
 * - a key is `keyboard.press`; `Tab to` presses Tab until focus is on the element, up to `--max-tabs` times;
 * - `click` and `wait` use a locator; `type` is `keyboard.type`;
 * - `colorScheme` and `reducedMotion` are `page.emulateMedia`, and `viewport` is `setViewportSize`. They are
 *   the state's options, so they are applied before the page loads (`applyMedia`); `runSteps` skips them.
 *
 * An element is found two ways, and nothing a step holds is ever built into a selector string:
 * - by role and accessible name, `page.getByRole(role, { name, exact: true })`. **The name is matched whole,
 *   and case-sensitively**: `button 'Menu'` is the button a screen reader reads as "Menu", not "Menu settings".
 *   A step that names half of what a person hears is a step worth knowing about, and a partial match would
 *   click the wrong one silently. A name given in `wait` may be left out, and then any element of the role
 *   will do.
 * - by CSS, `page.locator("css=" + selector)`. The `css=` prefix makes Playwright read all of it as CSS, so
 *   an engine prefix inside it (`xpath=//a`, `text=Menu`, `id=foo`) is only invalid CSS. The parser refuses
 *   those first (src/steps.ts); this is the second lock.
 *
 * A step that fails is a `StepFailure`: the step's number and text, and why in this tool's words. The page's
 * own text and Playwright's messages (which can quote the page) are never put in the reason.
 */

import type { Locator, Page } from "playwright-core";
import { formatStep, type Step, type Target } from "./steps.js";
import { DEFAULT_MAX_TABS } from "./walk.js";

/** How long the page is given to settle after a state's steps, in milliseconds (spec 5.2). */
export const SETTLE_MS = 500;

/** The longest one step waits for its element, in milliseconds, within what is left of the state's time. */
export const STEP_TIMEOUT_MS = 10_000;

/** Where a step failed, and why. */
export class StepFailure extends Error {
  constructor(
    readonly number: number,
    readonly step: Step,
    readonly reason: string,
  ) {
    super(`step ${number} (${formatStep(step)}) failed: ${reason}`);
    this.name = "StepFailure";
  }
}

const MEDIA_KINDS = new Set<Step["kind"]>(["colorScheme", "viewport", "reducedMotion"]);

/** The steps that set the state's media: applied before the load. */
export function mediaSteps(steps: readonly Step[]): Step[] {
  return steps.filter((step) => MEDIA_KINDS.has(step.kind));
}

/** The steps that run after the load, in order. */
export function actionSteps(steps: readonly Step[]): Step[] {
  return steps.filter((step) => !MEDIA_KINDS.has(step.kind));
}

/** Applies the media steps in the order written; the last of each kind holds. Before the page loads. */
export async function applyMedia(page: Page, steps: readonly Step[]): Promise<void> {
  for (const step of mediaSteps(steps)) {
    if (step.kind === "colorScheme") await page.emulateMedia({ colorScheme: step.scheme });
    else if (step.kind === "reducedMotion") await page.emulateMedia({ reducedMotion: "reduce" });
    else if (step.kind === "viewport") await page.setViewportSize({ width: step.width, height: step.height });
  }
}

/** The locator for a target. See the file's comment for why each is built the way it is. */
export function locate(page: Page, target: Target): Locator {
  if (target.by === "css") return page.locator(`css=${target.selector}`);
  return target.name === undefined
    ? page.getByRole(target.role)
    : page.getByRole(target.role, { name: target.name, exact: true });
}

/** Why a step failed, in this tool's words. */
function reasonOf(error: unknown, step: Step, timeoutMs: number, page: Page): string {
  const seconds = Math.max(1, Math.round(timeoutMs / 1000));
  const message = error instanceof Error ? error.message : "";
  if (page.isClosed() || /Target (page, context or browser )?has been closed/.test(message)) {
    return "the page closed";
  }
  if (/strict mode violation/i.test(message)) {
    return "more than one element matches it, so the step cannot tell which one is meant";
  }
  if (error instanceof Error && error.name === "TimeoutError") {
    return step.kind === "wait"
      ? `it did not become visible within ${seconds} seconds`
      : `no such element was found, or it could not be clicked, within ${seconds} seconds`;
  }
  const target = "target" in step ? step.target : undefined;
  if (target?.by === "css") return "the selector is not valid CSS";
  return "the browser could not do it";
}

/**
 * Whether focus is on `locator`'s element (or one of them). Asked of the browser's own focus state, `:focus`, through
 * Playwright's locator, which runs in its own world and goes into open shadow roots, as `getByRole` and `css=` do:
 * not of `document.activeElement`, which stops at a shadow root's host and which a page can redefine.
 */
async function hasFocus(page: Page, locator: Locator): Promise<boolean> {
  return (await locator.and(page.locator(":focus")).count()) > 0;
}

async function runOne(page: Page, step: Step, timeout: number, maxTabs: number): Promise<void> {
  switch (step.kind) {
    case "press":
      await page.keyboard.press(step.key);
      return;
    case "type":
      await page.keyboard.type(step.text);
      return;
    case "click":
      await locate(page, step.target).click({ timeout });
      return;
    case "wait":
      await locate(page, step.target).first().waitFor({ state: "visible", timeout });
      return;
    case "tabTo": {
      const locator = locate(page, step.target);
      for (let presses = 0; ; presses += 1) {
        if (await hasFocus(page, locator)) return;
        if (presses >= maxTabs) {
          const error = new Error("tab limit");
          error.name = "TabLimit";
          throw error;
        }
        await page.keyboard.press("Tab");
      }
    }
    case "colorScheme":
    case "viewport":
    case "reducedMotion":
      return; // applied before the load
  }
}

/**
 * Runs the steps in order on a loaded page, and throws a `StepFailure` at the first one that fails.
 * `msLeft()` is how long the state has left, and bounds each step's own wait. `maxTabs` is `--max-tabs`: the
 * most Tab presses a `Tab to` step makes before it fails.
 */
export async function runSteps(
  page: Page,
  steps: readonly Step[],
  msLeft: () => number,
  maxTabs: number = DEFAULT_MAX_TABS,
): Promise<void> {
  for (const [index, step] of steps.entries()) {
    if (MEDIA_KINDS.has(step.kind)) continue;
    // Short of the state's own limit, so a step that waits out its time is reported as that step.
    const timeout = Math.max(1, Math.min(STEP_TIMEOUT_MS, msLeft() - 300));
    try {
      await runOne(page, step, timeout, maxTabs);
    } catch (error) {
      if (error instanceof Error && error.name === "TabLimit") {
        throw new StepFailure(index + 1, step, `focus did not reach it within ${maxTabs} Tab presses`);
      }
      throw new StepFailure(index + 1, step, reasonOf(error, step, timeout, page));
    }
  }
}
