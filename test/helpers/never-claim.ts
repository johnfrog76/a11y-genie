/**
 * The never-claim phrase list (spec C16): no report, in any format, calls a site accessible, compliant or
 * conformant, or says it passes WCAG. The match is case-insensitive and by whole word. The allowed phrases
 * are exactly "accessible name" and "accessible names" (the others the spec allows are for the README, the
 * docs and the prompt file only). A new allowed phrase is a change to this list and to the spec's.
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

/** Every forbidden phrase found in `text`, once per match, after the allowed phrases are set aside. */
export function neverClaimViolations(text: string): string[] {
  let rest = text;
  for (const phrase of ALLOWED) rest = rest.replace(new RegExp(`\\b${phrase}\\b`, "gi"), " ");
  const found: string[] = [];
  for (const phrase of FORBIDDEN) {
    for (const match of rest.matchAll(new RegExp(`\\b${phrase}\\b`, "gi"))) found.push(match[0]);
  }
  return found;
}
