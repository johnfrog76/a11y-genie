import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Refusal } from "./refusal.js";

/** The variables an operating system and a browser read to find the temp folder. */
const TEMP_VARIABLES = process.platform === "win32" ? ["TMPDIR", "TEMP", "TMP"] : ["TMPDIR"];

let folder: string | undefined;

/**
 * Gives this process a temp folder of its own, and points the process's temp variables at it, so that
 * every folder playwright-core makes for a launch (the browser's profile, its artifacts), and anything the
 * browser or the browser installer, a child process, makes, lands in it. No other process on the machine
 * shares that folder, so nothing here can touch another run's files, and nothing another run does can touch ours.
 * The folder is removed when the process exits, whatever the exit (docs/ARCHITECTURE.md).
 *
 * Call it once, before the first browser launch. A second call returns the same folder. A temp folder that
 * cannot be made (missing, read-only, full) is a refusal that says so (docs/EXIT-CODES.md).
 */
export function usePrivateTemp(): string {
  if (folder) return folder;
  const parent = tmpdir();
  let made: string;
  try {
    made = mkdtempSync(join(parent, "a11y-genie-"));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "an error";
    throw new Refusal(
      `cannot make a temp folder in ${parent} (${code})`,
      `point ${process.platform === "win32" ? "TEMP" : "TMPDIR"} at a folder that exists and that you may write to.`,
    );
  }
  folder = made;
  for (const name of TEMP_VARIABLES) process.env[name] = made;
  // `exit` runs on a normal end, on process.exit() (a refusal, an unexpected error) and after an
  // uncaught exception. The signal handlers of src/interrupt.ts (Ctrl-C, a plain kill, a closed terminal) end
  // with process.exit(), so it runs for them too. It does not run on SIGKILL: only that leaves this one folder,
  // named a11y-genie-*.
  process.on("exit", removePrivateTemp);
  return made;
}

/** Removes the folder and everything in it. Safe to call twice, and when nothing was made. */
export function removePrivateTemp(): void {
  if (!folder) return;
  const gone = folder;
  folder = undefined;
  try {
    rmSync(gone, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // Nothing useful to do while exiting.
  }
}
