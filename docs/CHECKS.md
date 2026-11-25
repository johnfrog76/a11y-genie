# The checks

Every check a scan runs: axe-core's rules, and A11y Genie's own `genie/` rules. For each of the own rules, this
page says what it finds, what it does not, and what it sends to *needs review* instead of reporting as a finding.

A scan finds some problems, not all of them. A scan with no findings has checked only what is on this page, and
the last section says what it cannot see.

The deep detail, with the measurements the numbers were tuned on, is in [ARCHITECTURE.md](ARCHITECTURE.md). The
fields of a finding are in [JSON.md](JSON.md).

## Findings, advice and *needs review*

- A **finding** is a violation: a check decided that something is wrong. It has an impact (critical, serious,
  moderate or minor), and it can make the exit 1 (see `--fail-on` in [CLI.md](CLI.md)).
- **Advice** is a smaller kind of finding that never changes the exit.
- ***Needs review*** is something a check could not decide, so a person looks. It is listed, counted, and never
  changes the exit. Each item says why it could not be decided, and what to do.

## axe-core's rules

A11y Genie runs [axe-core](https://github.com/dequelabs/axe-core) on every page, in every state, at the exact
version it pins. The version is in every `scan.json` (`engine.axeCore`) and at the top of `a11y-genie rules`.

- **By default**, axe-core's default rule set runs. Nothing is turned on or off by hand. The landmark rules
  (`region`, `landmark-one-main` and the others) are in it.
- **With `--tags <list>`**, exactly those axe-core tags run, and a rule with none of them does not. The tags go
  in as given: `wcag2a` alone does not also run `wcag2aa`. An unknown tag is a refusal that gives examples of tags that work.
  The landmark rules, and `genie/no-landmarks` and `genie/skip-link` that sum them up, carry `best-practice`, so
  a list without it runs none of them. A `--tags` list also leaves out an own rule that has none of the list's
  tags.
- **`a11y-genie rules`** lists every rule that can run, axe-core's and A11y Genie's own, each with its impact,
  its WCAG criteria and its tags, under the version it pins. `a11y-genie rules --tags wcag2aa` lists the ones a
  `--tags wcag2aa` run would use. It needs no browser.
- **Findings** from axe-core are named `axe/<rule id>`, such as `axe/color-contrast`.
- ***Needs review*** from axe-core is its `incomplete` results: things it could not decide, such as text over a
  gradient, where it cannot measure the contrast. They are listed with axe-core's own reason. They never change
  the exit, and they are not findings.

A11y Genie writes each finding's plain words and fix itself (`src/plain.ts`), by rule. The WCAG criteria are the
ones axe-core's tags carry.

## A11y Genie's own rules

axe-core has no rule for any of these. Seven rules are registered today, and `a11y-genie rules` lists them:

| Rule | Impact | WCAG | Runs under |
| --- | --- | --- | --- |
| `genie/click-on-non-control` | serious | 2.1.1, 4.1.2 | the default set, or `cat.keyboard`, `wcag2a`, `wcag211`, `wcag412` |
| `genie/focus-not-returned` | moderate | 2.4.3 | the default set, or `cat.keyboard`, `wcag2a`, `wcag243` |
| `genie/focus-visible` | serious | 2.4.7 | the default set, or `cat.keyboard`, `wcag2aa`, `wcag247` |
| `genie/keyboard-trap` | critical | 2.1.2 | the default set, or `cat.keyboard`, `wcag2a`, `wcag212` |
| `genie/no-landmarks` | moderate | 1.3.1, 2.4.1 | the default set, or `best-practice` |
| `genie/skip-link` | moderate (minor as advice) | 2.4.1 | the default set, or `best-practice` |
| `genie/unnamed-step` | serious | 4.1.2 | `narrate`, or a config's `workflows`, whatever `--tags` says |

"Runs under" is what a `--tags` list needs to include for the rule to run: any one of the tags named. Page text
in every finding is data: it is quoted, cut and never run.

### `genie/no-landmarks`

- **Finds:** a page with no landmark at all: no banner, navigation, main or contentinfo. It says so once for the
  page, where axe-core would report every element outside a landmark one at a time. It reads the accessibility
  roles, not the tag names, so `<div role="main">` counts, and a `header` inside an `article` is not a banner.
- **Does not find:** a page that has some landmarks but the wrong ones, or two of one kind. axe-core's own
  landmark rules cover those. It does not read inside a frame.
- **Needs review:** nothing. It is a finding or it is silent.
- **The fix:** put the page's own content in a `main` element, and use `header`, `nav` and `footer` for its
  banner, its navigation and its footer, so a person using a screen reader can jump between them.

### `genie/click-on-non-control`

- **Finds:** an element that does something on a click, but is not a control: not a link, button, input, select,
  textarea, summary, label or option, has no widget role, and cannot take focus. A keyboard cannot reach it and a
  screen reader does not say it can be pressed. It counts a click handler of the element's own: an `onclick`
  attribute, or a `click` listener on the element itself.
- **Does not find:** a click handled further up the page. A framework often attaches one listener at the root,
  and from the element alone that cannot be told from a pointer cursor that does nothing. It reads only the
  page's own document: not its frames, and not inside shadow roots.
- **Needs review:** an element that looks clickable (its cursor is a pointer), has no role, cannot take focus,
  and has no click handler of its own. Also the elements past the check's caps: a scan asks for the listeners of
  at most 2000 such elements and lists at most 5000 candidates, and says so for the rest.
- **The fix:** make it a `button` element with the same handler and the same text, or a link if it goes to
  another page.

### `genie/skip-link`

- **Finds:** a page whose first three Tab stops give no way past the repeated content. A skip link is a link to
  `#id` whose target exists and is the page's `main` or inside it. With none, it is **advice** (minor) when the
  page has a landmark or a heading, since a screen-reader user can jump past the navigation, and a **violation**
  (moderate, WCAG 2.4.1) when the page has neither.
- **Does not find:** whether the skip link shows itself when it gets focus, or whether its target takes focus.
  A page with fewer than five tabbable elements before its main content is not checked, since it has little to
  skip. A skip link inside a frame does not count.
- **Needs review:** nothing.
- **The fix:** make the first thing on the page a link to the main content, such as `href="#main"` with
  `id="main"` on the `main` element, shown when it gets focus.

### `genie/keyboard-trap`

- **Finds:** keyboard focus that moves into part of the page, where Tab, Shift+Tab and Escape cannot move it out.
  It reads the keyboard walk (below). Where the walk goes round a set of elements, it tries Shift+Tab, then
  Escape, then Tab, from the set. If none of them puts focus outside the set, the set's elements are the finding.
- **Does not find:** a modal dialog that holds focus on purpose: every element of the set is inside one visible
  `role="dialog"` or `role="alertdialog"` with `aria-modal="true"`, and Escape closes it. A native `<dialog>`
  opened with `showModal()` is not checked at all, because Chrome hands Tab out of it to the browser's own
  controls; the scan says so under *What this scan cannot see*. Nothing inside a frame of another origin can be
  read.
- **Needs review:** nothing. A trap is a finding or it is not reported.
- **The fix:** let Tab move on past the last element of that part, and Shift+Tab back past the first. If it is a
  dialog that holds focus on purpose, give it `role="dialog"` and `aria-modal="true"`, and close it on Escape.

### `genie/focus-not-returned`

- **Finds:** a modal dialog that Escape closes, after which focus is on no element, or is on another element
  when exactly one element outside the dialog names it in `aria-controls`, which makes that element its opener.
- **Does not find:** where focus should have gone, when the opener cannot be known. With no such element, focus
  on any element outside the dialog counts as returned, because the check does not guess.
- **Needs review:** nothing.
- **The fix:** when the dialog closes, move focus back to the control that opened it: keep a reference to that
  control when the dialog opens, and call its `focus()` method when it closes.

### `genie/focus-visible`

- **Finds:** an element the Tab key moves focus to, where nothing about it changes on screen. For each stop of the
  keyboard walk, it compares the element focused and unfocused, in its own styles and its two nearest ancestors',
  and in a screenshot of the element with a few pixels around it. It also compares the element focused with the
  window as it was just before the Tab press, so a ring the page's own scripts draw when focus arrives (as Fluent UI
  does) is seen. The screenshots stay in memory and are never written. It reports only when no pixel changed and
  none of the styles did.
- **Does not find:** whether the focus indicator is easy to see against its background (WCAG 2.4.7 and 1.4.11). A
  change that is there but faint is not a finding. An indicator drawn somewhere else, such as a highlight on
  another element, is not seen. A ring the page's own scripts draw when focus arrives, on an element the Tab press
  scrolls into view, is not seen either, and can be reported as no change. It looks at the first 100 stops of each
  walk, and at nothing inside a frame of another origin.
- **Needs review:** an element whose focus changes too faintly to be sure of, or that changed a few pixels with
  no style behind them; an element it could not photograph, such as one outside the window; the stops past the
  cap; and any stop where the page's own listeners may have heard the check take focus off it.
- **The fix:** give it a focus style that can be seen. Do not remove the outline with `outline: none` unless
  something takes its place, such as an outline or a `box-shadow` ring in `:focus-visible`. If the page shows
  focus somewhere else, check it by hand.

### `genie/unnamed-step`

- **Finds:** a step of a narrated flow (`a11y-genie narrate`, or a config's `workflows`) that puts keyboard focus
  on a control that has a role and no accessible name, so a screen reader says only what it is, such as
  "button". It is one finding for the page, with an element for each control reached.
- **Does not find:** anything on a page that no flow reached. It checks the controls a flow stops on, not the
  page. axe-core's own name rules cover the page as a whole.
- **Needs review:** nothing.
- **The fix:** give the control a name: visible text inside it, or an `aria-label` that says what it does, such
  as `aria-label="Close"`.

## The keyboard walk

The walk presses Tab from the top of the page, up to `--max-tabs` times (default 200), and records where focus
lands after each press. It is not a rule and makes no finding. `genie/skip-link`, `genie/keyboard-trap`,
`genie/focus-not-returned` and `genie/focus-visible` read the same record, and it is kept in `scan.json`
(`pages[].walks`). It runs in every state that is scanned, whatever `--tags` says, and each state's walk is kept
apart, since a trap may exist in one state only. It ends when focus leaves the page, comes back to its first
stop, goes round a set of stops, or reaches `--max-tabs`; a walk cut by the limit is recorded as cut, and the
page may have more stops. It reads the page in an isolated world, so a page that replaces DOM methods cannot
steer it. [ARCHITECTURE.md](ARCHITECTURE.md) (*The keyboard walk*) has the detail.

## What a scan cannot see

Every `report.md` ends with this list, and `scan.json` holds it as `cannotSee`. Automated rules find only some
problems, and a person has to check what they cannot:

- Whether focus follows the reading order when you press Tab (WCAG 2.4.3).
- Whether the focus indicator is easy to see against every background it lands on (WCAG 2.4.7, 1.4.11).
- A focus indicator drawn away from the element (outside it, its two nearest ancestors' styles, and a few pixels
  around it) is not seen; check focus by hand where a design draws it elsewhere (WCAG 2.4.7).
- Whether every image's alternative text says what the image is for (WCAG 1.1.1).
- Whether headings and labels describe what follows them (WCAG 2.4.6).
- Whether anything is shown by colour alone (WCAG 1.4.1).
- Whether everything is still readable and usable at 200% zoom (WCAG 1.4.4).
- Whether the page works at 320 px wide without scrolling sideways (WCAG 1.4.10).
- Whether error messages say which field and how to fix it (WCAG 3.3.1, 3.3.3).
- Whether video and audio have captions or a transcript (WCAG 1.2.2, 1.2.3).
- Whether moving content pauses, and whether motion respects the reduced-motion setting (WCAG 2.2.2).
- Whether a person using a real screen reader can finish the page's main task (WCAG 4.1.2).

A scan adds a line to this list for a native modal dialog that was open, since the keyboard checks cannot walk
inside one. A page it did not scan, or a state that failed to load, is named in the report as *not scanned*, and
the exit is 1.

A scan also describes a page as the page presents itself. [KNOWN-GAPS.md](KNOWN-GAPS.md) lists the limits of
the tool itself.
