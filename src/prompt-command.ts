/**
 * `a11y-genie prompt`: prints the prompt file for a coding agent, `agentic/fix-loop.prompt.md` (spec 7A),
 * byte for byte. The file is read from the package's own folder, next to `dist/`, never from the working
 * directory, so a project's own file of the same name can't stand in for it.
 */

import { readFileSync } from "node:fs";
import { Refusal } from "./refusal.js";

/** Where the prompt file is, beside `dist/` in the installed package. */
export const PROMPT_FILE = new URL("../agentic/fix-loop.prompt.md", import.meta.url);

/** `a11y-genie prompt`. Exit 0; any argument is a refusal (exit 2). */
export function promptCommand(args: string[], helpHint: string): void {
  if (args.length > 0) {
    throw new Refusal(
      `prompt takes no argument, and got: ${JSON.stringify(args[0]?.slice(0, 80))}`,
      helpHint,
    );
  }
  process.stdout.write(readFileSync(PROMPT_FILE));
}
