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

It never says a site is "accessible" or "compliant". Automated checks find some problems, not all of them,
and every report says what a scan cannot see.

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

## Build it from a clone

You need Node 24 or newer.

```sh
git clone https://github.com/johnfrog76/a11y-genie.git
cd a11y-genie
npm ci && npm run build && npm link
a11y-genie --version
```

`npm test`, `npm run lint` and `npm run typecheck` check it. [AGENTS.md](AGENTS.md) says how the repository
is laid out and the rules a change must keep.

## Licence

[MIT](LICENSE). The third-party code it uses, and those licences, are listed in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

## Contributing

See [SECURITY.md](SECURITY.md) to report a security problem, and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
