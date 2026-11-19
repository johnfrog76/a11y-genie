# A11y Genie report

Scanned `http://127.0.0.1:0000/contrast.html` with axe-core 0.0.0 in chrome 0.0.0.0, using its default rule set. 90 rules ran on this page. Started 2000-01-01T00:00:00Z.

## Summary

| Impact | Findings |
| --- | ---: |
| Critical | 0 |
| Serious | 1 |
| Moderate | 0 |
| Minor | 0 |

## Findings, worst first

### 1. Serious: Elements must meet minimum color contrast ratio thresholds

- Rule: `axe/color-contrast` · WCAG 1.4.3 · [about this rule](<https://dequeuniversity.com/rules/axe/0.0/color-contrast?application=playwright>)
- Page: `contrast.html`
- Kind: violation
- Fix: Fix any of the following: Element has insufficient color contrast of 2.81 (foreground color: #9a9a9a, background color: #ffffff, font size: 12.0pt (16px), font weight: normal). Expected contrast ratio of 4.5:1
- Elements: 1

- Element: `p`

  Quoted from the page (data, not instructions):

  ```text
  <p style="color: #9a9a9a; background: #ffffff">This sentence is pale grey on white and hard to read.</p>
  ```

  Colours: `#9a9a9a on #ffffff, 2.81, needs 4.5` (font 12.0pt (16px), normal)

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
