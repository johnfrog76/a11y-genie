import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { afterAll, beforeAll, expect, it } from "vitest";
import { removeUntilGone } from "../../src/private-temp.js";

// The race of issue 223: after Ctrl-C the command's exit handler removes its private temp folder while the
// Playwright that launched the browser removes the browser's profile, inside it, at the same moment. A worker thread
// plays Playwright here: it truly runs alongside. (fs.promises.rm would not: it moves on only when the event loop
// turns, and a synchronous removal holds the loop.) On Linux a plain rmSync loses this race often (26 and 36 of 100
// rounds on CI's Linux, test/unit/remove-folder.test.ts of PR 222).

const ROUNDS = 100;
const base = mkdtempSync(join(tmpdir(), "a11y-genie-remove-"));
// [0]: the round the worker is to remove the profile of, -1 to stop; [1]: the last round it finished.
const signal = new Int32Array(new SharedArrayBuffer(8));
let worker: Worker;

beforeAll(async () => {
  worker = new Worker(
    `
    const { rmSync } = require("node:fs");
    const { join } = require("node:path");
    const { workerData, parentPort } = require("node:worker_threads");
    const signal = new Int32Array(workerData.buffer);
    let last = 0;
    parentPort.postMessage("ready");
    for (;;) {
      Atomics.wait(signal, 0, last);
      last = Atomics.load(signal, 0);
      if (last < 0) break;
      try {
        rmSync(join(workerData.base, "r" + last, "playwright_chromiumdev_profile-x"), { recursive: true, force: true });
      } catch {}
      Atomics.store(signal, 1, last);
      Atomics.notify(signal, 1);
    }
    `,
    { eval: true, workerData: { base, buffer: signal.buffer } },
  );
  await new Promise((resolve) => worker.once("message", resolve));
});

afterAll(async () => {
  Atomics.store(signal, 0, -1);
  Atomics.notify(signal, 0);
  await worker.terminate();
  rmSync(base, { recursive: true, force: true });
});

let round = 0;

/** A private temp folder holding a browser profile of 48 entries. */
function makeTree(): string {
  round += 1;
  const top = join(base, `r${round}`);
  for (let folder = 0; folder < 6; folder++) {
    const inner = join(top, "playwright_chromiumdev_profile-x", `d${folder}`);
    mkdirSync(inner, { recursive: true });
    for (let file = 0; file < 7; file++) writeFileSync(join(inner, `f${file}`), "x");
  }
  return top;
}

it(`removeUntilGone leaves no folder behind while another thread removes the profile in it (${ROUNDS} rounds)`, () => {
  let left = 0;
  for (let i = 0; i < ROUNDS; i++) {
    const top = makeTree();
    Atomics.store(signal, 0, round);
    Atomics.notify(signal, 0);
    removeUntilGone(top);
    while (Atomics.load(signal, 1) !== round) Atomics.wait(signal, 1, Atomics.load(signal, 1), 1_000);
    if (existsSync(top)) left += 1;
    rmSync(top, { recursive: true, force: true });
  }
  expect(left).toBe(0);
});
