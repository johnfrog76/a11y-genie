# A11y Genie

```text
                    ,-.
                   ( (_)
            .-~~~~~' '~~~~~-.
           /  .---.   .---.  \
          |   |===|   |===|   |
          |   '-o-'   '-o-'   |
           \     -.____.-~'  /
             '-._________.-'
        .-~-.(  ~-.___.-~  ).-~-.
       (__.-~-.__)~~~~~(__.-~-.__)
                   /^\
                  /___\
                   | |
                   | |
                .-'   '-.
               /  ~   ~  \
               |  a11y   |
               '._______.'
```

An accessibility scanner for agents and people. It drives a real browser through a site's pages and their
states, runs axe-core and its own checks, and writes a plain-language report with the fixes, worst first,
as JSON, Markdown and HTML.

It never tells you a site has no problems, or that it meets a standard:
automated checks find some problems, not all of them.
Every report says what a scan cannot see.

A11y Genie is in early development. Today:

- `scan <url>` scans a page, or the pages and states in a config file, with axe-core and A11y Genie's own
  checks in the installed Chrome, and writes `scan.json` and `report.md`, worst first, in plain words.
  [docs/JSON.md](docs/JSON.md) says what they hold, and [docs/CONFIG.md](docs/CONFIG.md) the config file.
- `check --baseline <scan> <url>` rescans and says what is new, still open and fixed since that scan.
- `rules` lists every rule a scan runs.
- `prompt` prints the prompt file for a coding agent,
  [agentic/fix-loop.prompt.md](agentic/fix-loop.prompt.md): scan, fix, rescan with `check --baseline`, and when to stop.

## The browser

A11y Genie uses the Chrome already installed on your machine, or Microsoft Edge with
`--browser-channel msedge`. Each run gets a new, empty browser profile, deleted afterwards; your own profile,
cookies and sign-ins are never opened. With no Chrome, it says so and downloads Playwright's Chromium once
(about 200 MB); `--no-download` refuses instead, and `--browser-channel chromium` uses that Chromium directly.
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) says how.

## Quick start

A11y Genie is not on npm yet, so build it from a clone. You need Git and Node 24 or newer.

```sh
git clone https://github.com/johnfrog76/a11y-genie.git
cd a11y-genie
npm ci && npm run build && npm link
a11y-genie --version
```

`npm link` puts the `a11y-genie` command on your path. `npm unlink -g a11y-genie` takes it off again.

## Usage

Start the site you want to scan, then give A11y Genie one of its pages. Here the site runs on your own machine,
on port 5173:

```sh
a11y-genie scan http://localhost:5173/
```

It prints what it found, worst first, and the last line names the folder it wrote: `scan.json` and
`report.md`. The exit is 1 when it found a problem or could not scan the page, and 0 when it found none.
Finding none does not mean there are none: the report says what a scan cannot see.
[docs/EXIT-CODES.md](docs/EXIT-CODES.md) lists every exit code.

Fix something, then rescan against that first scan. It says what is fixed, what is new and what is still open:

```sh
a11y-genie check --baseline <the folder it wrote>/scan.json http://localhost:5173/
```

`a11y-genie --help` lists every command and flag.

## Work on it

`npm test`, `npm run lint` and `npm run typecheck` check a change. [AGENTS.md](AGENTS.md) says how the
repository is laid out and the rules a change must keep.

## Licence

[MIT](LICENSE). The third-party code it uses, and those licences, are listed in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

## Contributing

See [SECURITY.md](SECURITY.md) to report a security problem, and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
