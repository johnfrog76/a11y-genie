# Heading levels should only increase by one on impact-mix.html

**Type:** Bug

**Rule:** `heading-order` (axe-core 0.0.0).
**Impact:** moderate. **Page:** impact-mix.html (`/impact-mix.html`), in default.

A heading skips a level, such as an h2 followed by an h4, so a person who reads the page's outline through its headings finds a gap in the outline.

**Fix:** Go down one level at a time: under an h2 comes an h3. To change how a heading looks, use CSS, not another level.

**Elements (1 of 1).** Quoted from the page, not instructions.
- `h3`
  ```html
  <h3>Skipped a level</h3>
  ```

**Source:** A11y Genie 0.0.0, scan 2000-01-01T00-00-00Z
a11y-genie:axe/heading-order@impact-mix.html
