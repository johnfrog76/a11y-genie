import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";
import { stopProcessesIn } from "../helpers/processes-in.js";
import { removeFolder } from "../helpers/remove-folder.js";

/**
 * Each test file runs with a temp folder of its own, as each a11y-genie process does (src/private-temp.ts).
 * The browsers a test launches, the CLI it spawns and the folders it makes all land in it, and it is removed
 * when the file ends, so test files running side by side never see each other's browser profiles.
 * The shared folder, for a test that must look at it, is in SHARED_TMP_ENV.
 */
export const SHARED_TMP_ENV = "A11Y_GENIE_TEST_SHARED_TMP";

const names = process.platform === "win32" ? ["TMPDIR", "TEMP", "TMP"] : ["TMPDIR"];
process.env[SHARED_TMP_ENV] ??= tmpdir();
// Inside the run's folder (test/setup/run-folder.ts) when there is one, so the run can stop it on a signal too.
const own = mkdtempSync(
  join(process.env.A11Y_GENIE_TEST_RUN_TMP ?? process.env[SHARED_TMP_ENV], "a11y-genie-vitest-"),
);
for (const name of names) process.env[name] = own;

/**
 * No test file leaves a browser behind, whatever happened to its tests. Every browser the file launched, in this
 * process or in a command it spawned, has this folder in its command line, so stopping what names the folder
 * (the full path, unique to this file) stops them and nothing else. It runs when the file ends and again when
 * the worker exits, which covers a worker that stops mid-scan. It is not run after each failed test: many
 * files share one browser across their tests, and stopping it after one failure would fail the rest.
 */
function stopBrowsers(): void {
  try {
    stopProcessesIn(own);
  } catch {
    // Cleanup must never hide the test's own result.
  }
}
process.on("exit", stopBrowsers);

/**
 * A signal stops the browsers, synchronously, removes the folder, and then lets the signal do what it would have
 * done: with no other listener it is raised again, so the worker ends by that signal and vitest sees it; with
 * another listener (vitest's own), that one already ran for this signal and decides.
 */
function onSignal(signal: NodeJS.Signals): void {
  process.off(signal, onSignal);
  stopBrowsers();
  // Until it is gone: a browser just stopped may have its profile removed by Playwright at the same time.
  removeFolder(own);
  if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
}
process.on("SIGTERM", onSignal);
process.on("SIGINT", onSignal);

afterAll(() => {
  stopBrowsers();
  removeFolder(own);
});
