# Releasing

A11y Genie is published to npm by `.github/workflows/publish.yml`, using npm's
[trusted publishing](https://docs.npmjs.com/trusted-publishers). No npm token is stored anywhere. The workflow
proves who it is to npm with a short-lived token from GitHub, and npm adds provenance on its own: a signed record
of the commit and the workflow that built the package.

The workflow **stages** each version and never publishes it straight away. `npm stage publish` puts the version
in npm's staging area, and it goes live only when the maintainer approves it on npm with two-factor
authentication. Only the maintainer pushes a version tag, and only the maintainer approves.

## Before the first release

These steps happen once.

1. **An npm account for the project**, with two-factor authentication turned on. It owns the package.
2. **The package's name on npm.** npm sets up a trusted publisher only for a package that already exists on
   the registry, so the very first step is taken by hand, by the maintainer, on their own machine, signed in to
   the project's npm account. There are two ways to take it:
   - **Try this first: stage a placeholder.** From a clean clone, run `npm stage publish`. npm's staging docs
     say that staging a package that does not exist yet publishes a placeholder version, `0.0.0-stage`. Approve
     nothing. Then set up the trusted publisher (step 3), and the first real version goes through the workflow,
     with provenance. If npm refuses the trusted publisher, or the workflow's publish, take the documented way
     below instead.
   - **The documented way: publish the first version by hand.** From a clean clone at the release commit (the
     version bumped, as in *Each release* below), run `npm ci`, `npm run build`, `npm pack --dry-run`, then
     `npm publish`. This first version has no provenance. Every version after it goes through the workflow.
3. **The trusted publisher**, on the package's settings page on npmjs.com (*Trusted Publisher*, GitHub Actions):
   - repository: `johnfrog76/a11y-genie`
   - workflow file: `publish.yml`, the name exactly
   - environment: none
   - allowed actions: `npm stage publish` only

   npm wants the first publish through a new trusted publisher within two days of setting it up, or the setting
   expires and has to be made again. So set it up on the day of the release.

## Each release

1. **A release pull request** changes `version` in `package.json` (and the README and the project page, when
   they change with it). It goes through review and CI like any other pull request.
2. **The maintainer tags the merged commit**, with `v` and the version: `git tag v0.1.0` and
   `git push origin v0.1.0`. Nothing else starts the workflow.
3. **The workflow** checks that the tag names the version `package.json` holds, then runs `npm ci`, lint,
   typecheck, the tests and the build, lists the package's files with `npm pack --dry-run`, and stages it.
4. **The maintainer reviews and approves** the staged version on npm, with two-factor authentication
   (`npm stage list`, then `npm stage approve <id>`, or on npmjs.com). Only then is it public.
5. **Check it:** `npm audit signatures` in a project that installs it, and `npx a11y-genie --version` on a
   clean machine.

## What the workflow needs

From npm's docs, and held by `test/unit/publish-workflow.test.ts`:

- a GitHub-hosted runner, and `id-token: write` on the job;
- npm 11.15.0 or later for `npm stage publish` (the workflow installs an exact version), and Node 22.14.0 or later
  (it uses the version in `.nvmrc`);
- `repository.url` in `package.json` matching this repository exactly;
- a public repository and a public package, for provenance.
