/**
 * The exit codes, in one place. docs/EXIT-CODES.md says what each one means for a person or an agent.
 *
 * A page that answered and could not be scanned (a hostile-page rule of src/context.ts, or a limit) makes
 * `scan` exit `findings` (1), so a page nobody saw never exits 0.
 *
 * `partial` (4) is not used yet: it is for a run that stopped after it had already written something. Only
 * `cards --toolkit` will reach it, so it arrives with that command.
 */
export const EXIT = {
  /** Scanned, and nothing found. */
  clean: 0,
  /** Scanned, and at least one finding; or a page that was not scanned. */
  findings: 1,
  /** A stated refusal: one `Error:` line, one `Hint:` line, nothing scanned or written. */
  refusal: 2,
  /** Something unexpected. */
  unexpected: 3,
  /** Reserved: a refusal after something was already written. Nothing exits with it yet. */
  partial: 4,
  /** Ctrl-C. */
  interrupted: 130,
} as const;
