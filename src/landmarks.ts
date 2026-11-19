/**
 * `genie/no-landmarks` (spec 6.1.1): one finding for a page that has no landmark at all.
 *
 * axe-core's `region` reports content outside landmarks one element at a time, and `landmark-one-main`
 * reports a missing main. A page with nothing at all gets both, plus every element `region` can reach.
 * This check says it once, in the words the deck uses. It reads the page's accessibility roles, not its
 * tag names, so a `div role="main"` counts and a `header` inside an `article` does not.
 */

import type { Page } from "playwright-core";
import type { Finding } from "./finding.js";

/** The four landmarks the check looks for. Others (`complementary`, `search`, `form`) do not count. */
export const LANDMARK_ROLES = ["banner", "navigation", "main", "contentinfo"] as const;

export const NO_LANDMARKS_RULE = {
  source: "genie",
  id: "no-landmarks",
  help: "The page has no landmarks: no banner, navigation, main or contentinfo.",
  helpUrl: "",
  wcag: ["1.3.1", "2.4.1"],
} as const;

const FAILURE =
  "Fix all of the following:\n" +
  "  The page has no landmark. Put the page's own content in a main element, and use header, nav and footer " +
  "for its banner, its navigation and its footer, so that a person using a screen reader can jump between them.";

/** Whether the page has at least one landmark of the four roles, visible to the accessibility tree. */
export async function hasLandmark(page: Page): Promise<boolean> {
  for (const role of LANDMARK_ROLES) {
    if ((await page.getByRole(role).count()) > 0) return true;
  }
  return false;
}

/** The finding for a page with no landmark, or undefined when it has one. `pageKey` names the page. */
export async function checkLandmarks(page: Page, pageKey: string): Promise<Finding | undefined> {
  if (await hasLandmark(page)) return undefined;
  // The page's own opening tag, as the element to point at; it is page text, so it is data.
  const html: unknown = await page.evaluate(
    "document.body.cloneNode(false).outerHTML.replace(/<\\/body>$/, '')",
  );
  return {
    id: `genie/no-landmarks@${pageKey}`,
    rule: { ...NO_LANDMARKS_RULE, wcag: [...NO_LANDMARKS_RULE.wcag] },
    kind: "violation",
    impact: "moderate",
    page: pageKey,
    elements: [
      {
        selector: "body",
        target: ["body"],
        html: typeof html === "string" ? html : "<body>",
        failure: FAILURE,
      },
    ],
  };
}
