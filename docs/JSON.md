# The JSON A11y Genie reads and writes

This document has two parts:

1. **Findings**: the shape A11y Genie gives each finding and each *needs review* item. `scan.json` is built
   from these.
2. **`scan.json`**: the record `a11y-genie scan` and `a11y-genie check` write, which `--json` prints and
   `report.md` is made from. Its JSON Schema is `schema/scan-1.json`.
3. **axe-core's results**: the shape axe-core hands back, at the version A11y Genie pins, as checked
   against a real browser. The findings are filled from it.

## Findings (`src/finding.ts`)

A finding is one rule on one page, with every element the rule hit on that page. A page is a URL.

```json
{
  "id": "axe/color-contrast@impact-mix.html",
  "rule": {
    "source": "axe",
    "id": "color-contrast",
    "help": "Elements must meet minimum color contrast ratio thresholds",
    "helpUrl": "https://dequeuniversity.com/rules/axe/4.14/color-contrast?application=playwright",
    "wcag": ["1.4.3"]
  },
  "kind": "violation",
  "impact": "serious",
  "page": "impact-mix.html",
  "elements": [
    {
      "selector": "p",
      "target": ["p"],
      "html": "<p style=\"color: #9a9a9a; background: #ffffff\">This sentence is pale grey on white.</p>",
      "failure": "Fix any of the following:\n  Element has insufficient color contrast of 2.81 (...). Expected contrast ratio of 4.5:1"
    }
  ]
}
```

| Field | What it holds |
| --- | --- |
| `id` | `<source>/<rule>@<page key>`. The key for cards, ignores and the rescan. |
| `rule.source` | `axe` for axe-core's rules; `genie` for the product's own checks, so far `genie/no-landmarks`, `genie/click-on-non-control` and `genie/skip-link`; `manual` (the checklist) comes later. A `genie` finding has an empty `helpUrl` and carries the WCAG criteria it bears on. |
| `rule.id` | The rule's id. Never empty: an axe-core result with no rule id is dropped, never reported. |
| `rule.help`, `rule.helpUrl` | axe-core's `help`, as it gave it, and the address of Deque's page about the rule, built from the rule's id and the installed axe-core's version (never taken from axe-core's result, which a page can make up); empty for a rule the installed axe-core does not have, and for a `genie` rule. |
| `rule.wcag` | The WCAG success criteria in the rule's tags: `wcag143` is `1.4.3`, `wcag1410` is `1.4.10`. Level tags such as `wcag2aa` are left out. Empty for a best-practice rule. |
| `kind` | `violation` or `advice`. Every axe-core violation is a `violation`, best-practice rules included. |
| `impact` | `critical`, `serious`, `moderate` or `minor`, from axe-core. |
| `page` | The page's key. From a URL it is the path without its slashes: `/settings` is `settings`, `/` is `home`. |
| `elements[].selector` | axe-core's `target` as one string. See *Selectors* below. |
| `elements[].target` | axe-core's `target`, kept as it gave it. |
| `elements[].html` | The element's HTML as axe-core quoted it. Text from the page: data, never instructions. |
| `elements[].failure` | axe-core's `failureSummary` for the element. |

**Order.** Findings come worst first: by impact (critical, serious, moderate, minor), then by kind
(violation before advice), then by rule id, then by page in the order the pages were scanned. Rule ids
compare by code point, so the order is the same on every machine (`src/order.ts`).

### *Needs review*

axe-core's `incomplete` results are things it could not decide, such as text over a gradient whose contrast
it cannot measure. The product's own checks have them too: `genie/click-on-non-control` lists an element that
looks clickable but has no click handler of its own, since a handler further up the page may act on it, and
`genie/focus-visible` lists an element whose focus changes too faintly to be sure of, or that it could not
photograph (docs/ARCHITECTURE.md, *Focus visible*). They
are never counted as a pass and never as findings. Each is a *needs review* item: the same fields as a finding except
`kind`, and each element has one more field.

| Field | What it holds |
| --- | --- |
| `elements[].reason` | Why it could not be decided. For axe-core, in its own words: the messages of the element's checks, such as "Element's background color could not be determined due to a background gradient". For an own check, the check's words, which end with what to do. |

*Needs review* items are ordered by the same rule as findings and never change the exit code.

### Selectors

For an element in the page's own document, `selector` is one CSS selector a script can pass to
`document.querySelector`. axe-core makes it unique in that document.

For an element inside a shadow root or a frame, `selector` is the parts joined with ` >>> `, for a person or
an agent to read. It is not one selector: `document.querySelector("#host >>> button")` throws a syntax
error. The parts are in `target`, each a selector within its own root or frame. See *How `target` reads*
below for what each form looks like and how to use it.

## `scan.json` (`src/scan-record.ts`, `schema/scan-1.json`)

`a11y-genie scan <url>` and `a11y-genie check` write `scan.json` on every run, and `--json` prints the same
document on stdout.
Text from the page is kept in it exactly, terminal escape sequences included: it is data. The control
characters JSON allows raw (DEL, the C1 controls, the bidirectional controls and the line and paragraph
separators) are written as `\u` escapes, so the file holds no raw control and parses to the same text.
`report.md` and the terminal get the same text with every escape sequence and control stripped.

It is versioned: `schema` is `"<major>.<minor>"`, now `"1.10"`. A field may be added in a minor version and is
never removed or renamed in one; a removal or a rename is a new major, and a new schema file. Readers must
ignore fields they do not know, so the schema allows extra fields. 1.1 added `pages[].requestedUrl`,
`pages[].redirects`, `pages[].stopped`, `limits` and `elementsCut`; a 1.0 record has none of them, and is
still valid against `schema/scan-1.json`. 1.2 added `colorPair` on a `color-contrast` element; a 1.1 record has
none, and is still valid too. 1.3 added `options`, and the `offline` and `other-origin` kinds of
`pages[].stopped`; a 1.2 record has no `options`, and is still valid too. 1.4 made `states` real (below): a 1.3 record has `["default"]` in each place, and is still valid too. 1.5 added the
comparison with an earlier scan (*Compared with an earlier scan*, below): `check`'s record, `summary.sincePrevious`,
and `target.commit` from `--commit`; a 1.4 record has none of them, and is still valid too. 1.6 added `fixedCut` on a
still-open finding; a 1.5 record has none, and is still valid too. 1.7 added
`pages[].walks`, the keyboard walk of each state (*The keyboard walk*, below); a 1.6 record has none, and is still
valid too. 1.8 added `stopsCut` on a walk (below); a 1.7 record has none, and is still valid too. 1.9 added a
walk's `cycled` end and its `cycleFrom` (below), the findings `genie/keyboard-trap` and
`genie/focus-not-returned`, and the `cannotSee` line for a native modal dialog; a 1.8 record has none of them,
and is still valid too. 1.10 filled `workflows` (*Narrated flows*, below), added `command: "narrate"` and the
finding `genie/unnamed-step`; a 1.9 record has `workflows: []`, and is still valid too.

| Field | What it holds |
| --- | --- |
| `schema` | The version, `"1.10"` |
| `tool` | `{ name, version }` of A11y Genie |
| `command` | `"scan"`, `"check"` for `a11y-genie check`, or, from 1.10, `"narrate"` for `a11y-genie narrate`: a record with no axe-core results (`engine.rulesRun` is `0`), whose findings are the flows' own |
| `exit` | The exit code the run ends with: `0` with no violation at or above `options.failOn`, `1` with one, or with a page that was not scanned. Advice and *needs review* items never change it |
| `engine` | `axeCore` (its version), `browser` (the channel that ran and its version, such as `chrome 158.0.8127.36` or `chromium 159.0.8154.6`), `fallback` (`true` when Chrome was missing and Playwright's Chromium ran in its place; `false` otherwise, `--browser-channel chromium` included), `tags` (`null` when axe-core's default rule set ran, or the list `--tags` gave, in the order given, which ran exactly those: a rule with none of them does not run, and the landmark rules, which carry `best-practice`, need that tag), `rulesRun` (distinct rule ids axe-core ran, the most any one state ran, with `--tags` the ones those tags selected; `0` when nothing was scanned) |
| `target` | `origin` of the address asked for (not of where a redirect ended), and `commit`: `--commit`, or the `GITHUB_SHA` environment variable when it is set and `--commit` is not, or `null` |
| `startedAt`, `finishedAt` | UTC, to the second: `2026-11-19T20:14:03Z` |
| `pages` | One per page. `key` (from the address asked for), `url` (where it ended, after redirects; the address asked for when it was not scanned), `requestedUrl`, `redirects` (how many were followed), `states`, `notScanned` and `stopped`, below. A run with `--config` has one entry per page of the file, in its order |
| `pages[].states` | Every state the page was asked to scan, `default` first and then the `--states` or config states in the order given. A state also named in `notScanned` was asked for and not scanned. A page's states are merged into its findings: see *One finding per rule per page* below |
| `pages[].walks` | Added in 1.7. The keyboard walk of each state that was scanned, in the order of `states`: see *The keyboard walk* below. A state that was not scanned has no walk |
| `pages[].notScanned` | Empty when everything asked of the page was scanned. Otherwise one `{ state, reason }` for each state that was not: the state's name (`default`, `menu-open`) and why, in A11y Genie's own words, such as `it redirected to an address that is not http: or https: (such as file:, chrome: or data:), and the browser stopped it`, `it did not answer: no answer within 30 seconds`, or `step 2 (click button 'Menu') failed: no such element was found, or it could not be clicked, within 10 seconds`. The other states are still scanned, and their findings are in the record. Anything in it makes the exit `1` |
| `summary` | Violations by impact (`critical`, `serious`, `moderate`, `minor`), `advice`, `needsReview` and `notScanned` counts (a page or state not scanned, and, from 1.10, a flow not narrated to its end). On a `check`, the impact and `advice` counts are of the findings still open (`new` and `still`), and `new`, `still` and `fixed` count the findings of each status. On a `scan` of a site scanned before, `sincePrevious` (below) |
| `findings` | Worst first. Each is a finding as above, plus `title`, `plain`, `fix`, `status`, `elementsCut` when some elements are not listed, and, on each element, `states`: the names of the states the element was found in, in the order the states were asked for, `default` first (`["default"]` for a page scanned in one state). Each element's `html` is cut to 160 characters, with `…` where it was cut |
| `needsReview` | Worst first, as above; each element has `reason` and `states`, and the item has `elementsCut` when some are not listed |
| `ignored` | `[]` until that feature exists |
| `workflows` | Added in 1.10. The narrated flows, in the order they ran: see *Narrated flows* below. `[]` when none was asked for |
| `checklist` | `null` until the checklist exists |
| `cannotSee` | What a scan cannot see: the same lines that end `report.md`. The fixed list, then, from 1.9, one line for each page where a native `dialog` was open by `showModal()`, naming the page and its states, which the trap check does not walk (docs/ARCHITECTURE.md, *The keyboard trap*). A page without one adds nothing |
| `options` | Added in 1.3. The flags that changed what the scan did or how it exited: `failOn` (`critical`, `serious`, `moderate` or `minor`; `minor` by default), `sameOrigin` and `offline` (booleans). `--tags` is `engine.tags`. The report says so when any is set |
| `baseline` | On a `check` only: `path`, the `--baseline` as it was given; `startedAt`, when the baseline's scan began; `commit`, the baseline's own `target.commit`; and `notScanned`, each `{ page, state }` the baseline asked for and did not scan |
| `limits` | The limits the page was held to: `pageSeconds` (60), `redirects` (10), `elementsPerFinding` (500), `excerptChars` (160), `scanJsonBytes` (52428800, 50 MB). docs/ARCHITECTURE.md, *Hostile pages*, says what each does |

**One finding per rule per page.** A page is a URL, and the states of a page are merged into it. A finding is one rule on one page, so
its `id` is the same whatever the number of states; its elements are the elements any state found, each listed once and
naming the states it was found in. Two elements are the same element when their axe-core `target` is the same. A merged
finding keeps the wording (`help`, `fix`, an element's `html` and `failure`) of the first state that had it, and the
worst `impact` any state gave; a *needs review* item merges the same way. An element found only in `dark` lists `["dark"]`; one found in the default state and in
`dark` lists `["default", "dark"]`. So a bug that shows only with a menu open is the finding `axe/button-name@settings`
with `states: ["menu-open"]`, and the same bug on the page from a state that never opens the menu is not there. A page
asked for in states of which none was scanned has no findings, and `notScanned` says why for each.

**Order is stable.** Findings are worst first (`order.ts`). Within a finding the elements are ordered by the first state each was found in (the order the states were asked for, `default` first) and then by `target`, in code-point order, so the order does not depend on the order axe-core listed them in. An element's `states` follow the order the states were asked for. The same scan run twice gives the same `scan.json` and `report.md`, apart from the times, the port and the versions. `report.md` adds *Found in the state(s)* under each element that was not found in the default state alone.

**What was cut.** A finding lists at most 500 elements; `elementsCut` counts the rest. If `scan.json` would
be larger than 50 MB, walks are cut first: every walk keeps its first N stops, N the most that fits and at least
one, and `stopsCut` counts the rest. Walks are a record, not findings, so they go before any finding does. Then elements are dropped, least severe first and never the last one of a finding, and
counted in `elementsCut` too. If even that is not enough, the page reads *not scanned* and says so. A
limit reached never reads as nothing found.

What an agent can rely on in major version 1: per finding `id`, `rule.source`, `rule.id`, `impact`, `kind`,
`fix`; per element `selector` and `html`; at the top `schema`, `exit`, `summary` and `pages[].notScanned`.
`notScanned` is in 1.0 too, always empty there.

**Where `plain` and `fix` come from.** Both are A11y Genie's own words, written for a reader who knows no WCAG,
from the wording table in `src/plain.ts`: `plain` says what is wrong and who it hurts, `fix` what to change,
in a sentence or two each. The table has words for every `genie/*` rule, for every axe-core rule a fixture page
makes fire (`button-name`, `color-contrast`, `empty-heading`, `heading-order`, `image-alt`,
`landmark-no-duplicate-main`, `landmark-one-main`, `page-has-heading-one`, `region`) and for `link-name`. An
advice finding takes the rule's advice words where it has them (`genie/skip-link` does). The words are fixed
data: nothing from the page and nothing axe-core said goes into them. For a rule the table has no words for,
`plain` is axe-core's `help` for the rule, and `fix` is axe-core's `failureSummary` for the finding's first
element, on one line ("Fix any of the following:" then its messages, separated by semicolons); where axe-core
gave none, it is the rule's `help` and `helpUrl`. A finding always has a fix. `title` is the `help`, without a closing full stop, and the
page. `status` is `new` until a scan is compared with an earlier one, then `new`, `still` or `fixed` (below).
Each element's `failure` stays as
axe-core, or the product's own check, wrote it, newlines included; `report.md` shows it under the element.

`summary` counts findings (one per rule per page), not elements. `toolkit` is not written yet.

**`colorPair`.** On an element of a `color-contrast` (or `color-contrast-enhanced`) violation, read from axe-core's
own check data (*Where the colour data is*, below). It is absent on every other element, and on a *needs review*
element: where axe-core could not measure the colours (a gradient, an image) there is no pair, and the element
reads *needs review* with axe-core's reason. A pair is never guessed.

| Field | What it holds |
| --- | --- |
| `foreground`, `background` | `fgColor` and `bgColor`, such as `#9a9a9a` |
| `ratio` | `contrastRatio`: the number axe-core measured, such as `2.81` |
| `required` | `expectedContrastRatio` read as a number: `"4.5:1"` is `4.5` |
| `fontSize`, `fontWeight` | As axe-core wrote them, such as `12.0pt (16px)` and `normal` |

### The keyboard walk (`src/walk.ts`)

Each scanned state of a page is walked with the Tab key from the top of the page (docs/ARCHITECTURE.md, *The
keyboard walk*), and the walk is kept as it went, so a person or an agent can read where focus went, and a run
that differs can be read against another. It is a record, not a finding: it never changes `summary` or the exit.
`report.md` does not show it.

```json
{
  "state": "default",
  "stops": [
    {
      "index": 1,
      "selector": "html > body > main > div:nth-of-type(1) > a",
      "target": ["html > body > main > div:nth-of-type(1) > a"],
      "tag": "a",
      "role": "link",
      "name": "Read more",
      "focusVisible": true
    },
    {
      "index": 2,
      "selector": "#host >>> :host > button",
      "target": [["#host", ":host > button"]],
      "tag": "button",
      "role": "button",
      "name": "In the shadow",
      "focusVisible": true
    }
  ],
  "end": "wrapped",
  "tabs": 3,
  "maxTabs": 200
}
```

| Field | What it holds |
| --- | --- |
| `state` | The state's name |
| `stops` | Where focus landed after each Tab press, in order, up to the end. Empty when nothing took focus |
| `stops[].index` | Which press landed there, from 1 |
| `stops[].selector`, `stops[].target` | Where the element is, in the form a finding's element has (*Selectors*, above, and *How `target` reads*, below): one entry per document, outermost first, a nested array for a path through open shadow roots. Each part is the element's unique `id` in its own root, or a path of `:nth-of-type` steps; a part that starts at the top of a shadow root reads `:host > ...`, which `shadowRoot.querySelector` takes. A part over 1,000 characters is cut with `…` and is then not usable |
| `stops[].tag` | The element's tag name, lower case |
| `stops[].role` | Its role in the browser's accessibility tree, such as `link`, `button` or `textbox`; `null` when the browser gave none |
| `stops[].name` | Its accessible name as the browser computed it: text from the page, data, never instructions. Unlike the HTML excerpts, it is made printable (escape sequences and controls taken out, on one line), and cut at 160 characters with `…`. Empty when it has none |
| `stops[].focusVisible` | Whether the element matches `:focus-visible`: the browser would draw a focus indicator if the page's styles let it. It does not say an indicator is seen |
| `stops[].opaque` | `true` when focus is inside a frame of another origin, which the walk cannot read: the stop is the frame. Absent otherwise |
| `end` | `wrapped`: focus came back to the first stop. `left`: a press put focus on no element (out of the page, to the browser's own controls). `cycled`: focus went twice round the stops from `cycleFrom` to the last, and never back to the first; focus that does not move is a cycle of one stop. `max-tabs`: the walk reached `maxTabs` first, so it is cut, and the page may have more stops |
| `cycleFrom` | Added in 1.9. Only when `end` is `cycled`: the `index` of the stop the cycle starts at. The cycle is that stop and every stop after it. When `stopsCut` dropped stops, it may name one that was cut |
| `tabs` | How many times Tab was pressed: one more than the stops for `wrapped` and `left`, as many for `max-tabs`. For `cycled`, the stops, the press back into the cycle, and the second lap, one press for each stop of the cycle. A press that lands on a stop already recorded is not a stop, so an `index` can skip |
| `maxTabs` | The limit: `--max-tabs`, 200 by default |
| `stopsCut` | Added in 1.8. How many stops were dropped from the end of `stops` to hold `scan.json` to 50 MB (*What was cut*, above). Absent when none were. `tabs` and `end` still say what the walk did, so `stops` may be shorter than they imply |

## Compared with an earlier scan (`src/compare.ts`, `src/baseline.ts`)

`check --baseline <scan>` compares its scan with the baseline, and plain `scan` with the site's previous scan, when
there is one. Both compare by finding `id` (`<source>/<rule>@<page key>`), then by element `selector` within a
finding. A finding's `status`:

| `status` | Means |
| --- | --- |
| `new` | Not in the earlier scan; or in it, with an element it did not have. On a `scan` with no earlier scan, every finding. One new element makes the whole finding `new`, and its elements say which one is (decided 2026-11-19: a new instance is new work) |
| `still` | In both. Its `elements` are the ones failing now. Also, with `unverified: true`, a finding or element found now only in states the earlier scan asked for and did not scan (below) |
| `fixed` | In the earlier scan, and not found now. Only a `check` lists fixed findings |

**Elements.** Within a finding found in both, elements are matched by `selector`. When the elements left unmatched on
each side are as many as each other, they are read as the same elements under selectors that moved, so the finding
reads `still`, never fixed plus new. Otherwise an unmatched element found now is `new`, and makes its finding `new`,
and an unmatched earlier element is fixed. On a `check`, each element has a `status` (`new`, `still`, or `fixed` on a
fixed finding), and a finding still open lists the earlier elements that no longer fail in `fixedElements`, at most 500; `fixedCut` counts the fixed elements
not listed there, and is left out when none were cut. `elementsCut` counts failing elements only, so a cut fixed
element is never in it. On a fixed finding, every element is a fixed one, and `elementsCut` counts those not listed.

**Not scanned is never fixed.** An earlier element found in a state of its page that was not scanned this time is
not read as fixed: it stays in `elements` with `status: "still"` and `unverified: true`, and its finding reads
`still` with `unverified: true`. Such a run exits 1 anyway, since a page or state was not scanned.

**Nor is a state the earlier scan did not scan read as new** (decided 2026-11-19: a state the baseline never
scanned proves nothing, and failing a pull request on bugs that were always there is a false alarm). An element
found now only in states the earlier scan asked for and did not scan (its `pages[].notScanned`) reads
`status: "still"` with `unverified: true`, and so does its finding, which then does not fail a check. An element
found in at least one state both scans scanned is judged as usual: `new` if the earlier scan did not have it. So a
finding with a new element in a state both scanned stays `new`, and only its elements in the unscanned state are
marked unverified. `check` says `1 finding is unverified: the baseline did not scan the state "dark". To compare
it, run a11y-genie scan with the same --states to make a new baseline.`, and `report.md` says the same.

**Narrated flows** (`workflows[]`, from 1.10; `src/narrate.ts`, docs/ARCHITECTURE.md, *Narration*). One entry for each
flow that ran: `narrate --flow` gives one, named `flow`, and `scan --config` gives one for each of the file's
`workflows`. Each has:

| Field | What it holds |
| --- | --- |
| `name` | `flow`, or the workflow's name in the config file, printable and cut to 80 characters |
| `page` | The key of the page it ran on |
| `file` | Its transcript, relative to the scan folder: `narration/<name>.txt`. The name is made one safe path part (letters, digits, `.`, `_`, `-`), and two names that come to the same one get `-2`, `-3` after it |
| `steps` | One entry for each step that ran: `key` (the step as the grammar writes it), then what the browser's accessibility tree said of the element focus was on after it: `role` (the tree's name for it, `null` when focus was on no element), `name` (empty when it has none), `states` (`required`, `expanded`, `checked`...), `spoken` (the line a screen reader would say, name first: `Save, button`; empty when focus was on no element), `unnamed` (the step brought focus to an element that has a role and no name), and `selector` (the element, `null` when none) |
| `steps[].produced` | Only on a step that pressed Enter or Space, or clicked: what it produced, in the order it is said, each `{ kind, spoken }`. `dialog`: a dialog opened, and this is its name and role. `focus`: focus moved to another element, or to none (then `spoken` is empty). `change`: focus stayed, and what is said of it changed, such as a menu button that opened. `live`: text added to an `aria-live`, `role="status"`, `role="alert"` or `role="log"` region. `page`: the step went to another page, and this is its title. An empty list means the press produced nothing a screen reader would say |
| `notScanned` | Absent when the flow ran to its last step. Otherwise why it stopped, in A11y Genie's own words, such as `step 2 (click button 'Menu') failed: no such element was found, or it could not be clicked, within 10 seconds`. The steps before it are kept. A flow not narrated to its end counts in `summary.notScanned` and makes the exit `1` |

A step that leaves focus on an element that has a role and no name is the finding `genie/unnamed-step` (serious, WCAG
4.1.2) on the flow's page, with one element for each such control, whatever number of flows reached it. The finding
needs `--fail-on` at `serious` or lower to make the exit `1`, like any other. A step that stays on the element the
step before it reached does not count again.

**`check`'s record** has `command: "check"`, `baseline`, every finding with its `status` (the open ones worst first,
then the fixed ones worst first), and `summary.new`, `still` and `fixed`. A fixed finding keeps the earlier
scan's elements and has `fixedIn`: `{ startedAt, commit }` of the scan it was first found gone in. That is this
check, unless the baseline is itself a `check` that already had the finding as fixed, whose `fixedIn` is kept.
`exit` is `1` on a `new` violation at or above `options.failOn`, or on a page or state not scanned, and `0`
otherwise: a finding still open from the baseline never fails a check.

**Plain `scan`'s `summary.sincePrevious`** is `{ new, fixed, startedAt }`: how many findings are new since the
site's previous scan, how many of its open findings are not found now (a `check` record's findings already marked
fixed are not counted again), and when it began. Each finding's `status` is
`new` or `still` against it, and no fixed finding is listed. It is compared only when the two scans covered the
same pages (by key), each in the same states, with the same `engine.tags`; otherwise `sincePrevious` is `null` and
`sincePreviousReason` says why: `different pages, states or tags`, or `it cannot be read as a scan.json of this
version`. With no previous scan, neither field is written. The previous scan is the newest folder under
`<scans>/<origin key>/` (`--out` when given), a `check`'s included, whose `target.origin` is this scan's; when that
folder holds none, the folder of the old name is read too (see *Where a scan is written*). `sincePrevious` changes nothing else: the exit
reads only the scan just run.

**The earlier scan is untrusted input.** `--baseline` (a `scan.json`, or a scan folder holding one) and the previous
scan are read the same way: at most 50 MB, the limit on `scan.json`; JSON, and nothing else; a `schema` of major
version 1; valid against `schema/scan-1.json`, checked with the validator in `src/json-schema.ts` before any field
is read; and no finding id twice. Only the fields this version knows are copied from it into the new record, an
element's `html` cut to 160 characters again, every other text cut to 1,000 characters and every list to 100 items
(`CARRIED_TEXT_CHARS`, `CARRIED_ITEMS` in `src/compare.ts`), and a rule's `helpUrl` built again from its id rather
than copied. Its text is printed only through `src/printable.ts`, and a refusal
names where the file failed the schema, never the value it held. A `--baseline` that fails any of these is a
refusal (docs/EXIT-CODES.md); a previous scan that fails reads *not comparable*.

## `rules --json` (`src/rules-command.ts`)

`a11y-genie rules --json` prints one document on stdout, and nothing on stderr. It needs no browser and no network.

```json
{
  "engine": { "axeCore": "4.14.1" },
  "tags": null,
  "rules": [
    {
      "source": "axe",
      "id": "color-contrast",
      "impact": "serious",
      "wcag": ["1.4.3"],
      "tags": ["cat.color", "wcag2aa", "wcag143"],
      "help": "Elements must meet minimum color contrast ratio thresholds",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.14/color-contrast?application=axeAPI"
    }
  ]
}
```

| Field | What it holds |
| --- | --- |
| `engine.axeCore` | The installed axe-core's version |
| `tags` | The `--tags` list that was given, in the order given, or `null` for every rule |
| `rules` | axe-core's rules from `axe.getRules()`, by id, then the product's own, by id |
| `rules[].source` | `axe` or `genie`. A finding's rule id is `<source>/<id>`, such as `genie/no-landmarks` |
| `rules[].id` | The rule's id, without the source |
| `rules[].impact` | `critical`, `serious`, `moderate` or `minor`: the rule's own impact. A finding can carry another, from the check that failed. `null` if axe-core states none (none does at the pinned version) |
| `rules[].wcag` | WCAG success criteria, such as `1.4.3`, from the rule's tags. Empty for a best-practice rule |
| `rules[].tags` | All of the rule's tags. A rule runs under `scan --tags` when it carries one of them |
| `rules[].help`, `rules[].helpUrl` | The rule's one-line help and its page; `helpUrl` is empty for a `genie` rule |

The fields are never renamed or removed; a field may be added, and readers ignore fields they do not know. Without
`--json` the same rules print as one aligned line each (`RULE`, `IMPACT`, `WCAG`, `TAGS`) under a sentence that
says how many there are and from which axe-core.

The product's own rules are the ones registered in `src/genie-rules.ts`. A check registers its rule when its
module loads, and `rules` lists what is registered, so a rule not built yet is not listed.

## `report.md` (`src/report.ts`)

Made from the record and nothing else. It holds, in order: what was scanned and with what, and where a
redirect ended (saying so when that is another origin); the comparison with the baseline or the last scan,
when there is one; a summary (the empty-scan sentence when nothing was
found, and each page not scanned with its reason); the findings worst first, each headed by a short title from
`src/plain.ts` (axe-core's `help` for a rule it has no words for), with its rule, a *What's wrong* line
with its `plain` where that differs from the title, its WCAG criteria each named in plain words (such as `1.4.3 Contrast (Minimum): text must stand out
from its background`, from `src/plain.ts`, or the number alone for a criterion it has no words for; an advice
finding gives them as context, since advice is never a WCAG failure), page, fix and elements (with how many are
not listed, when some were cut; a contrast element also has a `Colours:` line naming the pair, such as
`#9a9a9a on #ffffff, 2.81, needs 4.5`, from the record's numbers; and each element says what axe-core or the
check said about it, where that was not already said above it; once compared, its `Status:`, each element marked
`(new)` or `(still open, unverified)` where it is, and on a `check` the elements fixed under it, as *Fixed under
it*); on a `check`, *Fixed since the baseline*, each fixed finding with its elements and the scan it was first
found gone in; *Needs review*, when
axe-core could not decide something; *What the page tried, and was stopped*, when it opened dialogs or
pop-ups or started downloads, with the first few quoted; and *What this scan cannot see*, the same fixed
list in every report, last.

- It never tells you a site has no problems, or that it meets a standard: automated checks find some problems, not all of them. A page that was
  not scanned never reads as nothing found. A scan with no findings reads: `No problems found by these {rulesRun} rules on {pages}. Automated rules find only some
  problems; the checklist covers what they cannot see.` Both counts come from the record (`engine.rulesRun`,
  and the number of `pages`, written "this page" for one and "these 3 pages" for more; the header line reads "90 rules ran on this page" for one page and "90 rules ran on 3 pages" for more).
- Text from the page is data. Element HTML is in a fenced block, labelled as quoted, cut at 160 characters;
  the fence is longer than any run of backticks inside, and control characters are replaced.
- *What this scan cannot see* points to the guided checklist, which does not exist yet, and says so.

## Where a scan is written (`src/scans-folder.ts`)

`<scans>/<origin key>/<start time>/scan.json` and `report.md`, outside the scanned project. The origin key is
the scheme, `_`, then the host and the port of the address asked for: `http://localhost:5173` is
`http_localhost-5173`, and `https://example.com` is `https_example.com` (no port when it is the scheme's own). A
host that had to change to be one path part (`[::1]`, a trailing dot) adds `_` and the first 10 hex digits of the
SHA-256 of the full origin, and so does a key over 100 characters, cut to fit, so two origins never share a key and
every key is one path part on macOS, Linux and Windows. The start time is `2026-11-19T20-14-03Z`, with `-2`, `-3` added if two
scans start in the same second. `<scans>` is, in this order: `--out`; the `A11Y_GENIE_SCANS_DIR` environment
variable (tests set it to a temporary folder); then the per-user folder, `~/Library/Application Support/a11y-genie`
on macOS, `$XDG_DATA_HOME/a11y-genie` or `~/.local/share/a11y-genie` on Linux, and
`%LOCALAPPDATA%\a11y-genie` on Windows. `--format md,json` (the default) picks the reports; `scan.json` is
always written, because every other file is made from it.

Before this, the origin key was the host and port alone (`localhost-5173`), shared by `http` and `https`, and not
cut. Nothing is written under that old name any more, but the last scan is still looked for in it: when the new
folder holds no scan, the old one is read, and a scan in it is used only when its own `target.origin` is the origin
scanned now; one that cannot be read is passed over, since it cannot say whose it is. So an `https` scan never reads
an `http` scan as its last. The old name never holds `_`, so it is never a new key.

## axe-core's results (V1)

Checked on 2026-11-19 with axe-core 4.14.1, run by `@axe-core/playwright` 4.14.0 with its default rule set,
in Google Chrome 158 (headless) on macOS. The results recorded from `impact-mix.html` and
`needs-review.html` are in `test/fixtures/axe/`; the tests map them without a browser. The fixture server's
random port is replaced by `4173` in them.

### The top level

| Field | At 4.14.1 |
| --- | --- |
| `testEngine` | `{ "name": "axe-core", "version": "4.14.1" }`. `version` fills `engine.axeCore`. |
| `testRunner` | `{ "name": "axe" }` |
| `testEnvironment` | `userAgent`, `windowWidth`, `windowHeight`, `orientationAngle`, `orientationType` |
| `timestamp` | When the run ended, ISO 8601, such as `2026-11-19T21:31:19.360Z` |
| `url` | The page's URL |
| `toolOptions` | The options it ran with. With the default rule set: `{ "reporter": "v1" }` |
| `violations` | Rules that failed on at least one element |
| `incomplete` | Rules axe-core could not decide on at least one element: *needs review* |
| `passes` | Rules that passed on at least one element. Counted, never reported as a pass. |
| `inapplicable` | Rules that ran and found nothing to apply to |

Each rule that ran appears in at least one of the four lists. On the fixture pages the default rule set ran
90 rules; A11y Genie counts the distinct ids across the four lists as the rules that ran.

### A result (one rule)

| Field | At 4.14.1 |
| --- | --- |
| `id` | The rule id, such as `color-contrast` |
| `impact` | The rule's impact; in these results, the worst of its nodes'. `null` in `passes` and `inapplicable`. A finding falls back to its worst node's impact when this is missing. |
| `tags` | Such as `["cat.color", "wcag2aa", "wcag143", "TTv5", "TT13.c", "EN-301-549", "EN-9.1.4.3", "ACT", "RGAAv4", "RGAA-3.2.1"]`. Criteria are the `wcag` tags with digits only; best-practice rules carry `best-practice` and no criterion. |
| `description` | A longer sentence than `help` |
| `help` | One line, such as "Elements must meet minimum color contrast ratio thresholds" |
| `helpUrl` | Deque's page for the rule at the minor version, with `?application=playwright` added by `@axe-core/playwright` |
| `nodes` | The elements. Empty in `inapplicable`. |

### A node (one element)

| Field | At 4.14.1 |
| --- | --- |
| `target` | Where the element is. See *How `target` reads*. |
| `html` | The element's opening HTML and content, as axe-core quotes it |
| `impact` | This element's impact. `null` in `passes`. |
| `failureSummary` | "Fix any of the following:" or "Fix all of the following:" and the failed checks' messages. Present in `violations` and `incomplete`, absent in `passes`. |
| `any`, `all`, `none` | The checks behind the result. Each check has `id`, `data`, `relatedNodes` (each with `html` and `target`), `impact` and `message`. |

### How `target` reads

`target` is an array with one entry per document, outermost first: the page's own, then each frame on the way
in. An entry that is itself an array is a path through shadow roots. Checked on a page with an open shadow
root and on a page with a same-origin `iframe`:

| Where the element is | `target` | `selector` | How to reach it |
| --- | --- | --- | --- |
| The page's own document | `["p"]` | `p` | `document.querySelector("p")`; Playwright `page.locator("p")` |
| Inside an open shadow root | `[["#host", "button"]]` | `#host >>> button` | `document.querySelector("#host").shadowRoot.querySelector("button")`; Playwright `page.locator("#host button")`, since its CSS selectors pierce open shadow roots |
| Inside a frame | `["#f", "button"]` | `#f >>> button` | `document.querySelector("#f").contentDocument.querySelector("button")` (same origin only); Playwright `page.frameLocator("#f").locator("button")` |

So each part is a usable selector within its own root or frame, and the nesting says which is which: a nested
array is shadow roots, a new top-level entry is a frame. Not checked here: closed shadow roots, cross-origin
frames, and whether a part stays the same between two runs (V9, with the rescan).

### Where the colour data is

`colorPair` is filled from this. The data is on the node's `any` check whose `id` is `color-contrast`, in `data`:

| Field | On a violation (`contrast.html`) | On *needs review* (`needs-review.html`) |
| --- | --- | --- |
| `fgColor` | `"#9a9a9a"` | absent |
| `bgColor` | `"#ffffff"` | absent |
| `contrastRatio` | `2.81` (a number, two decimals) | `0` |
| `expectedContrastRatio` | `"4.5:1"` (a string, not a number) | `"4.5:1"` |
| `fontSize` | `"12.0pt (16px)"` | `"12.0pt (16px)"` |
| `fontWeight` | `"normal"` | `"normal"` |
| `messageKey` | `null` | `"bgGradient"`: why it could not measure |

The check's `message` says the same in words: "Element has insufficient color contrast of 2.81 (foreground
color: #9a9a9a, background color: #ffffff, font size: 12.0pt (16px), font weight: normal). Expected contrast
ratio of 4.5:1", or "Element's background color could not be determined due to a background gradient".

`#9a9a9a` on `#ffffff` measures 2.81 here, not 2.85. And `expectedContrastRatio` is a string, so a
`required` number has to be read out of it.
