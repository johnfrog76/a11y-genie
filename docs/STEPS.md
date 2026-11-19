# Steps

A step is one thing done to a page: press a key, move focus to an element, click, type, wait, or set the page's
media. The same steps are written in three places:

- `--states "<name>: <steps>"`, a state of a page beside the default one, such as a menu opened or dark mode;
- `--flow "<steps>"`, the task `narrate` drives through the keyboard;
- a config file's `states[].steps` and `workflows[].steps`, one step per string.

So a flow tried on the command line pastes into a config file unchanged:

```sh
a11y-genie scan http://localhost:5173 --states "menu-open: click button 'Menu'; wait menu" --states "dark: colorScheme dark"
a11y-genie narrate http://localhost:5173/settings --flow "Tab to combobox 'Time zone'; ArrowDown; Tab; Enter"
```

```yaml
states:
  - name: menu-open
    steps: ["click button 'Menu'", "wait menu"]
workflows:
  - name: change-time-zone
    page: settings
    steps: ["Tab to combobox 'Time zone'", "ArrowDown", "Tab to button 'Save'", "Enter"]
```

The parser is `src/steps.ts`, and `test/unit/steps.test.ts` has a row for every form and every error below.
The command does not read steps yet: `--states` and `--config` arrive with M3's next slice, `--flow` with M9.

## The steps

| Step | Example | Does |
| --- | --- | --- |
| a key | `Tab`, `Shift+Tab`, `Enter`, `Space`, `Escape`, `ArrowDown`, `Control+a` | presses it |
| `Tab to <role> '<name>'` | `Tab to combobox 'Time zone'` | presses Tab until focus is on that element; gives up after `--max-tabs` |
| `click <role> '<name>'` | `click button 'Menu'` | clicks it |
| `type '<text>'` | `type 'Ada Lovelace'` | types the text into the focused element |
| `wait <role>`, or `wait <role> '<name>'` | `wait menu`, `wait dialog 'Delete account'` | waits for it to be visible |
| `colorScheme light` or `colorScheme dark` | `colorScheme dark` | sets the page's colour scheme (states only) |
| `viewport <width>x<height>` | `viewport 390x844` | sets the viewport, in CSS pixels, each from 1 to 10000 (states only) |
| `reducedMotion` | `reducedMotion` | asks the page to reduce motion (states only) |

Steps are separated by `;` and run in the order written. A state's steps run after a fresh load of the page, so
states never leak into each other.

### Keys

A key is any name Playwright's `keyboard.press()` takes: a named key such as `Tab`, `Enter`, `Escape`, `Space`,
`Backspace`, `Delete`, `Home`, `End`, `PageDown`, `ArrowUp`, `F6` or `KeyA`, or one character such as `a`, `A`,
`1` or `?`. Names are written exactly as Playwright writes them: `Enter`, not `enter`. `src/keys.ts` has the
whole list, held by a test to the installed playwright-core.

A combination holds modifiers down while the last key is pressed: `Shift+Tab`, `Control+a`, `Control+Alt+Delete`.
Only `Shift`, `Control`, `Alt`, `Meta` and `ControlOrMeta` (Meta on macOS, Control elsewhere) come before a `+`.
A `+` at the start of a part is the `+` key itself, as in Playwright: `+` and `Shift++` press it.

Four characters mean something else in a step, so their keys are written by name: the space is `Space`, `;` is
`Semicolon`, `'` is `Quote`, and a new line is `Enter`.

### Elements

`Tab to`, `click` and `wait` name an element in one of two ways:

- **By role and accessible name**, the way a screen reader names it: `button 'Menu'`, `combobox 'Time zone'`,
  `link 'Sign in'`. The role is an ARIA role, in lower case, from the list Playwright's `getByRole()` takes
  (`button`, `link`, `textbox`, `combobox`, `checkbox`, `menu`, `menuitem`, `dialog`, `tab` and the rest). The
  name is the element's accessible name, in quotes. `Tab to` and `click` need the name; `wait` may leave it out,
  as in `wait menu`.
- **By CSS selector**, where an element has no role and name to find it by: `css '#menu-toggle'`,
  `css 'nav > ul > li:first-child'`. One CSS selector, in quotes.

Name an element by role and name where you can, so the steps read like the page. A role and name that do not
match what a screen reader would say is itself worth knowing.

### The media steps

`colorScheme`, `viewport` and `reducedMotion` change the media the page is shown in, so they belong to a state, not
to a flow, and a flow refuses them. They run in order like any other step; put them first in a state so the
page's other steps run in that media.

## Quoting

- Names, text and selectors go in straight single quotes: `'Menu'`.
- A `'` inside them is written twice: `click button 'Don''t save'` clicks the button named *Don't save*.
- Nothing else is special inside quotes. `;`, `:`, `"` and `\` are ordinary characters, so a selector keeps its
  own quotes and escapes: `css 'input[name="email"]'`, `css '#a\:b'`.
- A name or text is one line of plain text: it cannot hold a tab, a new line or any other control character. To
  press Enter or Tab, make that a step of its own.
- Outside quotes, spaces and tabs separate words, and any number of them is the same as one. Space around a `;`
  does not matter. Words are case-sensitive: `click`, not `Click`.
- In a shell, put the whole value in double quotes, so the single quotes inside reach A11y Genie as they are:
  `--flow "click button 'Menu'; Tab"`. In a YAML file, put each step in double quotes for the same reason.

## State names

`--states "<name>: <steps>"` starts with the state's name and a `:`. A name is lower-case letters, digits, `-` and
`_`, starts with a letter or a digit, and is at most 64 characters: `menu-open`, `dark`, `delete-dialog`. It
cannot be `default`, the state every page is scanned in first. A config file's state names follow the same rule.

## Steps as data

Steps are read, never run as code. Nothing in a step is passed to `eval`, run as JavaScript, or handed to the
browser as a selector string it did not come from:

- a role must be one of the roles `getByRole()` takes, so a step can only ever ask for an element by role;
- a name or text is kept exactly as written and passed as data, whatever it looks like (`'); alert(1); ('` is a
  name like any other);
- a CSS selector may not hold `>>`, which Playwright reads as a chain into another kind of selector (XPath, text,
  or its own engines), so a `css '...'` step stays one CSS selector.

## Errors

A step that does not parse is a refusal: exit 2, nothing scanned or written, and two lines on stderr. The `Error:`
line says where the steps came from, the step's number, the step itself, and the column where the problem starts;
the `Hint:` line says what was expected. Columns count characters from the start of the whole value, from 1, so
`--flow "Tab; clik"` points at column 6. A config step, one per string, has no step number: the config's own
refusal names the file and line.

```text
Error: --flow step 2 "clik button 'Menu'", column 6: "clik" is not a step.
Hint: a step is a key (Tab, Shift+Tab, Enter, Space, Escape, ArrowDown), Tab to, click, type, wait, colorScheme, viewport or reducedMotion.
```

A step that parses but fails on the page, such as a button that is not there, is not a refusal: that state or flow
reads *not scanned* with why, the run goes on, and the exit is 1.

Every error, with an example of what causes it:

| Refused | Example | The problem, as the `Error:` line ends |
| --- | --- | --- |
| no steps at all | `--flow ""`, `--states "dark:"` | `there are no steps.`, `the state has no steps after its name.` |
| an empty step | `Tab;;Enter`, `Tab;` | `the step is empty.` |
| a `;` in a config step | `"Tab; Enter"` in a config | `a config step is one step, and this one has a ";" in it.` |
| a quote never closed | `click button 'Menu` | `this quote is never closed.` |
| a control character in quotes | a tab or a new line inside `'...'` | `a quoted name or text cannot hold a control character, and this one holds U+0009.` |
| a word that is not a step | `clik`, `enter`, `Click` | `"enter" is not a step. Did you mean Enter?` |
| a quoted string where a step should start | `'Menu'` | `a step starts with a word, not with "'Menu'".` |
| a key that is not a key | `shift+tab`, `Shift+Tabb`, `a+b`, `Shift+` | `"shift+tab" is not a key. Did you mean Shift+Tab?` |
| more after a complete step | `Tab Enter`, `click button 'Menu' wait menu` | `"Enter" is more than the step takes; the step "Tab" ends before it.` |
| no element | `click`, `Tab to` | `click needs an element after it.` |
| a name with no role | `click 'Menu'` | `click needs a role before the name, such as click button 'Menu'.` |
| a role that is not an ARIA role | `click buton 'Menu'`, `wait Dialog` | `"Dialog" is not an ARIA role. Did you mean dialog?` |
| no name where one is needed | `click button`, `Tab to combobox` | `click button needs the element's name after the role, in quotes.` |
| no text to type | `type` | `type needs the text to type after it, in quotes.` |
| no selector | `click css` | `css needs a selector after it, in quotes.` |
| a name, text or selector not in quotes | `click button Save`, `type Ada`, `click css #menu` | `"Save" must be in quotes.` |
| the wrong quotes | `click button "Save"`, `click button ‘Save’` | `names, text and selectors go in straight single quotes ('), and this one starts with ".` |
| an empty name, text or selector | `click button ''`, `type ''`, `click css ''` | `the name is empty.` |
| `>>` in a selector | `click css 'nav >> text=Menu'` | `a selector cannot hold ">>", which Playwright reads as a chain into another kind of selector.` |
| a colour scheme that is not light or dark | `colorScheme blue`, `colorScheme Dark` | `colorScheme takes light or dark, not "blue".` |
| a viewport that is not `<w>x<h>` from 1 to 10000 | `viewport 1280`, `viewport 0x800`, `viewport 1280X800` | `viewport takes a width and a height in CSS pixels, from 1 to 10000, not "1280".` |
| a media step in a flow | `--flow "colorScheme dark"` | `colorScheme sets a state's media, and a flow has no media.` |
| a state with no `:` after its name | `--states "click button 'Menu'"` | `--states needs a state name and a ":" before the steps.` |
| a state with no name | `--states ": Tab"` | `the state has no name before the ":".` |
| a state name that breaks the rule | `--states "Menu Open: Tab"` | `"Menu Open" is not a state name: a name is lower-case letters, digits, "-" and "_", up to 64 characters, starting with a letter or a digit.` |
| a state called `default` | `--states "default: Tab"` | `the state cannot be called "default": that is the state every page is scanned in first.` |

The person's text in an `Error:` line is made safe to print first (no terminal escapes or control characters, as
everywhere else the command prints) and cut short past 60 characters.

## Choices the spec left open

The spec (section 4.1) gives the steps but not every rule around them. Where it was silent, the simplest reading
was taken:

- **Escaping.** A `'` inside quotes is written twice (`'Don''t'`), and there is no backslash escape, so a CSS
  selector's own backslashes and a Windows path pass through unchanged, and the same step works in a shell and in
  YAML.
- **Only straight single quotes.** Double and curly quotes are refused with a hint, not read as quotes.
- **An empty step is an error,** a trailing `;` included, rather than ignored.
- **One step per config string.** A `;` in a config step is refused, since the config gives each step its own
  string.
- **`css '<selector>'` names an element anywhere one is named:** in `Tab to` and `wait` as well as in `click`,
  following the config section's "by CSS selector where it cannot".
- **The name is needed in `Tab to` and `click`,** and may be left out only in `wait`, as the spec's table writes
  them.
- **The media steps run in order,** where they are written, like every other step; only a flow refuses them. A
  state may set them more than once, and the last one holds.
- **`click` and `type` are allowed in a flow.** Only the media steps are marked "states only".
- **Modifiers.** Only `Shift`, `Control`, `Alt`, `Meta` and `ControlOrMeta` come before a `+`.
- **The characters `;`, `'`, the space and the new line** are written by name (`Semicolon`, `Quote`, `Space`,
  `Enter`), since they mean something else in a step.
- **State names** are lower case, digits, `-` and `_`, up to 64 characters, and never `default`: they name files
  and finding entries, and a name that differs from another only in case would collide on some file systems.
- **A viewport is from 1 to 10000 pixels each way.**
- **What a name matches** (the whole accessible name, or part of it) is for the code that drives the page to
  decide, with `--states`; the parser only carries the name.
