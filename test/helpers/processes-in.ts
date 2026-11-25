import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { isAbsolute } from "node:path";

/** One running process whose command line names a folder. */
export interface FolderProcess {
  pid: number;
  command: string;
}

/** The folder as a process may print it: as given, and with symlinks resolved (/var is /private/var on macOS). */
function spellings(folder: string): string[] {
  const names = new Set([folder]);
  try {
    names.add(realpathSync(folder));
  } catch {
    // The folder is already gone: only the given spelling can match.
  }
  return [...names];
}

/**
 * The processes whose command line contains `folder`, read with `ps`. A browser a test launches carries
 * `--user-data-dir=<the file's private temp folder>/...`, so this finds the browsers of one test file and
 * nothing else: pass the full path of a folder made by mkdtemp, never a generic word. Never lists this process.
 * On Windows there is no `ps`, so it finds nothing there.
 */
export function processesIn(folder: string): FolderProcess[] {
  // No `ps` on Windows, so browsers a test leaves behind there are not found or stopped by this.
  if (process.platform === "win32") return [];
  // An empty or relative name would match nearly every command line, and stopProcessesIn would kill them all.
  if (!isAbsolute(folder) || folder.length < 8)
    throw new Error(`processesIn needs a full folder path, not "${folder}"`);
  const names = spellings(folder);
  const found: FolderProcess[] = [];
  for (const line of execFileSync("ps", ["-ww", "-axo", "pid,command"], { encoding: "utf8" }).split("\n")) {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line);
    const command = match?.[2];
    if (!match || command === undefined) continue;
    const pid = Number(match[1]);
    if (pid === process.pid || !names.some((name) => command.includes(name))) continue;
    found.push({ pid, command });
  }
  return found;
}

/**
 * Waits, synchronously, until `processesIn(folder)` finds none, or `capMs` has passed; true when none is left.
 * A process sent SIGKILL is not gone at once, and while it lasts it can still write into the folder.
 */
export function waitUntilGone(folder: string, capMs: number): boolean {
  const pause = new Int32Array(new SharedArrayBuffer(4));
  const deadline = Date.now() + capMs;
  while (processesIn(folder).length > 0) {
    if (Date.now() >= deadline) return false;
    Atomics.wait(pause, 0, 0, 50);
  }
  return true;
}

/** SIGKILL every process `processesIn(folder)` finds. Synchronous, so it can run in an exit handler. */
export function stopProcessesIn(folder: string): void {
  for (const { pid } of processesIn(folder)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  }
}

/**
 * The browsers' own main processes among `processesIn(folder)`. A Chromium main process carries
 * `--user-data-dir=` and no `--type=`; its helpers (renderer, GPU, network and other utilities) all carry
 * `--type=<kind>`, and never `--headless`, so a check of the main process must leave them out.
 */
export function mainBrowserProcesses(folder: string): FolderProcess[] {
  return processesIn(folder).filter(
    ({ command }) => command.includes("--user-data-dir=") && !command.includes("--type="),
  );
}
