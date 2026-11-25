/**
 * One page, several states, one finding per rule: a page is a URL, and its states are merged into the
 * page's finding, each element naming the states it was found in. An element is the same element across
 * states when its axe-core `target` is the same.
 *
 * This is the merge the record needs to be valid at all (a finding id is unique), so it is here from the
 * first state. Choices made where nothing else decides: a merged finding keeps the first state's wording
 * (`help`, `fix`, the element's `html` and `failure`), takes the worst impact any state gave it, and lists its
 * elements by the first state each was found in (`default` first), then by target.
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

/** Plain code-point order, the same on every machine and locale. */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The whole target as one string, so two targets compare part by part. */
function targetKey(target: AxeTarget): string {
  return JSON.stringify(target);
}

/**
 * Merges `runs`, one per state, by item id and then by element target. Each element of the result has the names
 * of the states it was found in, in the order the states were asked for: `stateOrder` when it is given (`default`
 * first whatever it says; a state it does not name comes after those it does), otherwise the order of `runs`.
 * Elements are ordered by the first of their states, then by target.
 */
export function mergeStates<I extends Mergeable>(
  input: readonly { state: string; items: readonly I[] }[],
  stateOrder: readonly string[] = input.map((run) => run.state),
): Merged<I>[] {
  const rank = (state: string): number => {
    if (state === "default") return -1;
    const at = stateOrder.indexOf(state);
    return at === -1 ? stateOrder.length : at;
  };
  const runs = [...input].sort((a, b) => rank(a.state) - rank(b.state));
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
  for (const item of merged.values()) {
    item.elements.sort(
      (a, b) =>
        rank(a.states[0] as string) - rank(b.states[0] as string) ||
        compareText(targetKey(a.target), targetKey(b.target)),
    );
  }
  return [...merged.values()];
}
