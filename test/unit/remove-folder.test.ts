import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { removeFolder } from "../helpers/remove-folder.js";

// The race of issue 160: a test run stopped by a signal removes its folder while the Playwright that launched a
// stopped browser removes that browser's profile, inside it, at the same moment. A worker thread plays Playwright
// here: it truly runs alongside, as another process does. (fs.promises.rm would not: it moves on only when the event
// loop turns, and a synchronous removal holds the loop.)

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
        rmSync(join(workerData.base, "r" + last, "worker", "profile"), { recursive: true, force: true });
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

/** A run folder holding a worker folder holding a profile of 48 entries, as the stopped run's was. */
function makeTree(): string {
  round += 1;
  const top = join(base, `r${round}`);
  for (let folder = 0; folder < 6; folder++) {
    const inner = join(top, "worker", "profile", `d${folder}`);
    mkdirSync(inner, { recursive: true });
    for (let file = 0; file < 7; file++) writeFileSync(join(inner, `f${file}`), "x");
  }
  return top;
}

/** Removes a fresh tree with `remove` while the worker removes its profile; says whether the top was left. */
function race(remove: (top: string) => void): { left: boolean; threw: boolean } {
  const top = makeTree();
  Atomics.store(signal, 0, round);
  Atomics.notify(signal, 0);
  let threw = false;
  try {
    remove(top);
  } catch {
    threw = true;
  }
  while (Atomics.load(signal, 1) !== round) Atomics.wait(signal, 1, Atomics.load(signal, 1), 1_000);
  const left = existsSync(top);
  rmSync(top, { recursive: true, force: true });
  return { left, threw };
}

it(`removeFolder leaves no folder behind while another thread removes part of it (${ROUNDS} rounds)`, () => {
  let left = 0;
  for (let i = 0; i < ROUNDS; i++) if (race(removeFolder).left) left += 1;
  expect(left).toBe(0);
});

// Only Linux: there Node's rmSync uses libstdc++'s remove_all, which stops at an entry already gone and reports it
// as done. How often it loses depends on the machine, so a count of zero is printed, not failed on; what is held is
// that each time it does lose, it says nothing, which is how the folder was left with no error.
describe.skipIf(process.platform !== "linux")("plain rmSync, on Linux", () => {
  it(`returns with no error and the folder still there, in some of ${ROUNDS} rounds`, () => {
    let left = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const result = race((top) => rmSync(top, { recursive: true, force: true }));
      if (result.left) {
        left += 1;
        expect(result.threw).toBe(false);
      }
    }
    // Straight to stderr, so the count shows in CI's log even where vitest keeps a passing test's console quiet.
    process.stderr.write(`plain rmSync left the folder in ${left} of ${ROUNDS} rounds\n`);
  });
});
