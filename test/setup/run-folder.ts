import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stopProcessesIn } from "../helpers/processes-in.js";
import { removeFolder } from "../helpers/remove-folder.js";

/**
 * The variable that names this run's folder. Every test file's own temp folder (test/setup/private-temp.ts) is
 * made inside it, so every browser the run launches names it in its command line.
 */
export const RUN_TMP_ENV = "A11Y_GENIE_TEST_RUN_TMP";

/**
 * Runs in vitest's own process, once. A run that is stopped (SIGTERM or SIGINT to vitest) ends its workers with
 * SIGKILL from vitest's watchdog, so no handler in a worker is sure to run. vitest's own process does run its `exit`
 * handlers when it is stopped by a signal (it catches SIGTERM and SIGINT and then exits), so this stops every
 * process that names the run's folder there, synchronously, before the workers go, and removes the folder
 * (`removeFolder`, which looks again until it is gone). Only this run's folder, made
 * by mkdtemp, is named, so another run's browsers on the same machine are never touched.
 */
export default function setup(): () => void {
  const shared = process.env.A11Y_GENIE_TEST_SHARED_TMP ?? tmpdir();
  const run = mkdtempSync(join(shared, "a11y-genie-run-"));
  process.env[RUN_TMP_ENV] = run;
  // Each step on its own, so a failure to stop the browsers never skips the removal. A failure is said on stderr,
  // which test/cli/browser-leak.test.ts prints when it finds the folder left (issue 160), and never thrown: cleanup
  // must never hide the run's own result.
  const step = (name: string, action: () => void) => {
    try {
      action();
    } catch (error) {
      process.stderr.write(`The test run's cleanup could not ${name}: ${String(error)}\n`);
    }
  };
  const stop = () => {
    step("stop its processes", () => stopProcessesIn(run));
    step("remove its folder", () => removeFolder(run));
    if (existsSync(run))
      process.stderr.write(`The test run's folder is still there after its cleanup: ${run}\n`);
  };
  process.on("exit", stop);
  return () => {
    process.off("exit", stop);
    stop();
  };
}
