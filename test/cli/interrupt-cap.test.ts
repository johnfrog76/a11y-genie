import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it } from "vitest";
import { CLEANUP_CAP_MS } from "../../src/interrupt.js";
import { builtCli } from "../helpers/built-cli.js";

// Issue #160: a signal's cleanup (closing the browser) had no time limit, so a browser that would not close kept
// the run alive until SIGKILL, and its private temp folder, removed on exit, was left behind. The fixture's cleanup
// never settles; the run must still exit with the signal's code within the cap, and take its folder with it.
builtCli();
const fixture = new URL("../fixtures/signal/wedged-cleanup.mjs", import.meta.url).pathname;
const shared = mkdtempSync(join(tmpdir(), "a11y-genie-cap-"));
afterAll(() => rmSync(shared, { recursive: true, force: true }));

it.skipIf(process.platform === "win32")(
  "a signal whose cleanup never settles still exits with its code within the cap, and removes the temp folder (skipped on Windows, where SIGTERM is not delivered)",
  async () => {
    const child = spawn(process.execPath, [fixture], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, TMPDIR: shared },
    });
    try {
      let output = "";
      child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
      const folder = await new Promise<string>((resolve, reject) => {
        child.stdout.on("data", (chunk: Buffer) => {
          output += chunk.toString();
          const ready = /^ready (.+)$/m.exec(output);
          if (ready?.[1]) resolve(ready[1]);
        });
        child.on("exit", () => reject(new Error(`the fixture ended before it was ready: ${output}`)));
      });
      expect(existsSync(folder)).toBe(true);
      const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
        child.on("exit", (code, signal) => resolve({ code, signal })),
      );
      const sent = Date.now();
      child.kill("SIGTERM");
      const { code, signal } = await exited;
      const took = Date.now() - sent;
      expect({ code, signal }, output).toEqual({ code: 143, signal: null });
      expect(took).toBeGreaterThanOrEqual(CLEANUP_CAP_MS - 100);
      expect(took).toBeLessThan(CLEANUP_CAP_MS + 3_000);
      expect(existsSync(folder)).toBe(false);
    } finally {
      // A run that never exits (the bug) is not left behind.
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
  },
  CLEANUP_CAP_MS + 15_000,
);
