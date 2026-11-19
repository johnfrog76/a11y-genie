# Exit codes and refusals

What `a11y-genie` exits with, and what it says when it refuses. The codes are in `src/exit-codes.ts`.

| Code | Meaning for `scan` |
| --- | --- |
| 0 | Scanned, and no findings. |
| 1 | Scanned, and at least one finding; or the page answered and was **not scanned** (below). |
| 2 | A stated refusal: one `Error:` line and one `Hint:` line on stderr, nothing on stdout, nothing scanned or written. |
| 3 | Something unexpected: one `Error:` line and one `Hint:` line saying where to report it. The stack trace prints only when `A11Y_GENIE_DEBUG` is set. |
| 130 | Ctrl-C. |

A scan with no findings says how much it checked. It never says a site is accessible.

Not built yet, with a place waiting in `src/exit-codes.ts`:

- **Exit 4**, a refusal after something was already written. Only a later command (`cards --toolkit`) can reach it.

## Refusals the command can reach

Every refusal is exit 2 and happens before anything is written: the scans folder and `--out` are left as they were.

| Refused | `Error:` | `Hint:` |
| --- | --- | --- |
| An unknown command | `unknown command or flag: scna` | `run a11y-genie --help to see what exists so far.` |
| An unknown flag after `scan` | the words of Node's argument parser, such as `Unknown option '--nope'. To specify a positional argument starting with a '-', place it at the end of the command after '--', as in '-- "--nope"` | the same hint |
| An extra argument | `scan takes one page, and got more: two` | the same hint |
| No address | `scan needs a page address to scan.` | `run: a11y-genie scan <url>` |
| A target that is not `http:` or `https:` | `only http: and https: addresses can be scanned, and this one is file:` (or `javascript:`, `data:`) | `give a full address that starts with http:// or https://. To scan a built site, serve it first, for example: npx serve dist` |
| A target that is not an address | `not a web address: "example"` | the same hint |
| A target that does not answer | `http://127.0.0.1:5173 did not answer: the connection was refused.`, `... the host name was not found.`, `... no answer within 30 seconds.`, or `... the browser reported ERR_<NAME>.` | `check the address, and that the server is running.` |
| No Chrome, with `--no-download` | `Chrome was not found on this machine, and --no-download stops A11y Genie from downloading Playwright's Chromium.` | `Install Chrome, or run with --browser-channel msedge if that one is installed, or download Playwright's Chromium yourself: npx playwright-core@1.65.1 install --no-shell chromium` |
| `--browser-channel chromium --no-download`, with no Chromium in Playwright's cache | `Playwright's Chromium is not installed on this machine, and --no-download stops A11y Genie from downloading it.` | `download it yourself: npx playwright-core@1.65.1 install --no-shell chromium, or run with another --browser-channel.` |
| A named `--browser-channel chrome` that is not installed (never replaced) | `Chrome was not found on this machine.` | `Install Chrome, or run with --browser-channel chromium to use Playwright's Chromium (downloaded once), or msedge if that one is installed.` |
| A `--browser-channel msedge` that is not installed (never replaced) | `Microsoft Edge was not found on this machine.` | `Install Microsoft Edge, or run with --browser-channel chrome, or chromium to use Playwright's Chromium (downloaded once).` |
| The Chromium download did not finish | `the download of Playwright's Chromium did not finish: the installer exited with code <n>.` (or `... was stopped by <signal>`) | `check the network and run again, or download it yourself: npx playwright-core@1.65.1 install --no-shell chromium` |
| An `--out` that is a file | `--out is not a folder: <path>` | `give a folder, or a new name inside a folder that exists.` |
| An `--out` whose parent is missing, or a file | `--out cannot be made, because the folder above it does not exist: <path>` (or `the path above it is not a folder`) | `make the folder above it first, or choose another --out.` |
| An `--out` with no permission | `--out cannot be written to: <path>` (or `... because the folder above it cannot be written to`) | `choose a folder you may write to.` |

With no Chrome and no `--browser-channel`, the run does not refuse: it says so in one line on stderr and downloads
Playwright's Chromium once (docs/ARCHITECTURE.md). That line comes before the download, so a download that then
fails prints it, and then its `Error:` and `Hint:`: three lines on stderr. Every other refusal prints two.
The version in the hints is the installed playwright-core's.

`--out` may name a folder that exists, or a new folder whose parent exists. A scan folder that turns out not to be
writable when the write is tried (a race, or the default scans folder) is the same refusal, `cannot write the
scan under <folder>: <code>`.

## How a page that does not answer is decided

The browser gets 30 seconds (`NAVIGATION_TIMEOUT_MS` in `src/run-scan.ts`) for the first page to answer. A refused
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
| the page has not finished loading 60 seconds after the first request | `it did not finish loading within 60 seconds` |
| axe-core has not finished 60 seconds after the first request | `the scan did not finish within 60 seconds` |
| the page moves to another address while axe-core reads it | `it went to another address while it was being scanned` |
| `scan.json` would be over 50 MB even with one element per finding | `its results were larger than the 52428800 byte limit on scan.json, even cut down` |

The 60 seconds are the spec's limit for one state, which `--timeout` will set in a later milestone. On the command
line the line reads `<address> was not scanned: <reason>.`

## Ctrl-C

Ctrl-C closes the browser, which deletes its temporary profile folder, and exits 130. Nothing is left in the
scans folder: a scan's folder is made and written, whole, only after the page has been scanned, and in one
unbroken step, so Ctrl-C comes before it or after it.
