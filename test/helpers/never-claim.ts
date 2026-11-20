/**
 * The never-claim phrase list (spec C16): no report, in any format, calls a site accessible, compliant or
 * conformant, or says it passes WCAG. The match is case-insensitive and by whole word. The allowed phrases
 * are exactly "accessible name" and "accessible names", and, in the README, the docs and the prompt file only,
 * the four in `ALLOWED_IN_DOCS`. A new allowed phrase is a change to these lists and to the spec's.
 */
export const FORBIDDEN = [
  "accessible",
  "compliant",
  "compliance",
  "conformant",
  "conforms",
  "passes",
  "passed WCAG",
];
export const ALLOWED = ["accessible name", "accessible names"];
/** Allowed in the README, `docs/` and the prompt file as well, and nowhere else (spec C16). */
export const ALLOWED_IN_DOCS = ["`npm test` passes", "the test passes", "the tests pass", "CI passes"];

/** A phrase as a case-insensitive pattern, every character literal, bounded by a word edge where it has one. */
function phrasePattern(phrase: string): RegExp {
  const literal = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const start = /^\w/.test(phrase) ? "\\b" : "";
  const end = /\w$/.test(phrase) ? "\\b" : "";
  return new RegExp(`${start}${literal}${end}`, "gi");
}

/**
 * Every forbidden phrase found in `text`, once per match, after the allowed phrases are set aside. `docs` is
 * for the README, the docs and the prompt file, which may also use the phrases in `ALLOWED_IN_DOCS`.
 */
export function neverClaimViolations(text: string, { docs = false }: { docs?: boolean } = {}): string[] {
  let rest = text;
  for (const phrase of docs ? [...ALLOWED, ...ALLOWED_IN_DOCS] : ALLOWED)
    rest = rest.replace(phrasePattern(phrase), " ");
  const found: string[] = [];
  for (const phrase of FORBIDDEN) {
    for (const match of rest.matchAll(new RegExp(`\\b${phrase}\\b`, "gi"))) found.push(match[0]);
  }
  return found;
}
