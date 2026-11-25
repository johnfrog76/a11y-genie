import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it } from "vitest";
import { INSTALLER_STOP_MS } from "../../src/chromium-download.js";
import { builtCli } from "../helpers/built-cli.js";

// Issue #169: Ctrl-C during the Chromium download passed SIGINT to the installer and returned at once, so the run
// exited, and removed its private temp folder, while the installer was still running and writing into it. The
// cleanup now waits for the installer to exit, and sends SIGKILL after INSTALLER_STOP_MS. The installer here is a
// fake (test/fixtures/signal/fake-installer.mjs): nothing is downloaded.
builtCli();
const fixture = new URL("../fixtures/signal/download.mjs", import.meta.url).pathname;
const fake = new URL("../fixtures/signal/fake-installer.mjs", import.meta.url).pathname;
const folder = mkdtempSync(join(tmpdir(), "a11y-genie-download-"));
afterAll(() => rmSync(folder, { recursive: true, force: true }));

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Starts the download with the fake installer, waits until the installer is ready, and sends SIGINT. */
async function interruptDownload(installerArgs: string[]) {
  const child = spawn(process.execPath, [fixture, fake, ...installerArgs], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let installer: number | undefined;
  try {
    // `exit`, not `close`: the installer shares the run's stderr, so `close` would wait for the installer too.
    const exited = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    installer = await new Promise<number>((resolve, reject) => {
      child.stderr.on("data", (chunk: Buffer) => {
        output += chunk.toString();
        const ready = /^installer ready (\d+)$/m.exec(output);
        if (ready?.[1]) resolve(Number(ready[1]));
      });
      child.on("exit", () =>
        reject(new Error(`the download ended before its installer was ready: ${output}`)),
      );
    });
    const sent = Date.now();
    child.kill("SIGINT");
    const code = await exited;
    return { code, took: Date.now() - sent, installerAlive: alive(installer), output };
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    // An installer the run left behind (the bug) is not left behind by the test.
    if (installer !== undefined && alive(installer)) process.kill(installer, "SIGKILL");
  }
}

it.skipIf(process.platform === "win32")(
  "Ctrl-C waits for the installer to stop before the run exits (skipped on Windows, where a signal cannot be sent to a child)",
  async () => {
    const marker = join(folder, "slow-stopped");
    const { code, installerAlive, output } = await interruptDownload(["slow", marker]);
    expect(code, output).toBe(130);
    expect(existsSync(marker), "the installer had not stopped when the run exited").toBe(true);
    expect(installerAlive).toBe(false);
    expect(output).not.toMatch(/^Error:/m);
  },
  15_000,
);

it.skipIf(process.platform === "win32")(
  "an installer that ignores Ctrl-C is killed after the wait, and the run still exits 130 (skipped on Windows)",
  async () => {
    const { code, took, installerAlive, output } = await interruptDownload(["stubborn"]);
    expect(code, output).toBe(130);
    expect(installerAlive).toBe(false);
    expect(took).toBeGreaterThanOrEqual(INSTALLER_STOP_MS - 100);
    expect(took).toBeLessThan(INSTALLER_STOP_MS + 1_500);
  },
  15_000,
);
