import { EXIT } from "./exit-codes.js";
import { interrupting } from "./interrupt.js";
import { printableLine } from "./printable.js";

/**
 * A stated refusal: the run stops before anything is scanned or written, and exits 2.
 * The command prints exactly two lines on stderr, `Error: <error>` and `Hint: <hint>`.
 */
export class Refusal extends Error {
  readonly hint: string;

  constructor(error: string, hint: string) {
    super(error);
    this.name = "Refusal";
    this.hint = hint;
  }
}

/**
 * Prints why a run failed and sets its exit code: a refusal is its `Error:` and `Hint:` lines and exit 2;
 * anything else is "something unexpected" and exit 3. Once a signal is being handled it prints nothing and sets
 * nothing: the failure is the interrupt's own doing (it closed the browser the run was waiting on), and
 * src/interrupt.ts exits with the signal's code. src/cli.ts calls it for whatever its command throws.
 */
export function reportFailure(error: unknown): void {
  if (interrupting()) return;
  // A refusal or an error can quote what it was given or what the browser said: print it stripped too.
  if (error instanceof Refusal) {
    // One line each, so that an argument with a newline in it cannot add an Error: or Hint: line of its own.
    console.error(printableLine(`Error: ${error.message}`));
    console.error(printableLine(`Hint: ${error.hint}`));
    process.exitCode = EXIT.refusal;
  } else {
    const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
    console.error(printableLine(`Error: something unexpected went wrong: ${message}`));
    console.error("Hint: please report it at https://github.com/johnfrog76/a11y-genie/issues.");
    if (process.env.A11Y_GENIE_DEBUG) console.error(error);
    process.exitCode = EXIT.unexpected;
  }
}
