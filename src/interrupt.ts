import { EXIT } from "./exit-codes.js";

type Cleanup = () => Promise<void>;

/**
 * The signals that end a run, each with the exit code a shell reports for it (128 plus the signal number).
 * SIGINT is Ctrl-C, SIGTERM a plain `kill`, SIGHUP a closed terminal.
 *
 * On Windows, Node does not deliver SIGTERM at all, and SIGHUP arrives when the console window is closed
 * (Node then ends the process shortly after, whatever the handler does). Ctrl-C is the one that always works.
 */
const SIGNALS = [
  ["SIGINT", EXIT.interrupted],
  ["SIGTERM", EXIT.terminated],
  ["SIGHUP", EXIT.hangUp],
] as const;

const cleanups = new Set<Cleanup>();
let installed = false;
let interrupting = false;

/** Runs every registered cleanup, then exits with the signal's code. A second signal exits at once. */
function onSignal(code: number): void {
  if (interrupting) process.exit(code);
  interrupting = true;
  void Promise.allSettled([...cleanups].map((cleanup) => cleanup())).then(() => process.exit(code));
}

/**
 * Makes Ctrl-C (130), a plain `kill` (143) and a closed terminal (129) exit with that code after cleanup, from
 * the moment it is called. The command calls it first thing. The private temp folder is removed by its `exit`
 * handler (src/private-temp.ts), which `process.exit()` runs.
 */
export function installInterruptHandler(): void {
  if (installed) return;
  installed = true;
  for (const [signal, code] of SIGNALS) process.on(signal, () => onSignal(code));
}

/**
 * Registers something to undo (a browser to close) if the run is interrupted by one of those signals, and
 * returns the call that removes it again. Nothing is written to the scans
 * folder until a scan is whole, and the write is synchronous, so a signal can never land half-way through it.
 */
export function onInterrupted(cleanup: Cleanup): () => void {
  cleanups.add(cleanup);
  return () => {
    cleanups.delete(cleanup);
  };
}
