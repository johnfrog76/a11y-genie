import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";

const require = createRequire(import.meta.url);

/**
 * Where playwright-core keeps its headless shell. The public API names only the full build's path
 * (`chromium.executablePath()`), so this reads playwright-core's own registry, which its package exports as
 * `playwright-core/lib/coreBundle` (checked at 1.65.1). An upgrade that moves it fails here, loudly.
 */
function headlessShellExecutable(): string {
  const core = require("playwright-core/lib/coreBundle") as {
    registry?: { registry?: { findExecutable(name: string): { executablePath(): string | undefined } } };
  };
  const path = core.registry?.registry?.findExecutable("chromium-headless-shell").executablePath();
  if (path === undefined)
    throw new Error("playwright-core's registry no longer names chromium-headless-shell.");
  return path;
}

const INSTALL = "  npx playwright-core@1.65.1 install chromium\n";

/**
 * Runs once before the suite. The browser tests use Playwright's headless shell by default, or the full Chromium
 * when `A11Y_GENIE_TEST_CHANNEL=chromium` asks for it (test/helpers/test-browser.ts), so a machine without that
 * one fails here, once, with the way to install it, instead of every browser test failing on its own or falling
 * back to the Google Chrome app. The install line fetches both builds.
 */
export default function setup(): void {
  const named = process.env.A11Y_GENIE_TEST_CHANNEL || "headless-shell";
  if (named === "headless-shell") {
    if (existsSync(headlessShellExecutable())) return;
    throw new Error(
      "The tests run on Playwright's headless shell and it is not installed. Install it once, with the full " +
        "Chromium beside it (about 300 MB in all):\n" +
        INSTALL,
    );
  }
  if (named !== "chromium") return; // an owner's explicit, opted-in choice: test-browser.ts checks it
  if (existsSync(chromium.executablePath())) return;
  throw new Error(
    "A11Y_GENIE_TEST_CHANNEL=chromium runs the tests on Playwright's full Chromium and it is not installed. " +
      "Install it once (with the headless shell beside it):\n" +
      INSTALL +
      "or run `a11y-genie scan <url> --browser-channel chromium` once, which downloads the full build only.",
  );
}
