/**
 * `a11y-genie scan`, in the parts `check` shares: the flags and what they are checked against
 * (`prepareScan`), the run, writing the scan folder (`writeScan`), and the lines for a person (`scanLines`).
 * src/cli.ts dispatches to `scanCommand`; src/check-command.ts runs the same parts around its comparison.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { printRunBanner } from "./banner.js";
import { previousScan } from "./baseline.js";
import { BROWSER_CHANNELS, DEFAULT_CHANNEL, isBrowserChannel } from "./browser.js";
import { notCheckedNow, sincePreviousLine, unverifiedOf, withPrevious } from "./compare.js";
import type { Impact } from "./finding.js";
import { narrationLines, NARRATION_DIR, renderTranscript } from "./narrate.js";
import { checkOutFolder } from "./out-folder.js";
import { printable, printableLine } from "./printable.js";
import { addressKindOfUrl } from "./private-address.js";
import { Refusal } from "./refusal.js";
import { adviceOnlySentence, emptyNarrationSentence, emptyScanSentence, renderReport } from "./report.js";
import { DEFAULT_FAIL_ON, parseFailOn, parseTags } from "./rule-flags.js";
import { runScan, type RunScanOptions } from "./run-scan.js";
import { checkStorageState, parseMaxTabs, parseTimeout } from "./scan-options.js";
import { planScan, type ScanPlan } from "./scan-plan.js";
import { scanJson, type ScanRecord } from "./scan-record.js";
import { defaultScansDir, makeScanFolder, writeScanFile } from "./scans-folder.js";

const SERVE_HINT =
  "give a full address that starts with http:// or https://. To scan a built site, serve it first, for example: npx serve dist";

const FORMATS = ["md", "json"] as const;
type Format = (typeof FORMATS)[number];

/** What a page tried, in the CLI's one line. Counts only: page text is never printed here. */
const STOPPED_WORDS = {
  dialog: ["dialog", "dialogs", "dismissed"],
  popup: ["pop-up window", "pop-up windows", "closed"],
  download: ["download", "downloads", "cancelled"],
  "private-network": ["request to a private address", "requests to private addresses", "blocked"],
  offline: ["request off this machine", "requests off this machine", "aborted"],
  "other-origin": ["request to another origin", "requests to other origins", "blocked"],
} as const;

/** The flags `scan` takes, in `parseArgs`'s shape. `check` takes these and `--baseline`. */
export const SCAN_FLAGS = {
  "browser-channel": { type: "string" },
  out: { type: "string" },
  format: { type: "string", multiple: true },
  json: { type: "boolean" },
  "no-download": { type: "boolean" },
  "allow-private": { type: "boolean" },
  tags: { type: "string" },
  "fail-on": { type: "string" },
  "same-origin": { type: "boolean" },
  offline: { type: "boolean" },
  states: { type: "string", multiple: true },
  config: { type: "string" },
  timeout: { type: "string" },
  "max-tabs": { type: "string" },
  "storage-state": { type: "string" },
  commit: { type: "string" },
} as const;

/** The values of `SCAN_FLAGS`, as `parseArgs` gives them. */
export interface ScanFlagValues {
  "browser-channel"?: string | undefined;
  out?: string | undefined;
  format?: string[] | undefined;
  json?: boolean | undefined;
  "no-download"?: boolean | undefined;
  "allow-private"?: boolean | undefined;
  tags?: string | undefined;
  "fail-on"?: string | undefined;
  "same-origin"?: boolean | undefined;
  offline?: boolean | undefined;
  states?: string[] | undefined;
  config?: string | undefined;
  timeout?: string | undefined;
  "max-tabs"?: string | undefined;
  "storage-state"?: string | undefined;
  commit?: string | undefined;
}

/** A scan, with every flag checked and nothing run yet. */
export interface PreparedScan {
  plan: ScanPlan;
  run: RunScanOptions;
  formats: Set<Format>;
  /** Where the scan folder goes: `--out`, or the per-user scans folder. */
  root: string;
  json: boolean;
  failOn: Impact;
  /** `--commit`, or `GITHUB_SHA` when it is set; null with neither. */
  commit: string | null;
}

/** `--format md,json`, repeatable: each value is a comma-separated list. */
function parseFormats(values: string[] | undefined): Set<Format> {
  const chosen = new Set<Format>();
  for (const value of values ?? ["md,json"]) {
    for (const name of value.split(",")) {
      if (!(FORMATS as readonly string[]).includes(name)) {
        throw new Refusal(
          `unknown --format: ${printableLine(name).slice(0, 80) || "(empty)"}`,
          `use ${FORMATS.join(" or ")}, or both, separated by a comma.`,
        );
      }
      chosen.add(name as Format);
    }
  }
  return chosen;
}

/** Refuses an address this tool may not load: anything but a full `http:` or `https:` address. */
function checkTarget(target: string): void {
  let protocol: string;
  try {
    protocol = new URL(target).protocol;
  } catch {
    throw new Refusal(`not a web address: ${JSON.stringify(target.slice(0, 80))}`, SERVE_HINT);
  }
  if (protocol !== "http:" && protocol !== "https:") {
    throw new Refusal(
      `only http: and https: addresses can be scanned, and this one is ${protocol}`,
      SERVE_HINT,
    );
  }
}

/** Refuses a target that is not on this machine, for `--offline`. */
function checkOfflineTarget(target: string): void {
  if (addressKindOfUrl(target) !== "loopback") {
    throw new Refusal(
      `--offline allows only a page on this machine, and ${new URL(target).origin} is not one.`,
      "serve the page on localhost, 127.0.0.1 or [::1], or run without --offline.",
    );
  }
}

/** A commit as `--commit` or `GITHUB_SHA` may name it: a sha, or a tag or branch name. */
const COMMIT = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;

/** `--commit`, or `GITHUB_SHA` when it is set and `--commit` is not given. */
export function parseCommit(flag: string | undefined, env: NodeJS.ProcessEnv = process.env): string | null {
  const [value, from] =
    flag !== undefined
      ? [flag, "--commit"]
      : [env.GITHUB_SHA === "" ? undefined : env.GITHUB_SHA, "GITHUB_SHA"];
  if (value === undefined) return null;
  if (!COMMIT.test(value)) {
    throw new Refusal(
      `${from} is not a commit: "${printableLine(value).slice(0, 40)}".`,
      "give a commit sha, or a tag or branch name: letters, digits, '.', '_', '/' and '-', up to 100.",
    );
  }
  return value;
}

/** Parses `args` with `options`, refusing an unknown flag in the parser's words. */
export function parseFlags<O extends NonNullable<Parameters<typeof parseArgs>[0]>["options"]>(
  args: string[],
  options: O,
  helpHint: string,
): { values: Record<string, unknown>; positionals: string[] } {
  try {
    const { values, positionals } = parseArgs({ args, options, allowPositionals: true, strict: true });
    return { values: values as Record<string, unknown>, positionals };
  } catch (error) {
    throw new Refusal((error as Error).message, helpHint);
  }
}

/** Checks every flag and the address, and plans the pages and states, before a browser is opened. */
export function prepareScan(
  values: ScanFlagValues,
  positionals: string[],
  command: "scan" | "check" | "narrate",
  helpHint: string,
): PreparedScan {
  const [url, ...extra] = positionals;
  if (url === undefined && values.config === undefined)
    throw new Refusal(
      `${command} needs a page address to ${command === "narrate" ? "narrate" : "scan"}.`,
      `run: a11y-genie ${command} <url>${command === "narrate" ? ' --flow "<steps>"' : ""}`,
    );
  if (extra.length > 0)
    throw new Refusal(
      `${command} takes one page, and got more: ${printableLine(extra[0] ?? "").slice(0, 80)}`,
      helpHint,
    );

  const channel = values["browser-channel"] ?? DEFAULT_CHANNEL;
  if (!isBrowserChannel(channel)) {
    throw new Refusal(
      `unknown --browser-channel: ${printableLine(String(channel)).slice(0, 80)}`,
      `use one of: ${BROWSER_CHANNELS.join(", ")}.`,
    );
  }
  const formats = parseFormats(values.format);
  const tags = values.tags === undefined ? undefined : parseTags(values.tags);
  const failOn = values["fail-on"] === undefined ? DEFAULT_FAIL_ON : parseFailOn(values["fail-on"]);
  const commit = parseCommit(values.commit);
  if (url !== undefined) checkTarget(url);
  if (values.out !== undefined) checkOutFolder(values.out);
  const plan = planScan({ url, states: values.states ?? [], config: values.config });
  checkTarget(plan.url);
  if (values.offline === true) checkOfflineTarget(plan.url);
  const pageMs = values.timeout === undefined ? undefined : parseTimeout(values.timeout);
  const maxTabs = values["max-tabs"] === undefined ? undefined : parseMaxTabs(values["max-tabs"]);
  if (values["storage-state"] !== undefined) checkStorageState(values["storage-state"]);

  const run: RunScanOptions = {
    url: plan.url,
    pages: plan.pages,
    ...(pageMs === undefined ? {} : { limits: { pageMs } }),
    ...(values["storage-state"] === undefined ? {} : { storageState: values["storage-state"] }),
    ...(plan.workflows.length === 0 ? {} : { workflows: plan.workflows }),
    channel,
    named: values["browser-channel"] !== undefined,
    download: values["no-download"] !== true,
    allowPrivate: values["allow-private"] === true,
    sameOrigin: values["same-origin"] === true,
    offline: values.offline === true,
    failOn,
    ...(tags === undefined ? {} : { tags }),
    ...(maxTabs === undefined ? {} : { maxTabs }),
    // `--offline` downloads nothing; the refusal names the flag the person gave.
    noDownloadFlag: values["no-download"] === true ? "--no-download" : "--offline",
  };
  return {
    plan,
    run,
    formats,
    root: values.out ?? defaultScansDir(),
    json: values.json === true,
    failOn,
    commit,
  };
}

/** Runs the scan and records `--commit` on it. */
export async function runPrepared(prepared: PreparedScan): Promise<ScanRecord> {
  const record = await runScan(prepared.run);
  return { ...record, target: { ...record.target, commit: prepared.commit } };
}

/** A scan folder that cannot be made or written, found only when the write is tried. */
function refuseUnwritable(error: unknown, where: string): never {
  const code = (error as NodeJS.ErrnoException).code;
  if (
    code !== undefined &&
    ["EACCES", "EPERM", "ENOENT", "ENOTDIR", "EROFS", "ENOSPC", "EEXIST"].includes(code)
  ) {
    throw new Refusal(`cannot write the scan under ${where}: ${code}`, "choose another folder with --out.");
  }
  throw error;
}

/** Makes the scan folder and writes `scan.json`, and `report.md` unless `--format` leaves it out. */
export function writeScan(prepared: PreparedScan, record: ScanRecord): string {
  try {
    const folder = makeScanFolder(prepared.root, record.target.origin, record.startedAt);
    // scan.json is the record every other file is made from, so it is always written.
    writeScanFile(folder, "scan.json", scanJson(record));
    if (prepared.formats.has("md")) writeScanFile(folder, "report.md", renderReport(record));
    // The transcript of each narrated flow, in `narration/`. Always written: it is what narrating is for.
    if (record.workflows.length > 0) mkdirSync(join(folder, NARRATION_DIR));
    for (const flow of record.workflows) writeScanFile(folder, flow.file, printable(renderTranscript(flow)));
    return folder;
  } catch (error) {
    return refuseUnwritable(error, prepared.root);
  }
}

/**
 * The lines for a person after the first: what was not scanned, how many problems, redirects, what the page
 * tried, why the exit is 0, what needs a person to look, and where the scan was written. Not yet printable:
 * `say` strips them, since addresses in them are the page's to choose.
 */
export function scanLines(record: ScanRecord, prepared: PreparedScan, folder: string): string[] {
  const lines: string[] = [];
  // On a `check`, the impact counts include the baseline's findings carried over unchecked, in a state not scanned
  // now. This run did not find them, so *Found* leaves them out and a line of their own says them (issue 157).
  const carried = notCheckedNow(record).filter((f) => f.kind === "violation");
  const count = (impact: Impact): number =>
    record.summary[impact] - carried.filter((f) => f.impact === impact).length;
  const found = count("critical") + count("serious") + count("moderate") + count("minor");
  const first = record.pages[0];
  // `narrate` prints each flow's transcript, which is what it is asked for; a scan only says where they went.
  if (record.command === "narrate") {
    for (const flow of record.workflows) lines.push(...narrationLines(flow));
  }
  for (const flow of record.workflows) {
    if (flow.notScanned !== undefined) {
      lines.push(`The flow "${flow.name}" on ${flow.page} was not narrated to the end: ${flow.notScanned}.`);
    }
  }
  for (const page of record.pages) {
    for (const missed of page.notScanned) {
      // The reason is the scan's own words; the address is the one asked for.
      const where = missed.state === "default" ? "" : ` in the state "${missed.state}"`;
      lines.push(`${page.url} was not scanned${where}: ${missed.reason}.`);
    }
  }
  if (record.summary.notScanned === 0 || found > 0) {
    const pages = record.pages.length;
    lines.push(
      found === 0
        ? record.command === "narrate"
          ? emptyNarrationSentence(record)
          : record.summary.advice > 0
            ? adviceOnlySentence(record)
            : emptyScanSentence(record)
        : `Found ${found} ${found === 1 ? "problem" : "problems"} on ${pages === 1 ? (first?.url ?? prepared.plan.url) : `${pages} pages`}, worst first: ` +
            `${count("critical")} critical, ${count("serious")} serious, ` +
            `${count("moderate")} moderate, ${count("minor")} minor.`,
    );
  }
  if (carried.length > 0) {
    lines.push(`${carried.length} ${found > 0 ? "more " : ""}still open, not checked this time.`);
  }
  for (const page of record.pages) {
    if (page.requestedUrl !== undefined && page.url !== page.requestedUrl) {
      lines.push(`It was redirected from ${page.requestedUrl} to ${page.url}.`);
    }
    const stopped = page.stopped ?? [];
    if (stopped.length > 0) {
      const tried = stopped.map((entry) => {
        const [one, many, done] = STOPPED_WORDS[entry.kind];
        return `${entry.count} ${entry.count === 1 ? one : many} ${done}`;
      });
      lines.push(`Stopped what the page tried: ${tried.join(", ")}. The report lists them.`);
    }
  }
  if (found > 0 && record.summary.notScanned === 0 && record.exit === 0) {
    lines.push(
      record.command === "check"
        ? `None of them is new${prepared.failOn === "minor" ? "" : ` at ${prepared.failOn} or worse`}, so the exit is 0: the ones still open were in the baseline` +
            // A finding found only in states the baseline did not scan reads still open, and was never in it (issue 158).
            (unverifiedOf(record).neverScanned > 0 ? ", or were found only in states it did not scan." : ".")
        : `None is ${prepared.failOn} or worse, so the exit is 0 (--fail-on ${prepared.failOn}).`,
    );
  }
  const review = record.summary.needsReview;
  if (review > 0) lines.push(`${review} more ${review === 1 ? "needs" : "need"} a person to look.`);
  lines.push(`Wrote ${folder}`);
  return lines;
}

/** Prints `lines` for a person, each stripped, then `scan.json` on stdout under `--json`, and sets the exit. */
export function finish(record: ScanRecord, prepared: PreparedScan, lines: string[]): void {
  // Under --json stdout holds the one document and everything for a person goes to stderr.
  const write = prepared.json ? console.error : console.log;
  for (const line of lines) write(printable(line));
  if (prepared.json) process.stdout.write(scanJson(record));
  process.exitCode = record.exit;
}

/**
 * `a11y-genie scan`: scans, compares with the site's previous scan when there is one (its first line and
 * `summary.sincePrevious`, nothing else), writes the scan folder, and exits 0 with no violation at or above
 * `--fail-on`, 1 with one or with a page or state not scanned.
 */
export async function scanCommand(args: string[], helpHint: string): Promise<void> {
  const { values, positionals } = parseFlags(args, SCAN_FLAGS, helpHint);
  const prepared = prepareScan(values as ScanFlagValues, positionals, "scan", helpHint);
  printRunBanner(prepared.json);
  let record = await runPrepared(prepared);
  const previous = previousScan(prepared.root, record.target.origin);
  if (previous !== undefined) record = withPrevious(record, previous);
  const folder = writeScan(prepared, record);
  const since = sincePreviousLine(record);
  finish(record, prepared, [...(since === undefined ? [] : [since]), ...scanLines(record, prepared, folder)]);
}
