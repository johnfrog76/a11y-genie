# The command line

Every command and flag that `a11y-genie --help` lists today. `--help` is the short form of this page; where the
two ever differ, `--help` is right, and a test (`test/unit/cli-doc.test.ts`) fails when a command or flag is
missing here or named here without being real.

```sh
a11y-genie --help
a11y-genie --version
a11y-genie <command> [<url>] [flags]
```

`--version` prints the version and exits 0, wherever it is on the line. So does `--help`: with no arguments at all,
or anywhere on the line (`a11y-genie scan --help`), it prints the same help. There is no help of its own for a
command.

A flag takes its value after a space or an equals sign (`--timeout 30` or `--timeout=30`). A flag that is not in
the table below, or a flag a command does not take, is a refusal (exit 2): one `Error:` line, one `Hint:` line,
nothing scanned or written.

## The commands

| Command | What it does | Needs a browser |
| --- | --- | --- |
| [`scan`](#scan) | Loads each page, in each state, runs axe-core and A11y Genie's own checks, and writes a scan | yes |
| [`check`](#check) | Scans as `scan` does, then compares with an earlier scan: new, still open, fixed | yes |
| [`narrate`](#narrate) | Presses the keys of a flow and writes what a screen reader would say after each | yes |
| [`rules`](#rules) | Lists every rule A11y Genie runs | no |
| [`prompt`](#prompt) | Prints the prompt file for a coding agent | no |

`--help` also names four commands marked *coming, none works yet*. They are not documented here.

### `scan`

Loads each page in a browser with a new, empty profile, in each state it is asked for, runs axe-core and the
keyboard checks on it, and writes `scan.json` and `report.md` to a new folder (see *Where output goes*, below).

```sh
a11y-genie scan <url> [flags]
a11y-genie scan [<url>] --config <file> [flags, but not --states]
```

```sh
a11y-genie scan http://localhost:5173
a11y-genie scan http://localhost:5173 --states "menu-open: click button 'Menu'; wait menu" --fail-on serious
a11y-genie scan --config a11y-genie.yaml
```

It takes one address, which must start with `http://` or `https://`. To scan a built site, serve it first. With
`--config`, the address is optional when the file has a `baseUrl`; one given here takes its place. `--states` and
`--config` cannot be used together.

Exit 0: no violation at or above `--fail-on`. Exit 1: a violation, or a page or state that could not be scanned.
Exit 2: a refusal. When the site was scanned before, the first line says what is new and what is fixed since
then, or why the two cannot be compared; the exit reads only this scan. See [EXIT-CODES.md](EXIT-CODES.md).

### `check`

Scans as `scan` does, with the same flags, then compares with an earlier scan, by finding and element: each
finding is *new*, *still open* or *fixed*. Its first line counts them, such as `2 fixed, 0 new, 3 still open
(worst: serious, color-contrast on settings)`.

```sh
a11y-genie check --baseline <scan> [<url>] [scan's flags]
```

```sh
a11y-genie scan http://localhost:5173
a11y-genie check --baseline "<the folder or the scan.json that was written>" http://localhost:5173
```

`--baseline` is required. Exit 0: no new violation at or above `--fail-on` (findings still open from the baseline
do not fail it). Exit 1: a new one, or a page or state that was not scanned; the baseline's findings there read
*still open* and *unverified*, never *fixed*. A baseline of another site, or of other pages, states or `--tags`,
is a refusal (exit 2), as is a baseline that is a narration. The comparison itself is in [JSON.md](JSON.md).

### `narrate`

Loads the page, presses the keys of `--flow` one at a time, and after each says what a screen reader would: the
focused element's name, then its role and state, read from the browser's accessibility tree. After Enter, Space
or a click it also says where focus went, the name of a dialog that opened, and text added to a live region.

```sh
a11y-genie narrate <url> --flow "<steps>" [flags]
```

```sh
a11y-genie narrate http://localhost:5173 --flow "Tab; Tab; Enter"
```

The transcript is printed, and written to `narration/flow.txt` in the scan folder beside `scan.json`. A step that
leaves focus on a control with no name is a finding, `genie/unnamed-step` (see [CHECKS.md](CHECKS.md)). `narrate`
runs no axe-core and no keyboard walk. It takes `scan`'s flags, except `--states`, `--config` and `--tags`, which
are about pages and rules, and it adds `--flow`. A flow is at most 200 steps.

Exit 0: no unnamed step. Exit 1: one, or a flow that stopped before its last step (the transcript says why).
Exit 2: a refusal. The step grammar is in [STEPS.md](STEPS.md).

### `rules`

Lists every rule A11y Genie runs: axe-core's, at the version it pins, and its own `genie/` rules, each with its
impact, its WCAG criteria and its tags.

```sh
a11y-genie rules [--tags <list>] [--json]
```

```sh
a11y-genie rules
a11y-genie rules --tags wcag2aa
a11y-genie rules --json
```

It needs no browser and no network, and takes no address. `--tags` keeps the rules that carry at least one of the
tags. `--json` prints one JSON document instead of the table ([JSON.md](JSON.md), *`rules --json`*). Exit 0, or 2
on a refusal. What the rules check is in [CHECKS.md](CHECKS.md).

### `prompt`

Prints the prompt file for a coding agent: how to run scan, fix, rescan on a project it can edit, and when to
stop.

```sh
a11y-genie prompt
```

It takes no flag and no argument, and needs no browser and no network. Exit 0, or 2 if given an argument.

## The flags

One row for each flag. The last column says which commands take it. A flag a command does not take is a refusal
there. `scan` takes every flag that lists `scan`; `check` takes those and `--baseline`.

| Flag | Takes | Default | What it does | Commands |
| --- | --- | --- | --- | --- |
| `--states` | `"<name>: <steps>"`, repeatable | none | A state of the page beside the default one. Steps are separated by `;` (see [STEPS.md](STEPS.md)). Each state is scanned from a fresh load. Cannot be used with `--config` | scan, check |
| `--config` | a file | none | Scan the pages and states a YAML file lists, and narrate its workflows ([CONFIG.md](CONFIG.md)) | scan, check |
| `--flow` | `"<steps>"` | none, required | The keys to press, separated by `;`, such as `"Tab; Tab; Enter"`. A step may also be `Tab to button 'Save'` or `click ...` ([STEPS.md](STEPS.md)) | narrate |
| `--baseline` | a `scan.json`, or the scan folder it is in | none, required | The earlier scan to compare with | check |
| `--timeout` | seconds, above 0 and up to 3600 | 60 | How long one page in one state may take, from its first request to the end of its scan. Past it, that state reads *not scanned* | scan, check, narrate |
| `--max-tabs` | a whole number, 1 to 1000 | 200 | The most Tab presses in the keyboard walk of each state, and in a `Tab to` step. A walk that reaches it is recorded as cut | scan, check, narrate |
| `--storage-state` | a file | none | A Playwright storage state file, for signed-in pages. It is read, never copied into the scan, and never printed | scan, check, narrate |
| `--json` | none | off | Print `scan.json` on stdout. Everything else goes to stderr | scan, check, narrate, rules |
| `--out` | a folder | the per-user scans folder | Where the scan folder goes | scan, check, narrate |
| `--format` | `md`, `json`, or `md,json`; repeatable | `md,json` | Which reports to write beside `scan.json`, which is always written | scan, check, narrate |
| `--browser-channel` | `chrome`, `msedge` or `chromium` | `chrome` | Which browser to launch. `chrome` and `msedge` are the ones installed on this machine; `chromium` is Playwright's own, downloaded once if it is not there yet | scan, check, narrate |
| `--no-download` | none | off | Never download Playwright's Chromium: with no Chrome, refuse instead | scan, check, narrate |
| `--allow-private` | none | off | Let a public page reach loopback, link-local and private addresses, which are blocked by default. A target that is itself one of them is never limited | scan, check, narrate |
| `--tags` | a comma-separated list | none | Run exactly these axe-core tags, such as `wcag2a,wcag2aa,best-practice`. Without it, axe-core's default rule set runs. The landmark rules and `genie/no-landmarks` need `best-practice`. On `rules`, keep only the rules with one of these tags | scan, check, rules |
| `--fail-on` | `critical`, `serious`, `moderate` or `minor` | `minor` | The lowest impact that makes the exit 1. Findings below it are still listed, and the exit is 0. Advice and *needs review* items never change the exit, and a page that could not be scanned always exits 1 | scan, check, narrate |
| `--same-origin` | none | off | Abort every request to an origin other than the page's own, and say so in the report. Some of the page's content may then be missing. Not stopped: a WebSocket opened from a dedicated worker, a shared worker's requests, and WebRTC ([SECURITY.md](../SECURITY.md), *Known gaps*) | scan, check, narrate |
| `--offline` | none | off | Only a page on this machine (`127.0.0.1`, `::1`, `localhost`, `*.localhost`) can be scanned. Every request the page makes off this machine is aborted and noted. The browser is also launched so that what it starts on its own stays on the machine: every connection off it goes to a proxy on this machine that refuses it, WebRTC sends no UDP, and no name is looked up but `localhost` and `*.localhost` ([ARCHITECTURE.md](ARCHITECTURE.md), *--offline at the launch*). No browser is downloaded | scan, check, narrate |
| `--commit` | a sha, tag or branch name | `GITHUB_SHA` when it is set | The commit the scan is of, recorded in `scan.json`. Letters, digits, `.`, `_`, `/` and `-`, up to 100 | scan, check, narrate |

Notes on the flags:

- **The browser.** With no Chrome, and no `--browser-channel`, A11y Genie says so and downloads Playwright's
  Chromium once. With `--browser-channel` named, it uses that browser or refuses. `--offline` and
  `--no-download` both stop the download.
- **`--tags`** takes the tags axe-core's own rules carry (`wcag2a`, `wcag2aa`, `wcag21aa`, `best-practice`,
  `cat.aria` and the rest); an unknown one is a refusal that lists them. The tags go in as given: `wcag2a` alone
  does not also run `wcag2aa`. A11y Genie's own rules run under the tags they carry (`a11y-genie rules` shows
  them).
- **`--out`** is checked before anything is scanned. Without it, a scan goes under the per-user folder:
  `~/Library/Application Support/a11y-genie` on macOS, `$XDG_DATA_HOME/a11y-genie` or `~/.local/share/a11y-genie`
  on Linux, `%LOCALAPPDATA%\a11y-genie` on Windows.
- **`--storage-state`** is a JSON file with `cookies` and `origins` lists, as Playwright writes one. It is never
  copied into the scan folder.
- The private-network and origin rules (`--allow-private`, `--same-origin`, `--offline`) are two of the defences
  against a hostile page. [ARCHITECTURE.md](ARCHITECTURE.md) (*Hostile pages*) lists them all.

## Where output goes

- **Standard output** holds what a command is asked to print: the table of `rules`, the prompt file of `prompt`,
  the version, the help, and, under `--json`, the one `scan.json` document. Nothing else is on stdout under
  `--json`, so it can be piped.
- **Standard error** holds the refusals (`Error:` and `Hint:`) and, under `--json`, the lines a person reads.
- **The lines for a person** of `scan`, `check` and `narrate` go to stdout without `--json`: what is new or
  fixed, anything not scanned, how many problems, what the page tried and was stopped from doing, how many items
  need a person to look, and the folder written.
- **The files** go in a new folder for each scan, outside the project that is scanned: `scan.json`, `report.md`
  unless `--format json`, and `narration/` for a narrated flow. Nothing is written inside a scanned project.
  Their fields are in [JSON.md](JSON.md).
- A refusal prints nothing to stdout and writes nothing.

## The genie

At a terminal, A11y Genie draws its genie and his bottle once: above the help, and at the start of a `scan`,
`check` or `narrate`, on stderr, after the arguments are accepted. It is shown only when all of these hold:

- the stream it would go to is a terminal (stdout for `--help`, stderr for a run);
- `--json` is not given;
- the `CI` environment variable is not set to a true value (unset, empty, `0` and `false` count as not CI);
- the terminal is at least as wide as the drawing, or does not report its width.

It is never in a file, in a pipe, or in `--json` output. `NO_COLOR` does not hide it, since it has no colour.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | No finding at or above `--fail-on` (for `check`, no new one). Findings below it are still listed |
| 1 | A finding at or above `--fail-on` (for `check`, a new one), or a page or state that was not scanned |
| 2 | A refusal: one `Error:` line, one `Hint:` line, nothing written |
| 3 | Something unexpected |
| 129, 130, 143 | The terminal was closed, Ctrl-C, or a plain `kill`, after the browser is closed |

[EXIT-CODES.md](EXIT-CODES.md) has every refusal's words, and how a page that does not answer is decided.

## Where to read more

- [EXIT-CODES.md](EXIT-CODES.md): exit codes, every refusal, and what *not scanned* means.
- [STEPS.md](STEPS.md): the grammar of `--states`, `--flow` and a config's steps.
- [CONFIG.md](CONFIG.md): the YAML file of `--config`.
- [JSON.md](JSON.md): `scan.json`, `report.md`, `rules --json` and the comparison `check` makes.
- [CHECKS.md](CHECKS.md): what each rule finds, and what a scan cannot see.
- [KNOWN-GAPS.md](KNOWN-GAPS.md): what A11y Genie does not do yet, and its known limits.
