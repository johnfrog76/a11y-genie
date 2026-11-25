import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stopProcessesIn } from "../helpers/processes-in.js";

/**
 * The variable that names this run's folder. Every test file's own temp folder (test/setup/private-temp.ts) is
 * made inside it, so every browser the run launches names it in its command line.
 */
export const RUN_TMP_ENV = "A11Y_GENIE_TEST_RUN_TMP";

/** How many times the cleanup removes the run's folder, and how long it waits between tries. */
const REMOVE_TRIES = 50;
const REMOVE_PAUSE_MS = 20;

/**
 * Removes `folder`, and looks again until it is gone (a few tries, synchronous, for an exit handler). One rmSync is
 * not enough when another process removes part of the folder at the same time, as Playwright does with its browser
 * profile when the browser it launched is stopped. On Linux, rmSync then returns early with no error and the folder
 * still there: Node's rmSync uses std::filesystem::remove_all, libstdc++'s version stops at the first entry that
 * is already gone (ENOENT), and Node takes ENOENT as done, even with `maxRetries`. libc++ (macOS) skips such an
 * entry and goes on, so this was never seen on macOS. A file made in the folder while it is removed is caught too.
 */
function removeFolder(folder: string): void {
  for (let tries = 0; tries < REMOVE_TRIES && existsSync(folder); tries++) {
    if (tries > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, REMOVE_PAUSE_MS);
    try {
      rmSync(folder, { recursive: true, force: true });
    } catch {
      // A file made during the removal (ENOTEMPTY): the next try removes it.
    }
  }
}

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
  const stop = () => {
    try {
      stopProcessesIn(run);
      removeFolder(run);
    } catch {
      // Cleanup must never hide the run's own result.
    }
  };
  process.on("exit", stop);
  return () => {
    process.off("exit", stop);
    stop();
  };
}
