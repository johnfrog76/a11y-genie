/**
 * One page, several states, one finding per rule (D6): a page is a URL, and its states are merged into the
 * page's finding, each element naming the states it was found in. An element is the same element across
 * states when its axe-core `target` is the same (spec 5.2).
 *
 * This is the merge the record needs to be valid at all (a finding id is unique), so it is here from the
 * first state. Choices made where the spec is silent: a merged finding keeps the first state's wording
 * (`help`, `fix`, the element's `html` and `failure`), takes the worst impact any state gave it, and lists its
 * elements in the order they were first seen, default state first.
 */

import { IMPACTS, type AxeTarget, type Impact } from "./finding.js";

interface Mergeable {
  id: string;
  impact: Impact;
  elements: { target: AxeTarget }[];
}

type Merged<I extends Mergeable> = Omit<I, "elements"> & { elements: InStates<I["elements"][number]>[] };

/** An element with the states it was found in. */
export type InStates<E> = E & { states: string[] };

function worse(a: Impact, b: Impact): Impact {
  return IMPACTS.indexOf(a) <= IMPACTS.indexOf(b) ? a : b;
}

/**
 * Merges `runs`, one per state in the order scanned, by item id and then by element target. Each element of the
 * result has the names of the states it was found in, in the order the states were scanned.
 */
export function mergeStates<I extends Mergeable>(
  runs: readonly { state: string; items: readonly I[] }[],
): Merged<I>[] {
  type E = I["elements"][number];
  const merged = new Map<string, Merged<I>>();
  const byTarget = new Map<string, Map<string, InStates<E>>>();
  for (const { state, items } of runs) {
    for (const item of items) {
      let into = merged.get(item.id);
      let seen = byTarget.get(item.id);
      if (into === undefined || seen === undefined) {
        into = { ...item, elements: [] } as Merged<I>;
        seen = new Map();
        merged.set(item.id, into);
        byTarget.set(item.id, seen);
      } else {
        into.impact = worse(into.impact, item.impact);
      }
      for (const element of item.elements) {
        const key = JSON.stringify(element.target);
        const known = seen.get(key);
        if (known === undefined) {
          const added = { ...element, states: [state] } as InStates<E>;
          seen.set(key, added);
          into.elements.push(added);
        } else if (!known.states.includes(state)) {
          known.states.push(state);
        }
      }
    }
  }
  return [...merged.values()];
}
