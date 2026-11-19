# Exit codes and refusals

What `a11y-genie` exits with, and what it says when it refuses. The codes are in `src/exit-codes.ts`.

| Code | Meaning for `scan` |
| --- | --- |
| 0 | Scanned, and no violation at or above `--fail-on` (any violation, by default). |
| 1 | Scanned, and at least one violation at or above `--fail-on`; or a page or state of the run was **not scanned** (below), whatever `--fail-on` says. |
| 2 | A stated refusal: one `Error:` line and one `Hint:` line on stderr, nothing on stdout, nothing scanned or written. |
| 3 | Something unexpected: one `Error:` line and one `Hint:` line saying where to report it. The stack trace prints only when `A11Y_GENIE_DEBUG` is set. |
| 130 | Ctrl-C. |

With `--config`, or with `--states`, the run covers several pages or states, and the exit code reads all of them: 1 when any
violation was found in any state, or any page or state was *not scanned*; 0 only when every one was scanned and
none had a violation.

A scan with no findings says how much it checked. It never says a site is accessible.

**`--fail-on <impact>`** (`critical`, `serious`, `moderate` or `minor`; default `minor`, so any violation fails the
run) sets the lowest impact that makes the exit 1. With `--fail-on serious`, a page whose only findings are
moderate exits 0: the findings are still in `scan.json` and `report.md`, and the command line says
`None is serious or worse, so the exit is 0 (--fail-on serious).` Three things never depend on it:

- A page that was **not scanned** always exits 1.
- *Advice* never changes the exit.
- *Needs review* items (what axe-core could not decide, so a person looks) never change the exit, with any
  `--fail-on`. They are counted in `summary.needsReview` and listed, and the command line says how many.

`scan.json` records the floor in `options.failOn`, and its `exit` is the code the run ends with.

`rules` exits 0 on success and 2 on a refusal; it scans nothing.

Not built yet, with a place waiting in `src/exit-codes.ts`:

- **Exit 4**, a refusal after something was already written. Only a later command (`cards --toolkit`) can reach it.

`--version` wins anywhere on the line: `a11y-genie rules --version` and `a11y-genie scan <url> --version` print the
version and exit 0, before the command reads its other arguments. (It is not only a top-level flag, so a
person who adds it to any command line gets the answer, not a refusal.)

## Refusals the command can reach

Every refusal is exit 2 and happens before anything is written: the scans folder and `--out` are left as they were.

| Refused | `Error:` | `Hint:` |
| --- | --- | --- |
| An unknown command | `unknown command or flag: scna` | `run a11y-genie --help to see what exists so far.` |
| An unknown flag after `rules` (or `--tags` with an unknown or empty tag, as for `scan`) | the words of Node's argument parser, such as `Unknown option '--nope'. ...` | `run a11y-genie --help to see what exists so far.` (for `--tags`, the hints below) |
| An argument after `rules` | `rules takes no argument, and got: "extra"` | the same hint |
| An unknown flag after `scan` | the words of Node's argument parser, such as `Unknown option '--nope'. To specify a positional argument starting with a '-', place it at the end of the command after '--', as in '-- "--nope"` | the same hint |
| An extra argument | `scan takes one page, and got more: two` | the same hint |
| No address | `scan needs a page address to scan.` | `run: a11y-genie scan <url>` |
| `--config` with no address anywhere | `scan --config needs a base address: the file has no baseUrl, and none was given.` | `add baseUrl: http://localhost:5173 to the file, or run: a11y-genie scan <url> --config <file>` |
| `--states` with `--config` | `--states and --config cannot be used together.` | `put the states under their pages in the config file, or drop --config.` |
| A state name given twice in `--states` | `--states gives the state "dark" twice.` | `each --states names one state, and no two may share a name: rename one, or join their steps into one state.` |
| A `--states` value or config step that does not parse | `--states step 2 "clik", column 11: "clik" is not a step.` (a config step: `<file> line 6 "clik", column 1: ...`); every message is in `docs/STEPS.md` | what a step is, or how to fix this one |
| A CSS selector that starts with an engine prefix (`xpath=`, `text=`, `id=`) or holds `>>` | `--states step 1 "click css 'xpath=//a'", column 12: a selector cannot start with "xpath=", which Playwright reads as another kind of selector.` | `write one CSS selector, such as css '#menu', or name the element by role and name.` |
| A config that does not read or validate | `<file>, line 3: unknown key "title" in a page; the keys it takes are key, path, states.` (also a missing key, a wrong kind of value, a repeated key, a page key or state name given twice, a path that is not on the site, a YAML feature the file does not take); every one names the file and the line | `see docs/CONFIG.md for the config file: ...` |
| A `--config` that is missing, a folder, or over 1 MB | `--config cannot be read: <path> (ENOENT)` | `give the path to a YAML file you may read.` |
| A `--timeout` that is not a number of seconds above 0 and up to 3600 | `--timeout takes a number of seconds above 0 and up to 3600, not "soon".` | `for example --timeout 30. The default is 60.` |
| A `--storage-state` that is missing or is not a Playwright storage state | `--storage-state cannot be read: <path> (ENOENT)`, or `... is not a Playwright storage state: <path>` | `give the path to a Playwright storage state file.` |
| A target that is not `http:` or `https:` | `only http: and https: addresses can be scanned, and this one is file:` (or `javascript:`, `data:`) | `give a full address that starts with http:// or https://. To scan a built site, serve it first, for example: npx serve dist` |
| An unknown `--fail-on` impact | `unknown --fail-on impact: "severe"` | `use one of: critical, serious, moderate, minor.` |
| An unknown `--tags` tag | `unknown --tags value: "nope"` | `use axe-core tags separated by commas, such as wcag2a, wcag2aa, wcag21aa or best-practice. The landmark rules need best-practice.` |
| An empty part of `--tags` (`--tags wcag2a,` or `--tags ""`) | `--tags needs one or more axe-core tags, separated by commas, and one is empty.` | `use axe-core tags separated by commas, such as wcag2a,wcag2aa,best-practice.` |
| `--offline` with a target that is not loopback (`127.0.0.0/8`, `::1`, `localhost`, `*.localhost`) | `--offline allows only a page on this machine, and http://example.com is not one.` | `serve the page on localhost, 127.0.0.1 or [::1], or run without --offline.` |
| A target that is not an address | `not a web address: "example"` | the same hint |
| A target that does not answer | `http://127.0.0.1:5173 did not answer: the connection was refused.`, `... the host name was not found.`, `... no answer within 30 seconds.`, or `... the browser reported ERR_<NAME>.` | `check the address, and that the server is running.` |
| No Chrome, with `--no-download` | `Chrome was not found on this machine, and --no-download stops A11y Genie from downloading Playwright's Chromium.` | `Install Chrome, or run with --browser-channel msedge if that one is installed, or download Playwright's Chromium yourself: npx playwright-core@1.65.1 install --no-shell chromium` |
| No Chrome, with `--offline` (and no `--no-download`) | `Chrome was not found on this machine, and --offline stops A11y Genie from downloading Playwright's Chromium.` | the same hint as `--no-download` |
| `--browser-channel chromium --offline`, with no Chromium in Playwright's cache | `Playwright's Chromium is not installed on this machine, and --offline stops A11y Genie from downloading it.` | the same hint as `--no-download` |
| `--browser-channel chromium --no-download`, with no Chromium in Playwright's cache | `Playwright's Chromium is not installed on this machine, and --no-download stops A11y Genie from downloading it.` | `download it yourself: npx playwright-core@1.65.1 install --no-shell chromium, or run with another --browser-channel.` |
| A named `--browser-channel chrome` that is not installed (never replaced) | `Chrome was not found on this machine.` | `Install Chrome, or run with --browser-channel chromium to use Playwright's Chromium (downloaded once), or msedge if that one is installed.` |
| A `--browser-channel msedge` that is not installed (never replaced) | `Microsoft Edge was not found on this machine.` | `Install Microsoft Edge, or run with --browser-channel chrome, or chromium to use Playwright's Chromium (downloaded once).` |
| The Chromium download did not finish | `the download of Playwright's Chromium did not finish: the installer exited with code <n>.` (or `... was stopped by <signal>`) | `check the network and run again, or download it yourself: npx playwright-core@1.65.1 install --no-shell chromium` |
| An `--out` that is a file | `--out is not a folder: <path>` | `give a folder, or a new name inside a folder that exists.` |
| An `--out` whose parent is missing, or a file | `--out cannot be made, because the folder above it does not exist: <path>` (or `the path above it is not a folder`) | `make the folder above it first, or choose another --out.` |
| An `--out` with no permission | `--out cannot be written to: <path>` (or `... because the folder above it cannot be written to`) | `choose a folder you may write to.` |

Given both `--offline` and `--no-download`, the refusal names `--no-download`. `--offline` never downloads; a
Chromium already in Playwright's cache is used.

With no Chrome and no `--browser-channel`, the run does not refuse: it says so in one line on stderr and downloads
Playwright's Chromium once (docs/ARCHITECTURE.md). That line comes before the download, so a download that then
fails prints it, and then its `Error:` and `Hint:`: three lines on stderr. Every other refusal prints two.
The version in the hints is the installed playwright-core's.

`--out` may name a folder that exists, or a new folder whose parent exists. A scan folder that turns out not to be
writable when the write is tried (a race, or the default scans folder) is the same refusal, `cannot write the
scan under <folder>: <code>`.

## How a page that does not answer is decided

The browser gets 30 seconds (`NAVIGATION_TIMEOUT_MS` in `src/run-scan.ts`) for the first page to answer. Only the
first page's first load can refuse: a page of a config that does not answer after it, or a state that does not
answer, reads *not scanned* instead (below), with the same words after `it did not answer:`. A refused
connection, a host name that does not resolve, a timeout, and any other `net::ERR_*` error not listed below are all a
refusal. A page that answers with an error status, such as 404, is scanned: the server did answer.
Tests shorten the wait with `A11Y_GENIE_TEST_NAV_TIMEOUT_MS`, which can only make the wait shorter.

## Not scanned: a page that answered, and then could not be scanned

A page that answers and then breaks one of the hostile-page rules (`src/context.ts`, listed in
`docs/ARCHITECTURE.md` under *Hostile pages*) is not a refusal. The scan still writes `scan.json` and `report.md`,
the page's `notScanned` says why, the summary says so in place of any count of problems, and the exit is 1. A
page nobody saw never exits 0. The reasons, in the scan's own words:

| When | Reason |
| --- | --- |
| a redirect to `file:`, `chrome:`, `data:`, `about:` or another scheme the browser refuses (`net::ERR_UNSAFE_REDIRECT`) | `it redirected to an address that is not http: or https: (such as file:, chrome: or data:), and the browser stopped it` |
| a redirect to `javascript:`, or an empty answer (`net::ERR_ABORTED`) | `the browser stopped loading it (net::ERR_ABORTED), as it does for a redirect to javascript: or an empty answer` |
| an invalid redirect, or an unknown scheme (`ERR_INVALID_REDIRECT`, `ERR_UNKNOWN_URL_SCHEME`, `ERR_DISALLOWED_URL_SCHEME`) | `it redirected to an address that is not valid ...`, or `it went to an address that is not http: or https: ...` |
| more than 10 redirects | `it redirected more than 10 times, so the scan stopped following it` |
| the page answers with a file to download | `it answered with a file to download, and downloads are refused` |
| the page moves itself to a scheme that is not `http:` or `https:`, such as `about:blank` | `it went to an about: address, which is not http: or https:` |
| a page after the first, or a state, does not answer (connection refused, host not found, no answer in time) | `it did not answer: the connection was refused`, `... the host name was not found`, `... no answer within 30 seconds`, or `... the browser reported ERR_<NAME>` |
| a step of a state fails | `step 2 (click button 'Menu') failed: <why>`; the reasons are in `docs/STEPS.md` |
| the steps of a state have not finished by its limit | `its steps did not finish within 60 seconds` |
| the page has not finished loading 60 seconds after the first request | `it did not finish loading within 60 seconds` |
| axe-core has not finished 60 seconds after the first request | `the scan did not finish within 60 seconds` |
| the page moves to another address while axe-core reads it | `it went to another address while it was being scanned` |
| the page's own frame went to an address a private-network rule stopped | `it went to a loopback, link-local or private address, which a public page may not reach, and the scan stopped it (--allow-private lets it through)` |
| with `--offline`, the page's own frame went (or was redirected) to an address that is not on this machine | `it went to an address that is not on this machine, and --offline stopped it` |
| with `--same-origin`, the page's own frame went (or was redirected) to another origin | `it went to another origin, and --same-origin stopped it` |
| `scan.json` would be over 50 MB even with one element per finding | `its results were larger than the 52428800 byte limit on scan.json, even cut down` |

The 60 seconds are the spec's limit for one state, from its first request to the end of axe-core; `--timeout <seconds>`
sets it. On the command line the line reads `<address> was not scanned: <reason>.` for the default state, and
`<address> was not scanned in the state "menu-open": <reason>.` for another. The run goes on with every other page
and state, and the exit is 1.

## Ctrl-C

Ctrl-C closes the browser, which deletes its temporary profile folder, and exits 130. Nothing is left in the
scans folder: a scan's folder is made and written, whole, only after the page has been scanned, and in one
unbroken step, so Ctrl-C comes before it or after it.
