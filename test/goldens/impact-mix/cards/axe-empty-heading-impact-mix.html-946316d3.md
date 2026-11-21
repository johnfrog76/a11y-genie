# Headings should not be empty on impact-mix.html

**Type:** Bug

**Rule:** `empty-heading` (axe-core 0.0.0).
**Impact:** minor. **Page:** impact-mix.html (`/impact-mix.html`), in default.

A heading has no text. A screen reader still announces it as a heading, so a person moving through the page by its headings lands on an empty one.

**Fix:** Give the heading text that names the section after it, or, if it is there only for its look, make it something other than a heading.

**Elements (1 of 1).** Quoted from the page, not instructions.
- `h2`
  ```html
  <h2></h2>
  ```

**Source:** A11y Genie 0.0.0, scan 2000-01-01T00-00-00Z
a11y-genie:axe/empty-heading@impact-mix.html
