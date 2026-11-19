# Architecture

How A11y Genie is put together, and why. Each section names the source file it describes.

## The browser (`src/browser.ts`)

A11y Genie drives a real browser through `playwright-core`. It launches the browser already installed on the
machine: Chrome by default, or Microsoft Edge with `--browser-channel msedge`. Playwright's own Chromium, and
the download of it when Chrome is missing, come later. Until then, a missing browser is a refusal.

### A new, empty profile for every run

Every launch is `chromium.launch({ channel, headless: true })`. It is never `launchPersistentContext()`, and
the person's own browser profile, with its cookies, extensions and sign-ins, is never opened.

`launch()` already does what we need, so A11y Genie does not make a profile folder of its own:

- playwright-core makes a new folder in the system temp folder for each launch
  (`playwright_chromiumdev_profile-` and a random suffix), and passes it to the browser as `--user-data-dir`;
- it deletes that folder when the browser closes;
- `withBrowser()` closes the browser in a `finally`, so the folder goes whether the run returns or throws.

The other way, `launchPersistentContext()` on a folder from `mkdtemp`, would put the folder's lifetime in our
hands: more code that can leak a folder, for nothing `launch()` does not already give. It is also the API that
opens a person's real profile when handed the wrong path, so the code never calls it.

`test/browser/launch.test.ts` checks this against the real browser. It reads the running browser's profile
folder from its own `chrome://version` page, and checks that the folder is in the temp folder, was made for
this run, differs between two runs, and is gone after the run, including a run that throws.

One case is not covered: if the A11y Genie process itself is killed outright (`SIGKILL`), nothing runs to
delete the folder, and it stays in the temp folder until the system clears it. On Ctrl-C, `src/interrupt.ts` closes the browser (so the folder is deleted) and exits 130; the launch passes
`handleSIGINT: false`, so playwright-core's own handler does not race it. On a normal `SIGTERM`,
playwright-core closes the browser and deletes the folder.

### No browser is a refusal

When the channel asked for is not installed, the run exits 2 with one `Error:` line and one `Hint:` line, and
nothing is scanned. playwright-core reports a missing channel by throwing
`Chromium distribution '<channel>' is not found at <path>` (or `... is not supported on <platform>`);
`isNotInstalledError()` matches those words, checked at the pinned version. Any other launch error is not a
refusal and is passed on.

playwright-core 1.65.1 makes the profile folder and an artifacts folder (`playwright-artifacts-` and a
suffix) before it looks for the browser, and leaves both behind, empty, when the browser is not installed.
So after any failed launch, `withBrowser()` removes the folders with those two names that appeared during the
launch. It removes them with `rmdir`, which deletes only an empty folder, so a folder another browser is
already using is never touched.

**For tests only:** setting `A11Y_GENIE_TEST_NO_BROWSER=1` makes every channel read as not installed, so the
refusal can be tested on a machine that has Chrome. It can only make a run refuse; it never changes which
browser is launched.

### playwright-core's installer (V10)

Checked on 2026-11-19 with `playwright-core` 1.65.1, on macOS (arm64).

**The entry point.** playwright-core's own CLI, `cli.js` in the package's folder. The package's `exports` do not
list `cli.js`, but they do list `./package.json`, so `src/chromium-download.ts` resolves
`playwright-core/package.json` and takes `cli.js` beside it. It runs as a child of the same Node,
`process.execPath`, with nothing installed globally and no `npx`:

```sh
node <playwright-core>/cli.js install --no-shell --no-remove chromium
```

- `install chromium` installs Playwright's Chromium (Chrome for Testing) and FFmpeg, which playwright-core
  always adds to it. By default it also adds Chrome Headless Shell, a second build of about 100 MB.
- `--no-shell` leaves the headless shell out. A11y Genie launches `channel: "chromium"`, the full build, which
  runs the same headless mode as the branded Chrome, so the shell would never be used.
- `--no-remove` stops the installer from deleting other Playwright browsers in the shared cache that it
  thinks nothing uses any more. Without it, a run could delete a browser another project on the machine
  installed.
- `--no-progress` is added when stderr is not a terminal.
- A second run of the same command, with the build already installed, prints nothing, fetches nothing and
  exits 0.

**The command a hint names**, for a person to run themselves. It installs the same build into the same cache:

```sh
npx playwright-core@1.65.1 install --no-shell chromium
```

(The version comes from the installed playwright-core, so it follows an upgrade.) Run through `npx` with no
project around it, playwright-core prints a boxed warning that it looks like a global `npx` run; the install
still works.

**What is fetched, and from where.** Two zip files over HTTPS, nothing else. The build numbers are in
playwright-core's `browsers.json`; `install --dry-run` prints the addresses.

| File | From |
| --- | --- |
| Chromium 159.0.8154.6 (Chrome for Testing, Playwright build 1255) | `https://cdn.playwright.dev/builds/cft/159.0.8154.6/<platform>/chrome-<platform>.zip` |
| FFmpeg (Playwright build 1013) | `https://cdn.playwright.dev/dbazure/download/playwright/builds/ffmpeg/1013/ffmpeg-<platform>.zip`, falling back to `playwright.download.prss.microsoft.com` and then `cdn.playwright.dev/builds/ffmpeg/...` |

They are unpacked into Playwright's cache: `~/Library/Caches/ms-playwright` on macOS, `~/.cache/ms-playwright`
on Linux (or `$XDG_CACHE_HOME/ms-playwright`), `%LOCALAPPDATA%\ms-playwright` on Windows, or the folder
`PLAYWRIGHT_BROWSERS_PATH` names. The installer honours playwright-core's own settings, among them
`PLAYWRIGHT_DOWNLOAD_HOST` for a mirror and `HTTPS_PROXY`. playwright-core also records, in the cache's
`.links` folder, which installation uses which build.

**The size**, measured from the `Content-Length` of each file on Playwright's servers, in MB of 1,000,000
bytes:

| Platform | Chromium | FFmpeg | Download | The message says |
| --- | --- | --- | --- | --- |
| macOS arm64 | 201.3 | 1.4 | 202.7 | about 200 MB |
| macOS x64 | 212.5 | 1.5 | 214.1 | about 210 MB |
| Linux x64 | 209.0 | 2.3 | 211.3 | about 210 MB |
| Linux arm64 | 207.6 | 2.0 | 209.7 | about 210 MB |
| Windows x64 | 217.4 | 1.7 | 219.0 | about 220 MB |

Any other platform reads "about 220 MB", the largest measured. Unpacked, it takes about 400 MB on disk (macOS
arm64: 377 MB for Chromium, 3 MB for FFmpeg). The download was run for real once, by hand, on macOS arm64: it
took about 5 seconds on a fast connection, and a scan with `--browser-channel chromium` then ran on it
(`engine.browser`: `chromium 159.0.8154.6`). The headless shell the download leaves out is 105.7 MB on macOS
arm64.

`test/unit/chromium-download.test.ts` pins Chromium build 1255 against playwright-core's `browsers.json`, so a
playwright-core upgrade fails it until the sizes are measured again.

### Which launch switches reach a branded Chrome (V11)

Checked on 2026-11-19 with `playwright-core` 1.65.1 and Google Chrome 158.0.8127.36 (the official build) on
macOS, headless.

**Every one of Playwright's default switches is passed to the branded Chrome.** The browser's own
`chrome://version` page lists its command line, and it holds the whole default list from playwright-core's
`chromiumSwitches.ts`, among them:

- `--disable-background-networking`
- `--disable-component-update`
- `--disable-field-trial-config`
- `--disable-breakpad`
- `--disable-sync`
- `--disable-default-apps`, `--disable-extensions`,
  `--disable-component-extensions-with-background-pages`
- `--no-first-run`, `--no-default-browser-check`, `--no-service-autorun`
- `--metrics-recording-only`, `--password-store=basic`, `--use-mock-keychain`
- `--disable-features=` with `OptimizationHints`, `NetworkTimeServiceQuerying`, `AimEnabled`,
  `PreconnectToSearch`, `MediaRouter` and others
- `--headless`, `--no-sandbox`, `--user-data-dir=<the temp folder>`, `--remote-debugging-pipe`

**The two that matter most for traffic take effect.** The browser was left open on `about:blank` for 90
seconds with Chrome's network log on (`--log-net-log`), once with the defaults and once with
`--disable-background-networking` and `--disable-component-update` removed (`ignoreDefaultArgs`):

| Run | Requests the browser made on its own |
| --- | --- |
| Playwright's defaults | one: `https://www.gstatic.com/ohttp_gateway/hpke_public_keys/v1/sbc_prod` (with the DNS-over-HTTPS lookup of `www.gstatic.com` that the machine's DNS settings ask for) |
| Without those two switches | the variations seed (`clientservices.googleapis.com/chrome-variations/seed`), component update checks (`update.googleapis.com/service/update2/json`) and component downloads (`edgedl.me.gvt1.com`), and the same `gstatic.com` request |

So on a branded Chrome the switches do stop the variations fetch and the component updater. **One request is
left**: the fetch of a public key from `www.gstatic.com/ohttp_gateway/...`, which by its path belongs to Safe
Browsing's privacy-preserving lookups. None of the default switches stops it. It carries no page content and
no person's data, but it is traffic the person did not ask for, and the security gate should decide whether to
turn it off.

Not checked here: Microsoft Edge (not installed where this was run), Chrome on Windows or Linux, and runs
longer than 90 seconds. A scan that loads a page also sends that page's own traffic, which is a different
question.

## axe-core (`src/axe.ts`, `src/map-axe.ts`, `src/order.ts`)

`scanPage(page)` runs axe-core on a page that is already loaded and returns its findings and *needs review*
items (`src/finding.ts`), worst first. It is split in three so that only the first part needs a browser:

- `src/axe.ts` runs `@axe-core/playwright` with axe-core's default rule set. There is no `withTags` until
  `--tags` exists. `@axe-core/playwright` injects axe-core from the installed package into the page and each
  of its frames; it fetches nothing.
- `src/map-axe.ts` turns axe-core's results into findings. axe-core runs inside the page, so its results
  come back through `page.evaluate`, and a page can tamper with them. They are read as `unknown` and checked
  field by field: a value of the wrong type is dropped. A result with no rule id, or with no element that
  has a usable `target`, is not reported.
- `src/order.ts` orders findings: impact, then kind, then rule id, then page order.

**The page must come from `browser.newContext()`.** To put the frames' results together,
`@axe-core/playwright` opens a blank page in the page's own context. A context made by `browser.newPage()`
refuses a second page, and the run fails with "Please use browser.newContext()". Checked at
`@axe-core/playwright` 4.14.0.

axe-core's result shape at the pinned version, and how its `target` reads for shadow roots and frames, are in
`docs/JSON.md`.

## One scan, end to end (`src/run-scan.ts`, `src/cli.ts`)

`a11y-genie scan <url>` launches the browser (`withBrowser`), makes a new context, loads the page, runs
`scanPage`, and builds the record (`src/scan-record.ts`). The CLI then makes the scan folder
(`src/scans-folder.ts`), writes `scan.json`, and writes `report.md` from the record (`src/report.ts`). The
report is a pure function of the record, so a stored `scan.json` can write it again later.

- **Exit code.** 0 when there is no violation, 1 when there is any. The record's `exit` says the same.
  Refusals (exit 2), Ctrl-C (130) and the unexpected (3) are in `docs/EXIT-CODES.md`.
- **`--json`.** stdout holds the document and nothing else; every line meant for a person goes to stderr.
  Without it, the summary goes to stdout.
- **Never into the project.** Nothing is written in the folder the command runs from, or the scanned
  project. Scans go to the per-user scans folder or `--out` (docs/JSON.md says where).
- **The schema is checked without a validator dependency.** `test/helpers/json-schema.ts` is a small
  validator for exactly the keywords `schema/scan-1.json` uses, and throws on any other, so the schema cannot
  outgrow it. The schema test runs it over every golden and over a record the browser test has just made.
- **Goldens.** `test/goldens/<page>/scan.json` and `report.md` for the four first fixture pages are written
  by `test/browser/goldens.test.ts` in the real Chrome, after the port, the times and the versions of this
  tool, axe-core and the browser are replaced by fixed values (`test/helpers/goldens.ts`). The rule count is
  kept, so an axe-core upgrade shows in the diff. `UPDATE_GOLDENS=1 npm test` rewrites them.
