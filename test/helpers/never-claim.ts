/**
 * The never-claim phrase list (spec C16): no report, in any format, calls a site accessible, compliant or
 * conformant, or says it passes WCAG. The match is case-insensitive and by whole word. The allowed phrases
 * are exactly "accessible name" and "accessible names", and, in the README, the docs and the prompt file only,
 * the five in `ALLOWED_IN_DOCS`; and, in the prompt file only, once, `PROMPT_WORD_LIST`. A new allowed phrase
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
/**
 * Allowed in the README, `docs/` and the prompt file as well, and nowhere else (spec C16). "`passes`", with its
 * backticks, is axe-core's own result key, which docs/JSON.md documents by name (decided 2026-11-20); the word in
 * prose still fails.
 */
export const ALLOWED_IN_DOCS = [
  "`npm test` passes",
  "the test passes",
  "the tests pass",
  "CI passes",
  "`passes`",
];

/**
 * The one sentence that may name the forbidden words, allowed only in `agentic/fix-loop.prompt.md` and only once
 * there (decided 2026-11-19): an agent follows a literal word list better than a description of one. It is
 * matched exactly, case and quotes included, so a variant of it is not allowed, and only its first copy is set
 * aside, so a second copy in the file is read like any other text and fails.
 */
export const PROMPT_WORD_LIST = 'Never call the site "accessible", "compliant" or "conformant".';

/**
 * Allowed in the shipped deck's own text (`web/src/deck/decks/` and its voices' scripts), and nowhere else. Each
 * is an exact phrase the owner approved for the deck (2026-11-24), with why it is not a claim. Any other use of a
 * forbidden word in the deck still fails, so a later ship that makes a claim is caught here.
 */
export const ALLOWED_IN_DECK: readonly { phrase: string; reason: string }[] = [
  { phrase: "Wish One, Accessible HTML", reason: "the first wish's title: the wish, not a verdict" },
  { phrase: "part of the journey to accessible HTML", reason: "the journey, not a claim" },
];

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
 * `PROMPT_WORD_LIST`. `deck` is for the shipped deck's text, which may also use the phrases in `ALLOWED_IN_DECK`.
 */
export function neverClaimViolations(
  text: string,
  {
    docs = false,
    promptFile = false,
    deck = false,
  }: { docs?: boolean; promptFile?: boolean; deck?: boolean } = {},
): string[] {
  let rest = text;
  if (promptFile) rest = rest.replace(PROMPT_WORD_LIST, " ");
  const allowed = [
    ...ALLOWED,
    ...(docs || promptFile ? ALLOWED_IN_DOCS : []),
    ...(deck ? ALLOWED_IN_DECK.map((entry) => entry.phrase) : []),
  ];
  for (const phrase of allowed) rest = rest.replace(phrasePattern(phrase), " ");
  const found: string[] = [];
  for (const phrase of FORBIDDEN) {
    for (const match of rest.matchAll(new RegExp(`\\b${phrase}\\b`, "gi"))) found.push(match[0]);
  }
  return found;
}
