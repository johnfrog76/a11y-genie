import {
  BROWSER_CHANNELS,
  NO_BROWSER_ENV,
  isBrowserChannel,
  type BrowserChannel,
} from "../../src/browser.js";

/**
 * Which browser the tests launch. By default, and always unless the owner says otherwise, it is Playwright's
 * own Chromium, headless: a test run never starts the Google Chrome app on the machine. This is the one
 * place that reads the choice; every test helper, `withBrowser()` call, `runScan()` option and spawned
 * command takes its channel from here. The product's own default (the person's installed Chrome) is not
 * touched: this is only what the tests ask for.
 */
export const TEST_CHANNEL_ENV = "A11Y_GENIE_TEST_CHANNEL";

/** Set to `1` to also run the tests that are about the Chrome channel itself, and to allow a Chrome channel. */
export const CHROME_OPT_IN_ENV = "A11Y_GENIE_TEST_CHROME";

export const chromeOptedIn = process.env[CHROME_OPT_IN_ENV] === "1";

function testChannel(): BrowserChannel {
  const named = process.env[TEST_CHANNEL_ENV] ?? "chromium";
  if (!isBrowserChannel(named)) {
    throw new Error(`${TEST_CHANNEL_ENV} must be one of ${BROWSER_CHANNELS.join(", ")}, not ${named}.`);
  }
  if (named !== "chromium" && !chromeOptedIn) {
    throw new Error(
      `${TEST_CHANNEL_ENV}=${named} starts a branded browser on this machine. Tests use Playwright's Chromium; ` +
        `set ${CHROME_OPT_IN_ENV}=1 as well to run on ${named} on purpose.`,
    );
  }
  return named;
}

export const TEST_CHANNEL: BrowserChannel = testChannel();

/** The command-line flags that make a spawned `a11y-genie` command use the tests' browser. */
export function channelArgs(args: readonly string[], env: NodeJS.ProcessEnv = {}): string[] {
  const browserCommand = ["scan", "narrate", "check"].includes(args[0] ?? "");
  // A run that is made to find no browser never launches one, and its words depend on the default channel.
  if (!browserCommand || args.includes("--browser-channel") || env[NO_BROWSER_ENV] === "1") return [...args];
  return [...args, "--browser-channel", TEST_CHANNEL];
}
