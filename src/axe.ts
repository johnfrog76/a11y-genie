import { AxeBuilder } from "@axe-core/playwright";
import type { Page } from "playwright-core";
import type { AxeScan } from "./finding.js";
import { checkLandmarks } from "./landmarks.js";
import { mapAxeResults, pageKeyOf } from "./map-axe.js";
import { orderFindings } from "./order.js";
import { BEST_PRACTICE_TAG } from "./rule-flags.js";

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
 * After axe-core it runs the product's own checks; so far, `genie/no-landmarks`. It is a best practice, like
 * the landmark rules it sums up, so a `--tags` list without `best-practice` does not run it either.
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
  // The product's own check for a page with no landmark at all (src/landmarks.ts).
  const noLandmarks =
    tags === null || tags.includes(BEST_PRACTICE_TAG) ? await checkLandmarks(page, pageKey) : undefined;
  return noLandmarks === undefined
    ? scan
    : { ...scan, findings: orderFindings([...scan.findings, noLandmarks]) };
}
