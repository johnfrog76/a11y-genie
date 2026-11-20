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
import { registerGenieRule } from "./genie-rules.js";
import { BEST_PRACTICE_TAG } from "./rule-flags.js";
import { FocusReader } from "./walk.js";

/** The four landmarks the check looks for. Others (`complementary`, `search`, `form`) do not count. */
export const LANDMARK_ROLES = ["banner", "navigation", "main", "contentinfo"] as const;

/** The ARIA roles a role attribute can name, which is how the first usable token is told from a made-up one. */
const KNOWN_ROLES = [
  "alert",
  "alertdialog",
  "application",
  "article",
  "banner",
  "blockquote",
  "button",
  "caption",
  "cell",
  "checkbox",
  "code",
  "columnheader",
  "combobox",
  "complementary",
  "contentinfo",
  "definition",
  "deletion",
  "dialog",
  "directory",
  "document",
  "emphasis",
  "feed",
  "figure",
  "form",
  "generic",
  "grid",
  "gridcell",
  "group",
  "heading",
  "img",
  "image",
  "insertion",
  "link",
  "list",
  "listbox",
  "listitem",
  "log",
  "main",
  "marquee",
  "math",
  "menu",
  "menubar",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "meter",
  "navigation",
  "none",
  "note",
  "option",
  "paragraph",
  "presentation",
  "progressbar",
  "radio",
  "radiogroup",
  "region",
  "row",
  "rowgroup",
  "rowheader",
  "scrollbar",
  "search",
  "searchbox",
  "separator",
  "slider",
  "spinbutton",
  "status",
  "strong",
  "subscript",
  "superscript",
  "switch",
  "tab",
  "table",
  "tablist",
  "tabpanel",
  "term",
  "textbox",
  "time",
  "timer",
  "toolbar",
  "tooltip",
  "tree",
  "treegrid",
  "treeitem",
];

export const NO_LANDMARKS_RULE = {
  source: "genie",
  id: "no-landmarks",
  help: "The page has no landmarks: no banner, navigation, main or contentinfo.",
  helpUrl: "",
  wcag: ["1.3.1", "2.4.1"],
} as const;

/** `moderate`, on the page's `body`. */
const NO_LANDMARKS_IMPACT = "moderate";

// It is listed by `a11y-genie rules`. Like the landmark rules it sums up, it runs only with `best-practice`.
registerGenieRule({
  rule: { ...NO_LANDMARKS_RULE, wcag: [...NO_LANDMARKS_RULE.wcag] },
  impact: NO_LANDMARKS_IMPACT,
  tags: [BEST_PRACTICE_TAG],
});

const FAILURE =
  "Fix all of the following:\n" +
  "  The page has no landmark. Put the page's own content in a main element, and use header, nav and footer " +
  "for its banner, its navigation and its footer, so that a person using a screen reader can jump between them.";

/**
 * Runs in the isolated world (`FocusReader.call`): whether the page has a landmark of the four roles, and whether
 * it has a heading, each visible to the accessibility tree. It reads the page the way the browser's role lookup does:
 *  - a role attribute decides, by its first token that is a known ARIA role; when none is known, `main`, `nav`, `h1` to `h6` have their own role, and
 *    `header` and `footer` are `banner` and `contentinfo` only outside a scoping ancestor: `article`, `aside`, `main`, `nav` or
 *    `section` with no role attribute, or an element whose role attribute is exactly `article`, `complementary`, `main`,
 *    `navigation` or `region` (the browser's own rule, which does not read the first known token here);
 *  - an element is out of the tree when it or an ancestor is `display: none` or `aria-hidden="true"`, or it is
 *    `visibility: hidden`;
 *  - open shadow roots are read, as the role lookup reads them.
 * The page's own overrides of `querySelector`, `matches` and `getAttribute` change nothing here.
 */
export const READ_STRUCTURE = `function () {
  const LANDMARKS = ${JSON.stringify(LANDMARK_ROLES)};
  const SECTIONING = ["ARTICLE", "ASIDE", "MAIN", "NAV", "SECTION"];
  const SCOPING_ROLES = ["article", "complementary", "main", "navigation", "region"];
  // The browser's scoping rule, as its selector: one of the five tags with no role attribute, or a role attribute
  // whose whole value, exactly as written, is one of the five roles. A value of several tokens does not match.
  const scopes = (e) => {
    const role = e.getAttribute("role");
    return role === null ? SECTIONING.includes(e.tagName) : SCOPING_ROLES.includes(role);
  };
  const parentOf = (el) => el.parentElement ?? (el.getRootNode() instanceof ShadowRoot ? el.getRootNode().host : null);
  const hidden = (el) => {
    if (getComputedStyle(el).visibility === "hidden") return true;
    for (let e = el; e; e = parentOf(e)) {
      if (e.getAttribute("aria-hidden") === "true" || getComputedStyle(e).display === "none") return true;
    }
    return false;
  };
  const KNOWN = ${JSON.stringify(KNOWN_ROLES)};
  const roleOf = (el) => {
    const tokens = (el.getAttribute("role") ?? "").trim().toLowerCase().split(/\\s+/);
    const explicit = tokens.find((t) => KNOWN.includes(t));
    if (explicit) return explicit;
    const tag = el.tagName;
    if (tag === "MAIN") return "main";
    if (tag === "NAV") return "navigation";
    if (/^H[1-6]$/.test(tag)) return "heading";
    if (tag === "HEADER" || tag === "FOOTER") {
      for (let e = parentOf(el); e; e = parentOf(e)) if (scopes(e)) return "";
      return tag === "HEADER" ? "banner" : "contentinfo";
    }
    return "";
  };
  const found = { landmark: false, heading: false };
  const visit = (root) => {
    for (const el of root.querySelectorAll("*")) {
      if (el.shadowRoot) visit(el.shadowRoot);
      if (found.landmark && found.heading) continue;
      const role = roleOf(el);
      if (role === "") continue;
      const wanted = LANDMARKS.includes(role) ? "landmark" : role === "heading" ? "heading" : "";
      if (wanted !== "" && !found[wanted] && !hidden(el)) found[wanted] = true;
    }
  };
  visit(document);
  return found;
}`;

/** What the page has, read in the reader's isolated world (`READ_STRUCTURE`). A reply that is not that shape counts as nothing. */
export async function readStructure(reader: FocusReader): Promise<{ landmark: boolean; heading: boolean }> {
  const found = (await reader.call(READ_STRUCTURE)) as { landmark?: unknown; heading?: unknown } | null;
  return { landmark: found?.landmark === true, heading: found?.heading === true };
}

/** Whether the page has at least one landmark of the four roles, visible to the accessibility tree. */
export async function hasLandmark(reader: FocusReader): Promise<boolean> {
  return (await readStructure(reader)).landmark;
}

/** Runs in the isolated world: the body's opening tag, for the finding's snippet. */
const BODY_OPENING_TAG = `function () {
  return document.body.cloneNode(false).outerHTML.replace(/<\\/body>$/, "");
}`;

/** The finding for a page with no landmark, or undefined when it has one. `pageKey` names the page. */
export async function checkLandmarks(page: Page, pageKey: string): Promise<Finding | undefined> {
  const reader = await FocusReader.open(page);
  let html: unknown;
  try {
    if (await hasLandmark(reader)) return undefined;
    // The page's own opening tag, as the element to point at; it is page text, so it is data.
    html = await reader.call(BODY_OPENING_TAG);
  } finally {
    await reader.close();
  }
  return {
    id: `genie/no-landmarks@${pageKey}`,
    rule: { ...NO_LANDMARKS_RULE, wcag: [...NO_LANDMARKS_RULE.wcag] },
    kind: "violation",
    impact: NO_LANDMARKS_IMPACT,
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
