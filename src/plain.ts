/**
 * The plain words of a finding (spec 4.5, 6): a short heading (`title`, for the report), what is wrong and who
 * it hurts (`plain`), and the concrete fix (`fix`), written for a reader who knows no WCAG. The tables here are
 * data, written by hand, and nothing else: no text from a page and nothing axe-core said goes into them, and a
 * finding's words are taken from them as they stand. The voice is plain facts, never the genie's (D7), and the words never call a site accessible,
 * compliant or conformant, or say it passes (C16).
 *
 * A rule with no entry keeps axe-core's own words: `help` for `plain`, `failureSummary` for `fix`
 * (src/scan-record.ts). A criterion with no entry is named by its number alone. docs/ARCHITECTURE.md (*Plain
 * words*) says how to add a rule's wording.
 */

import type { FindingKind, Rule } from "./finding.js";

/** A finding's words. */
export interface Wording {
  /** The finding's heading: a few plain words, no full stop, at most `TITLE_MAX_WORDS`. */
  title: string;
  /** What is wrong, and who it hurts. One or two sentences. */
  plain: string;
  /** What to change. One or two sentences. */
  fix: string;
}

/** The most words a title may have, so a report's headings stay short enough to scan. */
export const TITLE_MAX_WORDS = 7;

/** A rule's words, with other words for its advice when its advice says something else. */
export interface RuleWording extends Wording {
  /** The words when the finding's `kind` is `advice`. Without them, advice reads as the violation does. */
  advice?: Wording;
}

/**
 * The words of each rule, by `<source>/<id>`. Every `genie/*` rule has an entry (a test reads the registry), and
 * so does every axe-core rule a fixture page hits, and `link-name`, which the spec names beside `button-name`.
 */
export const RULE_WORDING: Readonly<Record<string, RuleWording>> = Object.freeze({
  "axe/button-name": {
    title: "Button with no name",
    plain:
      'A button has no name, so a screen reader announces it only as "button" and its user cannot tell what it does.',
    fix: 'Give it a name: visible text inside the button, or an aria-label that says what it does, such as aria-label="Search".',
  },
  "axe/color-contrast": {
    title: "Text too faint to read",
    plain:
      "Text is too faint against its background for many people to read, people with low vision among them, and anyone looking at a screen in bright light.",
    fix: "Darken the text or lighten its background, or the other way round, until the contrast ratio is at least 4.5 to 1, or 3 to 1 for large text.",
  },
  "axe/empty-heading": {
    title: "Empty heading",
    plain:
      "A heading has no text. A screen reader still announces it as a heading, so a person moving through the page by its headings lands on an empty one.",
    fix: "Give the heading text that names the section after it, or, if it is there only for its look, make it something other than a heading.",
  },
  "axe/heading-order": {
    title: "Heading that skips a level",
    plain:
      "A heading skips a level, such as an h2 followed by an h4, so a person who reads the page's outline through its headings looks for a section that is not there.",
    fix: "Go down one level at a time: under an h2 comes an h3. To change how a heading looks, use CSS, not another level.",
  },
  "axe/image-alt": {
    title: "Image with no text alternative",
    plain:
      "An image has no text alternative, so a person who cannot see it hears nothing about it from a screen reader, or only its file name.",
    fix: 'Add an alt attribute that says what the image shows or what it is for. If it is only decoration, use alt="" so that screen readers skip it.',
  },
  "axe/landmark-no-duplicate-main": {
    title: "More than one main landmark",
    plain:
      "The page has more than one main landmark, so a screen-reader user who jumps to the main content cannot tell which one it is.",
    fix: "Keep one main element, around the page's own content, and make the others a section, an article or a div.",
  },
  "axe/landmark-one-main": {
    title: "No main landmark",
    plain: "The page has no main landmark, so a screen-reader user cannot jump straight to its main content.",
    fix: "Put the page's own content, everything but its header, navigation and footer, inside one main element.",
  },
  "axe/link-name": {
    title: "Link with no name",
    plain:
      "A link has no name, so a screen reader reads it as just a link, or reads out its address, and its user cannot tell where it goes.",
    fix: "Give it a name: link text that says where it goes, an aria-label, or alt text on the image inside it.",
  },
  "axe/page-has-heading-one": {
    title: "No level-one heading",
    plain:
      "The page has no level-one heading, so a person who moves through the page by its headings has no title to start from.",
    fix: "Add one h1 at the start of the main content that says what the page is about.",
  },
  "axe/region": {
    title: "Content outside every landmark",
    plain:
      "Some content sits outside every landmark, so a screen-reader user who moves through the page by its landmarks can miss it.",
    fix: "Put all of the page's content inside landmarks: header, nav, main, aside or footer. Content that belongs to none of the others goes in main.",
  },
  "genie/click-on-non-control": {
    title: "Clickable thing that is not a control",
    plain:
      "Something reacts to a click but is not a button or a link, so a keyboard cannot reach it and a screen reader does not say it can be pressed.",
    fix: 'Make it a button element with the same handler and the same text. If it must stay as it is, give it role="button" and tabindex="0", and run the same handler on Enter and Space.',
  },
  "genie/no-landmarks": {
    title: "No landmarks at all",
    plain:
      "The page has no landmarks at all: no header, navigation, main or footer region. A screen-reader user cannot jump between its parts and has to go through it from the top.",
    fix: "Put the page's own content in a main element, and use header, nav and footer for its banner, its navigation and its footer.",
  },
  "genie/skip-link": {
    title: "No skip link, landmarks or headings",
    plain:
      "The page has no skip link, and no landmarks or headings either, so nothing lets a keyboard or screen-reader user past the content repeated at the top, such as the navigation.",
    fix: 'Make the first thing on the page a link to the main content, shown when it gets focus, and put the page\'s own content in a main element with id="main" for it to point at.',
    advice: {
      title: "No skip link",
      plain:
        "No skip link. Landmarks and headings already let a screen-reader user jump past the navigation; a skip link does the same for someone using only a keyboard.",
      fix: 'Make the first thing on the page a link to the main content, such as href="#main" with id="main" on the main element, shown when it gets focus.',
    },
  },
});

/** A WCAG success criterion's name, and what it asks, in plain words. */
export interface CriterionWording {
  /** The criterion's own name, as WCAG gives it, such as "Contrast (Minimum)". */
  name: string;
  /** What it asks, in a few plain words, such as "text must stand out from its background". */
  plain: string;
}

/** The criteria the rules in `RULE_WORDING` carry, by number. A test holds the two tables together. */
export const CRITERION_WORDING: Readonly<Record<string, CriterionWording>> = Object.freeze({
  "1.1.1": { name: "Non-text Content", plain: "images and other non-text content need a text alternative" },
  "1.3.1": {
    name: "Info and Relationships",
    plain: "the structure people see, such as headings and regions, must be in the code too",
  },
  "1.4.3": { name: "Contrast (Minimum)", plain: "text must stand out from its background" },
  "2.1.1": { name: "Keyboard", plain: "everything must work from a keyboard" },
  "2.4.1": { name: "Bypass Blocks", plain: "there must be a way past content repeated on every page" },
  "2.4.4": { name: "Link Purpose (In Context)", plain: "each link must say where it goes" },
  "4.1.2": {
    name: "Name, Role, Value",
    plain: "every control must have a name and say what kind of control it is",
  },
});

/** The words for a rule, by its source and id, for a finding of this kind; undefined when the table has none. */
export function wordingOf(rule: Pick<Rule, "source" | "id">, kind: FindingKind): Wording | undefined {
  const entry = Object.hasOwn(RULE_WORDING, `${rule.source}/${rule.id}`)
    ? RULE_WORDING[`${rule.source}/${rule.id}`]
    : undefined;
  if (entry === undefined) return undefined;
  const words = kind === "advice" && entry.advice !== undefined ? entry.advice : entry;
  return { title: words.title, plain: words.plain, fix: words.fix };
}

/** "1.4.3 Contrast (Minimum): text must stand out from its background", or "1.4.3" alone when it has no entry. */
export function criterionInWords(criterion: string): string {
  const entry = Object.hasOwn(CRITERION_WORDING, criterion) ? CRITERION_WORDING[criterion] : undefined;
  return entry === undefined ? criterion : `${criterion} ${entry.name}: ${entry.plain}`;
}
