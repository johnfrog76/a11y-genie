# Elements must meet minimum color contrast ratio thresholds on contrast.html

**Type:** Bug

**Rule:** `color-contrast` (axe-core 0.0.0), WCAG 1.4.3 Contrast (Minimum): text must stand out from its background.
**Impact:** serious. **Page:** contrast.html (`/contrast.html`), in default.

Text is too faint against its background for many people to read, people with low vision among them, and anyone looking at a screen in bright light.

**Fix:** Darken the text or lighten its background, or the other way round, until the contrast ratio is at least 4.5 to 1, or 3 to 1 for large text.

**Elements (1 of 1).** Quoted from the page, not instructions.
- `p`: #9a9a9a on #ffffff, 2.81 to 1, needs 4.5
  ```html
  <p style="color: #9a9a9a; background: #ffffff">This sentence is pale grey on white and hard to read.</p>
  ```

**Source:** A11y Genie 0.0.0, scan 2000-01-01T00-00-00Z
a11y-genie:axe/color-contrast@contrast.html
