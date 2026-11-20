/**
 * The never-claim phrase list (spec C16): no report, in any format, calls a site accessible, compliant or
 * conformant, or says it passes WCAG. The match is case-insensitive and by whole word. The allowed phrases
 * are exactly "accessible name" and "accessible names", and, in the README, the docs and the prompt file only,
 * the four in `ALLOWED_IN_DOCS`; and, in the prompt file only, once, `PROMPT_WORD_LIST`. A new allowed phrase
 * is a change to these lists and to the spec's.
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

/**
 * The one sentence that may name the forbidden words, allowed only in `agentic/fix-loop.prompt.md` and only once
 * there (decided 2026-11-19): an agent follows a literal word list better than a description of one. It is
 * matched exactly, case and quotes included, so a variant of it is not allowed, and only its first copy is set
 * aside, so a second copy in the file is read like any other text and fails.
 */
export const PROMPT_WORD_LIST = 'Never call the site "accessible", "compliant" or "conformant".';

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
 * `promptFile` is for `agentic/fix-loop.prompt.md` alone: the docs phrases, and the first exact copy of
 * `PROMPT_WORD_LIST`.
 */
export function neverClaimViolations(
  text: string,
  { docs = false, promptFile = false }: { docs?: boolean; promptFile?: boolean } = {},
): string[] {
  let rest = text;
  if (promptFile) rest = rest.replace(PROMPT_WORD_LIST, " ");
  for (const phrase of docs || promptFile ? [...ALLOWED, ...ALLOWED_IN_DOCS] : ALLOWED)
    rest = rest.replace(phrasePattern(phrase), " ");
  const found: string[] = [];
  for (const phrase of FORBIDDEN) {
    for (const match of rest.matchAll(new RegExp(`\\b${phrase}\\b`, "gi"))) found.push(match[0]);
  }
  return found;
}
