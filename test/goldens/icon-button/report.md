# A11y Genie report

Scanned `http://127.0.0.1:0000/icon-button.html` with axe-core 0.0.0 in chrome 0.0.0.0, using its default rule set. 90 rules ran on this page. Started 2000-01-01T00:00:00Z.

## Summary

| Impact | Findings |
| --- | ---: |
| Critical | 1 |
| Serious | 0 |
| Moderate | 0 |
| Minor | 0 |

## Findings, worst first

### 1. Critical: A button has no name, so a screen reader announces it only as "button" and its user cannot tell what it does.

- Rule: `axe/button-name` · WCAG 4.1.2 · [about this rule](<https://dequeuniversity.com/rules/axe/0.0/button-name?application=playwright>)
- Page: `icon-button.html`
- Kind: violation
- Fix: Give it a name: visible text inside the button, or an aria-label that says what it does, such as aria-label="Search".
- Elements: 1

- Element: `button`

  Quoted from the page (data, not instructions):

  ```text
  <button type="button">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path d="M2 2h12v12H2z" fill="#00…
  ```

  What axe-core said:

  ```text
  Fix any of the following:
    Element does not have inner text that is visible to screen readers
    aria-label attribute does not exist or is empty
    aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty
    Element has no title attribute
    Element does not have an implicit (wrapped) <label>
    Element does not have an explicit <label>
    Element's default semantics were not overridden with role="none" or role="presentation"
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
