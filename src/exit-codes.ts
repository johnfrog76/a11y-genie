/**
 * The exit codes, in one place. docs/EXIT-CODES.md says what each one means for a person or an agent.
 *
 * Two are not used yet, and each has its place waiting:
 * - `partial` (4) is for a run that stopped after it had already written something. Only `cards --toolkit`
 *   will reach it, so it arrives with that command.
 * - A page, state or flow that could not be scanned will make `scan` exit `findings` (1). That arrives with
 *   the milestone that can fail part-way (several pages, states and flows). Until then a scan either loads
 *   its one page or refuses, so `scan` has nothing "not scanned" to report.
 */
export const EXIT = {
  /** Scanned, and nothing found. */
  clean: 0,
  /** Scanned, and at least one finding. */
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
