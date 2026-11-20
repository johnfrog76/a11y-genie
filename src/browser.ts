import { readdirSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type LaunchOptions } from "playwright-core";
import { onInterrupted } from "./interrupt.js";
import { Refusal } from "./refusal.js";

/**
 * The browsers `--browser-channel` may name: the machine's Chrome or Microsoft Edge, or `chromium`,
 * Playwright's own Chromium, downloaded once when it is not there yet (src/browser-choice.ts).
 */
export const BROWSER_CHANNELS = ["chrome", "msedge", "chromium"] as const;
export type BrowserChannel = (typeof BROWSER_CHANNELS)[number];
export const DEFAULT_CHANNEL: BrowserChannel = "chrome";

export const CHANNEL_NAMES: Record<BrowserChannel, string> = {
  chrome: "Chrome",
  msedge: "Microsoft Edge",
  chromium: "Playwright's Chromium",
};

/**
 * Set to `1` to make every channel read as not installed, Playwright's Chromium included, and to turn the
 * download into a refusal. It exists so tests can reach the no-browser paths on a machine that has
 * Chrome. It can only make a run refuse, never launch or download anything.
 */
export const NO_BROWSER_ENV = "A11Y_GENIE_TEST_NO_BROWSER";

export type Launcher = (options: LaunchOptions) => Promise<Browser>;

export function isBrowserChannel(value: string): value is BrowserChannel {
  return (BROWSER_CHANNELS as readonly string[]).includes(value);
}

/**
 * playwright-core's words when a browser is not installed (checked at the pinned version). For `chrome`
 * and `msedge`: "Chromium distribution 'chrome' is not found at <path>", or "... is not supported on
 * <platform>". For `chromium`, Playwright's own: "Executable doesn't exist at <path>".
 */
const NOT_INSTALLED = /Chromium distribution '[^']+' is not (found|supported)|Executable doesn't exist at /;

export function isNotInstalledError(error: unknown): boolean {
  return error instanceof Error && NOT_INSTALLED.test(error.message);
}

/** The refusal for a browser that is not installed, so the caller can tell it from the run's own refusals. */
export class BrowserNotFound extends Refusal {
  readonly channel: BrowserChannel;

  constructor(channel: BrowserChannel, error: string, hint: string) {
    super(error, hint);
    this.name = "BrowserNotFound";
    this.channel = channel;
  }
}

/** A named `chrome` or `msedge` that is not installed: refused, never replaced by another browser. */
export function noBrowserRefusal(channel: BrowserChannel): BrowserNotFound {
  const hints: Record<BrowserChannel, string> = {
    chrome:
      "Install Chrome, or run with --browser-channel chromium to use Playwright's Chromium (downloaded once), or msedge if that one is installed.",
    msedge:
      "Install Microsoft Edge, or run with --browser-channel chrome, or chromium to use Playwright's Chromium (downloaded once).",
    chromium: "run again without --no-download to download it once, or choose another --browser-channel.",
  };
  const error =
    channel === "chromium"
      ? "Playwright's Chromium is not installed on this machine."
      : `${CHANNEL_NAMES[channel]} was not found on this machine.`;
  return new BrowserNotFound(channel, error, hints[channel]);
}

/** The temp folders playwright-core makes for a launch, by their name's start. */
const PLAYWRIGHT_TEMP_PREFIXES = ["playwright_chromiumdev_profile-", "playwright-artifacts-"];

function playwrightTempFolders(): Set<string> {
  try {
    return new Set(
      readdirSync(tmpdir()).filter((name) =>
        PLAYWRIGHT_TEMP_PREFIXES.some((prefix) => name.startsWith(prefix)),
      ),
    );
  } catch {
    return new Set();
  }
}

/**
 * playwright-core 1.65.1 makes the profile and artifacts folders before it looks for the browser, and
 * leaves them behind when the browser is not installed. This removes the ones that appeared during
 * the failed launch. `tmpdir()` is this process's private temp folder (src/private-temp.ts, set at start
 * in src/cli.ts), never the shared one, so no other run's folder is in the list. `rmdirSync` removes only
 * empty folders as well.
 */
function removeFoldersLeftBy(before: Set<string>): void {
  for (const name of playwrightTempFolders()) {
    if (before.has(name)) continue;
    try {
      rmdirSync(join(tmpdir(), name));
    } catch {
      // Not empty, or already gone: not ours to remove.
    }
  }
}

/**
 * Launches the installed browser for `channel`, exactly that one, hands it to `use`, and closes it
 * afterwards, whether `use` returns or throws. A browser that is not installed is a `BrowserNotFound`
 * refusal: this function never downloads and never picks another browser. Choosing, falling back and
 * downloading are `withChosenBrowser()` in src/browser-choice.ts.
 *
 * Every launch is `chromium.launch()`, never `launchPersistentContext()`: playwright-core makes a
 * new, empty profile folder in the system temp folder for each launch and deletes it when the
 * browser closes. The person's own browser profile, cookies, extensions and sign-ins are never
 * opened. See docs/ARCHITECTURE.md.
 */
export async function withBrowser<T>(
  channel: BrowserChannel,
  use: (browser: Browser) => Promise<T>,
  launcher: Launcher = (options) => chromium.launch(options),
): Promise<T> {
  if (process.env[NO_BROWSER_ENV] === "1") throw noBrowserRefusal(channel);

  const before = playwrightTempFolders();
  let browser: Browser;
  try {
    browser = await launcher({ channel, headless: true, handleSIGINT: false });
  } catch (error) {
    removeFoldersLeftBy(before);
    if (isNotInstalledError(error)) throw noBrowserRefusal(channel);
    throw error;
  }

  // Ctrl-C closes the browser, which deletes its profile folder, and then exits 130 (src/interrupt.ts).
  // playwright-core's own handler is off (`handleSIGINT: false`) so there is one, ours, and it sets the code.
  const forget = onInterrupted(() => browser.close());
  try {
    return await use(browser);
  } finally {
    forget();
    await browser.close();
  }
}
