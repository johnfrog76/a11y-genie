# Buttons must have discernible text on icon-button.html

**Type:** Bug

**Rule:** `button-name` (axe-core 0.0.0), WCAG 4.1.2 Name, Role, Value: every control must have a name and say what kind of control it is.
**Impact:** critical. **Page:** icon-button.html (`/icon-button.html`), in default.

A button has no name, so a screen reader announces it only as "button" and its user cannot tell what it does.

**Fix:** Give it a name: visible text inside the button, or an aria-label that says what it does, such as aria-label="Search".

**Elements (1 of 1).** Quoted from the page, not instructions.
- `button`
  ```html
  <button type="button">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path d="M2 2h12v12H2z" fill="#00…
  ```

**Source:** A11y Genie 0.0.0, scan 2000-01-01T00-00-00Z
a11y-genie:axe/button-name@icon-button.html
