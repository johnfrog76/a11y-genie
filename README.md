# A11y Genie

An accessibility scanner for agents and people. It drives a real browser through a site's pages and their
states, runs axe-core and its own checks, and writes a plain-language report with the fixes, worst first,
as JSON, Markdown and HTML.

It never says a site is "accessible" or "compliant". Automated checks find some problems, not all of them,
and every report says what a scan cannot see.

A11y Genie is in early development. Nothing here is ready to use yet: today the command only answers
`--version` and `--help`.

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
