# Images must have alternative text on impact-mix.html

**Type:** Bug

**Rule:** `image-alt` (axe-core 0.0.0), WCAG 1.1.1 Non-text Content: images and other non-text content need a text alternative.
**Impact:** critical. **Page:** impact-mix.html (`/impact-mix.html`), in default.

An image has no text alternative, so a person who cannot see it hears nothing about it from a screen reader, or only its file name.

**Fix:** Add an alt attribute that says what the image shows or what it is for. If it is only decoration, use alt="" so that screen readers skip it.

**Elements (1 of 1).** Quoted from the page, not instructions.
- `img`
  ```html
  <img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" width="40" height="40">
  ```

**Source:** A11y Genie 0.0.0, scan 2000-01-01T00-00-00Z
a11y-genie:axe/image-alt@impact-mix.html
