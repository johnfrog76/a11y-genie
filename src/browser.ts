import { readdirSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type LaunchOptions } from "playwright-core";
import { Refusal } from "./refusal.js";

/** The browsers `--browser-channel` may name. `chromium` (Playwright's own) comes with the download, later. */
export const BROWSER_CHANNELS = ["chrome", "msedge"] as const;
export type BrowserChannel = (typeof BROWSER_CHANNELS)[number];
export const DEFAULT_CHANNEL: BrowserChannel = "chrome";

const CHANNEL_NAMES: Record<BrowserChannel, string> = { chrome: "Chrome", msedge: "Microsoft Edge" };

/**
 * Set to `1` to make every channel read as not installed. It exists so tests can reach the
 * no-browser refusal on a machine that has Chrome. It can only make a run refuse, never launch
 * anything else.
 */
export const NO_BROWSER_ENV = "A11Y_GENIE_TEST_NO_BROWSER";

export type Launcher = (options: LaunchOptions) => Promise<Browser>;

export function isBrowserChannel(value: string): value is BrowserChannel {
  return (BROWSER_CHANNELS as readonly string[]).includes(value);
}

/**
 * playwright-core's words when a channel is not installed (checked at the pinned version):
 * "Chromium distribution 'chrome' is not found at <path>", or "... is not supported on <platform>".
 */
const NOT_INSTALLED = /Chromium distribution '[^']+' is not (found|supported)/;

export function isNotInstalledError(error: unknown): boolean {
  return error instanceof Error && NOT_INSTALLED.test(error.message);
}

export function noBrowserRefusal(channel: BrowserChannel): Refusal {
  const other = channel === "chrome" ? "msedge" : "chrome";
  return new Refusal(
    `${CHANNEL_NAMES[channel]} was not found on this machine, and A11y Genie cannot download a browser yet.`,
    `Install ${CHANNEL_NAMES[channel]}, or run with --browser-channel ${other} if that one is installed.`,
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
 * the failed launch. `rmdirSync` removes only empty folders, so a folder in use is never touched.
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
 * Launches the installed browser for `channel`, hands it to `use`, and closes it afterwards,
 * whether `use` returns or throws.
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
    browser = await launcher({ channel, headless: true });
  } catch (error) {
    removeFoldersLeftBy(before);
    if (isNotInstalledError(error)) throw noBrowserRefusal(channel);
    throw error;
  }

  try {
    return await use(browser);
  } finally {
    await browser.close();
  }
}
