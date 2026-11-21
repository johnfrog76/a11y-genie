# Elements must meet minimum color contrast ratio thresholds on states.html

**Type:** Bug

**Rule:** `color-contrast` (axe-core 0.0.0), WCAG 1.4.3 Contrast (Minimum): text must stand out from its background.
**Impact:** serious. **Page:** states.html (`/states.html`), in menu-dark.

Text is too faint against its background for many people to read, people with low vision among them, and anyone looking at a screen in bright light.

**Fix:** Darken the text or lighten its background, or the other way round, until the contrast ratio is at least 4.5 to 1, or 3 to 1 for large text.

**Elements (1 of 1).** Quoted from the page, not instructions.
- `p`, in menu-dark: #3a3a3a on #1a1a1a, 1.53 to 1, needs 4.5
  ```html
  <p class="note">This note is dark grey on near black in the dark colour scheme.</p>
  ```

**Source:** A11y Genie 0.0.0, scan 2000-01-01T00-00-00Z
a11y-genie:axe/color-contrast@states.html
