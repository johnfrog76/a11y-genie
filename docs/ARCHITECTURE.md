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
launch. It removes them with `rmdir`, which deletes only an empty folder, so a folder another browser is
already using is never touched.

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
again. Ctrl-C during the download stops the installer and exits 130.

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
no person's data, but it is traffic the person did not ask for, and the security gate should decide whether to
turn it off.

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

The spec (6.1.1) wants `region` and `landmark-one-main` on, so nothing is enabled. A `--tags` list that leaves
out `best-practice` runs none of the landmark rules, so `--help` and the unknown-tag hint both say the landmark
rules need it, and `genie/no-landmarks`, which sums them up, is not run either.

**What the product adds.** axe-core reports a page with no landmark at all as `region` on every element it can
reach plus `landmark-one-main`. `genie/no-landmarks` says it once for the page (moderate, WCAG 1.3.1 and 2.4.1
as context), on `body`. It is a violation, like the rules beside it, so it counts toward the exit code. The
check asks the browser for elements of the roles `banner`, `navigation`, `main` and `contentinfo`
(`page.getByRole`), so a `div role="main"` counts, a `header` inside an `article` does not, and an element
hidden from the accessibility tree does not. Other landmark roles (`complementary`, `search`, `form`, `region`)
do not count: a page with only those has none of the four. It runs on the page's own frame after axe-core, and
it does not change `engine.rulesRun`, which stays axe-core's count. The report lists it as any other finding;
no landmark map is drawn.

### Click on a non-control (`src/click-on-non-control.ts`)

axe-core has no rule for a `div` with an `onclick`. `genie/click-on-non-control` (serious, WCAG 2.1.1 and 4.1.2,
tagged `cat.keyboard`, `wcag2a`, `wcag211` and `wcag412`) flags an element that has a click handler of its own and
is not a control. It runs after axe-core, on the page's own frame, under the default rule set or a `--tags` list
with one of its tags. Like `genie/no-landmarks` it does not change `engine.rulesRun`.

**What is a control.** As spec 6.2 says: `a[href]`, `button`, `input`, `select`, `textarea`, `summary`, `label`
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
cannot be told from a pointer cursor that does nothing (spec 13, G3). So a candidate that sets a pointer cursor
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

`genie/skip-link` (spec 6.4) presses Tab three times from the top of the page, after axe-core and the other
checks, and reads each element that takes focus. A skip link is a same-page link (`href="#id"`) whose target
exists and is the page's `main` or inside it. With none, the finding is **advice** (`minor`) when the page has a
landmark or a heading, and a WCAG 2.4.1 **violation** (`moderate`) when it has neither. A page with fewer than
five tabbable elements before its main content (all of them when it has no main) is not checked. It is tagged
`best-practice`, as `genie/no-landmarks` is, and the registry lists the violation's impact. The check does not
test whether the link shows itself on focus or whether its target takes focus; the spec asks for neither.
Advice never changes the exit code. Fixtures: `no-skip-link.html`, `no-skip-no-structure.html`,
`skip-link-ok.html`, `skip-link-broken.html`, `few-tabbable.html`; test: `test/browser/skip-link.test.ts`.

### Plain words (`src/plain.ts`)

A finding's `plain` (what is wrong, and who it hurts) and `fix` (what to change), and the short `title` that
heads it in the report, come from one table,
`RULE_WORDING`, keyed by `<source>/<id>`, such as `axe/image-alt` or `genie/skip-link`. They are written for a
reader who knows no WCAG, in plain facts and never in the genie's voice (D7), and never call a site accessible,
compliant or conformant (C16). A second table, `CRITERION_WORDING`, names each WCAG criterion the rules carry,
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
`cat.keyboard`, `wcag2a`, `wcag211` and `wcag412`), and `src/rules-command.ts` imports that module. A check added later registers itself and
imports it there, and a rule not built yet is not listed. `--tags` keeps the rules that carry any of the tags,
as axe-core's own `--tags` runs them, so a list without `best-practice` leaves the landmark rules out, and one
without `wcag2a` (or another of its tags) leaves out `genie/click-on-non-control`.

### The rule flags (`src/rule-flags.ts`)

- **`--tags <list>`** is comma-separated, in the order given, without repeats. The tags it accepts are the ones
  axe-core's own rule metadata carries (`axe.getRules()` at the installed version, read in Node, nothing listed
  by hand): `wcag2a`, `wcag21aa`, `best-practice`, `cat.aria`, `experimental` and the rest. An unknown or empty
  one is a refusal that lists them. `axe.withTags()` then runs exactly those; a rule with none of them does not
  run, which is how `engine.rulesRun` comes to differ. Without `--tags`, `engine.tags` is `null` and axe-core's
  default rule set runs (docs/JSON.md). The tags go in as given: `wcag2a` alone does not also run `wcag2aa`.
- **`--fail-on <impact>`** is `critical`, `serious`, `moderate` or `minor`, default `minor`. The exit is 1 when a
  violation is at or above it (`atOrAbove`), or a page was not scanned; otherwise 0. A finding below it is still
  in `scan.json` and `report.md`, so the summary can read *Found 1 problem* and the exit be 0; the command line
  and the report say why. Advice and *needs review* items never change the exit, with any `--fail-on`: a
  *needs review* item is something axe-core or an own check could not decide, and a person looks (spec 4.3). The floor is
  recorded in `options.failOn`.

## One scan, end to end (`src/run-scan.ts`, `src/scan-command.ts`, `src/cli.ts`)

`a11y-genie scan <url>` plans what to scan (`src/scan-plan.ts`: the pages, and the states of each, from the
`--states` flags or the `--config` file, `src/config.ts`), launches the browser (`withChosenBrowser`, which may
fall back to Playwright's Chromium), and then, for each page and for each of its states, `default` first, makes a
new context with the hostile-page rules (`src/context.ts`, below), sets the state's media, loads the page, runs
the state's steps (`src/drive.ts`), runs `scanPage`, and closes the context, so no state sees another's cookies,
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
  that moved, so a list that only reordered reads `still`, never fixed plus new (spec R11). docs/JSON.md has the
  rest of the rule.
- **Not scanned is never fixed.** A baseline element found in a state that was not scanned this time stays still
  open, marked `unverified`, and the run exits 1 for the state not scanned anyway.
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
  rest counted in `elementsCut`), so a crafted baseline cannot carry more into a record than these caps allow (a fresh scan takes `failure` and `selector` as axe-core and the checks wrote them, which are short; carried ones come from a file and are capped); and everything printed from it passes through `src/printable.ts`.
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
pages whose markup changes from load to load (generated class names, shuffled lists), where R11's rule is the
fallback.

## Hostile pages (`src/context.ts`)

Every page is assumed to be written by someone who wants the tool to misbehave (the spec's 8A.1). The browser
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
| The size cap | `scan.json` at most 50 MB. Over it, elements are dropped, least severe first and never a finding's last one, and counted; if that is not enough, *not scanned* | `many-elements.html`, with the limit lowered | *the time, element and size caps* |
| Private networks | when the address scanned is public, every request to a loopback, link-local, private or unspecified address is aborted before it leaves the browser and noted under `stopped` as `private-network`; a page whose own frame goes to one reads *not scanned*. `--allow-private` turns it off, and a target that is itself loopback or private is never limited. See *The private-network rule (V12)* below | `private-network.html`, and redirects the test's fixture server makes | *a public page cannot reach private addresses* |
| `--same-origin` | every request to an origin other than the address scanned (scheme, host and port) is aborted and noted under `stopped` as `other-origin`; a page whose own frame goes to one reads *not scanned*. The report says so, and that some of the page's content may be missing. It is the private-network rule's mechanism, below, asked a second question: there is one interception layer, `networkRule()` in `src/context.ts` | `private-network.html`, and redirects the test's fixture server makes | `test/browser/network-flags.test.ts`, *--same-origin* |
| `--offline` | the target must be loopback (`127.0.0.0/8`, `::1`, `localhost`, `*.localhost`), or the run is refused; every request to an address that is not loopback is aborted and noted as `offline`, a page whose own frame goes to one reads *not scanned*, and no browser is downloaded. Nothing else of A11y Genie's own leaves the machine either, so there is nothing more to switch off (no ToolKit probe exists yet; spec 8) | `private-network.html`, and redirects the test's fixture server makes | `network-flags.test.ts`, *--offline* |
| Page text printed without its escapes | `printable()` (`src/printable.ts`) strips every terminal escape sequence whole (CSI, OSC with OSC 8 links and window titles, DCS, APC and the rest, in their 7-bit and 8-bit forms) and every control character but newline and tab (carriage return, DEL, C1 and the bidi overrides and isolates included) from every line the command prints and from all of `report.md`. `scan.json` keeps the page's text exactly, as data, and writes the controls `JSON.stringify` leaves raw (DEL, C1, bidi) as `\u` escapes, so `--json` on a terminal carries none either | `escapes.html` | *page text is printed without its escapes*; `test/cli/scan.test.ts` checks the real terminal output |

What was stopped is recorded per page in `scan.json` (`pages[].stopped`: the kind, a count, and the first five,
cut at 160 characters) and listed in `report.md` under *What the page tried, and was stopped*, quoted as data.
The command line prints only the counts, never the page's own words.

**The caps.** The spec gives the time limit (60 s, per state, which `--timeout` will set in M3), 500 elements
a finding, 160 characters an excerpt, and 50 MB for `scan.json`. It gives no redirect cap: Chrome's own is 20,
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
request the page makes to one of these is aborted (spec 8A.1):

| Kind | Ranges |
| --- | --- |
| loopback | `127.0.0.0/8`, `::1`, `localhost` and any name under `.localhost` |
| private | `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `fc00::/7` |
| link-local | `169.254.0.0/16`, `fe80::/10` |
| unspecified | `0.0.0.0/8`, `::` |
| IPv4-mapped IPv6 | `::ffff:0:0/96`, judged by the IPv4 address inside it |

`src/private-address.ts` holds the classifier, and `test/unit/private-address.test.ts` its edges. It reads the
host in the form the browser's URL parser gives it, so `http://0x7f.1/`, `http://2130706433/` and
`http://[::ffff:127.0.0.1]/` read as the loopback addresses they are. Anything else reads public, `100.64.0.0/10`
(shared address space) among them, since the spec does not list it. The rule reads the host as written and
never looks a name up, so a public name that resolves to a private address is not caught (gap G7; see
`SECURITY.md`). A target that is itself loopback or private (the usual dev server) is not limited at all, and
`--allow-private` turns the rule off.

**V12: what passes through Playwright's routes.** Checked with playwright-core 1.65.1 and Chrome 158 on macOS,
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

**What it does not hold.** These are not caught, and `SECURITY.md` lists them:

- **A dedicated worker's WebSocket.** Neither `routeWebSocket()`, nor the `Fetch` domain, nor
  `Network.setBlockedURLs` (which blocks no WebSocket at all) sees it, so it reaches a private address. The test
  *a known gap* pins it, and fails when that changes.
- **DNS rebinding** (G7): a public name that resolves to a private address.
- **Shared workers**, and connections that are not HTTP requests or WebSockets: WebRTC, and anything else that
  opens a socket of its own. Not checked. One check of `<link rel="preconnect">` to a private address opened no
  connection, which is not a proof.

**What a scan does not defend against.** A page shares its document with axe-core, and can change what
axe-core reads (gap G6 in the spec): a scan describes the page as the page presents itself, and is never a
security boundary. `SECURITY.md` lists this and every other known gap.
