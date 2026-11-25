import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stopProcessesIn, waitUntilGone } from "../helpers/processes-in.js";

/** The longest the cleanup waits for the run's stopped processes to be gone before it removes the folder. */
const GONE_CAP_MS = 5_000;

/**
 * The variable that names this run's folder. Every test file's own temp folder (test/setup/private-temp.ts) is
 * made inside it, so every browser the run launches names it in its command line.
 */
export const RUN_TMP_ENV = "A11Y_GENIE_TEST_RUN_TMP";

/**
 * Runs in vitest's own process, once. A run that is stopped (SIGTERM or SIGINT to vitest) ends its workers with
 * SIGKILL from vitest's watchdog, so no handler in a worker is sure to run. vitest's own process does run its `exit`
 * handlers when it is stopped by a signal (it catches SIGTERM and SIGINT and then exits), so this stops every
 * process that names the run's folder there, synchronously, before the workers go, and removes the folder. Only this run's folder, made
 * by mkdtemp, is named, so another run's browsers on the same machine are never touched.
 */
export default function setup(): () => void {
  const shared = process.env.A11Y_GENIE_TEST_SHARED_TMP ?? tmpdir();
  const run = mkdtempSync(join(shared, "a11y-genie-run-"));
  process.env[RUN_TMP_ENV] = run;
  // A process sent SIGKILL lasts a moment, and a browser or a worker that is ending can still write into the
  // folder: so wait until they are gone (capped), then remove it with retries, and say so if it is still there.
  const stop = () => {
    try {
      stopProcessesIn(run);
      waitUntilGone(run, GONE_CAP_MS);
      rmSync(run, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      // Cleanup must never hide the run's own result.
    }
    if (existsSync(run)) process.stderr.write(`The test run's temp folder could not be removed: ${run}\n`);
  };
  process.on("exit", stop);
  return () => {
    process.off("exit", stop);
    stop();
  };
}
