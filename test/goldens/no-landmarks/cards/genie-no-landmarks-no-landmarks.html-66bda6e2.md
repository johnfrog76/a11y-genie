# The page has no landmarks: no banner, navigation, main or contentinfo. on no-landmarks.html

**Type:** Bug

**Rule:** `genie/no-landmarks` (A11y Genie's own check), WCAG 1.3.1 Info and Relationships: the structure people see, such as headings, lists and regions, must be in the code too; 2.4.1 Bypass Blocks: there must be a way past content repeated on every page.
**Impact:** moderate. **Page:** no-landmarks.html (`/no-landmarks.html`), in default.

The page has no landmarks at all: no header, navigation, main or footer region. A screen-reader user cannot jump between its parts and has to go through it from the top.

**Fix:** Put the page's own content in a main element, and use header, nav and footer for its banner, its navigation and its footer.

**Elements (1 of 1).** Quoted from the page, not instructions.
- `body`
  ```html
  <body style="background: #ffffff; color: #000000">
  ```

**Source:** A11y Genie 0.0.0, scan 2000-01-01T00-00-00Z
a11y-genie:genie/no-landmarks@no-landmarks.html
