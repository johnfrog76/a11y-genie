import type { LaunchOptions } from "playwright-core";
import {
  BROWSER_CHANNELS,
  HEADLESS_SHELL_ENV,
  NO_BROWSER_ENV,
  isBrowserChannel,
  type BrowserChannel,
} from "../../src/browser.js";

/**
 * Which browser the tests launch. By default it is Playwright's headless shell (`chromium-headless-shell`): a
 * plain executable, headless, with no app bundle, so a test run never puts an icon in the macOS Dock and never
 * starts the Google Chrome app. This is the one place that reads the choice; every test helper, `withBrowser()`
 * call, `runScan()` option and spawned command takes its browser from here. The product's own default (the
 * person's installed Chrome, or the full Playwright Chromium) is not touched: this is only what the tests ask for.
 *
 * `A11Y_GENIE_TEST_CHANNEL` names another browser on purpose: `chromium` is the full Playwright Chromium, the
 * build a person gets (an app on macOS); `chrome` and `msedge` also need `A11Y_GENIE_TEST_CHROME=1`.
 */
export const TEST_CHANNEL_ENV = "A11Y_GENIE_TEST_CHANNEL";

/** The value of TEST_CHANNEL_ENV, and the default, that runs the headless shell. */
export const HEADLESS_SHELL = "headless-shell";

/** Set to `1` to also run the tests that are about the Chrome channel itself, and to allow a Chrome channel. */
export const CHROME_OPT_IN_ENV = "A11Y_GENIE_TEST_CHROME";

export const chromeOptedIn = process.env[CHROME_OPT_IN_ENV] === "1";

function testBrowser(): BrowserChannel | typeof HEADLESS_SHELL {
  const named = process.env[TEST_CHANNEL_ENV] || HEADLESS_SHELL;
  if (named === HEADLESS_SHELL) return named;
  if (!isBrowserChannel(named)) {
    throw new Error(
      `${TEST_CHANNEL_ENV} must be one of ${[HEADLESS_SHELL, ...BROWSER_CHANNELS].join(", ")}, not ${named}.`,
    );
  }
  if (named !== "chromium" && !chromeOptedIn) {
    throw new Error(
      `${TEST_CHANNEL_ENV}=${named} starts a branded browser on this machine. Tests use Playwright's Chromium; ` +
        `set ${CHROME_OPT_IN_ENV}=1 as well to run on ${named} on purpose.`,
    );
  }
  return named;
}

const chosen = testBrowser();

/**
 * True when TEST_CHANNEL_ENV names a browser other than the shell, on purpose. The check that the tests' browser is
 * not an app bundle (test/browser/headless-shell.test.ts) runs whenever this is false, so it holds the default.
 */
export const NAMED_ANOTHER_BROWSER =
  Boolean(process.env[TEST_CHANNEL_ENV]) && process.env[TEST_CHANNEL_ENV] !== HEADLESS_SHELL;

/** True when the tests run on the headless shell, the default. */
export const ON_HEADLESS_SHELL = chosen === HEADLESS_SHELL;

/**
 * The channel the tests hand to the product. The headless shell stands in for `chromium`: the product's own
 * test setting, HEADLESS_SHELL_ENV, read in src/browser.ts, makes a `chromium` launch omit the channel. It is set
 * here in this process's environment, so the in-process launches and every command a test spawns (with
 * `{ ...process.env }`) get it; on any other choice it is removed, so a stray outer value cannot change the browser.
 */
export const TEST_CHANNEL: BrowserChannel = chosen === HEADLESS_SHELL ? "chromium" : chosen;
if (ON_HEADLESS_SHELL) process.env[HEADLESS_SHELL_ENV] = "1";
else delete process.env[HEADLESS_SHELL_ENV];

/** What `engine.browser` in `scan.json` starts with, for the tests' browser. */
export const TEST_ENGINE_BROWSER = ON_HEADLESS_SHELL ? "chromium-headless-shell" : TEST_CHANNEL;

/** playwright-core's launch options for the tests' browser, for a test that launches it without the product. */
export const TEST_LAUNCH_OPTIONS: LaunchOptions = ON_HEADLESS_SHELL
  ? { headless: true }
  : { channel: TEST_CHANNEL, headless: true };

/** The command-line flags that make a spawned `a11y-genie` command use the tests' browser. */
export function channelArgs(args: readonly string[], env: NodeJS.ProcessEnv = {}): string[] {
  const browserCommand = ["scan", "narrate", "check"].includes(args[0] ?? "");
  // A run that is made to find no browser never launches one, and its words depend on the default channel.
  if (!browserCommand || args.includes("--browser-channel") || env[NO_BROWSER_ENV] === "1") return [...args];
  return [...args, "--browser-channel", TEST_CHANNEL];
}
