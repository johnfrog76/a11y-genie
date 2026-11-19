# Exit codes and refusals

What `a11y-genie` exits with, and what it says when it refuses. The codes are in `src/exit-codes.ts`.

| Code | Meaning for `scan` |
| --- | --- |
| 0 | Scanned, and no findings. |
| 1 | Scanned, and at least one finding. |
| 2 | A stated refusal: one `Error:` line and one `Hint:` line on stderr, nothing on stdout, nothing scanned or written. |
| 3 | Something unexpected: one `Error:` line and one `Hint:` line saying where to report it. The stack trace prints only when `A11Y_GENIE_DEBUG` is set. |
| 130 | Ctrl-C. |

A scan with no findings says how much it checked. It never says a site is accessible.

Not built yet, with a place waiting in `src/exit-codes.ts`:

- **Exit 4**, a refusal after something was already written. Only a later command (`cards --toolkit`) can reach it.
- **Exit 1 for "not scanned"**, when a page, state or flow could not be scanned. It comes with the scans that can
  fail part-way. Today a scan loads its one page or refuses.

## Refusals M1 can reach

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
| No Chrome | `Chrome was not found on this machine, and A11y Genie cannot download a browser yet.` (Microsoft Edge for `--browser-channel msedge`) | `Install Chrome, or run with --browser-channel msedge if that one is installed.` |
| An `--out` that is a file | `--out is not a folder: <path>` | `give a folder, or a new name inside a folder that exists.` |
| An `--out` whose parent is missing, or a file | `--out cannot be made, because the folder above it does not exist: <path>` (or `the path above it is not a folder`) | `make the folder above it first, or choose another --out.` |
| An `--out` with no permission | `--out cannot be written to: <path>` (or `... because the folder above it cannot be written to`) | `choose a folder you may write to.` |

`--out` may name a folder that exists, or a new folder whose parent exists. A scan folder that turns out not to be
writable when the write is tried (a race, or the default scans folder) is the same refusal, `cannot write the
scan under <folder>: <code>`.

## How a page that does not answer is decided

The browser gets 30 seconds (`NAVIGATION_TIMEOUT_MS` in `src/run-scan.ts`) to load the first page. A refused
connection, a host name that does not resolve, any other `net::ERR_*` error and a timeout are all a refusal. A page that
answers with an error status, such as 404, is scanned: the server did answer.
A `--timeout` flag comes in a later milestone. Tests shorten the wait with `A11Y_GENIE_TEST_NAV_TIMEOUT_MS`, which
can only make the wait shorter.

## Ctrl-C

Ctrl-C closes the browser, which deletes its temporary profile folder, and exits 130. Nothing is left in the
scans folder: a scan's folder is made and written, whole, only after the page has been scanned, and in one
unbroken step, so Ctrl-C comes before it or after it.
