import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withBrowser } from "../../src/browser.js";
import { SCANS_DIR_ENV } from "../../src/scans-folder.js";
import { testBrowserIsInstalled } from "../helpers/browser-guard.js";
import { builtCli } from "../helpers/built-cli.js";
import { mainBrowserProcesses, type FolderProcess } from "../helpers/processes-in.js";
import {
  NAMED_ANOTHER_BROWSER,
  TEST_CHANNEL,
  TEST_ENGINE_BROWSER,
  channelArgs,
} from "../helpers/test-browser.js";

// The tests launch Playwright's headless shell, a plain executable, never an app bundle: on macOS every launch of an
// app shows in the Dock, and a suite run launches many. This reads the launched browser's own main process from `ps`
// (its command line starts with the executable's path), never its helpers, which carry `--type=` and no `--headless`.
// It reads the process list, not playwright-core: its `Browser` does not expose the process it launched, and the
// process list is the same for a launch in this process and for one a spawned command makes.

const cli = builtCli();
const hasBrowser = await testBrowserIsInstalled();

/** What a main browser process says about itself: an app bundle, and headless. */
function shape(found: FolderProcess) {
  return {
    appBundle: found.command.includes(".app/"),
    headless: / --headless(=\S*)?( |$)/.test(found.command),
  };
}

describe.skipIf(!hasBrowser || process.platform === "win32")(
  "the tests' browser (skipped where the test browser is not installed, or there is no ps)",
  () => {
    it("is headless on its main process, in a launch in this process", async () => {
      const seen = await withBrowser(TEST_CHANNEL, async () => mainBrowserProcesses(tmpdir()));
      expect(seen).toHaveLength(1);
      expect(shape(seen[0]!).headless).toBe(true);
    });

    it.skipIf(NAMED_ANOTHER_BROWSER)(
      "is not an app bundle, in a launch in this process (skipped when A11Y_GENIE_TEST_CHANNEL names another browser)",
      async () => {
        const seen = await withBrowser(TEST_CHANNEL, async () => mainBrowserProcesses(tmpdir()));
        expect(seen).toHaveLength(1);
        expect(shape(seen[0]!), seen[0]!.command).toEqual({ appBundle: false, headless: true });
      },
    );

    describe("in a command a test spawns", () => {
      // The page answers only once this test has read the command's browser from the process list, so the
      // browser is surely running when it is read, however fast the machine is.
      let server: Server;
      let seen: FolderProcess[] = [];
      const scans = mkdtempSync(join(tmpdir(), "a11y-genie-scans-"));
      beforeAll(async () => {
        server = createServer((request, response) => {
          void (async () => {
            const deadline = Date.now() + 10_000;
            while (seen.length === 0 && Date.now() < deadline) {
              seen = mainBrowserProcesses(tmpdir());
              if (seen.length === 0) await new Promise((resolve) => setTimeout(resolve, 50));
            }
            response.writeHead(200, { "content-type": "text/html" });
            response.end(
              '<!doctype html><html lang="en"><title>Shell</title><main><h1>Shell</h1></main></html>',
            );
          })();
        });
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      });
      afterAll(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        rmSync(scans, { recursive: true, force: true });
      });

      it("names the tests' browser in engine.browser, and its main process is headless and, unless A11Y_GENIE_TEST_CHANNEL names another browser, not an app bundle", async () => {
        const { port } = server.address() as { port: number };
        const run = await new Promise<{ status: number | null; stdout: string; stderr: string }>(
          (resolve, reject) => {
            const child = spawn(
              process.execPath,
              [cli, ...channelArgs(["scan", `http://127.0.0.1:${port}/`, "--json"])],
              { env: { ...process.env, [SCANS_DIR_ENV]: scans } },
            );
            let stdout = "";
            let stderr = "";
            child.stdout.on("data", (chunk: Buffer) => (stdout += chunk));
            child.stderr.on("data", (chunk: Buffer) => (stderr += chunk));
            child.on("error", reject);
            child.on("close", (status) => resolve({ status, stdout, stderr }));
          },
        );
        expect(run.status, run.stderr).not.toBe(2);
        const record = JSON.parse(run.stdout) as { engine: { browser: string } };
        expect(record.engine.browser).toMatch(new RegExp(`^${TEST_ENGINE_BROWSER} \\d+(\\.\\d+)*$`));

        expect(seen).toHaveLength(1);
        expect(shape(seen[0]!).headless, seen[0]!.command).toBe(true);
        if (!NAMED_ANOTHER_BROWSER) expect(shape(seen[0]!).appBundle, seen[0]!.command).toBe(false);
      });
    });
  },
);
