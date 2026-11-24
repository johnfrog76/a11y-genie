// Not a test of the project: test/cli/browser-leak.test.ts runs this file on purpose, with signal.config.ts beside
// it, and stops the run with SIGTERM while the test below has a browser open. test/setup/private-temp.ts must stop
// that browser. The name does not end in .test.ts, so the main run never picks this file up.
//
// The browser is a separate process's, as a spawned command's is in test/cli/ when its page is slow. A browser
// launched in the worker itself goes with the worker (its pipe closes), but one a spawned process launched does
// not: before private-temp.ts stopped browsers on a signal, it ran on after the worker was gone.
import { spawn } from "node:child_process";
import { it } from "vitest";
import { TEST_LAUNCH_OPTIONS } from "../../helpers/test-browser.js";

it("waits, while a process it started has a browser open, until the run is stopped", async () => {
  // It stops when its browser goes, and by itself after a minute, so it cannot run on for good.
  const script = `
    import { chromium } from "playwright-core";
    const browser = await chromium.launch(${JSON.stringify(TEST_LAUNCH_OPTIONS)});
    browser.on("disconnected", () => process.exit(0));
    setTimeout(() => process.exit(0), 60_000);
  `;
  spawn(process.execPath, ["--input-type=module", "-e", script], {
    cwd: new URL("../../..", import.meta.url).pathname,
    stdio: "ignore",
    detached: true,
  }).unref();
  // The parent test sends SIGTERM once the browser names this file's folder. Until then, wait.
  await new Promise<never>(() => undefined);
});
