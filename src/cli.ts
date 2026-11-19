#!/usr/bin/env node
import { parseArgs } from "node:util";
import { BROWSER_CHANNELS, DEFAULT_CHANNEL, isBrowserChannel } from "./browser.js";
import { packageInfo } from "./package-info.js";
import { EXIT } from "./exit-codes.js";
import { installInterruptHandler } from "./interrupt.js";
import { checkOutFolder } from "./out-folder.js";
import { Refusal } from "./refusal.js";
import { emptyScanSentence, renderReport } from "./report.js";
import { runScan } from "./run-scan.js";
import { defaultScansDir, makeScanFolder, writeScanFile } from "./scans-folder.js";

const HELP = `A11y Genie: an accessibility scanner for agents and people.

It never says a site is "accessible" or "compliant". Automated checks find some problems, not all of them.

Usage:
  a11y-genie --version
  a11y-genie --help
  a11y-genie scan <url> [--json] [--out <folder>] [--format md,json] [--browser-channel chrome|msedge]

Flags:
  --json             print scan.json on stdout; everything else goes to stderr
  --out <folder>     where the scan folder goes; default is the per-user scans folder
  --format           which reports to write beside scan.json: md, json, or md,json (the default)
  --browser-channel  which installed browser to launch: chrome (the default) or msedge

Commands:
  scan       load one page in a browser with a new, empty profile, run axe-core on it, and write
             scan.json and report.md. Exit 0: no findings. Exit 1: findings.

Exit codes: 0 no findings, 1 findings, 2 a refusal (one Error: line and one Hint: line, nothing written),
3 something unexpected, 130 Ctrl-C.

Commands (coming, none works yet):
  check      scan again and say what is new and what is fixed
  narrate    describe a keyboard workflow step by step
  cards      turn findings into cards
  rules      list the checks
  checklist  the questions a scan cannot answer
  ignore     set a finding aside, with a reason and a date
  report     write a report again from a stored scan
  prompt     print the prompt file for a coding agent
`;

const HELP_HINT = "run a11y-genie --help to see what exists so far.";

const SERVE_HINT =
  "give a full address that starts with http:// or https://. To scan a built site, serve it first, for example: npx serve dist";

const FORMATS = ["md", "json"] as const;

/** `--format md,json`, repeatable: each value is a comma-separated list. */
function parseFormats(values: string[] | undefined): Set<(typeof FORMATS)[number]> {
  const chosen = new Set<(typeof FORMATS)[number]>();
  for (const value of values ?? ["md,json"]) {
    for (const name of value.split(",")) {
      if (!(FORMATS as readonly string[]).includes(name)) {
        throw new Refusal(
          `unknown --format: ${name || "(empty)"}`,
          `use ${FORMATS.join(" or ")}, or both, separated by a comma.`,
        );
      }
      chosen.add(name as (typeof FORMATS)[number]);
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

/** Scans one page, writes its scan folder, and sets the exit code: 0 with no findings, 1 with any. */
async function scan(args: string[]): Promise<void> {
  let values: {
    "browser-channel"?: string | undefined;
    out?: string | undefined;
    format?: string[] | undefined;
    json?: boolean | undefined;
  };
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args,
      options: {
        "browser-channel": { type: "string" },
        out: { type: "string" },
        format: { type: "string", multiple: true },
        json: { type: "boolean" },
      },
      allowPositionals: true,
      strict: true,
    }));
  } catch (error) {
    throw new Refusal((error as Error).message, HELP_HINT);
  }
  const [url, ...extra] = positionals;
  if (url === undefined)
    throw new Refusal("scan needs a page address to scan.", "run: a11y-genie scan <url>");
  if (extra.length > 0) throw new Refusal(`scan takes one page, and got more: ${extra[0]}`, HELP_HINT);

  const channel = values["browser-channel"] ?? DEFAULT_CHANNEL;
  if (!isBrowserChannel(channel)) {
    throw new Refusal(`unknown --browser-channel: ${channel}`, `use one of: ${BROWSER_CHANNELS.join(", ")}.`);
  }
  const formats = parseFormats(values.format);
  checkTarget(url);
  if (values.out !== undefined) checkOutFolder(values.out);

  const record = await runScan({ url, channel });

  const root = values.out ?? defaultScansDir();
  const json = `${JSON.stringify(record, null, 2)}\n`;
  let folder: string;
  try {
    folder = makeScanFolder(root, record.target.origin, record.startedAt);
    // scan.json is the record every other file is made from, so it is always written.
    writeScanFile(folder, "scan.json", json);
    if (formats.has("md")) writeScanFile(folder, "report.md", renderReport(record));
  } catch (error) {
    refuseUnwritable(error, root);
  }

  // Under --json stdout holds the one document and everything for a person goes to stderr.
  const say = values.json ? console.error : console.log;
  const found =
    record.summary.critical + record.summary.serious + record.summary.moderate + record.summary.minor;
  say(
    found === 0
      ? emptyScanSentence(record)
      : `Found ${found} ${found === 1 ? "problem" : "problems"} on ${record.pages[0]?.url ?? url}, worst first: ` +
          `${record.summary.critical} critical, ${record.summary.serious} serious, ` +
          `${record.summary.moderate} moderate, ${record.summary.minor} minor.`,
  );
  if (record.summary.needsReview > 0) say(`${record.summary.needsReview} more need a person to look.`);
  say(`Wrote ${folder}`);
  if (values.json) process.stdout.write(json);
  process.exitCode = record.exit;
}

async function main(args: string[]): Promise<void> {
  if (args[0] === "scan") return scan(args.slice(1));
  if (args.includes("--version")) {
    console.log(packageInfo().version);
  } else if (args.length === 0 || args.includes("--help")) {
    process.stdout.write(HELP);
  } else {
    throw new Refusal(`unknown command or flag: ${args[0]}`, HELP_HINT);
  }
}

installInterruptHandler();
try {
  await main(process.argv.slice(2));
} catch (error) {
  if (error instanceof Refusal) {
    console.error(`Error: ${error.message}`);
    console.error(`Hint: ${error.hint}`);
    process.exitCode = EXIT.refusal;
  } else {
    const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
    console.error(`Error: something unexpected went wrong: ${message}`);
    console.error("Hint: please report it at https://github.com/johnfrog76/a11y-genie/issues.");
    if (process.env.A11Y_GENIE_DEBUG) console.error(error);
    process.exitCode = EXIT.unexpected;
  }
}
