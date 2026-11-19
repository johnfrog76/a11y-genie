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
delete the folder, and it stays in the temp folder until the system clears it. On Ctrl-C and on a normal
`SIGTERM`, playwright-core closes the browser and deletes the folder.

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
