# Architecture

How A11y Genie is put together, and why. Each section names the source file it describes.

## The browser (`src/browser.ts`)

A11y Genie drives a real browser through `playwright-core`. It launches the browser already installed on the
machine: Chrome by default, or Microsoft Edge with `--browser-channel msedge`. With no Chrome, it downloads
Playwright's own Chromium once and uses that (see "Playwright's Chromium, when Chrome is missing" below);
`--browser-channel chromium` asks for it directly.

### A new, empty profile for every run

Every launch is `chromium.launch({ channel, headless: true })`. It is never `launchPersistentContext()`, and
the person's own browser profile, with its cookies, extensions and sign-ins, is never opened.

`launch()` already does what we need, so A11y Genie does not make a profile folder of its own. It does give
each process a temp folder of its own, below:

- playwright-core makes a new folder in the temp folder for each launch
  (`playwright_chromiumdev_profile-` and a random suffix), and hands it to the browser as `--user-data-dir`;
- it deletes that folder when the browser closes;
- `withBrowser()` closes the browser in a `finally`, so the folder goes whether the run returns or throws.

#### One private temp folder per process (`src/private-temp.ts`)

The first thing `src/cli.ts` does is make a folder under the system temp folder (`a11y-genie-` and a random
suffix) and set `TMPDIR` to it in `process.env`, and `TEMP` and `TMP` too on Windows. playwright-core reads the
temp folder each time it launches, not once at import, so its profile and artifacts folders, and everything the
browser and the browser installer (a child process) make, land in it. The folder is removed when the process
exits, however it exits: a normal end, a refusal (exit 2), an unexpected error (exit 3), and Ctrl-C, a plain kill and a closed terminal (130, 143 and 129,
through `process.exit()` in `src/interrupt.ts`), all of which run the `exit` handler. The handler removes the folder and
looks again until it is gone (`removeUntilGone`, about a second at most), because one `rmSync` is not enough: after
Ctrl-C, Playwright may still be removing the browser's profile inside the folder, and on Linux `rmSync` then returns
with no error and the folder still there (libstdc++'s `std::filesystem::remove_all`, which Node uses, stops at the
first entry already gone, and Node takes that as done). CI's Linux left the folder so after Ctrl-C (issue 223);
`test/unit/private-temp-remove.test.ts` races the removal against a worker thread removing a profile inside it.

Why: the system temp folder is shared by every process on the machine. Cleaning up after a failed launch there,
as this code once did, can remove another run's brand-new, still-empty profile folder, and that browser then
fails to start (*Failed to create a ProcessSingleton*). In the private folder nothing else is running, so the
failed-launch cleanup in `withBrowser()` reads only that folder, and the shared one is never read for it.

Not covered: only `SIGKILL`. Nothing runs, so the folder stays, one folder named `a11y-genie-*` (the browser and its
profile are inside it), until the system clears the temp folder.

**Tests** get the same isolation: `test/setup/private-temp.ts` (a vitest setup file) gives each test file its own
temp folder and removes it after the file, so test files that launch browsers side by side, or one that tests a
missing browser, never share one. The shared one is in `A11Y_GENIE_TEST_SHARED_TMP`.
The same setup file stops every browser a file left running: when the file ends, when the worker exits, and when the
worker is stopped by SIGTERM or SIGINT (it stops them, removes the folder, and raises the signal again, so vitest
sees it). It sends SIGKILL to each process whose command line names the file's own temp folder
(`test/helpers/processes-in.ts`, read with `ps`, so not on Windows). A browser a test launches, or a command it
spawns launches, always has that folder in its command line, so a test that fails or times out cannot leave one
behind. It is not done after each failed test, because many files share one browser across their tests.
A run that is itself stopped (SIGTERM or SIGINT to vitest) is different: vitest's watchdog ends the workers with
SIGKILL as soon as vitest's own process exits, so no handler in a worker is sure to run. So each file's folder is
made inside one folder for the run (`test/setup/run-folder.ts`, a global setup, `A11Y_GENIE_TEST_RUN_TMP`), and
vitest's own process, which does run its `exit` handlers when it is stopped, stops every process that names the
run's folder, synchronously, before the workers go. Only that run's folder is named, so another run on the same
machine is never touched. Then, as a step of its own so a failure to stop them never skips it, it removes the folder, and looks again until it is gone (a few tries, a second at
most). One removal is not enough: when a browser is stopped, the Playwright that launched it removes the browser's
profile at the same moment. On Linux, Node's `rmSync` then returns early, with no error and the folder still there:
it uses `std::filesystem::remove_all`, libstdc++'s version stops at the first entry already gone, and Node takes
that error as done, even with `maxRetries`. macOS's libc++ skips such an entry and goes on, so only Linux saw it:
the run's folder left holding one empty worker folder (issue 160). The removal is `test/helpers/remove-folder.ts`;
`test/unit/remove-folder.test.ts` races it against a worker thread removing a profile inside the folder, and on
Linux races plain `rmSync` the same way and prints how often it left the folder (26 of 100 on CI's Linux, the first
time it ran). `test/setup/private-temp.ts` removes each test file's own folder the same way, since the same race left
one of those behind too. Either step that fails, or a folder still
there after both, is said on stderr, which the leak test prints when it finds the folder left.
`test/cli/browser-leak.test.ts` holds this: it runs `test/fixtures/leak/leak.fixture.ts`, tests built to fail and
to time out with a browser open (the main run never includes that file), and looks for any process left; and it
runs `test/fixtures/leak/signal.fixture.ts`, stops that run with SIGTERM while a process the test started has a
browser open, and looks again. Without the run's folder, that browser was left running.
**Which browser the tests launch.** Playwright's headless shell (`chromium-headless-shell`), never the Google Chrome
app, and never an app bundle: on macOS every launch of an app (the full Chromium is "Google Chrome for Testing.app")
shows an icon in the Dock, even headless, and a suite run launches many. `test/helpers/test-browser.ts` is the one
place that chooses: by default it hands the product `chromium` and sets `A11Y_GENIE_TEST_HEADLESS_SHELL=1` in the
test process, so the in-process launches and every command a test spawns (with the test's environment) get it.
`src/browser.ts` reads that variable in one place (`runsHeadlessShell()`): a `chromium` launch then omits `channel`
and stays headless, which playwright-core 1.65.1 resolves to the headless shell (`getExecutableName()`: no channel
and headless is `chromium-headless-shell`). `chrome` and `msedge` are not changed by it. Under it, `engine.browser`
says `chromium-headless-shell <version>`, a missing shell is refused by that name, and nothing is downloaded. It is a
test setting only, not in `--help` or the product's docs. The product is unchanged: a person still gets their
installed Chrome by default, or the full Chromium. `test/browser/headless-shell.test.ts` holds it: the launched
browser's main process, read from `ps` (the one with `--user-data-dir=` and no `--type=`; its helpers carry `--type=`
and never `--headless`), must carry `--headless` and must not be inside an `.app/`, in a launch in the test process
and in a spawned `scan --json`, whose `engine.browser` names the shell.
The shell runs Chromium's older headless mode, so it is not the browser a person runs. `A11Y_GENIE_TEST_CHANNEL=chromium`
runs the same tests on the full Chromium; run it at a milestone, or by hand when a change touches the browser.
One difference is known: past the last tabbable element, the shell's Tab leaves the page on every lap, where the
full build alternates (*Where it ends (V5)*, below), so a keyboard walk that ends `wrapped` on the full build ends
`left` on the shell. One constant, `TEST_LAP_END` in `test/helpers/test-browser.ts`, holds the end the browser under
test gives, and the walk tests assert it. The goldens keep the full build's `wrapped`; on the shell
`test/helpers/goldens.ts` expects a recorded `wrapped` as `left`, so the comparison stays exact, and it refuses
`UPDATE_GOLDENS=1` there, so `left` never replaces `wrapped` in a golden (rewrite them with
`A11Y_GENIE_TEST_CHANNEL=chromium UPDATE_GOLDENS=1 npm test`). So the default run checks the shell's lap end, and
only the opt-in run on the full build checks `wrapped`, the end a person's scan gives.
Both are installed once per machine with `npx playwright-core@1.65.1 install chromium` (playwright-core's installer
adds the headless shell to `chromium` unless `--no-shell` is given; about 300 MB in all); `test/setup/global-chromium.ts`
stops the run once, with that command, if the browser the tests use is missing, and never falls back to Chrome. The
tests about the Chrome channel itself (`test/browser/launch.test.ts`: the branded Chrome, its profile folder) run only
with `A11Y_GENIE_TEST_CHROME=1`, and say so in their names. The tests that spawn the built command name it through
`test/helpers/built-cli.ts`, which stops the file with "run `npm run build` first" when `dist/cli.js` is missing.
`test/cli/private-temp.test.ts` runs the built command with a temp folder of its own on every exit path, and runs
a Chrome scan for 20 rounds beside loops of missing-browser launches.

The other way, `launchPersistentContext()` on a folder from `mkdtemp`, would put the folder's lifetime in our
hands: more code that can leak a folder, for nothing `launch()` does not already give. It is also the API that
opens a person's real profile when handed the wrong path, so the code never calls it.

`test/browser/launch.test.ts` checks this against the real browser. It reads the running browser's profile
folder from its own `chrome://version` page, and checks that the folder is in the temp folder, was made for
this run, differs between two runs, and is gone after the run, including a run that throws.

On Ctrl-C, a plain `kill` (`SIGTERM`) or a closed terminal (`SIGHUP`), `src/interrupt.ts` closes the browser (so
the folder is deleted) and exits 130, 143 or 129. It waits at most five seconds for the browser to close
(`CLEANUP_CAP_MS`), then exits anyway, so a browser that will not close never keeps the run alive or leaves its
private temp folder behind (`test/cli/interrupt-cap.test.ts`, with a cleanup that never settles); the launch sets `handleSIGINT: false`, `handleSIGTERM: false`
and `handleSIGHUP: false`, so playwright-core's own handlers (all on by default) do not race it or change the code.
Closing the browser makes whatever the scan was waiting on fail (`page.evaluate: Target page, context or browser
has been closed`), often before the browser has finished closing, so that failure reaches the command's catch
before the exit. `interrupting()` says a signal is being handled, and `reportFailure()` (src/refusal.ts), which the
catch calls, then prints nothing and sets no exit code (`test/cli/interrupt-failure.test.ts`, with a cleanup that
makes the wait fail every time).

### A browser that is not installed

`withBrowser()` launches exactly the channel it is given. When that browser is not installed it throws a
`BrowserNotFound` refusal (exit 2, one `Error:` line and one `Hint:` line) and never downloads or picks
another; choosing and falling back are `withChosenBrowser()`, below. playwright-core reports a missing
`chrome` or `msedge` by throwing `Chromium distribution '<channel>' is not found at <path>` (or `... is not
supported on <platform>`), and a missing Playwright's Chromium with `Executable doesn't exist at <path>`;
`isNotInstalledError()` matches those words, checked at the pinned version. Any other launch error is not a
refusal and is passed on.

playwright-core 1.65.1 makes the profile folder and an artifacts folder (`playwright-artifacts-` and a
suffix) before it looks for the browser, and leaves both behind, empty, when the browser is not installed.
So after any failed launch, `withBrowser()` removes the folders with those two names that appeared during the
launch, in this process's private temp folder (above). It removes them with `rmdir`, which deletes only an empty
folder. The whole private folder goes at exit anyway; this keeps a long run, or a caller that launches again, tidy.

**For tests only:** setting `A11Y_GENIE_TEST_NO_BROWSER=1` makes every channel read as not installed,
Playwright's Chromium included, and turns the download into a refusal, so the no-browser paths can be tested on
a machine that has Chrome. It can only make a run refuse; it never launches or downloads anything.

### Playwright's Chromium, when Chrome is missing (`src/browser-choice.ts`, `src/chromium-download.ts`)

`withChosenBrowser()` decides which browser runs:

1. `chrome` or `msedge` is launched as it is. If it is installed, that is the browser, and nothing else happens.
2. The default `chrome`, not named with `--browser-channel`, that is not installed falls back to Playwright's
   Chromium. A named `--browser-channel chrome`, and any `msedge`, that is not installed is refused, never
   replaced.
3. Playwright's Chromium, by that fallback or by `--browser-channel chromium`, is used from Playwright's cache
   if it is installed there. If it is not, one line on stderr says so, and then playwright-core's installer
   downloads it, once. With `--no-download`, or `--offline` (nothing may leave the machine, a download included),
   the run refuses instead; the refusal names the flag (docs/EXIT-CODES.md has the words). A Chromium already in
   the cache is still used under `--offline`: nothing is fetched.
4. It is launched like any other browser, by `withBrowser("chromium")`: `channel: "chromium"`, headless, a new,
   empty profile deleted after the run.

`scan.json` records what ran: `engine.browser` is `chromium <version>` and `engine.fallback` is `true` when
Chrome was missing and Playwright's Chromium ran in its place. `--browser-channel chromium` is not a fallback:
it is `chromium <version>` with `fallback: false`.

The line said before the download, with the size and the cache folder filled in:

> Chrome was not found, so A11y Genie is downloading Playwright's Chromium (about 200 MB) once, into
> /home/someone/.cache/ms-playwright. --browser-channel names another browser.

A later run with Chrome still missing downloads nothing and says
`Chrome was not found, so A11y Genie is using Playwright's Chromium, from <cache>. --browser-channel names
another browser.` With `--browser-channel chromium` and nothing in the cache, the line is
`Playwright's Chromium is not installed yet, so A11y Genie is downloading it (<size>) once, into <cache>.`

Playwright's Chromium is read as installed only when its executable exists **and** playwright-core's
`INSTALLATION_COMPLETE` marker is in the build's folder. playwright-core writes the marker after unpacking, so
a download stopped part-way (Ctrl-C, a lost connection) reads as not installed, and the next run downloads it
again. Ctrl-C during the download sends SIGINT on to the installer and waits for it to exit, at most
`INSTALLER_STOP_MS` (three seconds, below the five-second cap), then sends SIGKILL, and exits 130. Without the
wait the run would remove its private temp folder while the installer was still writing into it
(`test/cli/interrupt-download.test.ts`, with a fake installer that is slow to stop and one that never does).

The installer's output (its "Downloading ..." lines, and a progress bar at a terminal) goes to stderr, never
stdout, so `--json` keeps stdout for the one document. A download that fails is a refusal:
`the download of Playwright's Chromium did not finish: the installer exited with code <n>.`

On Linux, Playwright's Chromium needs some system libraries the installer does not add (that is
`install --with-deps`, which needs `sudo`, and A11y Genie never runs it). Where they are missing, the launch
fails and the error is passed on as it is.

**Tests never download.** The installer, the cache check and the launch are stand-ins in
`test/unit/browser-choice.test.ts`, which proves the decision, the line, one download and none on the second
run, and the `--no-download` refusal. The built command's tests use `A11Y_GENIE_TEST_NO_BROWSER=1`, which
turns the download into a refusal. And `vitest.config.ts` sets `PLAYWRIGHT_DOWNLOAD_HOST` and
`PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST` to a dead loopback port for every test and every child it starts, so a test
that reached the real installer by mistake would fail at once rather than download. The real installer runs
in tests only with `--dry-run`, which prints what it would fetch and fetches nothing.

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

Any other platform reads "about 220 MB", the largest measured. Unpacked, it takes about 380 MB on disk (macOS
arm64: 377 MB for Chromium, 3 MB for FFmpeg). The download was run for real once, by hand, on macOS arm64: it
took about 5 seconds on a fast connection, and a scan with `--browser-channel chromium` then ran on it
(`engine.browser`: `chromium 159.0.8154.6`). The headless shell the download leaves out is 105.7 MB on macOS
arm64.

**Decided 2026-11-19: the full Chromium, not the headless shell.** A11y Genie downloads the full Chromium
build, not Chrome Headless Shell (105.7 MB on macOS arm64). The full build runs the same headless mode as Chrome, so a scan
finds the same things on either browser. That matters more than the extra download of about 100 MB, which
happens once.

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
no person's data, but it is traffic the person did not ask for. Under `--offline` it goes to the refusing proxy
instead (*--offline at the launch*, below); without `--offline` it is still sent.

Not checked here: Microsoft Edge (not installed where this was run), Chrome on Windows or Linux, and runs
longer than 90 seconds. A scan that loads a page also sends that page's own traffic, which is a different
question.

## axe-core (`src/axe.ts`, `src/map-axe.ts`, `src/order.ts`)

`scanPage(page)` runs axe-core on a page that is already loaded and returns its findings and *needs review*
items (`src/finding.ts`), worst first. It is split in three so that only the first part needs a browser:

- `src/axe.ts` runs `@axe-core/playwright` with axe-core's default rule set, or, with `--tags`, with exactly
  the tags given (`withTags`; see *The rule flags*, below). `@axe-core/playwright` injects axe-core from the
  installed package into the page and each of its frames; it fetches nothing.
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

### Landmarks (`src/landmarks.ts`)

**Which landmark rules run by default.** Checked at axe-core 4.14.1 by scanning the landmark fixture pages with
no `withTags`, and by reading each rule's tags in `axe.getRules()`. All of these run in the default set; none
is `experimental`, and none needs to be turned on:

| Rule | Fired on |
| --- | --- |
| `region` (content outside landmarks) | `no-landmarks.html`, `content-outside-landmarks.html` |
| `landmark-one-main` | `no-landmarks.html`, `no-main.html` |
| `landmark-no-duplicate-main` | `two-mains.html` |
| `landmark-unique`, `landmark-no-duplicate-banner`, `landmark-no-duplicate-contentinfo`, `landmark-banner-is-top-level`, `landmark-main-is-top-level`, `landmark-contentinfo-is-top-level`, `landmark-complementary-is-top-level` | not fixtured; each carries the `best-practice` tag, and none is `experimental` (`landmark-complementary-is-top-level` is also tagged `deprecated`) |

`region` and `landmark-one-main` are wanted on, and axe-core's default set already runs both, so nothing is enabled. A `--tags` list that leaves
out `best-practice` runs none of the landmark rules, so `--help` and the unknown-tag hint both say the landmark
rules need it, and `genie/no-landmarks`, which sums them up, is not run either.

**What the product adds.** axe-core reports a page with no landmark at all as `region` on every element it can
reach plus `landmark-one-main`. `genie/no-landmarks` says it once for the page (moderate, WCAG 1.3.1 and 2.4.1
as context), on `body`. It is a violation, like the rules beside it, so it counts toward the exit code. The
check reads the page in an isolated world, through a `FocusReader` of its own (`READ_STRUCTURE`), so a page that
overrides `querySelector`, `matches` or `getAttribute` cannot hide its missing landmarks. It looks for elements of
the roles `banner`, `navigation`, `main` and `contentinfo`: a role attribute decides by its first token that is a known ARIA role (`<nav role="foo">` stays a navigation), and
with none known `main` and `nav` are `main` and `navigation`, while `header` and `footer` are `banner` and
`contentinfo` only outside a scoping ancestor: an `article`, `aside`, `main`, `nav` or `section` with no role
attribute, or an element whose role attribute, trimmed and in any case, is exactly `article`, `complementary`, `main`, `navigation` or
`region` (the browser's own selector; an ancestor's role is not read by its first known token here, so
`role="foo article"` does not scope, as in Chrome's accessibility tree). So a `div role="main"` counts, a
`header` inside an `article` or a `div role="article"` does not, a `header` inside `section role="tabpanel"` does, and an element out of the accessibility tree (`display: none`,
`visibility: hidden`, or it or an ancestor `aria-hidden="true"`) does not. Open shadow roots are read. Other
landmark roles (`complementary`, `search`, `form`, `region`)
do not count: a page with only those has none of the four. It runs on the page's own frame after axe-core, and
it does not change `engine.rulesRun`, which stays axe-core's count. The report lists it as any other finding;
no landmark map is drawn.

### Click on a non-control (`src/click-on-non-control.ts`)

axe-core has no rule for a `div` with an `onclick`. `genie/click-on-non-control` (serious, WCAG 2.1.1 and 4.1.2,
tagged `cat.keyboard`, `wcag2a`, `wcag211` and `wcag412`) flags an element that has a click handler of its own and
is not a control. It runs after axe-core, on the page's own frame, under the default rule set or a `--tags` list
with one of its tags. Like `genie/no-landmarks` it does not change `engine.rulesRun`.

**What is a control.** These are the controls: `a[href]`, `button`, `input`, `select`, `textarea`, `summary`, `label`
and `option`; any element whose `role` names one of ARIA's widget roles (`button`, `link`, `checkbox`,
`menuitem`, `tab`, `switch` and the rest, the composite ones such as `listbox` and `grid` included); and any
element with `tabindex` 0 or more. A `role` of several tokens counts when any one of them names a control:
browsers use the first token they recognise, so `role="presentation button"` is presented as no role at all, but
the author marked it a control, and reading any token is the conservative choice for a tool that must not
claim more than it knows (`#multi-role` in the fixture gives no finding). Everything else is a candidate. A candidate that is not shown
(`checkVisibility()` is false: `hidden`, `display: none`) is left out, since no one can click it.

**When it is flagged.** A candidate is flagged when it carries an inline `onclick` attribute, or when the DevTools
Protocol lists a `click` listener on the element itself (`DOMDebugger.getEventListeners`). Listeners are asked for
only where the computed `cursor` is `pointer`; an element with an `onclick` needs no asking. The fix names the
button: "Make it a `<button>` with the same handler and the same text", or give it `role="button"`,
`tabindex="0"` and the same handler on Enter and Space.

**Delegated handlers go to *needs review*.** A list with one listener for all its items, or a framework such as
React with one listener at the root, leaves the item with no handler of its own, and from the item alone that
cannot be told from a pointer cursor that does nothing (gap G3 in [KNOWN-GAPS.md](KNOWN-GAPS.md)). So a candidate that sets a pointer cursor
and has no click handler of its own is a *needs review* item, never a finding: "looks clickable, has no role and
cannot take focus; check whether it does something". Only the element that sets the pointer is listed: the
elements inside it inherit the cursor (their parent's cursor is a pointer too), and listing each would say the
same thing many times. The delegating parent itself is not asked unless it looks clickable, so on
`div-onclick.html` the list with the listener is neither flagged nor listed.

**The page cannot steer it.** The script that finds candidates runs in an isolated world of its own
(`Page.createIsolatedWorld`), so a page that replaces `getComputedStyle`, `Element.prototype.matches` or
`querySelectorAll` changes nothing it reads (`click-tampered.html`). What it hands back is checked field by field.
It reads the page's own document, not its frames and not inside shadow roots. Each element's `html` is its opening
tag, up to 80 characters of its text, and its closing tag, never the whole subtree. Its `selector` is the
element's unique `id`, or a path of `:nth-of-type` steps up to one.

**What `getEventListeners` needs (V8).** Checked at playwright-core 1.65.1 against Chrome:

- `DOMDebugger.getEventListeners` takes a remote object id (`objectId`), not a DOM node id, so each candidate is
  first resolved to a remote object. The page script returns the candidates as one array, and
  `Runtime.getProperties` on it gives each element's object id.
- A listener belongs to the world that added it. Asked with an object from the isolated world,
  `getEventListeners` lists none of the page's listeners, even on an element that has one. So each candidate is
  resolved again in the page's main world, through its backend node id (`DOM.describeNode`, then `DOM.resolveNode`,
  whose default is the main world), and asked there: three calls a candidate.
- An inline `onclick` attribute is listed as a `click` listener too, beside the ones `addEventListener` added,
  and so is a handler set as a property (seen with `onmouseover`, listed as a `mouseover` listener).
- `getEventListeners` on `document` with `depth: -1` lists every listener in the document, each with its
  `backendNodeId`, in one call. The check does not use it, because matching those nodes back to the candidates
  costs a call a node again, but it is the way to a cheaper check if one is needed.

**The cost, and the caps.** Measured with the scan's own code on generated pages, each a flat list of `div`s, a
share of them with a pointer cursor and a share of those with a click listener; the three calls of each
candidate are sent together, so their round trips overlap. Times are the third run on one page, on a laptop:

| Elements | Pointer candidates | Asked | Time |
| --- | --- | --- | --- |
| 1,000 | 100 | 100 | 14 ms |
| 10,000 | 1,000 | 1,000 | 125 ms |
| 10,000 | 2,000 | 2,000 | 250 ms |
| 20,000 | 5,000 | 2,000 (the cap) | 270 ms |
| 50,000 | 10,000 | 2,000 (the cap) | 290 ms |
| 50,000 | none | none | 14 ms |

About an eighth of a millisecond a candidate, and a page with no pointer cursor costs one walk of its elements.
Two caps hold it on a page with many: at most `MAX_LISTENER_QUERIES` (2,000) elements are asked, and each one past
it is a *needs review* item saying it was not asked (`many-clickable.html`); at most `MAX_CANDIDATES` (5,000) are
described at all, and the rest are counted in one *needs review* line on `body`. An element with an `onclick`
within the 5,000 is flagged whatever the first cap, since it needs no asking. The whole check runs inside the page
time limit, with axe-core.

### The skip link (`src/skip-link.ts`)

`genie/skip-link` reads the first three stops of the keyboard walk (below), which runs after
axe-core and the other checks and starts at the top of the page: at each, it asks whether the element that has
focus is a skip link. It presses no Tab of its own: one walk feeds the skip link, the trap check and focus visible. A skip link is a same-page link (`href="#id"`) whose target
exists and is the page's `main` or inside it. With none, the finding is **advice** (`minor`) when the page has a
landmark or a heading (read as `genie/no-landmarks` reads landmarks, in the isolated world), and a WCAG 2.4.1 **violation** (`moderate`) when it has neither. A page with fewer than
five tabbable elements before its main content (all of them when it has no main) is not checked. It is tagged
`best-practice`, as `genie/no-landmarks` is, and the registry lists the violation's impact. The check does not
test whether the link shows itself on focus or whether its target takes focus.
A link counts only when it belongs to the top document: its fragment is resolved against its own
`ownerDocument`, so a fragment link inside a same-origin frame, which scrolls only the frame, is not a skip link,
while one in a shadow root is. Every read it makes of the page (the focused element, the tabbable count, the
landmarks and headings, the body's opening tag) runs in an
isolated world through a `FocusReader` that `scanPage` opens for the walk's checks (the focus-visible check
shares it), so a page that overrides `document.activeElement`,
`getAttribute`, `matches`, `querySelector` or `getElementById` cannot hide a missing skip link or fake one.
Advice never changes the exit code. Fixtures: `no-skip-link.html`, `no-skip-no-structure.html`,
`skip-link-ok.html`, `skip-link-broken.html`, `few-tabbable.html`, `skip-link-tampered.html`,
`skip-link-hidden-tampered.html`, `no-landmarks-tampered.html`, `skip-link-frame.html` (with
`skip-link-frame-inner.html`), `skip-link-shadow.html`; the role and scope fixtures (`landmark-role-*.html`, `landmark-header-presentation.html`, `landmark-scoped-header-footer.html`, `landmark-top-header-footer.html`, `landmark-scoped-role-*.html`, `landmark-unscoped-tabpanel.html`, `landmark-role-multi-token-article.html`) are read by `test/browser/landmarks.test.ts`; test: `test/browser/skip-link.test.ts`.

### The keyboard walk (`src/walk.ts`)

The walk presses Tab from the top of the page, up to `--max-tabs` times (default 200, at most 1000),
and records where focus lands after each press: a *stop*. It is not a rule and makes no finding: it is a record,
kept in `scan.json` as `pages[].walks` (docs/JSON.md), that the skip link, the trap check and the
focus-visible check read. It runs in every state that is scanned, last in `scanPage`, because it moves
focus, and whatever `--tags` says. Each state's walk is kept apart; walks are not merged across states, since
a trap may exist in one state only.

**Where it starts.** Blurring the focused element is not enough. Chrome starts the next Tab from the element
that last had focus or was clicked (its sequential focus navigation starting point), so after a state's steps
a blur-and-Tab begins part way down the page. Checked at Chrome 158: after a click on the fourth control, a
blur and a Tab landed on the fifth. Focusing the root element (given `tabindex="-1"` for a moment, then put
back as it was) moves the starting point to the top, but that is still not the start: from an element outside
the Tab order, Chrome goes to the next tabbable element in source order, so a `tabindex="1"` after a
`tabindex="2"` was skipped. So the walk then presses Shift+Tab once. From the top that takes focus out of the
page, and the next Tab enters it where a person's first Tab does, positive `tabindex` first
(`walk-order.html`, and the same walk after a click lower on the page).

**Where it ends (V5).** Checked at Chrome 158 (headless, Playwright 1.65.1) on pages with a plain list of
controls, a same-origin frame last, an open shadow root last, and no control at all, each from a fresh page:

- The first Tab past the last tabbable element takes focus out of the document, to the browser's own controls:
  `document.activeElement` is `body` and `document.hasFocus()` is `false`. It does not stay on the last element,
  and it does not wrap.
- The next Tab comes back into the page, to the first tabbable element.
- On the laps after that, Chrome alternates: one lap goes from the last element straight to the first, without
  leaving the document, and the next leaves it again. The same holds when the last stop is in a frame or a
  shadow root.
- On a page with nothing to focus, every Tab leaves focus on `body`, with `hasFocus()` false.
- Playwright's headless shell (Chromium 159, the tests' browser, checked 2026-11-21) does not alternate: every Tab
  past the last element leaves the document. On two buttons, ten Tabs give `a b out a b out a b out a` on the
  shell, and `a b out a b a b out a b` on the full Chromium. So on the shell the walk ends `left` where Chrome and the
  full build end `wrapped` (the tests' `TEST_LAP_END`).

Since the walk has just left the page with its Shift+Tab, its lap goes from the last element straight back to
the first. The walk does not rely on which happens: it ends at a press that puts focus on no element
(`end: "left"`), or at one that brings it back to the first stop (`end: "wrapped"`), whichever comes first, or at
the limit (`end: "max-tabs"`; the walk is then cut, and the page may have more stops). Only the stops before the
end are recorded; `tabs` counts every press.

**Where focus goes round (`cycled`).** A press that lands on a stop already recorded, other than the first, is
not recorded again: it starts a second lap. If the presses after it go round the same stops in the same order
and come back to it, the walk ends `cycled`, and `cycleFrom` is the `index` of the stop the cycle starts at; the
cycle runs from there to the last stop. Focus that does not move at all is a cycle of one, and ends the walk at
the same element after three presses. If the second lap goes anywhere else, the walk goes on
from there, so a page that sends focus back once is walked to its end (`walk-revisit.html`). The second lap
costs as many presses as the cycle has stops, inside `--max-tabs`. Before this, a walk held in a widget ran to
the limit and recorded the same stops again and again. Playwright's Chromium was not installed at the pinned version on
the machine this was checked on, so V5 is recorded for Chrome only.

**What a stop holds.** Its press number (`index`, from 1), its `selector` and `target` in the form a finding's
element has (one entry per document, outermost first; a nested array is a path through open shadow roots;
` >>> ` joins the parts in `selector`), its tag, the role and accessible name from the browser's own
accessibility tree (`Accessibility.getPartialAXTree`), and `focusVisible`: whether the element matches
`:focus-visible`, which says the browser would draw an indicator if the page's styles let it, not that one is
seen (that is `genie/focus-visible`, below). Each part of a selector is the element's `id` when that id is unique in
its own root, or a path of `:nth-of-type` steps up to one, as the click check's are; an element at the top of a
shadow root is anchored with `:host >`, which `shadowRoot.querySelector` reads in Chrome, so the part matches
that element and nothing deeper. A part longer than 1,000 characters keeps its end, which names the element
itself, behind `…` and a short hash of the whole part, so two different deep elements never read as one stop
(`walk-deep.html`: siblings 60 levels down, which kept the start instead read as one stop, and as a false trap). The same unchanged page
walked twice gives the same stops.

**Frames and shadow roots.** It reads into open shadow roots and frames of the same origin. A frame of another
origin cannot be read inside: while focus is in it, the stop is the frame itself, marked `opaque`, and an opaque
stop is never taken as the walk coming back to its first stop. A closed shadow root cannot be read either: the
stop is its host.

**The page cannot steer it.** Focus is read in an isolated world of the walk's own (`Page.createIsolatedWorld`),
so a page that replaces `document.activeElement`, `Element.prototype.matches` or `getRootNode` changes nothing
it reads (`walk-tampered.html`). The isolated world of the top page reaches the same-origin frames' documents
and the open shadow roots. What comes back is checked field by field. The one thing the walk changes in the page
is the root element's `tabindex`, for the moment it takes to move the starting point, and the page's own
handlers see the focus, the blur and the key presses. Names are made printable (escape sequences and controls
taken out, on one line) and cut at 160 characters in `scan.json` (`walk-names.html`).

**For the checks that come next.** `FocusReader` is the walk's reader on its own: open it on a page, move to the
top, read where focus is after any key, close it. A trap check can press Shift+Tab or Escape and read again with
the same reader, and compare stops with `sameStop` (the same `target`). `walkPage` calls `onStop` after each stop
is read, while focus is still on it; the skip link uses it, and the focus-visible check takes its screenshots
there.

`FocusReader.call` and `FocusReader.callOnFocused` run a check's own function in the reader's isolated world
(with the focused element as `this`, for the second), with plain JSON arguments, so a check asks the page out of
reach of its scripts; `DESCRIBE` is exported so such a check names elements as the stops are named.

**The cost.** A stop is three DevTools Protocol calls after the key press; a 30-stop page walks in well under a
second. Fixtures: `impact-mix.html` (its golden), `walk-shadow.html`, `walk-frame.html` and
`walk-frame-inner.html`, `walk-order.html`, `walk-long.html`, `walk-tampered.html`, `walk-other-origin.html`,
`walk-names.html`, `walk-nothing.html`; test: `test/browser/walk.test.ts`.

### The keyboard trap (`src/keyboard-trap.ts`)

`genie/keyboard-trap` (critical, WCAG 2.1.2) and `genie/focus-not-returned` (moderate, WCAG 2.4.3)
read the keyboard walk and press a few more keys with the walk's own `FocusReader`; there is no second walker.
They run last in `scanPage`, after the skip link, because Escape may close a dialog. Each is tagged
`cat.keyboard` and `wcag2a`, with `wcag212` or `wcag243`, and runs when a `--tags` list has one of its tags.

**Where focus may be held.** Only where the walk went round:

- `end: "cycled"`: the stops from `cycleFrom` to the last. The stops before the cycle are outside it, so it is
  always a strict part of the page. A cycle of one is focus that does not move.
- `end: "wrapped"`: all the stops. That is the whole Tab order on most pages, and it is read as a trap only
  when the page's own document has a tabbable element the walk never reached. That element must plainly take
  Tab: shown, enabled, not inert, `tabIndex` 0 or more, and not a frame, a shadow host or a radio button,
  whose focus lands elsewhere or is one of a group. Leaving the doubtful ones out can only make a trap read as
  none, never the other way round (`trap-first.html`).
- `left` and `max-tabs`: nothing went round, and nothing more is pressed. Nor when the cycle holds a frame of
  another origin, inside which focus cannot be read.

**Trying to leave.** From the cycle's first element, where the walk leaves focus: Shift+Tab, once for each element
of the cycle, then Escape, then Tab once more (an editor that keeps Tab for indenting gives it back after Escape).
Any press that puts focus on an element outside the cycle, or on no element, means a keyboard can leave:
nothing is flagged (`trap-shift-leaves.html`, `trap-escape-leaves.html`). If none does, every element of the
cycle is an element of `genie/keyboard-trap` (`trap.html`, `trap-stuck.html`). After Escape, a focused element
that is no longer shown counts as focus on no element: Chrome can leave focus on a button of a dialog Escape has
just hidden until it moves focus to the page itself. Focus is read two frames after Escape and after the Tab
that follows it (or a second later, when frames do not come), not the moment the key returns: a dialog that gives
focus back in a `setTimeout(0)` once it has closed, as many dialog libraries do, has done so by then
(`modal-late-return.html`).

**The modal dialog.** A dialog keeps focus inside on purpose. When every element of the cycle is inside one shown
modal dialog (`role="dialog"` or `"alertdialog"`, or a `dialog` element, with `aria-modal="true"`), and Escape
takes focus out of the cycle and the dialog is no longer shown, it is not a trap (`modal-ok.html`). Then focus
must be back on the control that opened it (`focus-not-returned.html`).

**The opener rule.** The check cannot see which control opened a dialog, and it does not guess. The opener is
known only when exactly one element outside the dialog names the dialog's `id` in `aria-controls`: then focus
anywhere but that element, after Escape closed the dialog, is `genie/focus-not-returned`. When no element names
it, or more than one does, there is no known opener: focus on no element is still the finding, and focus on any
element outside the dialog is taken as returned.

**A native modal dialog is not checked.** A `dialog` opened with `showModal()` is not checked for a trap, or for
focus not returned, because Chrome hands Tab and Shift+Tab out of it to the browser's own controls, so the walk
cannot show whether it holds focus. After the walk, `scanPage` asks the walk's isolated world whether the page's
own document has a `dialog:modal`; if it has, the trap check does not run in that state, and the skip is never
silent: the scan's *What this scan cannot see* (`cannotSee` in `scan.json`, and `report.md`) gets one line for
the page after the fixed list, naming the states: "A dialog on `<page>` (in the state `<state>`) was opened with
showModal(); A11y Genie cannot walk the keyboard inside a native modal dialog, so check by hand that Tab stays in
it and Escape closes it (WCAG 2.1.2)." A page without one adds nothing, so the list stays the fixed one
(`native-modal.html`). A dialog is open only in the state that opens it, so these are found in a state
such as `delete-dialog: click css '#open'`.

**What it does not see.** A trap inside a frame of another origin. A native modal dialog (above). A
`dialog:modal` inside a frame or a shadow root, which the native-dialog question does not read. Focus not
returned after a dialog closed by anything but Escape.

**The cost.** Nothing on a walk that ends `left` or `max-tabs`. Otherwise, the walk's second lap of the cycle
(as many presses as the cycle has stops, inside `--max-tabs`), then at most that many Shift+Tab presses, one
Escape and one Tab, and two or three DevTools Protocol calls after each press. Test:
`test/browser/keyboard-trap.test.ts`.

### Focus visible (`src/focus-visible.ts`)

`genie/focus-visible` (serious, WCAG 2.4.7) asks, at each stop of the keyboard walk, whether the Tab
key's focus changed anything on screen. It is tagged `cat.keyboard`, `wcag2aa` and `wcag247`, as axe-core tags its
own level AA rules, and runs under the default rule set or a `--tags` list with one of those. It runs inside the
walk, from its `onStop`, while focus is still where Tab put it, through the one `FocusReader` that `scanPage` opens
for the walk's checks and shares with the skip link; it presses no key.

**Two comparisons.** For each stop, the element focused and the same element unfocused:

1. the computed `outline-style`, `outline-width`, `outline-color`, `box-shadow`, `border-color`,
   `background-color` and `text-decoration` of the element and of its first two ancestors (through a shadow
   root's host), read in the isolated world. An outline whose style is `none` is not drawn, so its width and
   colour are not compared; and
2. a screenshot of the element's box padded by 4 px on each side (`PAD_PX`), in the top page's window
   coordinates (a frame's offset added), cut to the window. The first is taken as Tab left it, so
   `:focus-visible` applies; the second after focus is taken off it.

A pixel has changed when one of its red, green and blue differs by more than 16 levels of 255
(`PIXEL_TOLERANCE`). Then:

| Changed pixels | Styles | Result |
| --- | --- | --- |
| 1% of the padded box or more (`VISIBLE_SHARE`) | any | visible: nothing |
| none | none changed | **finding**: focus produced no visible change |
| fewer than 1% | some changed | *needs review*: "the change may be too faint to see" |
| some, fewer than 1% | none changed | *needs review*: a few pixels changed, and nothing a scan reads |

So a finding needs both to say nothing changed. Anything in between is for a person to look at, never a finding.
The check proves that focus produced no visible change, not that a change is enough: whether the indicator stands
out against its background (WCAG 2.4.7 and 1.4.11) stays on *What this scan cannot see*. A stop it cannot
photograph is *needs review* too: one outside the window (`#away` in `focus-hidden.html`, a link left at
`left: -9999px` when it has focus), or one where the screenshot or its reading failed. A stop inside a frame of
another origin is not looked at: focus inside it cannot be read.

**The threshold (V4).** Measured at Chrome 158 (headless, Playwright 1.65.1), one CSS pixel to a device pixel, on
the fixtures. The share is of the padded box's pixels that changed by more than 16 levels:

| Fixture, element | Focus style | Changed | Styles changed | Result |
| --- | --- | --- | --- | --- |
| `clean.html`, `impact-mix.html`, `walk-long.html` (30 buttons), `walk-shadow.html`, `walk-frame.html`, `skip-link-ok.html` | the browser's own outline | 14% to 23% | outline | visible |
| `focus-custom-ok.html` `#ring` | `outline: none`, a 3 px `box-shadow` ring | 27% | box-shadow | visible |
| `focus-custom-ok.html` `#fill` | `outline: none`, the background filled | 51% | background-color | visible |
| `focus-custom-ok.html` `#name` | `outline: none`, a 3 px border for a 1 px one | 19% | border-color | visible |
| `skip-link-ok.html`, the skip link | moved into the window from `left: -9999px` | 48% | outline, border, background | visible |
| `focus-hidden.html` `#plain-link`, `#plain-button` | `outline: none` and nothing else | 0 pixels | none | finding |
| `focus-faint.html` `#faint-fill` | white background to `#f4f4f4` | 0 (854 pixels changed by 8 levels or more, none by more than 16) | background-color | needs review |
| `focus-faint.html` `#faint-ring` | a 2 px outline in `#f6f6f6` on white | 0 (364 pixels by 8 or more) | outline | needs review |
| `focus-animated.html` `#slide`, `#grow`, `#pulse` | a ring by a transition, by an animation, by an endless pulse | 25%, 25%, 24% | box-shadow | visible |
| `focus-marked.html` `#marked-first`, `#marked-second` | `outline: none`, a ring drawn on a mark the page's focus handlers set (as Fluent UI's `data-fui-focus-visible`) | 0 after the blur; 19% and 14% against the witness | none | visible, by the witness |
| `focus-marked.html` `#bare`, right after `#marked-second` | `outline: none` and nothing else | 0, and 0 against the witness with the previous stop left out | none | finding |
| `focus-marked-scroll.html` `#marked-low` | as `#marked-first`, far down the page: the Tab press scrolls | 0; no witness, the press scrolled | none | finding (a limit, below) |
| `focus-marked-scroll.html` `#native` | the browser's own outline, down the page | 13% | outline | visible |
| `focus-witness-edges.html` `#after-wide`, right after `#wide-ring`'s 8 px outline | `outline: none` and nothing else | 0; 0 against the witness, the previous stop left out 16 px past its padded box (4.4% with only its padded box left out) | none | finding |
| `focus-witness-edges.html` `#beside-spinner`, beside a shadow root that pulses for ever | `outline: none` and nothing else | 0, the pulse held in both shots (4.2% with it running) | none | finding |
| `focus-witness-edges.html` `#small-field`, a 24 px text field | `outline: none` and nothing else | 0, the caret hidden in every shot (1.4% against the witness with it shown) | none | finding |
| `focus-witness-scrolled.html` `#fixed-marked`, a fixed toolbar on a page scrolled 3,000 px | a ring drawn on a mark, as `focus-marked.html` | 0 after the blur; visible against the witness, taken of the window | none | visible, by the witness |
| `focus-witness-scrolled.html` `#fixed-bare` | `outline: none` and nothing else | 0 | none | finding |
| The deck page's player bar (Fluent UI v9 buttons: Exit deck, Next slide, Settings, Fullscreen, Stop narration) | Fluent's ring on `data-fui-focus-visible` | 0 after the blur; 15% to 25% against the witness | none | visible, by the witness |

The smallest visible change measured was 14% of the padded box, and every unchanged element changed no pixel at
all, at any tolerance: the two screenshots are taken in the same run, of the same layout, so nothing but focus
differs. The default of 1% is far inside that gap and is kept. The tolerance of 16 levels is
what makes the faint fixtures faint: below it, a change is too small for many people to notice, and with no
tolerance `#faint-fill` would count as fully changed. A smaller tolerance would pass the faint fixtures as
visible; a much larger one would start to miss light focus colours.

**Why a finding needs both to say nothing changed.** The screenshots see only the element and 4 px around it.
An indicator drawn further out by the properties the check reads still changes one of them on the element or one
of its two nearest ancestors: an outline with a large `outline-offset` changes `outline-style`, a wide ring changes
`box-shadow`, a filled parent changes its `background-color`. So with no changed pixel, a style change keeps the
element out of the findings, and at most it is *needs review*: the check is never wrong about an indicator drawn
that way.

**The witness.** Some pages draw their ring from a mark their own focus handlers set and remove: Fluent UI sets
`data-fui-focus-visible` when a key moves focus to an element and takes it off in its `focusout` handler, and the
focus-visible polyfill does the same with a class. The guard (below) keeps the page from hearing the check's blur,
so the mark stays, the ring is still drawn in the unfocused screenshot, and the two match: before the witness, the
deck page's player bar was five false serious findings. So just before each Tab press, while the check still takes
screenshots, the walk's `beforePress` takes one more: the window, held still (finite animations at their end,
infinite ones at their start), as the page drew it before focus moved. When the blur shows no visible change, the
check photographs the element focused again, held the same way, and compares it with the same padded box cut from
the witness. The previous stop's padded box is left out of that comparison, so its own ring going away is not read
as this stop's ring arriving (`#bare` in `focus-marked.html` sits right after a ringed button). The witness is used
only when the press scrolled nothing: the window's offsets and a count of `scroll` events, heard by the isolated
world's own listener and read after the next frame, must be the same before and after the press. A witness can
only show focus visible; it never makes a finding. Nothing about it reaches the page: no event is stopped or sent,
no focus moves, and its screenshots are taken through the DevTools Protocol (`optimizeForSpeed`), whose clip is in
the page's coordinates, so the window's own offset in the page is added (`focus-witness-scrolled.html`, where the
toolbar sits 3,000 px down the page).

What else it holds to, each from a review of its first version:

- **No witness without the frame.** The scroll mark waits for the next frame, so a scroll the press caused has
  fired its event; a page that draws no frame (a hidden or throttled one) gives up after `WITNESS_FRAME_MS`
  (1 s) and has no witness, rather than holding the scan for ever (held by a test that stops the page's frames).
  Each same-origin frame's window is in the mark too, its offsets and its scroll events.
- **Only the stop just left is left out.** The check counts presses, and leaves out the padded box of the stop it
  measured at the press just before, 16 px wider on each side (`MASK_PX`), so a ring drawn further out than the
  padding is left out too (`#after-wide`). When the press before did not reach a stop it measured (a lap, a stop
  outside the window or in another origin's frame), the stop focus left is not known, and there is no witness.
- **Still in every root.** Its animations are held in every open shadow root and same-origin frame, as above.
- **No caret.** The same style that hides the caret and turns transitions off is adopted, for each shot, in every
  root, as a constructed style sheet (`adoptedStyleSheets`), which the page's mutation observers do not hear, then
  taken away (`#small-field`).

**Where a scan can be wrong.** An indicator drawn by something else, and more than 4 px away, changes nothing the
check reads: focus shown only on a sibling (`#save` in `focus-elsewhere.html`, whose status line 40 px below fills
in), or only by a pseudo-element (`#help`, whose `::after` bar sits 12 px below it; pseudo-elements' styles are not
read). Both are read as no visible change, and are findings, though a person can see where focus is. The test
holds this limit as it is, and *What this scan cannot see* has a fixed line for it, in every record: "A focus
indicator drawn away from the element (outside it, its two nearest ancestors' styles, and a few pixels around it)
is not seen; check focus by hand where a design draws it elsewhere (WCAG 2.4.7)."
A ring drawn from a mark the page's focus handlers set, on an element the Tab press scrolls into view, has no
witness: the shot before the press is of another part of the page. It reads as the blur reads it, no visible
change, and is a finding though a person sees the ring (`#marked-low` in `focus-marked-scroll.html`, held as it
is by the test).

**Animations (V4).** A ring that comes in by a transition or an animation is judged as it ends. Before each
screenshot, every running animation and transition of the page, its same-origin frames, every open shadow root
(a document's `getAnimations()` does not reach into them, checked at Chrome 158) and the shadow roots the element
is in is paused, its `currentTime` kept, and a finite one is set to its end while paused; a style turns
transitions off for as long as the screenshot takes (Playwright's `style` option, which reaches shadow roots and
frames). An infinite animation on the element, an ancestor or a descendant is paused where it is, since it may be
the ring; one anywhere else is set to its start, the same in both screenshots, so a spinner beside the element is
not read as its focus (`#beside-spinner` in `focus-witness-edges.html`). After the screenshot each one is put back at the time it
was paused at plus the time that has passed since, and played on, so it ends where it would have without the
check, not early and not late. One whose time ran out while it was held is finished, as it would have been by
then: played instead, from its end, it would start again from the beginning (the Web Animations auto-rewind; a
test holds a 150 ms animation past its end and reads it finished, at 150, once). Nothing else is finished, so no
other `finish` event fires; setting a paused CSS animation or
transition to its end does queue its `animationend` or `transitionend`, so the guard (`src/focus-guard.ts`)
also stops those two kinds of event, and `animationstart`, `animationiteration`, `animationcancel`,
`transitionrun`, `transitionstart` and `transitioncancel`, for the animations the check named (it names them, with the guard, before it sets any of them to its end, so no
event can be dispatched in between, and holds only those), until three frames have been
drawn after they are put back (the browser dispatches animation events in the step that opens a frame, before that
frame's `requestAnimationFrame` callbacks, so the wait follows frames and not a clock; only a page that draws no
frames, such as a hidden one, ends it at a ten-second cap); the page's other animations' events pass. The styles of the focused and the
unfocused element are read inside the same stillness, so an animated ring is judged as it ends
(`focus-running.html`: a 60 s animation and transition, running when the check reaches them, are within half a
second of where the page's own clock puts them, with no end event heard). Playwright's own `animations: "disabled"` is not used,
because it cancels an infinite animation back to the style without it: with it, `#pulse`'s ring was gone from the
focused screenshot (0 pixels changed, needs review). With neither, `#slide` and `#grow`, whose rings start after
a second, were photographed before them and read as findings. The caret is hidden by the same style.
Playwright's own `caret: "hide"` is not used either: it writes a `style` attribute on every field and leaves it
there, empty, which changed the HTML the trap check quotes.

**The page is left as it was.** Focus is taken off the element with `blur()` and given back with `focus()`
(`preventScroll`) in the isolated world. For that moment, a guard (`src/focus-guard.ts`) stops the `blur`,
`focusout`, `focus` and `focusin` events, and the older `DOMFocusIn` and `DOMFocusOut` that Chrome still fires beside
them (checked at Chrome 159; `focus-listening.html` counts all six), so the page's own handlers never see them.
From just before the blur until the refocus has been styled, a constructed style sheet in every root turns
transitions off, so the blur and the refocus start none; the sheet is taken away only after each document's styles
are worked out, so taking it away starts nothing either. Turning transitions off does not stop one that is already
running from being cancelled: the blur changes the focus style under the ring's own transition, and the browser
cancels it a frame later, a `transitioncancel` the page did not cause. So just before the blur the check names,
with the guard, every animation and transition that is running, and the guard holds their events through the
blur, the unfocused screenshot and the refocus, until three frames have been drawn after focus is back (`keep` and
`release` in `src/focus-guard.ts`). The page hears no transition event of the check's making
(`focus-transitioning.html`, whose ring comes in by a 10 s transition and which writes down, in order, every focus
change and transition event it hears: each one follows a focus change the page heard itself, an element runs,
starts or ends at most once for each of its own, and is cancelled only after the page heard it lose focus; the
same test runs again with the CPU six times slower). How many events it hears is not compared with a scan
without the check, because that depends on the walk's pace: a Tab away from a ring that has been drawn for a frame
starts it back, and the check makes the walk wait on each stop, as a person would. Until this was found, the test
compared those counts, and passed on a fast machine only because a screenshot's hold happened to keep back two of
the page's own events. A menu that closes when
focus leaves it stays open (`focus-watched.html`, whose counts of focus and blur events, and whose walk, are the
same with the check as without it). The guard is first in line: `runScan` installs it before the page navigates
(`FocusGuard.install`, `Page.addScriptToEvaluateOnNewDocument` into an isolated world of its own, in every
document the page opens, frames included), and it sits dormant, with capture-phase listeners on `window` for the
four events that do nothing, until the check switches it on around its blur and refocus and off after. So a
listener of the page's own on `window` in the capture phase, added at load, is behind it and hears nothing
(`focus-listening.html`, `focus-running.html`, whose counts are the same with the check as without it). Verified in Chrome: a
listener added from an isolated world and stopping an event with `stopImmediatePropagation()` stops the page's
own main-world listeners after it on the same target, as the browser keeps one list of listeners per target.
A scan of a page that was already loaded when it began (a caller that did not install the guard, or installed it
only after the load, so no document has its world) gets a late guard, behind whatever the page added (`runScan`
installs early, and if that install fails it carries on with a late one); whenever the guard has to be added to the
open documents, it is marked late, whatever the install was. A late guard cannot shield the page from the blur, so every stop the check would have measured is *needs review* ("the page's own listeners may have heard the check") and the check never blurs it or raises a finding on it. Stops it never measures (outside the window, past the cap, in another origin's frame) read as they always did. Focus ends on
the element Tab put it on, so the walk's next Tab goes on from there, and the trap check reads the same walk and
the same trap with the check as without it (`trap.html`, `trap-stuck.html`, `walk-order.html`, `walk-shadow.html`,
`walk-frame.html`). If focus cannot be given back, the check takes no more screenshots on that walk, and the rest
of its stops are *needs review*. Focus is given back once a stop, after the second screenshot, or at the end when
something failed before that; a failure after it (a screenshot that does not decode) is that stop's own *needs
review*, and the walk's later stops are looked at as they would be. What the page can still notice: the screenshot style is a `style` element added and removed, and the witness's
style is in `adoptedStyleSheets` while it shoots, and so is the sheet that turns transitions off from the blur to the refocus.

**The screenshots stay in memory.** Each pair is decoded in Node (`src/png.ts`, a small reader of Chrome's 8-bit
RGB and RGBA PNGs, on Node's own zlib), compared, and dropped. No screenshot is written to disk, to `scan.json`
or to the report; the record holds only the finding or the *needs review* item, with the element's selector and
HTML excerpt, as any other check's.

**The cost, and the cap.** Two screenshots and about a dozen DevTools Protocol calls a stop, and the witness's
window shot before each press (with one more shot of the element when the blur shows nothing): about 100 ms a
stop. A page of 30 buttons (`walk-long.html`) took 3.5 s with the check and 0.5 s without on a desktop, against 2.5 s
before the witness; with Playwright's own screenshot for the witness it took 4.8 s, so the witness's shots are taken
straight through the DevTools Protocol, encoded for speed, and decoded only when a stop needs them. So at
most `MAX_SCREENSHOT_STOPS` (100) stops of each walk get screenshots, about 10 s; each stop after them is a
*needs review* item saying it was not looked at, and why. With the default `--max-tabs` of 200 that is at most 100
such items a state. Fixtures: `focus-custom-ok.html`, `focus-hidden.html`, `focus-faint.html`,
`focus-animated.html`, `focus-watched.html`, `focus-listening.html`, `focus-transitioning.html`, `focus-elsewhere.html`, `focus-marked.html`,
`focus-marked-scroll.html`, `focus-witness-edges.html`, `focus-witness-scrolled.html`; tests: `test/browser/focus-visible.test.ts`,
`test/unit/focus-visible.test.ts`.

### Reading the accessibility tree (`src/a11y-tree.ts`)

Narration reads, after each key of a flow, what the browser's accessibility tree says of the
element focus is on, and writes the line a screen reader would say for it. This part is the reader and the line;
the `narrate` command, its transcript and `genie/unnamed-step` are in *Narration*, below. It is not a screen reader: it says what
Chrome's tree holds, in words of its own, and NVDA, JAWS and VoiceOver each say it their own way.

**Two sources, compared (V6).** Checked at Chrome 158 (headless, Playwright 1.65.1) on each control of
`workflow.html` and `a11y-tree-sets.html`, focused, against Playwright's `locator.ariaSnapshot()` and the
DevTools Protocol's `Accessibility.getPartialAXTree`:

| Field | `ariaSnapshot()` | `getPartialAXTree` | Read from |
| --- | --- | --- | --- |
| role, name | yes | yes | the protocol |
| heading level | `[level=1]` | `level` | the protocol |
| checked, pressed, disabled, invalid, selected | `[checked]`, `[pressed]`... when they hold | `checked`, `pressed`... `"true"` or `"false"` | the protocol |
| collapsed | missing: `[expanded]` shows only when true, so collapsed reads the same as a button that does not expand | `expanded: false` | the protocol |
| required | missing | `required` | the protocol |
| a menu button's popup | missing | `hasPopup: "menu"` | the protocol |
| read only | missing | `readonly` | the protocol |
| value | a text field's text, after `:` | `value` | the protocol |
| `aria-valuetext` | missing | `valuetext` is empty | the element's attribute, in the isolated world |
| position in a set ("2 of 3") | missing | missing, even with `aria-posinset` and `aria-setsize` | worked out, below |
| `aria-activedescendant` | missing | `activedescendant`, with the node it points at | the protocol |

So the reader uses the protocol for everything it gives, and `ariaSnapshot()` for nothing: the snapshot is
YAML for a person to read, and leaves out `required`, a collapsed state and the popup. The keyboard walk already
reads role and name from the same call (above).

**A position in a set.** Neither source gives it, so the reader works it out, in this order. `aria-posinset` and
`aria-setsize`, when the page gives them, read from the element in the isolated world. A native radio button with
a name: its place among the radio buttons with the same name, the same form owner and the same document or shadow
root, that are rendered, as HTML groups them. An item role (an option, a menu item, a tab, a tree item, a radio
button by role): its place among the items of the same role in the nearest set in the tree (a list box, a menu, a
tab list, a tree or its group, a radio group), found with `Accessibility.queryAXTree`, leaving out the items of
sets nested in that one, so a tree item counts its siblings and not their children. An item the tree ignores
(hidden) is not counted. Past 50 nested sets no position is given. A part the page gives overrides the part
worked out; a position larger than its size is not given at all.

**`aria-activedescendant`.** When the focused element points at one of its items (a combo box and its options),
the item is what is read and named, as a screen reader reads it, and `activeDescendant` is set.

**The spoken line.** The parts, each left out when empty, joined with `, `: the name; the role's words; the level,
for a heading or a tree item; the states; the position in the set, as `2 of 3`; the value, unless it is the same
as the name. The states are said in this order: `expanded` or `collapsed`; `checked`, `not checked` or
`partly checked`; `pressed`, `not pressed` or `partly pressed`; then, only when they hold, `selected`, `disabled`,
`read only`, `required` and `invalid`. The role's words come from `ROLE_WORDS` (`textbox` is `edit text`,
`checkbox` is `check box`, `combobox` is `combo box`); a button with a menu popup is a `menu button`, and one with a
pressed state a `toggle button`; a role the table does not list is said as the tree names it, its words split
(`LabelText` is `label text`); `generic`, `none` and `presentation` say nothing. So:

| Control in `workflow.html` | Spoken |
| --- | --- |
| the heading | `Account settings, heading, level 1` |
| the email field | `Email, edit text, required` |
| the button with no name | `button` |
| the submit button | `Save, button` |
| the field with a value | `Display name, edit text, Ada` |
| the invalid field | `Invite code, edit text, invalid` |
| the radio buttons | `Free, radio button, checked, 1 of 3`; `Team, radio button, not checked, 2 of 3`; `Business, radio button, not checked, 3 of 3` |
| the checkbox | `Send me news, check box, checked` |
| the toggle | `Bold, toggle button, pressed` |
| the menu button | `Actions, menu button, collapsed`, and `Actions, menu button, expanded` once open |
| the control marked disabled | `Archive, button, disabled` |
| the link | `Privacy notes, link` |

**Unnamed.** An element whose role says something and whose name is empty is `unnamed`, and its line starts at the
role: `button`. That is what narration flags as a step with no name. An element whose role says nothing and has
no name (a focusable `div`) is not `unnamed`, and its line is empty.

**Page text is data.** Names and values are read up to 500 characters, made printable (escape sequences and
controls taken out, on one line, `src/printable.ts`) and cut at the excerpt limit, 160 characters with `…`, before
they reach the line (`a11y-tree-sets.html`, `walk-names.html`). Focus is found in an isolated world of the
reader's own, as the walk finds it, so a page that replaces `document.activeElement` changes nothing
(`walk-tampered.html`); every field the protocol gives back is checked before use.

**The cost.** A read is five DevTools Protocol calls, two more when it follows `aria-activedescendant`, and for an
item role whose position is worked out from the tree, one query for its items, one for each kind of set it may
nest in, and one for each nested set. Fixtures: `workflow.html`, `a11y-tree-sets.html`, and the walk's `walk-shadow.html`,
`walk-frame.html`, `walk-tampered.html` and `walk-names.html`; tests: `test/browser/a11y-tree.test.ts`,
`test/unit/a11y-tree.test.ts`.

### Narration (`src/narrate.ts`, `src/narrate-command.ts`)

`a11y-genie narrate <url> --flow "<steps>"` drives one flow by the keyboard and writes down what a screen reader
would say after each step. A config's `workflows` are narrated the same way on `scan --config`, after the
pages and their states. Each flow runs in a new context of its own, with every hostile-page rule of
`src/context.ts` (below), from a fresh load of its page, held to the page time limit (`--timeout`). The load, the
rules and the refusals are `src/run-scan.ts`'s (`loadPage`, `narrateWorkflow`); with `narrate`, nothing else runs:
no axe-core and no keyboard walk, so its record has `command: "narrate"` and `engine.rulesRun` of `0`.

**One step at a time.** `narrateSteps` runs each step with the step driver (`runSteps` of `src/drive.ts`), then
reads the focused element with `TreeReader` (*Reading the accessibility tree*, above): role, name, states and the
spoken line. A step that fails on the page stops the flow, which reads *not scanned* with the driver's words and
keeps the steps before it; so do a network rule that stopped the page, an address that is not `http:` or `https:`,
and the time limit. `Tab to` is bounded by `--max-tabs`, and a flow by 200 steps.

**What a press produced.** After Enter, Space or a click (`producesResult`), the step also says what it did, in
the order a screen reader would, from three things read in an isolated world of the narration's own, out of the
page's reach (`PressObserver`):

- *a dialog that opened*: a visible `dialog` element, or `role="dialog"` or `"alertdialog"`, that was not shown
  before the press. Its name and role are read from the accessibility tree: `Settings, dialog`.
- *where focus went*: focus on another element than before, or on none (`kind: "focus"`); or, on the same
  element, a spoken line that changed, such as a menu button that went from collapsed to expanded
  (`kind: "change"`). A focus line that only repeats the dialog's is not said twice.
- *live regions*: before the press the text of every visible `aria-live="polite"` or `"assertive"` element,
  `role="status"`, `"alert"` and `"log"` element, and `output`, is remembered; after it, the page is given 250 ms
  (`ACTION_SETTLE_MS`) for its answer, and the text that was added is said, as `Saved, status`. A region that
  grew by appending says only what was added; one that was rewritten says all of it. Open shadow roots are
  searched; frames are not. A region inside another region (a `role="status"` in an `aria-live` div) is not read on
  its own, as a screen reader says it once with the outer one (`narrate-nested-live.html`). A page that goes to another address (not a jump within the page), or loads a new
  document at the same address (a reload, a form that posts back to itself: the main frame's `DOMContentLoaded`
  is counted), is read again from scratch, and the step says the new page's title (`kind: "page"`;
  `narrate-reload.html`). A new document that commits after that check is caught when the readers' world is
  found gone, and read again the same way, once.

A press that produced none of these reads `(nothing is said)` in the transcript. Page text read here is made
printable (`src/printable.ts`) and cut to the excerpt limit (160 characters) before it is kept, and each value read
from the page is checked before use.

**The transcript.** `renderTranscript` writes one from the record alone, so `report` can write it again from a
stored `scan.json`: a line `<name>, on <page>`, then one line a step, the number, the step and what is said,
in columns; a press that produced several things continues them under the first; and a step with no name is
followed by a line that says so:

```text
flow, on workflow.html
1  Tab    Email, edit text, required
2  Tab    button
   ^ This step has no name. A screen reader says "button", and stops.
3  Tab    Save, button
4  Enter  Saved, status
```

A flow that stopped early ends with `Not narrated past this point: <why>.` `narrate` prints the transcript and
writes it as `narration/flow.txt` in the scan folder beside `scan.json`; with `scan --config` each workflow has
`narration/<name>.txt` (docs/CONFIG.md says how a name becomes a file name). Every report carries each transcript
under *Narrated flows*. The golden is `test/goldens/narration/flow.txt`, from `workflow.html` with the flow
`Tab; Tab; Tab; Enter`; `UPDATE_GOLDENS=1 npm test` rewrites it. Speaking the transcript aloud comes later:
`spoken` is what a speech engine would be given.

**`genie/unnamed-step`** (serious, WCAG 4.1.2): a step that brings focus to an element that has a role that is
said and no name (the tree reader's `unnamed` field). A step that leaves focus where the step before it left it is not
counted again, and the same element reached by two flows is one element of the finding. The finding is the page's, in
the record's default state, and makes `narrate` exit 1 at the default `--fail-on`. It is registered with the tags
`cat.name-role-value`, `wcag2a` and `wcag412`, like the other level-A own rules (decided 2026-11-19). The tags only
change `rules --tags` listings: a flow someone asked to narrate is always read, whatever `--tags` says. Its plain words are in `src/plain.ts`.

A `narrate` record is not a scan to compare with: plain `scan` skips it when it looks for the site's last scan
(`previousScan`), and `check --baseline` refuses it. Fixtures: `workflow.html` (its form is `novalidate`, so
Enter on Save submits instead of stopping at the empty required Email), `narrate-press.html` and
`hostile/narrate-text.html`; tests: `test/browser/narrate.test.ts`, `test/cli/narrate.test.ts` and
`test/unit/narrate.test.ts`.

### Plain words (`src/plain.ts`)

A finding's `plain` (what is wrong, and who it hurts) and `fix` (what to change), and the short `title` that
heads it in the report, come from one table,
`RULE_WORDING`, keyed by `<source>/<id>`, such as `axe/image-alt` or `genie/skip-link`. They are written for a
reader who knows no WCAG, in plain facts and never in the genie's voice, and never tell a reader a site has
no problems or meets a standard. A second table, `CRITERION_WORDING`, names each WCAG criterion the rules carry,
with what it asks in a few words; the report prints `1.4.3 Contrast (Minimum): text must stand out from its
background`. A rule with no entry keeps axe-core's `help` and `failureSummary`, and a criterion with no entry
reads as its number. The tables are data: no page text and nothing axe-core said goes into them, and the
finding's element keeps axe-core's (or the check's) own words beside them.

To add a rule's words:

1. Add an entry to `RULE_WORDING`: a `title` of a few words (at most `TITLE_MAX_WORDS`, no full stop), and
   `plain` and `fix`, a sentence or two each, ending with a full stop. Add
   `advice` too when the rule's advice says something its violation does not, as `genie/skip-link` does.
2. Add each WCAG criterion the rule carries to `CRITERION_WORDING`, if it is not there: its name as WCAG gives
   it, and what it asks.
3. Run `UPDATE_GOLDENS=1 npm test` if a golden page hits the rule, and read the diff: only words should change.

`test/unit/plain.test.ts` holds the tables together: every registered `genie/*` rule has an entry (so a new
check without words fails), every axe entry names a rule of the pinned axe-core, every axe-core rule a fixture
page hits has an entry, and every criterion those rules carry has words, and every title is short. `test/unit/never-claim.test.ts` reads
every entry, and `test/unit/report.test.ts` checks the fallback.

### The list of rules (`src/rules-command.ts`, `src/genie-rules.ts`)

`a11y-genie rules` prints axe-core's rules from `axe.getRules()` at the installed version and the product's own
`genie/*` rules, each with impact, WCAG criteria and tags (`--json` is documented in `docs/JSON.md`). It runs
in Node alone: no browser, no network. axe-core's `getRules()` leaves out each rule's impact, so it is read
from `axe._audit.rules`, the one place axe-core keeps it, and shown as `null` if it is ever missing (a test
fails when it is, at the pinned version). The own rules come from one registry, `src/genie-rules.ts`: a check
calls `registerGenieRule` in its module (`src/landmarks.ts` does, for `genie/no-landmarks`, `moderate`, tagged
`best-practice`; `src/click-on-non-control.ts` does, for `genie/click-on-non-control`, `serious`, tagged
`cat.keyboard`, `wcag2a`, `wcag211` and `wcag412`; `src/keyboard-trap.ts` does, for `genie/keyboard-trap`,
`critical`, and `genie/focus-not-returned`, `moderate`, both tagged `cat.keyboard` and `wcag2a`;
`src/focus-visible.ts` does, for `genie/focus-visible`, `serious`, tagged `cat.keyboard`, `wcag2aa` and `wcag247`), and
`src/rules-command.ts` imports that module. A check added later registers itself and
imports it there, and a rule not built yet is not listed. `--tags` keeps the rules that carry any of the tags,
as axe-core's own `--tags` runs them, so a list without `best-practice` leaves the landmark rules out, and one
without `wcag2a` (or another of its tags) leaves out `genie/click-on-non-control`, and one without `wcag2aa` (or
`cat.keyboard` or `wcag247`) leaves out `genie/focus-visible`.

### The rule flags (`src/rule-flags.ts`)

- **`--tags <list>`** is comma-separated, in the order given, without repeats. The tags it accepts are the ones
  axe-core's own rule metadata carries (`axe.getRules()` at the installed version, read in Node, nothing listed
  by hand): `wcag2a`, `wcag21aa`, `best-practice`, `cat.aria`, `experimental` and the rest. An unknown or empty
  one is a refusal that gives examples. `axe.withTags()` then runs exactly those; a rule with none of them does not
  run, which is how `engine.rulesRun` comes to differ. Without `--tags`, `engine.tags` is `null` and axe-core's
  default rule set runs (docs/JSON.md). The tags go in as given: `wcag2a` alone does not also run `wcag2aa`.
- **`--fail-on <impact>`** is `critical`, `serious`, `moderate` or `minor`, default `minor`. The exit is 1 when a
  violation is at or above it (`atOrAbove`), or a page was not scanned; otherwise 0. A finding below it is still
  in `scan.json` and `report.md`, so the summary can read *Found 1 problem* and the exit be 0; the command line
  and the report say why. Advice and *needs review* items never change the exit, with any `--fail-on`: a
  *needs review* item is something axe-core or an own check could not decide, and a person looks. The floor is
  recorded in `options.failOn`.

## One scan, end to end (`src/run-scan.ts`, `src/scan-command.ts`, `src/cli.ts`)

`a11y-genie scan <url>` plans what to scan (`src/scan-plan.ts`: the pages, and the states of each, from the
`--states` flags or the `--config` file, `src/config.ts`), launches the browser (`withChosenBrowser`, which may
fall back to Playwright's Chromium), and then, for each page and for each of its states, `default` first, makes a
new context with the hostile-page rules (`src/context.ts`, below), sets the state's media, loads the page, runs
the state's steps (`src/drive.ts`), runs `scanPage` (axe-core, the own checks, then the keyboard walk), and closes the context, so no state sees another's cookies,
storage or page. The states of a page are merged into one finding per rule (`src/merge-states.ts`), and the record
is built (`src/scan-record.ts`). A page or state that answers and then breaks one of those rules, or whose step
fails, is not scanned: the record says why, and the run goes on with the rest, still writes its files and exits 1.
Only the first page's first load that does not answer is a refusal. `--timeout` sets the limit for one state, and
`--storage-state` is handed to each context's own storage and never copied. `src/cli.ts` only dispatches: the flags,
the run, the files and the lines for a person are `src/scan-command.ts`'s, which `check` shares. The command then
reads the site's last scan, if there is one (below), makes the scan folder
(`src/scans-folder.ts`), writes `scan.json`, and writes `report.md` from the record (`src/report.ts`). The
report is a pure function of the record, so a stored `scan.json` can write it again later.

- **Exit code.** 0 when there is no violation, 1 when there is any or the page was not scanned. The record's
  `exit` says the same.
  Refusals (exit 2), Ctrl-C (130) and the unexpected (3) are in `docs/EXIT-CODES.md`.
- **`--json`.** stdout holds the document and nothing else; every line meant for a person goes to stderr.
  Without it, the summary goes to stdout.
- **The drawing.** At a terminal, `--help` prints the genie (`src/banner.ts`) above its text on stdout, and `scan`,
  `check` and `narrate` print it on stderr, once the arguments and every up-front refusal check have passed, so a
  refusal stays one `Error:` line and one `Hint:` line. `shouldShowBanner` says no under `--json`, when the stream
  is not a terminal, when `CI` is set (to anything but empty, `0` or `false`), and when the terminal is narrower
  than the drawing. It has no colour and no escape sequence, so `NO_COLOR` changes nothing. `--version` and an
  unknown command print none.
- **Never into the project.** Nothing is written in the folder the command runs from, or the scanned
  project. Scans go to the per-user scans folder or `--out` (docs/JSON.md says where).
- **The schema is checked without a validator dependency.** `src/json-schema.ts` is a small
  validator for exactly the keywords `schema/scan-1.json` uses, and throws on any other, so the schema cannot
  outgrow it. The schema test runs it over every golden and over a record the browser test has just made, and
  `check` runs it over its baseline before it reads anything from it.
- **Goldens.** `test/goldens/<page>/scan.json` and `report.md` for the four first fixture pages and `no-landmarks` are written
  by `test/browser/goldens.test.ts` in the real Chrome, after the port, the times and the versions of this
  tool, axe-core and the browser are replaced by fixed values (`test/helpers/goldens.ts`). The rule count is
  kept, so an axe-core upgrade shows in the diff. `UPDATE_GOLDENS=1 npm test` rewrites them.

## Scan, fix, rescan (`src/check-command.ts`, `src/compare.ts`, `src/baseline.ts`)

`a11y-genie check --baseline <scan>` is `scan` with one more flag. It parses the same flags with the same code
(`src/scan-command.ts`), then reads the baseline (`src/baseline.ts`) and refuses it unless it is a `scan.json` of
schema major 1 that `schema/scan-1.json` holds, of the same origin, and of the same pages, each in the same states,
under the same `--tags` as the check will scan. All of that is before a browser opens, so a wrong baseline costs
nothing. Then it runs the scan as `scan` does, compares (`src/compare.ts`), and writes and prints the result.
The comparison is a pure function of two records, so the browser tests and the unit tests drive it directly.

- **Match by id, then by selector.** A finding's id names its rule and page; within a finding, elements are
  matched by `selector`. Unmatched elements, as many on each side, are read as the same elements under selectors
  that moved, so a list that only reordered reads `still`, never fixed plus new. Only elements both runs could see
  are paired so: an earlier one in a state not scanned now, or one found now in a state the earlier run did not scan,
  is never counted on a side. docs/JSON.md has the
  rest of the rule.
- **Not scanned is never fixed.** A baseline element found in a state that was not scanned this time stays still
  open, marked `unverified`, and the run exits 1 for the state not scanned anyway. The printed *Found* line counts
  only what this run found (`notCheckedNow` in `src/compare.ts`); the findings carried so are said apart, as still
  open, not checked this time.
- **One new element makes a finding new** (decided 2026-11-19: a new instance is new work). The finding reads
  `new` and fails the run, and its elements say which one is new.
- **A state the baseline never scanned is not new either** (decided 2026-11-19: a state the baseline never scanned
  proves nothing, and failing a pull request on bugs that were always there is a false alarm). An element found now
  only in states the baseline asked for and did not scan reads still open and `unverified`, and does not fail the
  run; one found in any state both scans scanned is judged as usual. `check` says which states, and to scan again
  with the same `--states` for a baseline that has them.
- **Only new violations fail it.** The exit reads the findings whose `status` is `new`, at or above `--fail-on`,
  and whether anything was not scanned; findings still open from the baseline are listed and do not fail it. This
  is what lets a pull request's job fail only on what the pull request added.
- **The baseline is untrusted.** It comes from a file anyone could have written: it is read in chunks up to the
  50 MB limit on `scan.json`, parsed as JSON only, validated with the same small validator the tests use
  (`src/json-schema.ts`) before a field is read, and refused with a finding id given twice. A refusal names where
  the file failed the schema and never the value. What a check carries forward from it (its fixed findings, and
  elements no longer failing) is copied field by field, only the fields this version knows, with each excerpt cut
  to 160 characters again, with `failure` and `selector` cut to 1,000 and at most 500 elements kept per finding (the
  rest counted in `elementsCut`), so a crafted baseline cannot carry more into a record than these caps allow (a fresh scan takes `failure` and `selector` as axe-core and the checks wrote them, which are short; carried ones come from a file and are capped); and everything printed from it goes through `src/printable.ts`.
- **Plain `scan` reads its last scan too**, for one line and `summary.sincePrevious`: the newest scan folder of the
  site under the scans folder or `--out`, read the same way. A last scan that cannot be read, or that covered other
  pages, states or tags, reads *not comparable* and says why; it is never a refusal, and it never changes the exit.
- **`--commit`** (or `GITHUB_SHA`) is recorded as `target.commit`, and a fixed finding's `fixedIn` names it.

**The loop, for an agent (`agentic/fix-loop.prompt.md`, `src/prompt-command.ts`).** `a11y-genie prompt` prints a
prompt file that lets a coding agent run scan, fix, rescan on a project it can edit: a baseline with `scan`, then
rounds of small fixes, each judged by `check --baseline` against that same baseline, never by the agent. It stops
on one of six named stops (Clean, Budget spent, Stuck, Regression, Blocked, Refused) and prints one line per
finding (`FIXED`, `OPEN`, `STUCK`, `NEW`, `BLOCKED`), then what was checked, what is still open and what a scan
cannot see. Anything not scanned, or unverified, is Blocked: rounds cannot fix a page that did not load, and an
unverified finding needs a new baseline with the same `--states`. The command reads the file from the package's
own folder, not the working directory. `test/cli/prompt.test.ts` holds the file to the product: every command and
flag it names is in `--help`, every field it names resolves in `schema/scan-1.json`, and the never-claim test reads
it.

**Selectors are stable between runs (V9).** Checked on 2026-11-19 with axe-core 4.14.1 in Chrome 158 (headless)
on macOS: eight fixture pages (`impact-mix`, `contrast`, `icon-button`, `no-landmarks`, `states`,
`needs-review`, `content-outside-landmarks`, `two-mains`), each scanned three times with nothing changed, gave the
same `target` for every element of every finding and *needs review* item, 13 elements in all.
`test/browser/check.test.ts` holds it for the check fixture. Not checked: elements in shadow roots or frames, and
pages whose markup changes from load to load (generated class names, shuffled lists), where that rule, matching the elements left over in order, is the
fallback.

## Hostile pages (`src/context.ts`)

Every page is assumed to be written by someone who wants the tool to misbehave. The browser
context's defences are all set in `src/context.ts`, so they can be read together: `CONTEXT_OPTIONS` (the
options the context is made with), `LIMITS` (the caps), `ALLOWED_SCHEMES`, and `armContext()`, which watches
the context before any page opens. `src/run-scan.ts` applies them to the one page it loads. Each defence has a
fixture page in `test/fixtures/site/hostile/` and a test in `test/browser/hostile.test.ts`, which scans the
fixture in the real Chrome, from `127.0.0.1`, with every request off the fixture servers aborted.

| Defence | How | Fixture | Test (`hostile.test.ts`) |
| --- | --- | --- | --- |
| Downloads refused | `acceptDownloads: false`. A download the page starts is cancelled and noted under `stopped`; a page that answers with a file to download reads *not scanned* | `download.html`, `payload.bin` | *downloads are refused* |
| Permissions denied | `permissions: []`: nothing is granted. Geolocation, camera, microphone and notifications all read `denied`, and a request for one is refused or never answered | `permissions.html` | *permissions are denied* |
| Service workers blocked | `serviceWorkers: "block"`: none is registered, so none can answer the page's requests | `service-worker.html`, `sw.js` | *service workers are blocked* |
| Pop-ups closed | every page in the context with an opener (`window.open`, `target="_blank"`, with or without `noopener`) is closed at once and noted. axe-core's own page has no opener and is left alone | `popup.html` | *pop-ups are closed* |
| Dialogs dismissed | `alert`, `confirm`, `prompt` and `beforeunload` are dismissed on every page and noted: `confirm` answers false, `prompt` answers nothing. An alert loop is dismissed each time and counted, until the time limit | `dialogs.html`, `alert-loop.html`, `beforeunload.html` | *dialogs are dismissed and noted* |
| Only `http:` and `https:` | a redirect to `file:`, `chrome:`, `data:`, `about:` or `javascript:` reads *not scanned* with why; so does a page whose address is not `http:` or `https:` when it has loaded or when axe-core is done | `moves-to-blank.html`, `script-moves.html`, and redirects the test's fixture server makes | *only http: and https: are loaded* |
| Redirects to a cap | the main frame's redirects are counted from its `request` events; past 10 the page is closed, which stops the chain, and reads *not scanned*. The address asked for (`requestedUrl`), where it ended (`url`) and the count (`redirects`) are recorded; a redirect to another origin is scanned there, and the report says it is another origin | redirects the test's fixture server makes | *redirects are followed to a cap* |
| The time limit | 60 seconds a page, from the first request to the end of axe-core. The answer is waited for first (30 seconds; no answer is a refusal), then the load and axe-core within what is left. Past it, *not scanned* | `busy-load.html`, `busy-after-load.html` | *the time, element and size caps* |
| The element and excerpt caps | at most 500 elements per finding, the rest counted in `elementsCut`; each element's quoted HTML cut at 160 characters in `scan.json` as well as in the report | `many-elements.html` | *the time, element and size caps* |
| The size cap | `scan.json` at most 50 MB. Over it, every walk is cut to its first N stops (N the most that fits, at least one; the rest counted in `stopsCut`), then, on a `check`, the fixed elements under findings still open (counted in `fixedCut`), then elements are dropped, least severe first and never a finding's last one, and counted; if that is not enough, *not scanned*, with the comparison's counts at 0 | `many-elements.html`, with the limit lowered | *the time, element and size caps* |
| Private networks | when the address scanned is public, every request to a loopback, link-local, private or unspecified address is aborted before it leaves the browser and noted under `stopped` as `private-network`; a page whose own frame goes to one reads *not scanned*. `--allow-private` turns it off, and a target that is itself loopback or private is never limited. See *The private-network rule (V12)* below | `private-network.html`, and redirects the test's fixture server makes | *a public page cannot reach private addresses* |
| `--same-origin` | every request to an origin other than the address scanned (scheme, host and port) is aborted and noted under `stopped` as `other-origin`; a page whose own frame goes to one reads *not scanned*. The report says so, and that some of the page's content may be missing. It is the private-network rule's mechanism, below, asked a second question: there is one interception layer, `networkRule()` in `src/context.ts` | `private-network.html`, and redirects the test's fixture server makes | `test/browser/network-flags.test.ts`, *--same-origin* |
| `--offline` | the target must be loopback (`127.0.0.0/8`, `::1`, `localhost`, `*.localhost`), or the run is refused; every request to an address that is not loopback is aborted and noted as `offline`, a page whose own frame goes to one reads *not scanned*, and no browser is downloaded. The browser is launched with switches that keep what it starts on its own on the machine too (*--offline at the launch*, below) | `private-network.html`, and redirects the test's fixture server makes | `network-flags.test.ts`, *--offline* |
| Page text printed without its escapes | `printable()` (`src/printable.ts`) strips every terminal escape sequence whole (CSI, OSC with OSC 8 links and window titles, DCS, APC and the rest, in their 7-bit and 8-bit forms) and every control character but newline and tab (carriage return, DEL, C1 and the bidi overrides and isolates included) from every line the command prints and from all of `report.md`. `scan.json` keeps the page's text exactly, as data, and writes the controls `JSON.stringify` leaves raw (DEL, C1, bidi) as `\u` escapes, so `--json` on a terminal carries none either | `escapes.html` | *page text is printed without its escapes*; `test/cli/scan.test.ts` checks the real terminal output |

What was stopped is recorded per page in `scan.json` (`pages[].stopped`: the kind, a count, and the first five,
cut at 160 characters) and listed in `report.md` under *What the page tried, and was stopped*, quoted as data.
The command line prints only the counts, never the page's own words.

**The caps.** The time limit is 60 s per state, which `--timeout` sets; then 500 elements
a finding, 160 characters an excerpt, and 50 MB for `scan.json`. There was no redirect cap to follow: Chrome's own is 20,
and A11y Genie stops at 10. Five examples are kept of each kind of thing stopped. `scan.json` records the caps
the run used under `limits`.

**What the browser already does, checked with playwright-core 1.65.1 and Chrome 158 on macOS.**

- A redirect to `file:`, `chrome:`, `data:` or `about:` fails with `net::ERR_UNSAFE_REDIRECT`, and one to
  `javascript:` with `net::ERR_ABORTED`; the page is never loaded. The browser does not report where the
  redirect pointed, so the reason names the kind of address, not the address.
- A page's own script cannot move the top frame to `file:`, `chrome:` or `data:`. Chrome refuses it in the
  console ("Not allowed to load local resource", "Not allowed to navigate top frame to data URL") and the page
  stays where it is, so it is scanned as itself and nothing is noted. A move to `about:blank` is allowed, and
  reads *not scanned*.
- Playwright denies every permission by default too; `permissions: []` says so where a reviewer reads it.
- With `serviceWorkers: "block"`, `navigator.serviceWorker.register()` resolves, but nothing is registered.
- Only the first request of a redirect chain goes through `context.route()`: the hops after it do not. That
  is why the redirect cap counts `request` events. It matters for the private-network rule too (below).

### The private-network rule (V12)

A hostile public page could use the browser to reach services on the person's own machine or network: a
router's admin page, a dev server, a cloud metadata address. So when the address scanned is public, every
request the page makes to one of these is aborted:

| Kind | Ranges |
| --- | --- |
| loopback | `127.0.0.0/8`, `::1`, `localhost` and any name under `.localhost` |
| private | `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `fc00::/7` |
| link-local | `169.254.0.0/16`, `fe80::/10` |
| unspecified | `0.0.0.0/8`, `::` |
| IPv4-mapped IPv6 | `::ffff:0:0/96`, judged by the IPv4 address inside it |
| NAT64, well-known prefix | `64:ff9b::/96` (RFC 6052), judged by the IPv4 address in its last 32 bits, as `::ffff:0:0/96` is |
| IPv4-translated, IPv4-compatible | `::ffff:0:0:0/96` (RFC 2765) and the deprecated `::/96` beyond `::` and `::1` (RFC 4291), judged by the IPv4 address in their last 32 bits |
| NAT64, local-use prefix | `64:ff9b:1::/48` (RFC 8215), read as private: the IPv4 address's place depends on the network's prefix length, so it cannot be judged |

`src/private-address.ts` holds the classifier, and `test/unit/private-address.test.ts` its edges. It reads the
host in the form the browser's URL parser gives it, so `http://0x7f.1/`, `http://2130706433/` and
`http://[::ffff:127.0.0.1]/` read as the loopback addresses they are. Anything else reads public, `100.64.0.0/10`
(shared address space) among them, since it is not a private range. So are 6to4 (`2002::/16`) and Teredo
(`2001::/32`): the IPv4 address inside them is a relay's or a tunnel end's, reached across the internet, not the
service a page could reach on the person's network.

Chromium does not refuse the embedded forms. Checked with playwright-core 1.65.1 and Playwright's Chromium on
macOS, against a server on `127.0.0.1`: `http://[::ffff:7f00:1]:<port>/` reached it, while `[::ffff:0:7f00:1]`,
`[::7f00:1]` (which the URL parser writes for `[::127.0.0.1]`), `[64:ff9b::7f00:1]` and `[2002:7f00:1::1]` were
sent out as IPv6 and timed out, because that network has no translator. On a network that has one, they arrive,
so each is judged by the IPv4 address inside. The rule reads the host as written and
never looks a name up, so a public name that resolves to a private address is not caught (gap G7; see
`SECURITY.md`). A target that is itself loopback or private (the usual dev server) is not limited at all, and
`--allow-private` turns the rule off.

**V12: what goes through Playwright's routes.** Checked with playwright-core 1.65.1 and Chrome 158 on macOS,
against loopback servers; the two *not*s below are pinned by the test *V12, at playwright-core 1.65.1* in
`hostile.test.ts`, so an upgrade that changes them fails it:

- `context.route()` sees the first request of every chain from the page, its frames (a frame on another site
  included), its dedicated workers and `navigator.sendBeacon`.
- It does **not** see a redirect hop: the second request of a chain onward. A redirect from a public address to
  a private one reaches the private address with `route()` alone.
- It does **not** see a WebSocket. `context.routeWebSocket()` does, from the page and from its frames.

So the rules are held in three places, all set in `src/context.ts`, for the private-network rule and for
`--same-origin` and `--offline` alike (`networkRule()` asks them in that order, `--offline` first, and the first
that stops a request names its kind):

1. A context route aborts every first request to a private address, from any page, frame or worker. With the
   rule on, it also aborts every request of any page but the scanned one: a pop-up loads nothing, so the redirect
   hops of a pop-up's chain, which nothing else would see, never start. Pop-ups are closed anyway.
2. `context.routeWebSocket()` closes every WebSocket to a private address before it connects.
3. For redirect hops, the scanned page gets a DevTools Protocol session of its own (`FetchGuard`), with the
   `Fetch` domain pausing every request at the request stage, hops included, beside Playwright's own: Chrome
   pauses each request for both, and one this session fails never leaves. A frame on another site runs in a
   process of its own (site isolation) with a target of its own, which the page's session does not see. So the
   session auto-attaches to each new target below it, held at its start (`waitForDebuggerOnStart`) until it is
   armed, and each attaches to its own in turn. They are reached with `Target.sendMessageToTarget`, because
   Playwright's session object cannot send to a flattened child. A dedicated worker's requests are paused in its
   page's session.

Each blocked attempt is noted under `pages[].stopped` (kind `private-network`, `other-origin` or `offline`, the
count, and the first five addresses). A blocked navigation of the page's own frame, a redirect of the address asked for included, reads
*not scanned*. The tests stand in for a public site with the fixture server, declared public as only a test can
(`A11Y_GENIE_TEST_PUBLIC_ORIGINS`, which is read only when the address scanned is on one of its origins, so it
can turn the rule on for a loopback target and never off), and for a private service with a second loopback
server, which records every request it receives. For `--offline` the same declared origins read as off the
machine (never the target's own), so a second loopback server stands in for a host out on the network; for
`--same-origin` another port is already another origin, and nothing is declared. Each way of reaching it is proved aborted before it arrives,
and arriving with `--allow-private`: a fetch, an iframe, an image, a WebSocket, a worker's fetch, the redirect hop
of an image, a fetch, an iframe and a worker's fetch, a redirect hop inside a frame on another site, a pop-up
that redirects, and the page moving itself or being redirected there. Each layer was also taken out once, by
hand, to see its tests fail: without `FetchGuard` every redirect-hop test fails, and without its auto-attach the
frame on another site's does.

**--offline at the launch.** The rules above see only what the page asks for. Under `--offline` the browser is
also launched with three switches (`offlineSwitches()` in `src/browser.ts`), so that what it starts on its own,
and what the page opens around the interception points, stays on the machine:

- `--proxy-server=http://127.0.0.1:9`: every connection goes to a proxy on a port nothing answers on, so it
  fails. Chrome never sends a connection to this machine through a proxy, so the page itself still loads.
  (Playwright's own `proxy` launch option is not used: it sends loopback through the proxy as well.)
- `--force-webrtc-ip-handling-policy=disable_non_proxied_udp`: WebRTC may not send UDP the proxy cannot carry,
  which is all of it.
- `--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE *.localhost, EXCLUDE 127.*, EXCLUDE [::1]`:
  no name is looked up but `localhost` and `*.localhost`, so no DNS query leaves the machine, a prefetch's
  included. The loopback addresses are kept as they are (without the last two, the rule turned `127.0.0.1` itself
  into "not found").

`test/browser/offline-launch.test.ts` holds what they do, with a recording proxy on 127.0.0.1 in place of the dead
one: the page still loads by `127.0.0.1`, `localhost` and `app.localhost`; a page's fetch off the machine, a
dedicated worker's WebSocket and a shared worker's fetch all go to the proxy; and WebRTC gathers no candidate and
sends no packet, even to a STUN server on 127.0.0.1 (without the switches it sent five). Checked on Playwright's
headless shell; the branded Chrome reads the same command-line switches, but the gstatic.com request above was not
measured again under them here. `--same-origin` cannot use the proxy, since other origins on the internet are
allowed, so the gaps below stay open for it.

**What it does not hold.** These are not caught, and `SECURITY.md` lists them:

- **A dedicated worker's WebSocket.** Neither `routeWebSocket()`, nor the `Fetch` domain, nor
  `Network.setBlockedURLs` (which blocks no WebSocket at all) sees it, so it reaches a private address. The test
  *a known gap* pins it, and fails when that changes.
- **DNS rebinding** (G7): a public name that resolves to a private address.
- **Shared workers**, and connections that are not HTTP requests or WebSockets: WebRTC, and anything else that
  opens a socket of its own. Not checked. One check of `<link rel="preconnect">` to a private address opened no
  connection, which is not a proof.


All of these hold for `--same-origin` as for the private-network rule: it uses the same three places. Under
`--offline` the launch closes the WebSocket, the shared worker and WebRTC (*--offline at the launch*, above), and
the rule never looks a name up at all.

**What a scan does not defend against.** A page shares its document with axe-core, and can change what
axe-core reads (gap G6 in [KNOWN-GAPS.md](KNOWN-GAPS.md)): a scan describes the page as the page presents itself, and is never a
security boundary. `SECURITY.md` lists this and every other known gap. What a page can make up stays data: every text from axe-core's
results is quoted and escaped in the report, and the one link the report draws, to the page about a rule, is
built from the rule's id and the installed axe-core's version (`axeHelpUrl` in `src/map-axe.ts`), never taken from
the result, which a page that replaces `window.axe` can fill in.
