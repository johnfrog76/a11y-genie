import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it } from "vitest";
import { processesIn, stopProcessesIn, waitUntilGone } from "../helpers/processes-in.js";

// Issue #160: the test run's cleanup sent SIGKILL and removed its folder at once, while the stopped processes
// could still write into it. waitUntilGone is the wait in between: it returns once ps finds none naming the folder.
const folder = mkdtempSync(join(tmpdir(), "a11y-genie-gone-"));
afterAll(() => rmSync(folder, { recursive: true, force: true }));

it.skipIf(process.platform === "win32")(
  "waitUntilGone returns true once the processes naming a folder are gone, and false while one lasts past the cap (skipped on Windows, which has no ps)",
  async () => {
    // A process whose command line names the folder, as a test's browser does.
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 60000)", folder], {
      stdio: "ignore",
    });
    try {
      const deadline = Date.now() + 10_000;
      while (processesIn(folder).length === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(processesIn(folder)).toHaveLength(1);
      expect(waitUntilGone(folder, 200)).toBe(false);
      stopProcessesIn(folder);
      expect(waitUntilGone(folder, 5_000)).toBe(true);
      expect(processesIn(folder)).toEqual([]);
    } finally {
      child.kill("SIGKILL");
    }
  },
  30_000,
);
