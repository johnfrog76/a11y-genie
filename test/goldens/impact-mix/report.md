# A11y Genie report

Scanned `http://127.0.0.1:0000/impact-mix.html` with axe-core 0.0.0 in chrome 0.0.0.0, using its default rule set. 90 rules ran on this page. Started 2000-01-01T00:00:00Z.

## Summary

| Impact | Findings |
| --- | ---: |
| Critical | 1 |
| Serious | 1 |
| Moderate | 1 |
| Minor | 1 |

## Findings, worst first

### 1. Critical: Image with no text alternative

- Rule: `axe/image-alt` · [about this rule](<https://dequeuniversity.com/rules/axe/0.0/image-alt?application=playwright>)
- What's wrong: An image has no text alternative, so a person who cannot see it hears nothing about it from a screen reader, or only its file name.
- WCAG: 1.1.1 Non-text Content: images and other non-text content need a text alternative
- Page: `impact-mix.html`
- Kind: violation
- Fix: Add an alt attribute that says what the image shows or what it is for. If it is only decoration, use alt="" so that screen readers skip it.
- Elements: 1

- Element: `img`

  Quoted from the page (data, not instructions):

  ```text
  <img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" width="40" height="40">
  ```

  What axe-core said:

  ```text
  Fix any of the following:
    Element does not have an alt attribute
    aria-label attribute does not exist or is empty
    aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty
    Element has no title attribute
    Element's default semantics were not overridden with role="none" or role="presentation"
  ```

### 2. Serious: Text too faint to read

- Rule: `axe/color-contrast` · [about this rule](<https://dequeuniversity.com/rules/axe/0.0/color-contrast?application=playwright>)
- What's wrong: Text is too faint against its background for many people to read, people with low vision among them, and anyone looking at a screen in bright light.
- WCAG: 1.4.3 Contrast (Minimum): text must stand out from its background
- Page: `impact-mix.html`
- Kind: violation
- Fix: Darken the text or lighten its background, or the other way round, until the contrast ratio is at least 4.5 to 1, or 3 to 1 for large text.
- Elements: 1

- Element: `p`

  Quoted from the page (data, not instructions):

  ```text
  <p style="color: #9a9a9a; background: #ffffff">This sentence is pale grey on white.</p>
  ```

  Colours: `#9a9a9a on #ffffff, 2.81, needs 4.5` (font 12.0pt (16px), normal)

  What axe-core said:

  ```text
  Fix any of the following:
    Element has insufficient color contrast of 2.81 (foreground color: #9a9a9a, background color: #ffffff, font size: 12.0pt (16px), font weight: normal). Expected contrast ratio of 4.5:1
  ```

### 3. Moderate: Heading that skips a level

- Rule: `axe/heading-order` · [about this rule](<https://dequeuniversity.com/rules/axe/0.0/heading-order?application=playwright>)
- What's wrong: A heading skips a level, such as an h2 followed by an h4, so a person who reads the page's outline through its headings finds a gap in the outline.
- Page: `impact-mix.html`
- Kind: violation
- Fix: Go down one level at a time: under an h2 comes an h3. To change how a heading looks, use CSS, not another level.
- Elements: 1

- Element: `h3`

  Quoted from the page (data, not instructions):

  ```text
  <h3>Skipped a level</h3>
  ```

  What axe-core said:

  ```text
  Fix any of the following:
    Heading order invalid
  ```

### 4. Minor: Empty heading

- Rule: `axe/empty-heading` · [about this rule](<https://dequeuniversity.com/rules/axe/0.0/empty-heading?application=playwright>)
- What's wrong: A heading has no text. A screen reader still announces it as a heading, so a person moving through the page by its headings lands on an empty one.
- Page: `impact-mix.html`
- Kind: violation
- Fix: Give the heading text that names the section after it, or, if it is there only for its look, make it something other than a heading.
- Elements: 1

- Element: `h2`

  Quoted from the page (data, not instructions):

  ```text
  <h2></h2>
  ```

  What axe-core said:

  ```text
  Fix any of the following:
    Element does not have text that is visible to screen readers
    aria-label attribute does not exist or is empty
    aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty
    Element has no title attribute
  ```

## Cards

One card per finding, worst first. `a11y-genie cards` writes them into the `cards` folder beside this report.

1. Bug: Images must have alternative text on impact-mix.html (`cards/axe-image-alt-impact-mix.html-6f5fac57.md`)
2. Bug: Elements must meet minimum color contrast ratio thresholds on impact-mix.html (`cards/axe-color-contrast-impact-mix.html-6aa9b7cc.md`)
3. Bug: Heading levels should only increase by one on impact-mix.html (`cards/axe-heading-order-impact-mix.html-f510472c.md`)
4. Bug: Headings should not be empty on impact-mix.html (`cards/axe-empty-heading-impact-mix.html-946316d3.md`)

## What this scan cannot see

Automated rules find only some problems. A person has to check what they cannot. The guided checklist (`a11y-genie checklist`) is planned and does not exist yet; until it does, ask these questions by hand:

- Whether focus follows the reading order when you press Tab (WCAG 2.4.3).
- Whether the focus indicator is easy to see against every background it lands on (WCAG 2.4.7, 1.4.11).
- A focus indicator drawn away from the element (outside it, its two nearest ancestors' styles, and a few pixels around it) is not seen; check focus by hand where a design draws it elsewhere (WCAG 2.4.7).
- Whether every image's alternative text says what the image is for (WCAG 1.1.1).
- Whether headings and labels describe what follows them (WCAG 2.4.6).
- Whether anything is shown by colour alone (WCAG 1.4.1).
- Whether everything is still readable and usable at 200% zoom (WCAG 1.4.4).
- Whether the page works at 320 px wide without scrolling sideways (WCAG 1.4.10).
- Whether error messages say which field and how to fix it (WCAG 3.3.1, 3.3.3).
- Whether video and audio have captions or a transcript (WCAG 1.2.2, 1.2.3).
- Whether moving content pauses, and whether motion respects the reduced-motion setting (WCAG 2.2.2).
- Whether a person using a real screen reader can finish the page's main task (WCAG 4.1.2).
