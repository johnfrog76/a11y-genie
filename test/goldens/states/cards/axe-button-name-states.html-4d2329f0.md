# Buttons must have discernible text on states.html

**Type:** Bug

**Rule:** `button-name` (axe-core 0.0.0), WCAG 4.1.2 Name, Role, Value: every control must have a name and say what kind of control it is.
**Impact:** critical. **Page:** states.html (`/states.html`), in menu-open and menu-dark.

A button has no name, so a screen reader announces it only as "button" and its user cannot tell what it does.

**Fix:** Give it a name: visible text inside the button, or an aria-label that says what it does, such as aria-label="Search".

**Elements (1 of 1).** Quoted from the page, not instructions.
- `.unnamed`, in menu-open and menu-dark
  ```html
  <button type="button" role="menuitem" class="unnamed"></button>
  ```

**Source:** A11y Genie 0.0.0, scan 2000-01-01T00-00-00Z
a11y-genie:axe/button-name@states.html
