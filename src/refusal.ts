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
