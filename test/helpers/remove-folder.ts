import { existsSync, rmSync } from "node:fs";

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
 * test/setup/run-folder.ts and test/setup/private-temp.ts use it; test/unit/remove-folder.test.ts holds it to that race.
 */
export function removeFolder(folder: string): void {
  for (let tries = 0; tries < REMOVE_TRIES && existsSync(folder); tries++) {
    if (tries > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, REMOVE_PAUSE_MS);
    try {
      rmSync(folder, { recursive: true, force: true });
    } catch {
      // A file made during the removal (ENOTEMPTY): the next try removes it.
    }
  }
}
