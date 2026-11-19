import { AxeBuilder } from "@axe-core/playwright";
import type { Page } from "playwright-core";
import type { AxeScan } from "./finding.js";
import { checkLandmarks } from "./landmarks.js";
import { mapAxeResults, pageKeyOf } from "./map-axe.js";
import { orderFindings } from "./order.js";

/**
 * Runs axe-core on a page that is already loaded, and maps what it found (src/map-axe.ts).
 *
 * It runs axe-core's default rule set: no `withTags` (that comes with `--tags`). axe-core is injected
 * into the page and its frames by `@axe-core/playwright` from the installed package; nothing is fetched.
 *
 * The page must come from `browser.newContext()` then `context.newPage()`, not `browser.newPage()`:
 * `@axe-core/playwright` opens a blank page in the same context to put the frames' results together,
 * and a context made by `browser.newPage()` refuses a second page.
 *
 * After axe-core it runs the product's own checks; so far, `genie/no-landmarks`.
 *
 * `pageKey` names the page in finding ids; without it, the key comes from the page's URL (D6).
 */
export async function scanPage(page: Page, pageKey: string = pageKeyOf(page.url())): Promise<AxeScan> {
  const results: unknown = await new AxeBuilder({ page }).analyze();
  const scan = mapAxeResults(results, pageKey);
  // The product's own check for a page with no landmark at all (src/landmarks.ts).
  const noLandmarks = await checkLandmarks(page, pageKey);
  return noLandmarks === undefined
    ? scan
    : { ...scan, findings: orderFindings([...scan.findings, noLandmarks]) };
}
