import { AxeBuilder } from "@axe-core/playwright";
import type { Page } from "playwright-core";
import type { AxeScan, Finding } from "./finding.js";
import { CLICK_ON_NON_CONTROL_TAGS, checkClickOnNonControl } from "./click-on-non-control.js";
import {
  checkKeyboardTrap,
  FOCUS_NOT_RETURNED_TAGS,
  KEYBOARD_TRAP_TAGS,
  nativeModalOpen,
} from "./keyboard-trap.js";
import { FOCUS_VISIBLE_TAGS, FocusVisibleCheck, type FocusVisibleResult } from "./focus-visible.js";
import { checkLandmarks } from "./landmarks.js";
import { mapAxeResults, pageKeyOf } from "./map-axe.js";
import { orderFindings } from "./order.js";
import { BEST_PRACTICE_TAG } from "./rule-flags.js";
import { checkSkipLink, focusedIsSkipLink, SKIP_LINK_STOPS } from "./skip-link.js";
import { FocusGuard } from "./focus-guard.js";
import { FocusReader, walkPage, type Walk } from "./walk.js";

/**
 * Runs axe-core on a page that is already loaded, and maps what it found (src/map-axe.ts).
 *
 * It runs axe-core's default rule set, or with `tags` (`--tags`) exactly those tags, by `withTags`. axe-core is injected
 * into the page and its frames by `@axe-core/playwright` from the installed package; nothing is fetched.
 *
 * The page must come from `browser.newContext()` then `context.newPage()`, not `browser.newPage()`:
 * `@axe-core/playwright` opens a blank page in the same context to put the frames' results together,
 * and a context made by `browser.newPage()` refuses a second page.
 *
 * After axe-core it runs the product's own checks: `genie/no-landmarks` and `genie/skip-link`, best practices
 * like the landmark rules, so a `--tags` list without `best-practice` does not run them; and
 * `genie/click-on-non-control`, which runs when a `--tags` list has one of its tags (`wcag2a` among them).
 *
 * Last comes the keyboard walk (src/walk.ts), because it presses Tab. It runs whatever the tags, since it is
 * a record of where focus goes and not a rule, and it is kept on the result as `walk`. The skip link's check
 * reads the walk's first stops rather than pressing Tab itself (spec 6.5: one walk feeds 6.3 and 6.4).
 *
 * At each stop of the walk, while focus is on it, `genie/focus-visible` (src/focus-visible.ts) compares the element
 * focused and unfocused, and gives focus back where the Tab key put it. It runs when a `--tags` list has one of
 * its tags (`wcag2aa` among them).
 *
 * After the walk, where it went round, `genie/keyboard-trap` and `genie/focus-not-returned` (src/keyboard-trap.ts)
 * press Shift+Tab and Escape from where the walk left focus. They come last of all, because Escape may close a
 * dialog. Each runs when a `--tags` list has one of its tags (`wcag2a` among them).
 *
 * `pageKey` names the page in finding ids; without it, the key comes from the page's URL (D6). `maxTabs` is
 * `--max-tabs`, the walk's limit.
 */
export async function scanPage(
  page: Page,
  pageKey: string = pageKeyOf(page.url()),
  tags: readonly string[] | null = null,
  options: { maxTabs?: number } = {},
): Promise<AxeScan> {
  const builder = new AxeBuilder({ page });
  if (tags !== null) builder.withTags([...tags]);
  const results: unknown = await builder.analyze();
  const scan = mapAxeResults(results, pageKey);
  // The product's own checks, then the keyboard walk, which presses Tab.
  const bestPractice = tags === null || tags.includes(BEST_PRACTICE_TAG);
  // A page with no landmark at all (src/landmarks.ts).
  const noLandmarks = bestPractice ? await checkLandmarks(page, pageKey) : undefined;
  // A click handler on an element that is not a control (src/click-on-non-control.ts).
  const click =
    tags === null || CLICK_ON_NON_CONTROL_TAGS.some((t) => tags.includes(t))
      ? await checkClickOnNonControl(page, pageKey)
      : undefined;
  const wants = (ruleTags: readonly string[]): boolean =>
    tags === null || ruleTags.some((t) => tags.includes(t));
  // The keyboard walk (src/walk.ts). At its first stops it asks whether focus is on a skip link, and at every
  // stop whether focus can be seen (src/focus-visible.ts). Both read the page through one reader of their own,
  // in an isolated world, out of the page's reach.
  const focusVisibleTags = wants(FOCUS_VISIBLE_TAGS);
  let skipLinkSeen = false;
  let noSkipLink: Finding | undefined;
  let seen: FocusVisibleResult;
  const reader = bestPractice || focusVisibleTags ? await FocusReader.open(page) : undefined;
  // The guard that shields the page from the check's blur and refocus (src/focus-guard.ts). It is first in line
  // when `FocusGuard.install` ran before the page loaded, as `runScan` does;
  // otherwise the guard is `late` and the check reads its stops as needs review.
  const guard = reader !== undefined && focusVisibleTags ? await FocusGuard.of(page) : undefined;
  const focusVisible =
    reader !== undefined && guard !== undefined
      ? new FocusVisibleCheck(page, pageKey, reader, guard)
      : undefined;
  let walk: Walk;
  try {
    walk = await walkPage(page, {
      ...(options.maxTabs === undefined ? {} : { maxTabs: options.maxTabs }),
      onStop: async (stop) => {
        if (reader !== undefined && bestPractice && !skipLinkSeen && stop.index <= SKIP_LINK_STOPS) {
          skipLinkSeen = await focusedIsSkipLink(reader);
        }
        await focusVisible?.atStop(stop);
      },
      ...(focusVisible === undefined ? {} : { beforePress: () => focusVisible.beforePress() }),
    });
    seen = focusVisible?.result() ?? {};
    // No skip link (src/skip-link.ts).
    noSkipLink =
      reader !== undefined && bestPractice
        ? await checkSkipLink(page, pageKey, skipLinkSeen, reader)
        : undefined;
  } finally {
    await focusVisible?.close();
    await reader?.close();
  }
  // Where the walk went round: a keyboard trap, or a modal dialog that does not give focus back (src/keyboard-trap.ts).
  const trapTags = wants(KEYBOARD_TRAP_TAGS);
  const returnTags = wants(FOCUS_NOT_RETURNED_TAGS);
  // A native modal dialog (showModal()) is not checked for a trap, since Chrome hands Tab out of it to the
  // browser's own controls; the record names it in `cannotSee` instead. Asked before Escape could close it.
  const nativeModal = trapTags || returnTags ? await nativeModalOpen(page) : false;
  const trap = (trapTags || returnTags) && !nativeModal ? await checkKeyboardTrap(page, pageKey, walk) : {};
  const findings = [
    noLandmarks,
    click?.finding,
    noSkipLink,
    seen.finding,
    trapTags ? trap.trap : undefined,
    returnTags ? trap.notReturned : undefined,
  ].filter((f) => f !== undefined);
  const needsReview = [click?.needsReview, seen.needsReview].filter((n) => n !== undefined);
  return {
    ...scan,
    walk,
    ...(nativeModal ? { nativeModal: true as const } : {}),
    findings: findings.length === 0 ? scan.findings : orderFindings([...scan.findings, ...findings]),
    needsReview:
      needsReview.length === 0 ? scan.needsReview : orderFindings([...scan.needsReview, ...needsReview]),
  };
}
