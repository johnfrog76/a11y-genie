/**
 * `genie/skip-link` (spec 6.4): a page whose first controls give a keyboard user no way past the navigation.
 *
 * axe-core has no rule for it. The check presses Tab three times from the top of the page and reads each
 * element that takes focus. A skip link is a same-page link (`href="#id"`) whose target exists and is the
 * page's `main` or sits inside it. With none, the finding is advice when landmarks or headings already let a
 * screen-reader user jump past the repeated content, and a WCAG 2.4.1 violation when nothing does. A page with
 * fewer than five tabbable elements before its main content has nothing much to skip and is not checked.
 */

import type { Page } from "playwright-core";
import type { Finding } from "./finding.js";
import { registerGenieRule } from "./genie-rules.js";
import { hasLandmark } from "./landmarks.js";
import { BEST_PRACTICE_TAG } from "./rule-flags.js";

export const SKIP_LINK_RULE = {
  source: "genie",
  id: "skip-link",
  help: "The page has no skip link among its first three tabbable elements.",
  helpUrl: "",
  wcag: ["2.4.1"],
} as const;

/** The violation's impact. The advice is `minor`; the registry lists the higher one. */
const VIOLATION_IMPACT = "moderate";
const ADVICE_IMPACT = "minor";

/** How many Tab presses the check reads, and how many tabbable elements before `main` a page needs to be checked. */
const TABS_READ = 3;
const MIN_TABBABLE = 5;

// It is listed by `a11y-genie rules`. It runs only with `best-practice`, as `genie/no-landmarks` does.
registerGenieRule({
  rule: { ...SKIP_LINK_RULE, wcag: [...SKIP_LINK_RULE.wcag] },
  impact: VIOLATION_IMPACT,
  tags: [BEST_PRACTICE_TAG],
});

const ADVICE_FAILURE =
  "Fix all of the following:\n" +
  "  No skip link. Its landmarks or headings let a screen-reader user jump past the navigation; " +
  "a skip link does the same for someone using only a keyboard. " +
  "Add a link to #main as the first thing on the page, shown when it gets focus.";

const VIOLATION_FAILURE =
  "Fix all of the following:\n" +
  "  No skip link, and the page has no landmarks or headings, so nothing gets a person past the repeated content. " +
  "Add a link to #main as the first thing on the page, shown when it gets focus, " +
  "and put the page's own content in a main element with that id.";

/** Runs in the page: how many tabbable elements come before `main`, or all of them when there is no main. */
const COUNT_TABBABLE = `(() => {
  const main = document.querySelector("main, [role=main]");
  const sel = "a[href], button, input:not([type=hidden]), select, textarea, summary, [tabindex], [contenteditable=true]";
  let n = 0;
  for (const el of document.querySelectorAll(sel)) {
    if (el.disabled || el.tabIndex < 0) continue;
    const box = el.getClientRects();
    if (box.length === 0 || getComputedStyle(el).visibility === "hidden") continue;
    if (main && (main.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING) === 0) continue;
    n++;
  }
  return n;
})()`;

/** Runs in the page: whether the focused element is a link to an element that is `main` or inside it. */
const FOCUSED_IS_SKIP_LINK = `(() => {
  const el = document.activeElement;
  if (!el || el.tagName !== "A") return false;
  const href = el.getAttribute("href") ?? "";
  if (!href.startsWith("#") || href.length < 2) return false;
  let id = href.slice(1);
  try { id = decodeURIComponent(id); } catch {}
  const target = document.getElementById(id);
  if (!target) return false;
  const main = document.querySelector("main, [role=main]");
  return main !== null && main.contains(target);
})()`;

/** Whether one of the first three Tab stops is a skip link. Moves focus, so it runs after axe-core. */
export async function hasSkipLink(page: Page): Promise<boolean> {
  await page.evaluate("document.activeElement instanceof HTMLElement && document.activeElement.blur()");
  for (let i = 0; i < TABS_READ; i++) {
    await page.keyboard.press("Tab");
    if ((await page.evaluate(FOCUSED_IS_SKIP_LINK)) === true) return true;
  }
  return false;
}

/** The finding for a page with no skip link, or undefined when it has one or has too little to skip. */
export async function checkSkipLink(page: Page, pageKey: string): Promise<Finding | undefined> {
  const tabbable: unknown = await page.evaluate(COUNT_TABBABLE);
  if (typeof tabbable !== "number" || tabbable < MIN_TABBABLE) return undefined;
  if (await hasSkipLink(page)) return undefined;
  const structure = (await hasLandmark(page)) || (await page.getByRole("heading").count()) > 0;
  const html: unknown = await page.evaluate(
    "document.body.cloneNode(false).outerHTML.replace(/<\\/body>$/, '')",
  );
  return {
    id: `genie/skip-link@${pageKey}`,
    rule: { ...SKIP_LINK_RULE, wcag: [...SKIP_LINK_RULE.wcag] },
    kind: structure ? "advice" : "violation",
    impact: structure ? ADVICE_IMPACT : VIOLATION_IMPACT,
    page: pageKey,
    elements: [
      {
        selector: "body",
        target: ["body"],
        html: typeof html === "string" ? html : "<body>",
        failure: structure ? ADVICE_FAILURE : VIOLATION_FAILURE,
      },
    ],
  };
}
