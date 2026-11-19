import type { Browser } from "playwright-core";
import {
  BrowserNotFound,
  NO_BROWSER_ENV,
  noBrowserRefusal,
  withBrowser,
  type BrowserChannel,
  type Launcher,
} from "./browser.js";
import {
  chromiumCacheFolder,
  chromiumIsInstalled,
  downloadFailedRefusal,
  downloadSize,
  installerHint,
  runInstaller,
} from "./chromium-download.js";
import { Refusal } from "./refusal.js";

/** Which browser a run asked for, and what it allows. */
export interface BrowserChoice {
  channel: BrowserChannel;
  /**
   * True when `--browser-channel` named the channel. Only the default Chrome falls back to Playwright's
   * Chromium; a named `chrome` or `msedge` that is not installed is refused, never replaced.
   */
  named: boolean;
  /** False under `--no-download` or `--offline`: a Chromium that is not installed is refused instead of downloaded. */
  download: boolean;
  /** The flag the refusal names when `download` is false. Default `--no-download`. */
  noDownloadFlag?: NoDownloadFlag | undefined;
  /** For tests: stand-ins for the launch and the download. */
  deps?: Partial<BrowserChoiceDeps> | undefined;
}

/** The browser that ran, for the scan record. */
export interface UsedBrowser {
  channel: BrowserChannel;
  /** True when Chrome was missing and Playwright's Chromium ran in its place. */
  fallback: boolean;
}

/** What the choice needs from the outside world. Tests replace them, so no test ever downloads. */
export interface BrowserChoiceDeps {
  launcher?: Launcher;
  /** Whether Playwright's Chromium is installed, whole. */
  chromiumInstalled: () => boolean;
  /** Downloads Playwright's Chromium, or throws a refusal saying why it did not. */
  installChromium: () => Promise<void>;
  /** Where the download goes, for the line said before it. */
  cacheFolder: () => string;
  /** Says one line to the person, on stderr. */
  say: (line: string) => void;
}

function defaultDeps(): BrowserChoiceDeps {
  if (process.env[NO_BROWSER_ENV] === "1") {
    // Every browser reads as not installed, and the download refuses: nothing is launched or fetched.
    return {
      chromiumInstalled: () => false,
      installChromium: async () => {
        throw downloadFailedRefusal(`downloads are turned off by ${NO_BROWSER_ENV}`);
      },
      cacheFolder: () => chromiumCacheFolder(),
      say: (line) => console.error(line),
    };
  }
  return {
    chromiumInstalled: () => chromiumIsInstalled(),
    installChromium: () => runInstaller(),
    cacheFolder: () => chromiumCacheFolder(),
    say: (line) => console.error(line),
  };
}

/** The line said before the download, and the one said when Chrome is missing and no download is needed. */
export function fallbackLines(size: string, cache: string) {
  return {
    downloading: `Chrome was not found, so A11y Genie is downloading Playwright's Chromium (${size}) once, into ${cache}. --browser-channel names another browser.`,
    using: `Chrome was not found, so A11y Genie is using Playwright's Chromium, from ${cache}. --browser-channel names another browser.`,
    downloadingNamed: `Playwright's Chromium is not installed yet, so A11y Genie is downloading it (${size}) once, into ${cache}.`,
  };
}

/** The flags that stop the download, and so name themselves in its refusal. */
export type NoDownloadFlag = "--no-download" | "--offline";

/**
 * No Chrome and `--no-download` (or `--offline`, which downloads nothing either), or
 * `--browser-channel chromium` with no Chromium.
 */
export function noDownloadRefusal(fallback: boolean, flag: NoDownloadFlag = "--no-download"): Refusal {
  return fallback
    ? new Refusal(
        `Chrome was not found on this machine, and ${flag} stops A11y Genie from downloading Playwright's Chromium.`,
        `Install Chrome, or run with --browser-channel msedge if that one is installed, or download Playwright's Chromium yourself: ${installerHint()}`,
      )
    : new Refusal(
        `Playwright's Chromium is not installed on this machine, and ${flag} stops A11y Genie from downloading it.`,
        `download it yourself: ${installerHint()}, or run with another --browser-channel.`,
      );
}

/** Makes sure Playwright's Chromium is installed, downloading it once when the choice allows. */
async function ensureChromium(choice: BrowserChoice, fallback: boolean, deps: BrowserChoiceDeps) {
  const lines = () => fallbackLines(downloadSize(), deps.cacheFolder());
  if (deps.chromiumInstalled()) {
    if (fallback) deps.say(lines().using);
    return;
  }
  if (!choice.download) throw noDownloadRefusal(fallback, choice.noDownloadFlag);
  deps.say(fallback ? lines().downloading : lines().downloadingNamed);
  await deps.installChromium();
  if (!deps.chromiumInstalled()) {
    throw downloadFailedRefusal("the installer finished, but the browser is not where playwright-core looks");
  }
}

/**
 * Launches the browser the run asked for and hands it to `use`, with what ran:
 *
 * 1. `chrome` or `msedge` is launched as it is. If it is installed, that is the browser.
 * 2. The default `chrome` (not named with `--browser-channel`) that is not installed falls back to
 *    Playwright's Chromium. A named `chrome` and any `msedge` are refused instead.
 * 3. Playwright's Chromium, by fallback or by `--browser-channel chromium`, is downloaded once if it is not
 *    installed yet, after one line on stderr saying so; `--no-download` refuses instead.
 *
 * Every launch is `withBrowser()`: a new, empty profile, deleted after the run.
 */
export async function withChosenBrowser<T>(
  choice: BrowserChoice,
  use: (browser: Browser, used: UsedBrowser) => Promise<T>,
): Promise<T> {
  const deps = { ...defaultDeps(), ...choice.deps };
  let fallback = false;
  if (choice.channel !== "chromium") {
    try {
      return await withBrowser(
        choice.channel,
        (browser) => use(browser, { channel: choice.channel, fallback: false }),
        deps.launcher,
      );
    } catch (error) {
      // Only a launch that found no browser falls back; the run's own refusals and errors pass on.
      if (!(error instanceof BrowserNotFound)) throw error;
      if (choice.named || choice.channel !== "chrome") throw noBrowserRefusal(choice.channel);
      fallback = true;
    }
  }
  await ensureChromium(choice, fallback, deps);
  return withBrowser("chromium", (browser) => use(browser, { channel: "chromium", fallback }), deps.launcher);
}
