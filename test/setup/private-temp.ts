import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";

/**
 * Each test file runs with a temp folder of its own, as each a11y-genie process does (src/private-temp.ts).
 * The browsers a test launches, the CLI it spawns and the folders it makes all land in it, and it is removed
 * when the file ends, so test files running side by side never see each other's browser profiles.
 * The shared folder, for a test that must look at it, is in SHARED_TMP_ENV.
 */
export const SHARED_TMP_ENV = "A11Y_GENIE_TEST_SHARED_TMP";

const names = process.platform === "win32" ? ["TMPDIR", "TEMP", "TMP"] : ["TMPDIR"];
process.env[SHARED_TMP_ENV] ??= tmpdir();
const own = mkdtempSync(join(process.env[SHARED_TMP_ENV], "a11y-genie-vitest-"));
for (const name of names) process.env[name] = own;

afterAll(() => {
  rmSync(own, { recursive: true, force: true });
});
