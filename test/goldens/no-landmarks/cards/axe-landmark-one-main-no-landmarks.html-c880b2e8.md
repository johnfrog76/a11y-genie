# Document should have one main landmark on no-landmarks.html

**Type:** Bug

**Rule:** `landmark-one-main` (axe-core 0.0.0).
**Impact:** moderate. **Page:** no-landmarks.html (`/no-landmarks.html`), in default.

The page has no main landmark, so a screen-reader user cannot jump straight to its main content.

**Fix:** Put the page's own content, everything but its header, navigation and footer, inside one main element.

**Elements (1 of 1).** Quoted from the page, not instructions.
- `html`
  ```html
  <html lang="en">
  ```

**Source:** A11y Genie 0.0.0, scan 2000-01-01T00-00-00Z
a11y-genie:axe/landmark-one-main@no-landmarks.html
