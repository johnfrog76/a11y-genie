import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";

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
