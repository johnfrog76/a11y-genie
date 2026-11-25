# Exit codes and refusals

What `a11y-genie` exits with, and what it says when it refuses. The codes are in `src/exit-codes.ts`.

| Code | Meaning for `scan` |
| --- | --- |
| 0 | Scanned, and no violation at or above `--fail-on` (any violation, by default). |
| 1 | Scanned, and at least one violation at or above `--fail-on`; or a page or state of the run was **not scanned** (below), whatever `--fail-on` says. |
| 2 | A stated refusal: one `Error:` line and one `Hint:` line on stderr, nothing on stdout, nothing scanned or written. |
| 3 | Something unexpected: one `Error:` line and one `Hint:` line saying where to report it. The stack trace prints only when `A11Y_GENIE_DEBUG` is set. |
| 129 | The terminal was closed (`SIGHUP`). Like 130, after the browser is closed. |
| 130 | Ctrl-C. |
| 143 | A plain `kill` (`SIGTERM`). Like 130, after the browser is closed. |

With `--config`, or with `--states`, the run covers several pages or states, and the exit code reads all of them: 1 when any
violation was found in any state, or any page or state was *not scanned*; 0 only when every one was scanned and
none had a violation.

A scan with no findings says how much it checked. It never tells you a site has no problems, or that it meets a standard: automated checks find some problems, not all of them.

**`--fail-on <impact>`** (`critical`, `serious`, `moderate` or `minor`; default `minor`, so any violation fails the
run) sets the lowest impact that makes the exit 1. With `--fail-on serious`, a page whose only findings are
moderate exits 0: the findings are still in `scan.json` and `report.md`, and the command line says
`None is serious or worse, so the exit is 0 (--fail-on serious).` Three things never depend on it:

- A page that was **not scanned** always exits 1.
- *Advice* never changes the exit.
- *Needs review* items (what axe-core or an own check could not decide, so a person looks) never change the exit, with any
  `--fail-on`. They are counted in `summary.needsReview` and listed, and the command line says how many.

`scan.json` records the floor in `options.failOn`, and its `exit` is the code the run ends with.

**`check --baseline <scan>`** scans as `scan` does, compares with the baseline (docs/JSON.md, *Compared with an
earlier scan*), and exits on what is new:

| Code | Meaning for `check` |
| --- | --- |
| 0 | Every page and state was scanned, and no **new** violation at or above `--fail-on`. Findings still open from the baseline do not fail it, and neither do fixed ones. |
| 1 | A new violation at or above `--fail-on` (a finding the baseline did not have, or a new element on one it had); or a page or state **not scanned**, whatever `--fail-on` says. The baseline's findings on a page or state not scanned read still open and unverified, never fixed. A finding found only in a state the baseline asked for and did not scan reads unverified, not new, and does not make the exit 1. |
| 2, 3, 130 | As for `scan`. A baseline that cannot be compared is a refusal (below). |

Its first line counts the findings, such as `2 fixed, 0 new, 3 still open (worst: serious, color-contrast on
settings)`, and when it exits 0 with findings still open it says `None of them is new, so the exit is 0: the ones
still open were in the baseline.`, or, when one of them was found only in states the baseline did not scan,
`None of them is new, so the exit is 0: the ones still open were in the baseline, or were found only in states it
did not scan.` Its *Found* line counts only what this run found: a baseline finding on a page or state not scanned
this time is said apart, as `1 more still open, not checked this time.` Plain `scan` compares with the site's last scan only for its first line
(`4 new, 2 fixed since the last scan`, or `Not comparable with the last scan: different pages, states or tags.`):
its exit reads only the scan just run.

**`narrate <url> --flow "<steps>"`** exits as `scan` does, over the flow: 0 when every step ran and none left focus on a
control with no name (`genie/unnamed-step`, serious) at or above `--fail-on`; 1 when one did, or when the flow stopped
before its last step (a step that fails on the page, a page a network rule stopped, the time limit), whatever
`--fail-on` says, so a flow nobody heard to the end never exits 0. Its refusals (2) are below. The same holds for
the `workflows` of a `scan --config`: a flow not narrated to its end makes the scan exit 1.

`rules` exits 0 on success and 2 on a refusal; it scans nothing. So does `prompt`, which prints the prompt file
and takes no argument.

Not built yet, with a place waiting in `src/exit-codes.ts`:

- **Exit 4**, a refusal after something was already written. Only a later command (`cards --toolkit`) can reach it.

`--version` wins anywhere on the line: `a11y-genie rules --version` and `a11y-genie scan <url> --version` print the
version and exit 0, before the command reads its other arguments. (It is not only a top-level flag, so a
person who adds it to any command line gets the answer, not a refusal.)

## Refusals the command can reach

Every refusal is exit 2 and happens before anything is written: the scans folder and `--out` are left as they were.
`check` takes every flag `scan` does, with the same refusals, and `--baseline`; its own refusals come before a
browser opens, too.

| Refused | `Error:` | `Hint:` |
| --- | --- | --- |
| An unknown command | `unknown command or flag: scna` | `run a11y-genie --help to see what exists so far.` |
| An unknown flag after `rules` (or `--tags` with an unknown or empty tag, as for `scan`) | the words of Node's argument parser, such as `Unknown option '--nope'. ...` | `run a11y-genie --help to see what exists so far.` (for `--tags`, the hints below) |
| An argument after `rules` | `rules takes no argument, and got: "extra"` | the same hint |
| An argument after `prompt` | `prompt takes no argument, and got: "extra"` | the same hint |
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
| A `--max-tabs` that is not a whole number from 1 to 1000 | `--max-tabs takes a whole number of Tab presses from 1 to 1000, not "lots".` | `for example --max-tabs 500. The default is 200.` |
| A `--storage-state` that is missing or is not a Playwright storage state | `--storage-state cannot be read: <path> (ENOENT)`, or `... is not a Playwright storage state: <path>` | `give the path to a Playwright storage state file.` |
| `narrate` with no `--flow` | `narrate needs --flow: the steps to drive.` | `run: a11y-genie narrate <url> --flow "Tab; Tab; Enter"` |
| `narrate` with no address | `narrate needs a page address to narrate.` | `run: a11y-genie narrate <url> --flow "<steps>"` |
| A `--flow` that does not parse, is empty, or sets media (`colorScheme`, `viewport`, `reducedMotion`) | `--flow step 2 "clik", column 6: "clik" is not a step.`; every message is in `docs/STEPS.md` | what a step is, or how to fix this one |
| A `--flow` of more than 200 steps, or a config workflow of more than 200 | `--flow has 201 steps, and narrate takes at most 200.` | `narrate one task at a time: split the flow in two.` (a config: `split it into workflows of their own.`) |
| `--states`, `--config` or `--tags` after `narrate` | the words of Node's argument parser, such as `Unknown option '--states'. ...` | the same hint |
| `check --baseline` given a `narrate` record | `--baseline is a narration, which has no axe-core results to compare with.` | `give the scan.json of a scan: a11y-genie scan <url>, then a11y-genie check --baseline <scan> <url>` |
| A target that is not `http:` or `https:` | `only http: and https: addresses can be scanned, and this one is file:` (or `javascript:`, `data:`) | `give a full address that starts with http:// or https://. To scan a built site, serve it first, for example: npx serve dist` |
| An unknown `--fail-on` impact | `unknown --fail-on impact: "severe"` | `use one of: critical, serious, moderate, minor.` |
| An unknown `--tags` tag | `unknown --tags value: "nope"` | `use axe-core tags separated by commas, such as wcag2a, wcag2aa, wcag21aa or best-practice. The landmark rules need best-practice.` |
| An empty part of `--tags` (`--tags wcag2a,` or `--tags ""`) | `--tags needs one or more axe-core tags, separated by commas, and one is empty.` | `use axe-core tags separated by commas, such as wcag2a,wcag2aa,best-practice.` |
| `--offline` with a target that is not loopback (`127.0.0.0/8`, `::1`, `localhost`, `*.localhost`) | `--offline allows only a page on this machine, and http://example.com is not one.` | `serve the page on localhost, 127.0.0.1 or [::1], or run without --offline.` |
| A target that is not an address | `not a web address: "example"` | the same hint |
| A target that does not answer | `http://127.0.0.1:5173 did not answer: the connection was refused.`, `... the host name was not found.`, `... no answer within 30 seconds.` (or the page time limit, `--timeout`, when that is shorter: the number is always the limit that bound), or `... the browser reported ERR_<NAME>.` | `check the address, and that the server is running.` |
| No Chrome, with `--no-download` | `Chrome was not found on this machine, and --no-download stops A11y Genie from downloading Playwright's Chromium.` | `Install Chrome, or run with --browser-channel msedge if that one is installed, or download Playwright's Chromium yourself: npx playwright-core@1.65.1 install --no-shell chromium` |
| No Chrome, with `--offline` (and no `--no-download`) | `Chrome was not found on this machine, and --offline stops A11y Genie from downloading Playwright's Chromium.` | the same hint as `--no-download` |
| `--browser-channel chromium --offline`, with no Chromium in Playwright's cache | `Playwright's Chromium is not installed on this machine, and --offline stops A11y Genie from downloading it.` | the same hint as `--no-download` |
| `--browser-channel chromium --no-download`, with no Chromium in Playwright's cache | `Playwright's Chromium is not installed on this machine, and --no-download stops A11y Genie from downloading it.` | `download it yourself: npx playwright-core@1.65.1 install --no-shell chromium, or run with another --browser-channel.` |
| A named `--browser-channel chrome` that is not installed (never replaced) | `Chrome was not found on this machine.` | `Install Chrome, or run with --browser-channel chromium to use Playwright's Chromium (downloaded once), or msedge if that one is installed.` |
| A `--browser-channel msedge` that is not installed (never replaced) | `Microsoft Edge was not found on this machine.` | `Install Microsoft Edge, or run with --browser-channel chrome, or chromium to use Playwright's Chromium (downloaded once).` |
| The Chromium download did not finish | `the download of Playwright's Chromium did not finish: the installer exited with code <n>.` (or `... was stopped by <signal>`) | `check the network and run again, or download it yourself: npx playwright-core@1.65.1 install --no-shell chromium` |
| A temp folder that cannot be made (`TMPDIR` missing, read-only or full), for `scan`, `check` and `narrate` | `cannot make a temp folder in /nonexistent (ENOENT)` | `point TMPDIR at a folder that exists and that you may write to.` (`TEMP` on Windows) |
| An `--out` that is a file | `--out is not a folder: <path>` | `give a folder, or a new name inside a folder that exists.` |
| An `--out` whose parent is missing, or a file | `--out cannot be made, because the folder above it does not exist: <path>` (or `the path above it is not a folder`) | `make the folder above it first, or choose another --out.` |
| An `--out` with no permission | `--out cannot be written to: <path>` (or `... because the folder above it cannot be written to`) | `choose a folder you may write to.` |
| A `--commit`, or a `GITHUB_SHA` with no `--commit`, that is not a sha, tag or branch name | `--commit is not a commit: "a b".` (or `GITHUB_SHA is not a commit: ...`) | `give a commit sha, or a tag or branch name: letters, digits, '.', '_', '/' and '-', up to 100.` |
| `check` with no `--baseline` | `check needs --baseline: the scan to compare with.` | `scan first, then give its scan.json or its folder: a11y-genie check --baseline <scan> <url>` |
| `check` with no address and no `--config`, or more than one | `check needs a page address to scan.`, `check takes one page, and got more: two` | as for `scan` |
| A `--baseline` that is missing, unreadable, or a folder with no `scan.json` | `--baseline cannot be read: <path> (ENOENT)` | `give a scan.json that a11y-genie scan wrote, or the scan folder it is in, such as <scans>/localhost-5173/2026-11-19T20-14-03Z.` |
| A `--baseline` that is not a file (a device, a pipe) | `--baseline is not a file: <path>` | the same hint |
| A `--baseline` over 50 MB, the limit on `scan.json` | `--baseline is over the 52428800 byte limit on scan.json: <path>` | the same hint |
| A `--baseline` that is not JSON (or not UTF-8), or has no `schema` | `--baseline is not a scan.json: <path> is not JSON.` (or `... has no schema version.`) | the same hint |
| A `--baseline` of another `schema` major | `--baseline is a scan.json of schema 2, and this version of A11y Genie reads schema 1 (1.x).` | `scan again with this version to make a baseline it can read, or run the version that wrote it.` |
| A `--baseline` the schema does not hold, or that lists a finding id twice | `--baseline is not a scan.json A11y Genie wrote: <path> does not match schema/scan-1.json at .findings[0].impact.` (and `, and 2 more` when there are more); `... lists the finding <id> twice.` It names where, never the value the file held | the same hint |
| A `--baseline` of another site | `--baseline is a scan of http://127.0.0.1:9, and this check is of http://127.0.0.1:8.` | `comparing two sites' findings means nothing: give a baseline of the same site, or scan this one first for one.` |
| A `--baseline` of other pages, states or tags than the check | `--baseline is not comparable with this check: it scanned the pages home, and this check scans settings.` (or `it scanned the page home in the states default, and this check scans it in dark, default.`, or `it ran axe-core's default rule set, and this check runs the tags wcag2a.`) | `run check with the arguments the baseline was scanned with: the same pages, the same states and the same --tags.` |

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
| a page after the first, or a state, does not answer (connection refused, host not found, no answer in time) | `it did not answer: the connection was refused`, `... the host name was not found`, `... no answer within 30 seconds` (or `--timeout`, when that is shorter), or `... the browser reported ERR_<NAME>` |
| a step of a state fails | `step 2 (click button 'Menu') failed: <why>`; the reasons are in `docs/STEPS.md` |
| the steps of a state have not finished by its limit | `its steps did not finish within 60 seconds` |
| the page has not finished loading 60 seconds after the first request | `it did not finish loading within 60 seconds` |
| axe-core has not finished 60 seconds after the first request | `the scan did not finish within 60 seconds` |
| the page moves to another address while axe-core reads it | `it went to another address while it was being scanned` |
| the page's own frame went to an address a private-network rule stopped | `it went to a loopback, link-local or private address, which a public page may not reach, and the scan stopped it (--allow-private lets it through)` |
| with `--offline`, the page's own frame went (or was redirected) to an address that is not on this machine | `it went to an address that is not on this machine, and --offline stopped it` |
| with `--same-origin`, the page's own frame went (or was redirected) to another origin | `it went to another origin, and --same-origin stopped it` |
| `scan.json` would be over 50 MB even with one element per finding and no walk stops | `its results were larger than the 52428800 byte limit on scan.json, even cut down` |

The 60 seconds are the limit for one state, from its first request to the end of axe-core; `--timeout <seconds>`
sets it. On the command line the line reads `<address> was not scanned: <reason>.` for the default state, and
`<address> was not scanned in the state "menu-open": <reason>.` for another. The run goes on with every other page
and state, and the exit is 1.

## Ctrl-C

Ctrl-C closes the browser, which deletes its temporary profile folder, and exits 130. A plain `kill`
(`SIGTERM`) and a closed terminal (`SIGHUP`) do the same and exit 143 and 129. A second signal while the browser
is closing exits at once, and a browser that has not closed after five seconds is left to the system: the run exits
with the signal's code anyway, and its temporary folder goes with it. On Windows `SIGTERM` is not delivered, and `SIGHUP` arrives when the console window is
closed. Nothing is left in the
scans folder: a scan's folder is made and written, whole, only after the page has been scanned, and in one
unbroken step, so Ctrl-C comes before it or after it.
