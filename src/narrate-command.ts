/**
 * `a11y-genie narrate <url> --flow "<steps>"` (docs/STEPS.md and docs/ARCHITECTURE.md, *Narration*): drives the flow by the keyboard in the hardened
 * browser context, reads each step back from the accessibility tree (src/narrate.ts), prints the transcript,
 * and writes the scan folder with `narration/flow.txt` in it. It shares the flags and the files of `scan`
 * (src/scan-command.ts), without the ones that make no sense for a flow: `--states`, `--config` and `--tags`.
 */

import { printRunBanner } from "./banner.js";
import { FLOW_NAME, MAX_FLOW_STEPS } from "./narrate.js";
import { Refusal } from "./refusal.js";
import { pageKeyOf } from "./map-axe.js";
import {
  finish,
  parseFlags,
  prepareScan,
  runPrepared,
  SCAN_FLAGS,
  scanLines,
  writeScan,
  type ScanFlagValues,
} from "./scan-command.js";
import { parseSteps } from "./steps.js";

/** The flags `narrate` takes: `scan`'s, less `--states`, `--config` and `--tags`, which are about pages and rules; and `--flow`. */
export const NARRATE_FLAGS = {
  "browser-channel": SCAN_FLAGS["browser-channel"],
  out: SCAN_FLAGS.out,
  format: SCAN_FLAGS.format,
  json: SCAN_FLAGS.json,
  "no-download": SCAN_FLAGS["no-download"],
  "allow-private": SCAN_FLAGS["allow-private"],
  "fail-on": SCAN_FLAGS["fail-on"],
  "same-origin": SCAN_FLAGS["same-origin"],
  offline: SCAN_FLAGS.offline,
  timeout: SCAN_FLAGS.timeout,
  "max-tabs": SCAN_FLAGS["max-tabs"],
  "storage-state": SCAN_FLAGS["storage-state"],
  commit: SCAN_FLAGS.commit,
  flow: { type: "string" },
} as const;

export async function narrateCommand(args: string[], helpHint: string): Promise<void> {
  const { values, positionals } = parseFlags(args, NARRATE_FLAGS, helpHint);
  const flow = values.flow as string | undefined;
  if (flow === undefined) {
    throw new Refusal(
      "narrate needs --flow: the steps to drive.",
      'run: a11y-genie narrate <url> --flow "Tab; Tab; Enter"',
    );
  }
  const steps = parseSteps(flow, { source: "--flow", use: "flow" });
  if (steps.length > MAX_FLOW_STEPS) {
    throw new Refusal(
      `--flow has ${steps.length} steps, and narrate takes at most ${MAX_FLOW_STEPS}.`,
      "narrate one task at a time: split the flow in two.",
    );
  }
  const prepared = prepareScan(values as ScanFlagValues, positionals, "narrate", helpHint);
  const page = prepared.plan.pages[0]?.key ?? pageKeyOf(prepared.plan.url);
  prepared.run = {
    ...prepared.run,
    workflows: [{ name: FLOW_NAME, page, steps }],
    narrateOnly: true,
  };
  printRunBanner(prepared.json);
  const record = await runPrepared(prepared);
  const folder = writeScan(prepared, record);
  finish(record, prepared, scanLines(record, prepared, folder));
}
