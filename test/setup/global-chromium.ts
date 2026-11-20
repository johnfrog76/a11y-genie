import { existsSync } from "node:fs";
import { chromium } from "playwright-core";

/**
 * Runs once before the suite. The browser tests use Playwright's own Chromium (test/helpers/test-browser.ts),
 * so a machine without it fails here, once, with the way to install it, instead of every browser test
 * failing on its own or falling back to the Google Chrome app.
 */
export default function setup(): void {
  const named = process.env.A11Y_GENIE_TEST_CHANNEL ?? "chromium";
  if (named !== "chromium") return; // an owner's explicit, opted-in choice: test-browser.ts checks it
  if (existsSync(chromium.executablePath())) return;
  throw new Error(
    "The tests run on Playwright's own Chromium and it is not installed. Install it once (about 200 MB):\n" +
      "  npx playwright-core@1.65.1 install --no-shell chromium\n" +
      "or run `a11y-genie scan <url> --browser-channel chromium` once, which downloads it.",
  );
}
