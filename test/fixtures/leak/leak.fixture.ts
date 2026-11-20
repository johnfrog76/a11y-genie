// Not a test of the project: test/cli/browser-leak.test.ts runs this file on purpose, with vitest.config.ts
// beside it, and expects every test here to fail. Each leaves a browser running; test/setup/private-temp.ts must
// stop it. The name does not end in .test.ts, so the main run never picks this file up.
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { Socket } from "node:net";
import { afterAll, beforeAll, describe, it } from "vitest";
import { runScan } from "../../../src/run-scan.js";
import { processesIn } from "../../helpers/processes-in.js";
import { TEST_CHANNEL } from "../../helpers/test-browser.js";

describe("tests that fail and leave a browser running", () => {
  let hang: Server;
  const held = new Set<Socket>();
  beforeAll(async () => {
    hang = createServer(() => undefined);
    hang.on("connection", (socket) => held.add(socket));
    await new Promise<void>((resolve) => hang.listen(0, "127.0.0.1", resolve));
  });
  afterAll(async () => {
    for (const socket of held) socket.destroy();
    await new Promise<void>((resolve) => hang.close(() => resolve()));
  });

  it("throws while a process it started has a browser open", async () => {
    // A separate process that outlives the worker, as the built command does in a test that spawns it and then
    // fails. It stops when its browser goes, and by itself after a minute, so it cannot run on for good.
    const script = `
      import { chromium } from "playwright-core";
      const browser = await chromium.launch({ channel: ${JSON.stringify(TEST_CHANNEL)}, headless: true });
      browser.on("disconnected", () => process.exit(0));
      setTimeout(() => process.exit(0), 60_000);
    `;
    spawn(process.execPath, ["--input-type=module", "-e", script], {
      cwd: new URL("../../..", import.meta.url).pathname,
      stdio: "ignore",
      detached: true,
    }).unref();
    // Its browser is up once the command line of some process names this file's private temp folder.
    const deadline = Date.now() + 10_000;
    while (processesIn(process.env.TMPDIR ?? "").length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("failing on purpose");
  });

  it("times out while its scan waits for a page that never answers", async () => {
    const { port } = hang.address() as { port: number };
    await runScan({ url: `http://127.0.0.1:${port}/`, channel: TEST_CHANNEL });
  });
});
