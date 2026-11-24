import { readdirSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type LaunchOptions } from "playwright-core";
import { playwrightCoreVersion } from "./chromium-download.js";
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

/**
 * For tests only: set to `1` to launch Playwright's headless shell (`chromium-headless-shell`, a plain
 * executable) wherever a run would launch Playwright's Chromium (`channel: "chromium"`, an app bundle on
 * macOS, which shows in the Dock at every launch). It changes nothing for `chrome` or `msedge`, launches
 * nothing new and never downloads. A person never needs it; it is not in `--help`. See docs/ARCHITECTURE.md
 * (*Which browser the tests launch*).
 */
export const HEADLESS_SHELL_ENV = "A11Y_GENIE_TEST_HEADLESS_SHELL";

/** The one place that reads HEADLESS_SHELL_ENV: whether a launch of `channel` runs the headless shell. */
export function runsHeadlessShell(channel: BrowserChannel): boolean {
  return channel === "chromium" && process.env[HEADLESS_SHELL_ENV] === "1";
}

/** What `scan.json`'s `engine.browser` calls the browser that ran: the channel, or the headless shell. */
export function engineBrowserName(channel: BrowserChannel): string {
  return runsHeadlessShell(channel) ? "chromium-headless-shell" : channel;
}

export type Launcher = (options: LaunchOptions) => Promise<Browser>;

/** Where `--offline` sends every connection that is not to this machine: a port nothing answers on. */
export const OFFLINE_PROXY = "http://127.0.0.1:9";

/**
 * The launch switches `--offline` adds, so that nothing the browser itself starts leaves the machine either
 * (docs/ARCHITECTURE.md, *--offline at the launch*). Every connection goes to `proxy`, which refuses it, except
 * to this machine, which Chrome never sends through a proxy. WebRTC may not send UDP the proxy cannot carry, and
 * no name is looked up except `localhost` and `*.localhost` (the loopback addresses are kept as they are). The
 * page's own requests off the machine are also stopped and noted by src/context.ts, as before.
 */
export function offlineSwitches(proxy: string = OFFLINE_PROXY): string[] {
  return [
    `--proxy-server=${proxy}`,
    "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
    "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE *.localhost, EXCLUDE 127.*, EXCLUDE [::1]",
  ];
}

/** How to launch, beyond the channel. */
export interface LaunchChoice {
  /** `--offline`: launch with `offlineSwitches()`. */
  offline?: boolean | undefined;
}

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

/** The headless shell, asked for by HEADLESS_SHELL_ENV, is not installed. Only tests reach it. */
export function noHeadlessShellRefusal(): BrowserNotFound {
  return new BrowserNotFound(
    "chromium",
    `Playwright's headless shell is not installed on this machine, and ${HEADLESS_SHELL_ENV}=1 asks for it.`,
    `install it once: npx playwright-core@${playwrightCoreVersion()} install chromium, or unset ${HEADLESS_SHELL_ENV}.`,
  );
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
  launch: LaunchChoice = {},
): Promise<T> {
  if (process.env[NO_BROWSER_ENV] === "1") throw noBrowserRefusal(channel);

  const shell = runsHeadlessShell(channel);
  const before = playwrightTempFolders();
  let browser: Browser;
  try {
    browser = await launcher({
      // No channel and headless is playwright-core's headless shell (checked at 1.65.1); only tests ask for it.
      ...(shell ? {} : { channel }),
      headless: true,
      ...(launch.offline === true ? { args: offlineSwitches() } : {}),
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
    });
  } catch (error) {
    removeFoldersLeftBy(before);
    if (isNotInstalledError(error)) throw shell ? noHeadlessShellRefusal() : noBrowserRefusal(channel);
    throw error;
  }

  // Ctrl-C, a plain kill and a closed terminal close the browser, which deletes its profile folder, and then
  // exit 130, 143 or 129 (src/interrupt.ts). playwright-core's own handlers are off (`handleSIGINT`,
  // `handleSIGTERM` and `handleSIGHUP` are all true by default) so there is one, ours, and it sets the code:
  // its own SIGTERM and SIGHUP handlers close every browser on their own, racing ours to close the same one.
  const forget = onInterrupted(() => browser.close());
  try {
    return await use(browser);
  } finally {
    forget();
    await browser.close();
  }
}
