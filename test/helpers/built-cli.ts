import { existsSync } from "node:fs";

/**
 * The built command, `dist/cli.js`, for the tests that spawn it. `npm test` builds first; a file run on its own
 * with `npx vitest run` does not. Without the build, every spawn would fail with a parse error of its empty output,
 * so this stops the file at once, with what to run.
 */
export function builtCli(): string {
  const path = new URL("../../dist/cli.js", import.meta.url).pathname;
  if (!existsSync(path)) {
    throw new Error(
      "The built command dist/cli.js is missing. Run `npm run build` first (`npm test` builds before it tests).",
    );
  }
  return path;
}
