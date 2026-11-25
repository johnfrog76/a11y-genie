import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it } from "vitest";
import { testBrowserIsInstalled } from "../helpers/browser-guard.js";
import { mainBrowserProcesses, processesIn } from "../helpers/processes-in.js";

// test/setup/private-temp.ts stops every browser a test file launched, so a test that fails or times out
// cannot leave one running (issue 114). This runs a file of tests built to fail that way, in a vitest of its
// own with its own shared temp folder, and looks for any process left that names the folder.
// The variable test/setup/private-temp.ts reads for the shared temp folder.
const SHARED_TMP_ENV = "A11Y_GENIE_TEST_SHARED_TMP";
// The variable test/setup/run-folder.ts sets for this run; a child run must not make its folders in this run's.
const RUN_TMP_ENV = "A11Y_GENIE_TEST_RUN_TMP";
const hasBrowser = await testBrowserIsInstalled();

/** The child run's environment: its own shared temp folder, and none of this run's folder. */
function childEnv(shared: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, [SHARED_TMP_ENV]: shared };
  delete env[RUN_TMP_ENV];
  return env;
}
const config = new URL("../fixtures/leak/vitest.config.ts", import.meta.url).pathname;
const signalConfig = new URL("../fixtures/leak/signal.config.ts", import.meta.url).pathname;
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
      env: childEnv(shared),
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

it.skipIf(!hasBrowser || process.platform === "win32")(
  "a test run stopped by SIGTERM while a test has a browser open leaves no browser running (skipped where there is no test browser or no ps)",
  async () => {
    const signalShared = mkdtempSync(join(tmpdir(), "a11y-genie-signal-"));
    try {
      const child = spawn(
        process.execPath,
        ["node_modules/vitest/vitest.mjs", "run", "--config", signalConfig],
        {
          cwd: root,
          stdio: ["ignore", "pipe", "pipe"],
          env: childEnv(signalShared),
        },
      );
      let output = "";
      child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
      child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
      const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
        child.on("exit", (code, signal) => resolve({ code, signal })),
      );

      // The test's browser is up once a main browser process names the child run's folder.
      const deadline = Date.now() + 60_000;
      while (mainBrowserProcesses(signalShared).length === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(mainBrowserProcesses(signalShared), output).toHaveLength(1);

      child.kill("SIGTERM");
      const { code, signal } = await exited;
      // Stopped, not finished: the run did not end by passing.
      expect(code === 0 && signal === null, output).toBe(false);

      // SIGKILL is sent before the worker ends; give the system a moment to take the processes away.
      const gone = Date.now() + 5_000;
      while (processesIn(signalShared).length > 0 && Date.now() < gone) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(processesIn(signalShared).map((found) => found.command)).toEqual([]);
      // When a folder is left, say what is in it and what the stopped run printed, so a failure carries its cause.
      const left = readdirSync(signalShared, { recursive: true }).map(String).sort();
      expect(left, `left behind:\n${left.join("\n")}\n--- the stopped run's output ---\n${output}`).toEqual(
        [],
      );
    } finally {
      for (const { pid } of processesIn(signalShared)) process.kill(pid, "SIGKILL");
      rmSync(signalShared, { recursive: true, force: true });
    }
  },
  120_000,
);
