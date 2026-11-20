import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it } from "vitest";
import { testBrowserIsInstalled } from "../helpers/browser-guard.js";
import { processesIn } from "../helpers/processes-in.js";

// test/setup/private-temp.ts stops every browser a test file launched, so a test that fails or times out
// cannot leave one running (issue 114). This runs a file of tests built to fail that way, in a vitest of its
// own with its own shared temp folder, and looks for any process left that names the folder.
// The variable test/setup/private-temp.ts reads for the shared temp folder.
const SHARED_TMP_ENV = "A11Y_GENIE_TEST_SHARED_TMP";
const hasBrowser = await testBrowserIsInstalled();
const config = new URL("../fixtures/leak/vitest.config.ts", import.meta.url).pathname;
const root = new URL("../..", import.meta.url).pathname;

const shared = mkdtempSync(join(tmpdir(), "a11y-genie-leak-"));
afterAll(() => rmSync(shared, { recursive: true, force: true }));

it.skipIf(!hasBrowser || process.platform === "win32")(
  "a test that throws and a test that times out, each with a browser open, leave no browser running (skipped where there is no test browser or no ps)",
  () => {
    const run = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "--config", config], {
      cwd: root,
      encoding: "utf8",
      timeout: 120_000,
      env: { ...process.env, [SHARED_TMP_ENV]: shared },
    });
    // Both tests fail on purpose, so the run fails: it did not pass by running nothing.
    expect(run.status, run.stdout + run.stderr).not.toBe(0);
    expect(run.stdout + run.stderr).toMatch(/failing on purpose/);
    expect(run.stdout + run.stderr).toMatch(/timed out/i);
    expect(processesIn(shared).map((found) => found.command)).toEqual([]);
    expect(readdirSync(shared)).toEqual([]);
  },
  150_000,
);
