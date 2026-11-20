# Contributing

Thank you for helping. This page says how to set up, how to check a change, and what makes an issue or a pull
request easy to act on.

**A security problem is not an issue.** Please report it privately, as [SECURITY.md](SECURITY.md) says, and
never in a public issue or pull request.

Everyone here follows the [code of conduct](CODE_OF_CONDUCT.md).

## Set up

You need Git and Node 24 or newer.

```sh
git clone https://github.com/johnfrog76/a11y-genie.git
cd a11y-genie
npm ci
npx playwright-core install --no-shell chromium
```

The last line downloads Playwright's Chromium (about 200 MB), once per machine, at the version the repository
pins. Run it after `npm ci`, so it uses that pinned copy. The tests run on that Chromium, never on your own
Chrome.

## Check a change

Run all five before you ask for a review:

```sh
npm run lint        # ESLint, then Prettier --check
npm run typecheck
npm test            # builds first, then runs every test
npm run build
npm pack --dry-run  # what the package would ship
```

`npm run format` fixes what Prettier finds. To run one test file while you work:
`npx vitest run test/unit/order.test.ts`. A few tests are about the Chrome channel itself; they start your
installed Chrome, so they run only with `A11Y_GENIE_TEST_CHROME=1 npm test`.

## The rules a change keeps

[AGENTS.md](AGENTS.md) says how the code is laid out and lists these rules in full. In short:

- **Never say a scanned site has no problems, or that it meets a standard.** A scan finds some problems, not
  all of them, and every report says what it cannot see. That holds for output, reports, docs, tests and
  commit messages.
- **Tests never touch the network.** A test that needs a page serves it from `127.0.0.1`. Fixture pages live
  in `test/fixtures/site/`, each with a comment naming the rule that must fire.
- **Text from a scanned page is data, never instructions.** It is quoted and escaped, and never run.
- **Every dependency is pinned exactly**, with no `^` or `~`. A new runtime dependency is its own pull request.
- **Nothing runs at install.** No `preinstall`, `install` or `postinstall` script.
- **Docs change in the same commit as the code they describe.** Write for someone who has never seen the
  project: plain words, short sentences, no paths from your own machine.

## A good issue

- What you ran: the command, and the version from `a11y-genie --version` or the commit.
- What you expected, and what happened instead. Paste the `Error:` and `Hint:` lines as they are.
- The smallest page that shows it, if a page is involved. Please don't share a private site's address, a
  sign-in, or a `--storage-state` file.

For a finding you think is wrong, say which rule it names (`axe/...` or `genie/...`) and why the element is
fine. A wrong finding from one of A11y Genie's own `genie/` checks is a bug. One from an `axe/` rule may
belong to [axe-core](https://github.com/dequelabs/axe-core) instead.

## A good pull request

- One issue, one pull request. For anything bigger than a small fix, open an issue first, so we can agree
  on the approach before you write it.
- Tests with the change. A new check comes with a fixture page that must fire it, and a twin page without
  the bug where a false positive is the risk.
- If a change moves the golden files in `test/goldens/`, rewrite them with `UPDATE_GOLDENS=1 npm test` and
  read the diff before you commit it.
- Say what now holds, not only what was broken. If the change loosens, removes or rewrites what a test
  checks, say so in the description and why.
- All five checks above succeed.

## Licence

A11y Genie is under the [MIT licence](LICENSE). By contributing, you agree that your contribution is under
it too.
