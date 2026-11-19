# The JSON A11y Genie reads and writes

This document has two parts:

1. **Findings**: the shape A11y Genie gives each finding and each *needs review* item. `scan.json` is built
   from these.
2. **`scan.json`**: the record `a11y-genie scan` writes, which `--json` prints and `report.md` is made from.
   Its JSON Schema is `schema/scan-1.json`.
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
| `rule.source` | `axe` for axe-core's rules. `genie` (the product's own checks) and `manual` (the checklist) come later. |
| `rule.id` | The rule's id. Never empty: an axe-core result with no rule id is dropped, never reported. |
| `rule.help`, `rule.helpUrl` | axe-core's `help` and `helpUrl`, as it gave them. |
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
it cannot measure. They are never passes and never findings. Each is a *needs review* item: the same fields
as a finding except `kind`, and each element has one more field.

| Field | What it holds |
| --- | --- |
| `elements[].reason` | Why axe-core could not decide, in its own words: the messages of the element's checks, such as "Element's background color could not be determined due to a background gradient". |

*Needs review* items are ordered by the same rule as findings and never change the exit code.

### Selectors

For an element in the page's own document, `selector` is one CSS selector a script can pass to
`document.querySelector`. axe-core makes it unique in that document.

For an element inside a shadow root or a frame, `selector` is the parts joined with ` >>> `, for a person or
an agent to read. It is not one selector: `document.querySelector("#host >>> button")` throws a syntax
error. The parts are in `target`, each a selector within its own root or frame. See *How `target` reads*
below for what each form looks like and how to use it.

## `scan.json` (`src/scan-record.ts`, `schema/scan-1.json`)

`a11y-genie scan <url>` writes `scan.json` on every run, and `--json` prints the same document on stdout.
It is versioned: `schema` is `"<major>.<minor>"`, now `"1.0"`. A field may be added in a minor version and is
never removed or renamed in one; a removal or a rename is a new major, and a new schema file. Readers must
ignore fields they do not know, so the schema allows extra fields.

| Field | What it holds |
| --- | --- |
| `schema` | The version, `"1.0"` |
| `tool` | `{ name, version }` of A11y Genie |
| `command` | `"scan"` |
| `exit` | The exit code the run ends with: `0` with no violations, `1` with any |
| `engine` | `axeCore` (its version), `browser` (such as `chrome 158.0.8127.36`), `fallback` (`false` until the browser fallback), `tags` (`null`: axe-core's default rule set), `rulesRun` (distinct rule ids axe-core ran) |
| `target` | `origin` of the page, and `commit` (`null`) |
| `startedAt`, `finishedAt` | UTC, to the second: `2026-11-19T20:14:03Z` |
| `pages` | One per page: `key`, `url`, `states` (`["default"]`), `notScanned` (empty) |
| `summary` | Violations by impact (`critical`, `serious`, `moderate`, `minor`), `advice`, `needsReview` and `notScanned` counts |
| `findings` | Worst first. Each is a finding as above, plus `title`, `plain`, `fix`, `status` and, on each element, `states` |
| `needsReview` | Worst first, as above; each element has `reason` and `states` |
| `ignored`, `workflows` | `[]` until those features exist |
| `checklist` | `null` until the checklist exists |
| `cannotSee` | The fixed list of what a scan cannot see: the same lines that end `report.md` |

What an agent can rely on in major version 1: per finding `id`, `rule.source`, `rule.id`, `impact`, `kind`,
`fix`; per element `selector` and `html`; at the top `schema`, `exit`, `summary` and `pages[].notScanned`.

**`plain` and `fix` until plain-language fixes are written.** `plain` is axe-core's `help` for the rule. `fix`
is axe-core's `failureSummary` for the finding's first element, on one line ("Fix any of the following:" then
its messages, separated by semicolons); where axe-core gave none, it is the rule's `help` and `helpUrl`. A
finding always has a fix. `title` is the `help` and the page. `status` is `new` until a scan is compared
with the one before it. Each element's `failure` stays as axe-core wrote it, newlines included.

`summary` counts findings (one per rule per page), not elements. `toolkit` and `colorPair` are not written
yet.

## `report.md` (`src/report.ts`)

Made from the record and nothing else. It holds, in order: what was scanned and with what; a summary (the
empty-scan sentence when nothing was found); the findings worst first, each with its rule, WCAG criteria,
page, fix and elements; *Needs review*, when axe-core could not decide something; and *What this scan cannot
see*, the same fixed list in every report, last.

- It never calls a site accessible, compliant or conformant and never says it passes WCAG. A scan with no
  findings reads: `No problems found by these {rulesRun} rules on {pages}. Automated rules find only some
  problems; the checklist covers what they cannot see.` Both counts come from the record (`engine.rulesRun`,
  and the number of `pages`, written "this page" for one and "these 3 pages" for more; the header line reads "90 rules ran on this page" for one page and "90 rules ran on 3 pages" for more).
- Text from the page is data. Element HTML is in a fenced block, labelled as quoted, cut at 160 characters;
  the fence is longer than any run of backticks inside, and control characters are replaced.
- *What this scan cannot see* points to the guided checklist, which does not exist yet, and says so.

## Where a scan is written (`src/scans-folder.ts`)

`<scans>/<origin key>/<start time>/scan.json` and `report.md`, outside the scanned project. The origin key is
the host and port (`localhost-5173`); the start time is `2026-11-19T20-14-03Z`, with `-2`, `-3` added if two
scans start in the same second. `<scans>` is, in this order: `--out`; the `A11Y_GENIE_SCANS_DIR` environment
variable (tests set it to a temporary folder); then the per-user folder, `~/Library/Application Support/a11y-genie`
on macOS, `$XDG_DATA_HOME/a11y-genie` or `~/.local/share/a11y-genie` on Linux, and
`%LOCALAPPDATA%\a11y-genie` on Windows. `--format md,json` (the default) picks the reports; `scan.json` is
always written, because every other file is made from it.

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

For the later colour pair. The data is on the node's `any` check whose `id` is `color-contrast`, in `data`:

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
