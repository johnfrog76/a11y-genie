/**
 * `--tags` and `--fail-on`: the two flags that choose which rules run and which findings fail the run.
 * Both refuse a value they do not know, before anything is scanned (docs/EXIT-CODES.md).
 */

import { createRequire } from "node:module";
import { IMPACTS, type Impact } from "./finding.js";
import { Refusal } from "./refusal.js";

/** The tag the landmark rules carry: a `--tags` list without it runs none of them (docs/ARCHITECTURE.md). */
export const BEST_PRACTICE_TAG = "best-practice";

/** What `--fail-on` is when it is not given: any violation fails the run (spec 4.2). */
export const DEFAULT_FAIL_ON: Impact = "minor";

/**
 * Every tag any axe-core rule carries, from axe-core's own rule metadata (`axe.getRules()`) at the installed
 * version, sorted. Nothing is listed by hand, so an upgrade that adds a tag adds it here.
 */
export function axeTags(): string[] {
  const require = createRequire(import.meta.url);
  const axe = require("axe-core") as { getRules(): { tags: string[] }[] };
  const tags = new Set<string>();
  for (const rule of axe.getRules()) for (const tag of rule.tags) tags.add(tag);
  return [...tags].sort();
}

/**
 * `--tags a,b`: the tags axe-core runs, in the order given and without repeats. A value that is empty, has
 * an empty part, or names a tag no axe-core rule carries is refused.
 */
export function parseTags(value: string): string[] {
  const known = axeTags();
  const tags: string[] = [];
  for (const part of value.split(",")) {
    const tag = part.trim();
    if (tag === "") {
      throw new Refusal(
        "--tags needs one or more axe-core tags, separated by commas, and one is empty.",
        `use axe-core tags separated by commas, such as wcag2a,wcag2aa,${BEST_PRACTICE_TAG}.`,
      );
    }
    if (!known.includes(tag)) {
      throw new Refusal(
        `unknown --tags value: ${JSON.stringify(tag.slice(0, 80))}`,
        `use axe-core tags separated by commas, such as wcag2a, wcag2aa, wcag21aa or ${BEST_PRACTICE_TAG}. The landmark rules need ${BEST_PRACTICE_TAG}.`,
      );
    }
    if (!tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

/** `--fail-on <impact>`: the lowest impact that makes the exit 1. */
export function parseFailOn(value: string): Impact {
  if (!(IMPACTS as readonly string[]).includes(value)) {
    throw new Refusal(
      `unknown --fail-on impact: ${JSON.stringify(value.slice(0, 80))}`,
      `use one of: ${IMPACTS.join(", ")}.`,
    );
  }
  return value as Impact;
}

/** Whether `impact` is at or above `floor`: `serious` is at or above `moderate`, not the other way round. */
export function atOrAbove(impact: Impact, floor: Impact): boolean {
  return IMPACTS.indexOf(impact) <= IMPACTS.indexOf(floor);
}
