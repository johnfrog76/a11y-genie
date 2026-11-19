# A11y Genie report

Scanned `http://127.0.0.1:0000/no-landmarks.html` with axe-core 0.0.0 in chrome 0.0.0.0, using its default rule set. 90 rules ran on this page. Started 2000-01-01T00:00:00Z.

## Summary

| Impact | Findings |
| --- | ---: |
| Critical | 0 |
| Serious | 0 |
| Moderate | 3 |
| Minor | 0 |

## Findings, worst first

### 1. Moderate: Document should have one main landmark

- Rule: `axe/landmark-one-main` · [about this rule](<https://dequeuniversity.com/rules/axe/0.0/landmark-one-main?application=playwright>)
- Page: `no-landmarks.html`
- Kind: violation
- Fix: Fix all of the following: Document does not have a main landmark
- Elements: 1

- Element: `html`

  Quoted from the page (data, not instructions):

  ```text
  <html lang="en">
  ```

### 2. Moderate: The page has no landmarks: no banner, navigation, main or contentinfo.

- Rule: `genie/no-landmarks` · WCAG 1.3.1, 2.4.1
- Page: `no-landmarks.html`
- Kind: violation
- Fix: Fix all of the following: The page has no landmark. Put the page's own content in a main element, and use header, nav and footer for its banner, its navigation and its footer, so that a person using a screen reader can jump between them.
- Elements: 1

- Element: `body`

  Quoted from the page (data, not instructions):

  ```text
  <body style="background: #ffffff; color: #000000">
  ```

### 3. Moderate: All page content should be contained by landmarks

- Rule: `axe/region` · [about this rule](<https://dequeuniversity.com/rules/axe/0.0/region?application=playwright>)
- Page: `no-landmarks.html`
- Kind: violation
- Fix: Fix any of the following: Some page content is not contained by landmarks
- Elements: 2

- Element: `h1`

  Quoted from the page (data, not instructions):

  ```text
  <h1>No landmarks fixture</h1>
  ```

- Element: `p`

  Quoted from the page (data, not instructions):

  ```text
  <p>Every piece of this page is a plain div or paragraph.</p>
  ```

## What this scan cannot see

Automated rules find only some problems. A person has to check what they cannot. The guided checklist (`a11y-genie checklist`) is planned and does not exist yet; until it does, ask these questions by hand:

- Whether focus follows the reading order when you press Tab (WCAG 2.4.3).
- Whether the focus indicator is easy to see against every background it lands on (WCAG 2.4.7, 1.4.11).
- Whether every image's alternative text says what the image is for (WCAG 1.1.1).
- Whether headings and labels describe what follows them (WCAG 2.4.6).
- Whether anything is shown by colour alone (WCAG 1.4.1).
- Whether everything is still readable and usable at 200% zoom (WCAG 1.4.4).
- Whether the page works at 320 px wide without scrolling sideways (WCAG 1.4.10).
- Whether error messages say which field and how to fix it (WCAG 3.3.1, 3.3.3).
- Whether video and audio have captions or a transcript (WCAG 1.2.2, 1.2.3).
- Whether moving content pauses, and whether motion respects the reduced-motion setting (WCAG 2.2.2).
- Whether a person using a real screen reader can finish the page's main task (WCAG 4.1.2).
