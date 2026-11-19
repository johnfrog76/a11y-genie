/**
 * The registry of the product's own rules, the `genie/*` ones (spec 6). A check registers its rule here when
 * its module loads, and `a11y-genie rules` lists what is registered, so a new check adds itself to the list by
 * registering and nothing else keeps a second copy. A rule that is not built yet is not registered, and so
 * is not listed.
 */

import type { Impact, Rule } from "./finding.js";

/** One of the product's own rules, as `rules` lists it. */
export interface GenieRule {
  /** The rule as a finding carries it: `source` is `genie`, and `id` has no `genie/` prefix. */
  rule: Rule & { source: "genie" };
  /** The impact its findings carry. */
  impact: Impact;
  /** The axe-core tags that decide whether it runs: a `--tags` list that has none of them leaves it out. */
  tags: string[];
}

const registered = new Map<string, GenieRule>();

/** Adds a rule to the list. Two rules with one id would be a mistake in the code, so it throws. */
export function registerGenieRule(entry: GenieRule): void {
  if (registered.has(entry.rule.id)) throw new Error(`genie rule registered twice: ${entry.rule.id}`);
  registered.set(entry.rule.id, entry);
}

/** Every registered rule, by id. */
export function genieRules(): GenieRule[] {
  return [...registered.values()].sort((a, b) => a.rule.id.localeCompare(b.rule.id));
}
