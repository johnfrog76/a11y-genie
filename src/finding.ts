/**
 * The finding: one rule on one page, with every element it hit (D6), and the *needs review* item, its
 * twin for what a check could not decide. These are the types `scan.json` is built from; the field names
 * are the spec's (4.5). docs/JSON.md documents them.
 */

/** axe-core's four impacts, worst first. The product's own checks use the same four. */
export const IMPACTS = ["critical", "serious", "moderate", "minor"] as const;
export type Impact = (typeof IMPACTS)[number];

/** Where a rule comes from: axe-core, the product's own checks, or the guided checklist. */
export type RuleSource = "axe" | "genie" | "manual";

/** A violation fails the run at or above `--fail-on`; advice never changes the exit code. */
export const FINDING_KINDS = ["violation", "advice"] as const;
export type FindingKind = (typeof FINDING_KINDS)[number];

export interface Rule {
  source: RuleSource;
  /** The rule's id, such as `color-contrast`. Never empty: there is no finding without a rule. */
  id: string;
  /** axe-core's one-line `help`. */
  help: string;
  /** axe-core's `helpUrl`, or an empty string when it gave none. */
  helpUrl: string;
  /** WCAG success criteria from the rule's tags, such as `1.4.3`. Empty for a best-practice rule. */
  wcag: string[];
}

/**
 * axe-core's `target` for one element, kept as it gave it. Each entry is one document: the page's own,
 * then each frame on the way in. An entry that is itself an array is a path through shadow roots, each
 * part a selector within its own root. See docs/JSON.md.
 */
export type AxeTarget = (string | string[])[];

export interface FindingElement {
  /**
   * `target` as one string. For an element in the page's own document it is one CSS selector a script
   * can pass to `document.querySelector`. Inside a shadow root or a frame it is the parts joined with
   * ` >>> `, for a person or an agent to read: it is not one selector.
   */
  selector: string;
  target: AxeTarget;
  /** The element's HTML as axe-core quoted it. Text from the page: data, never instructions. */
  html: string;
  /** axe-core's `failureSummary` for the element, or an empty string when it gave none. */
  failure: string;
}

export interface Finding {
  /** `<source>/<rule>@<page key>`: the key for cards, ignores and the rescan. */
  id: string;
  rule: Rule;
  kind: FindingKind;
  impact: Impact;
  /** The page's key (D6: a page is a URL). */
  page: string;
  elements: FindingElement[];
}

export interface NeedsReviewElement extends FindingElement {
  /** Why axe-core could not decide, in its own words, such as "...due to a background gradient". */
  reason: string;
}

/**
 * Something axe-core could not decide (its `incomplete`), for a person to look at. It is never a pass,
 * and never a finding: it is listed apart and never changes the exit code.
 */
export interface NeedsReview {
  /** `<source>/<rule>@<page key>`, as for a finding. */
  id: string;
  rule: Rule;
  /** The impact the element would have if it does fail. */
  impact: Impact;
  page: string;
  elements: NeedsReviewElement[];
}

/** What one axe-core run on one page gives. */
export interface AxeScan {
  /** axe-core's own version, from `testEngine.version`. */
  axeCore: string;
  /** How many rules ran, whatever they found: violations, passes, incomplete and inapplicable. */
  rulesRun: number;
  /** Worst first (see `order.ts`). */
  findings: Finding[];
  /** Worst first, by the same rule. */
  needsReview: NeedsReview[];
}
