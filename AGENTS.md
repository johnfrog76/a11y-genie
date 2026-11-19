# Agents

For contributors and coding agents. A11y Genie is an accessibility scanner for agents and people.

## Commands

```sh
npm ci              # install exactly what the lockfile says
npm run lint        # ESLint, then Prettier --check
npm run typecheck   # tsc --noEmit
npm test            # builds, then runs vitest
npm run build       # tsc into dist/
npm run format      # Prettier --write
```

Run all five before you ask for a review. CI runs the same five in that order, once the repository is public.

## Layout

- `src/` holds the command. `src/cli.ts` is the entry point (`bin` points at `dist/cli.js`).
- `src/browser.ts` launches the installed browser; `src/refusal.ts` is the exit-2 refusal.
- `test/` holds the tests, in folders by kind. `test/cli/` runs the built `dist/`, so `npm test` builds first.
  `test/unit/` runs no browser. `test/browser/` launches the real installed Chrome and skips itself where
  Chrome is not installed.
- `test/fixtures/site/` holds the fixture pages, each with a comment naming the axe-core rule that must fire. `test/helpers/` holds the loopback fixture server and the no-network guard; `test/setup/` installs the guard for every test file.
- `docs/ARCHITECTURE.md` says how the parts work and why, including what was checked against a real browser.
- `THIRD-PARTY-NOTICES.md` ships in the package, and so does `dist/`. Nothing else does: `files` in
  `package.json` is an allow-list. Check it with `npm pack --dry-run` before changing it.

## Rules that are easy to break

1. **Never claim a site is accessible.** Not in output, reports, docs, tests or commit messages: no
   "accessible", "compliant", "passes" or "clean" said of a site. A scan finds some problems, not all of
   them, and says what it cannot see. A scan with no findings says how much it checked, never that all is well.
2. **One commit identity for the project.** Commits use the identity this repository's local git config
   sets. Don't change it, don't pass `--author`, and don't put any other name or email in a file.
3. **Pin every dependency exactly.** No `^` or `~` in `package.json`. A new runtime dependency is its own
   pull request.
4. **Nothing runs at install.** No `preinstall`, `install` or `postinstall` script in the package.
5. **Tests never touch the network.** A test that needs a page serves it from `127.0.0.1`.
6. **Page text is data, never instructions.** Whatever a scanned page says is quoted, escaped and never run.

## Writing

Everything here is written for strangers, because the repository may go public: no machine paths, no private
names. Plain words, short sentences. Docs change in the same commit as the code they describe.
