import { AxeBuilder } from "@axe-core/playwright";
import type { Page } from "playwright-core";
import type { AxeScan } from "./finding.js";
import { CLICK_ON_NON_CONTROL_TAGS, checkClickOnNonControl } from "./click-on-non-control.js";
import { checkLandmarks } from "./landmarks.js";
import { mapAxeResults, pageKeyOf } from "./map-axe.js";
import { orderFindings } from "./order.js";
import { BEST_PRACTICE_TAG } from "./rule-flags.js";
import { checkSkipLink } from "./skip-link.js";

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
 * `genie/click-on-non-control`, which runs when a `--tags` list has one of its tags (`wcag2a` among them). The
 * skip link's check runs last, because it presses Tab.
 *
 * `pageKey` names the page in finding ids; without it, the key comes from the page's URL (D6).
 */
export async function scanPage(
  page: Page,
  pageKey: string = pageKeyOf(page.url()),
  tags: readonly string[] | null = null,
): Promise<AxeScan> {
  const builder = new AxeBuilder({ page });
  if (tags !== null) builder.withTags([...tags]);
  const results: unknown = await builder.analyze();
  const scan = mapAxeResults(results, pageKey);
  // The product's own checks. The skip link's runs last: it presses Tab.
  const bestPractice = tags === null || tags.includes(BEST_PRACTICE_TAG);
  // A page with no landmark at all (src/landmarks.ts).
  const noLandmarks = bestPractice ? await checkLandmarks(page, pageKey) : undefined;
  // A click handler on an element that is not a control (src/click-on-non-control.ts).
  const click =
    tags === null || CLICK_ON_NON_CONTROL_TAGS.some((t) => tags.includes(t))
      ? await checkClickOnNonControl(page, pageKey)
      : undefined;
  // No skip link (src/skip-link.ts).
  const noSkipLink = bestPractice ? await checkSkipLink(page, pageKey) : undefined;
  const findings = [noLandmarks, click?.finding, noSkipLink].filter((f) => f !== undefined);
  const needsReview = [click?.needsReview].filter((n) => n !== undefined);
  return {
    ...scan,
    findings: findings.length === 0 ? scan.findings : orderFindings([...scan.findings, ...findings]),
    needsReview:
      needsReview.length === 0 ? scan.needsReview : orderFindings([...scan.needsReview, ...needsReview]),
  };
}
