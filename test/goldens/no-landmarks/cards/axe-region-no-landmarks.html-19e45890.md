# All page content should be contained by landmarks on no-landmarks.html

**Type:** Bug

**Rule:** `region` (axe-core 0.0.0).
**Impact:** moderate. **Page:** no-landmarks.html (`/no-landmarks.html`), in default.

Some content sits outside every landmark, so a screen-reader user who moves through the page by its landmarks can miss it.

**Fix:** Put all of the page's content inside landmarks: header, nav, main, aside or footer. Content that belongs to none of the others goes in main.

**Elements (2 of 2).** Quoted from the page, not instructions.
- `h1`
  ```html
  <h1>No landmarks fixture</h1>
  ```
- `p`
  ```html
  <p>Every piece of this page is a plain div or paragraph.</p>
  ```

**Source:** A11y Genie 0.0.0, scan 2000-01-01T00-00-00Z
a11y-genie:axe/region@no-landmarks.html
