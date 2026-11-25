import { spawn } from "node:child_process";
import { expect, it } from "vitest";
import { builtCli } from "../helpers/built-cli.js";

// Issue #159: Ctrl-C closes the browser while the scan is still waiting on it, and the scan's wait then fails.
// That failure reached the command's catch before the exit, which printed "something unexpected went wrong" and
// asked for a report. The fixture's cleanup makes its wait fail the same way, every time; the run must say
// nothing and exit with the signal's code.
builtCli();
const fixture = new URL("../fixtures/signal/failure-during-interrupt.mjs", import.meta.url).pathname;

it.skipIf(process.platform === "win32")(
  "a failure the interrupt itself causes prints nothing, and the run exits with the signal's code (skipped on Windows, where a signal cannot be sent to a child)",
  async () => {
    const child = spawn(process.execPath, [fixture], { stdio: ["ignore", "pipe", "pipe"] });
    try {
      let stdout = "";
      let stderr = "";
      child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
      const exited = new Promise<number | null>((resolve) => child.on("close", (code) => resolve(code)));
      await new Promise<void>((resolve, reject) => {
        child.stdout.on("data", (chunk: Buffer) => {
          stdout += chunk.toString();
          if (stdout.includes("ready\n")) resolve();
        });
        child.on("exit", () => reject(new Error(`the fixture ended before it was ready: ${stderr}`)));
      });
      child.kill("SIGINT");
      expect(await exited).toBe(130);
      expect(stderr).toBe("");
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
  },
  15_000,
);
