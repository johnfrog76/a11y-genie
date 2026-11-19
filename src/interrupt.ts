import { EXIT } from "./exit-codes.js";

type Cleanup = () => Promise<void>;

const cleanups = new Set<Cleanup>();
let installed = false;
let interrupting = false;

/** Runs every registered cleanup, then exits 130. A second Ctrl-C exits at once. */
function onInterrupt(): void {
  if (interrupting) process.exit(EXIT.interrupted);
  interrupting = true;
  void Promise.allSettled([...cleanups].map((cleanup) => cleanup())).then(() =>
    process.exit(EXIT.interrupted),
  );
}

/** Makes Ctrl-C exit 130 after cleanup, from the moment it is called. The command calls it first thing. */
export function installInterruptHandler(): void {
  if (installed) return;
  installed = true;
  process.on("SIGINT", onInterrupt);
}

/**
 * Registers something to undo (a browser to close) if the person presses Ctrl-C, and returns the call that
 * removes it again. Nothing is written to the scans
 * folder until a scan is whole, and the write is synchronous, so a signal can never land half-way through it.
 */
export function onInterrupted(cleanup: Cleanup): () => void {
  cleanups.add(cleanup);
  return () => {
    cleanups.delete(cleanup);
  };
}
