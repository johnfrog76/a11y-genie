/**
 * `a11y-genie rules`: every rule it runs, axe-core's and its own, with the axe-core version (spec 4.1).
 * It needs no browser and no network: axe-core's rules come from `axe.getRules()` in Node, the product's own
 * from the registry in `src/genie-rules.ts`. docs/JSON.md has the `--json` shape.
 */

import { createRequire } from "node:module";
import { parseArgs } from "node:util";
import "./click-on-non-control.js"; // registers `genie/click-on-non-control`
import { IMPACTS, type Impact } from "./finding.js";
import "./focus-visible.js"; // registers `genie/focus-visible`
import { genieRules } from "./genie-rules.js";
import "./keyboard-trap.js"; // registers `genie/keyboard-trap` and `genie/focus-not-returned`
import "./landmarks.js"; // registers `genie/no-landmarks`; each later check is imported here too
import "./narrate.js"; // registers `genie/unnamed-step`
import "./skip-link.js"; // registers `genie/skip-link`
import { wcagCriteria } from "./map-axe.js";
import { Refusal } from "./refusal.js";
import { parseTags } from "./rule-flags.js";

/** One line of `rules --json`, and one row of the text. */
export interface RuleRow {
  /** `axe` or `genie`. */
  source: "axe" | "genie";
  /** The rule's id as a finding names it (`genie/no-landmarks` is `no-landmarks` here, with source `genie`). */
  id: string;
  /** The rule's own impact; null where axe-core states none. A finding can carry another, from the check that failed. */
  impact: Impact | null;
  /** WCAG success criteria, such as `1.4.3`. Empty for a best-practice rule. */
  wcag: string[];
  tags: string[];
  help: string;
  helpUrl: string;
}

/** The document `rules --json` prints. */
export interface RulesDocument {
  engine: { axeCore: string };
  /** The `--tags` list that was given, or null for every rule. */
  tags: string[] | null;
  rules: RuleRow[];
}

interface AxeModule {
  version: string;
  getRules(): { ruleId: string; help: string; helpUrl: string; tags: string[] }[];
  /** axe-core keeps each rule's impact here only; `getRules()` leaves it out. */
  _audit?: { rules?: { id: string; impact?: string }[] };
}

/** Every rule at the installed axe-core and the registered `genie/*` rules, axe-core's first, each sorted by id. */
export function allRules(): RulesDocument {
  const axe = createRequire(import.meta.url)("axe-core") as AxeModule;
  const impacts = new Map((axe._audit?.rules ?? []).map((r) => [r.id, r.impact]));
  const rules: RuleRow[] = axe
    .getRules()
    .map((r) => {
      const impact = impacts.get(r.ruleId);
      return {
        source: "axe" as const,
        id: r.ruleId,
        impact: (IMPACTS as readonly (string | undefined)[]).includes(impact) ? (impact as Impact) : null,
        wcag: wcagCriteria(r.tags),
        tags: [...r.tags],
        help: r.help,
        helpUrl: r.helpUrl,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  for (const g of genieRules()) {
    rules.push({
      source: "genie",
      id: g.rule.id,
      impact: g.impact,
      wcag: [...g.rule.wcag],
      tags: [...g.tags],
      help: g.rule.help,
      helpUrl: g.rule.helpUrl,
    });
  }
  return { engine: { axeCore: axe.version }, tags: null, rules };
}

/** Keeps the rules that carry at least one of `tags`, as axe-core's own `--tags` does. */
export function filterByTags(all: RulesDocument, tags: string[]): RulesDocument {
  return { ...all, tags, rules: all.rules.filter((r) => r.tags.some((t) => tags.includes(t))) };
}

/** The text a person reads: a sentence, then one aligned line a rule. */
export function renderRules(doc: RulesDocument, total: number): string {
  const own = doc.rules.filter((r) => r.source === "genie").length;
  const rows = doc.rules.map((r) => [
    `${r.source}/${r.id}`,
    r.impact ?? "-",
    r.wcag.join(",") || "-",
    r.tags.join(",") || "-",
  ]);
  const head = ["RULE", "IMPACT", "WCAG", "TAGS"];
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((row) => (row[i] ?? "").length)));
  const line = (cells: string[]): string =>
    cells
      .map((c, i) => (i === cells.length - 1 ? c : c.padEnd(widths[i] ?? 0)))
      .join("  ")
      .trimEnd();
  const count = doc.tags === null ? `${doc.rules.length}` : `${doc.rules.length} of ${total}`;
  const shown = doc.tags === null ? "" : `, with the tags ${doc.tags.join(",")}`;
  return (
    `${count} rules${shown}: ${doc.rules.length - own} from axe-core ${doc.engine.axeCore} ` +
    `and ${own} of A11y Genie's own.\n\n` +
    [head, ...rows].map(line).join("\n") +
    "\n"
  );
}

/** `a11y-genie rules [--tags <list>] [--json]`. Exit 0; a bad flag is a refusal (exit 2). */
export function rulesCommand(args: string[], helpHint: string): void {
  let values: { tags?: string | undefined; json?: boolean | undefined };
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args,
      options: { tags: { type: "string" }, json: { type: "boolean" } },
      allowPositionals: true,
      strict: true,
    }));
  } catch (error) {
    throw new Refusal((error as Error).message, helpHint);
  }
  if (positionals.length > 0) {
    throw new Refusal(
      `rules takes no argument, and got: ${JSON.stringify(positionals[0]?.slice(0, 80))}`,
      helpHint,
    );
  }
  const all = allRules();
  const doc = values.tags === undefined ? all : filterByTags(all, parseTags(values.tags));
  process.stdout.write(
    values.json ? `${JSON.stringify(doc, null, 2)}\n` : renderRules(doc, all.rules.length),
  );
}
