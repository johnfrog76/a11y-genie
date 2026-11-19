import { FINDING_KINDS, IMPACTS, type FindingKind, type Impact } from "./finding.js";

/** What ordering reads from a finding or a *needs review* item. */
export interface Orderable {
  impact: Impact;
  /** A *needs review* item has no kind; it sorts as a violation would. */
  kind?: FindingKind;
  rule: { id: string };
  page: string;
}

/** Plain code-point order, so the same findings sort the same way on every machine and locale. */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Orders findings worst first (principle 2.2): by impact on a person (critical, serious, moderate,
 * minor), then by kind (violation before advice), then by rule id, then by page order.
 *
 * `pageOrder` lists the page keys in the order the pages were scanned. A page not in it comes after
 * those that are, in code-point order of its key. Ties keep their input order. Returns a new array.
 */
export function orderFindings<T extends Orderable>(
  items: readonly T[],
  pageOrder: readonly string[] = [],
): T[] {
  const pageRank = (page: string): number => {
    const index = pageOrder.indexOf(page);
    return index === -1 ? pageOrder.length : index;
  };
  return [...items].sort(
    (a, b) =>
      IMPACTS.indexOf(a.impact) - IMPACTS.indexOf(b.impact) ||
      FINDING_KINDS.indexOf(a.kind ?? "violation") - FINDING_KINDS.indexOf(b.kind ?? "violation") ||
      compareText(a.rule.id, b.rule.id) ||
      pageRank(a.page) - pageRank(b.page) ||
      compareText(a.page, b.page),
  );
}
