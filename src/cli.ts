#!/usr/bin/env node
import { parseArgs } from "node:util";
import { BROWSER_CHANNELS, DEFAULT_CHANNEL, isBrowserChannel } from "./browser.js";
import { packageInfo } from "./package-info.js";
import { EXIT } from "./exit-codes.js";
import { installInterruptHandler } from "./interrupt.js";
import { checkOutFolder } from "./out-folder.js";
import { printable } from "./printable.js";
import { Refusal } from "./refusal.js";
import { emptyScanSentence, renderReport } from "./report.js";
import { addressKindOfUrl } from "./private-address.js";
import { DEFAULT_FAIL_ON, parseFailOn, parseTags } from "./rule-flags.js";
import { rulesCommand } from "./rules-command.js";
import { runScan } from "./run-scan.js";
import { scanJson } from "./scan-record.js";
import { defaultScansDir, makeScanFolder, writeScanFile } from "./scans-folder.js";

const HELP = `A11y Genie: an accessibility scanner for agents and people.

It never says a site is "accessible" or "compliant". Automated checks find some problems, not all of them.

Usage:
  a11y-genie --version
  a11y-genie --help
  a11y-genie rules [--tags <list>] [--json]
  a11y-genie scan <url> [--json] [--out <folder>] [--format md,json]
                  [--browser-channel chrome|msedge|chromium] [--no-download] [--allow-private]
                  [--tags <list>] [--fail-on <impact>] [--same-origin] [--offline]

Flags:
  --json             print scan.json on stdout; everything else goes to stderr
  --out <folder>     where the scan folder goes; default is the per-user scans folder
  --format           which reports to write beside scan.json: md, json, or md,json (the default)
  --browser-channel  which browser to launch: chrome (the default) or msedge, installed on this machine,
                     or chromium, Playwright's own, downloaded once if it is not there yet
  --no-download      never download Playwright's Chromium: with no Chrome, refuse instead (--offline does too)
  --allow-private    let a public page reach loopback, link-local and private addresses, which
                     are blocked by default. A target that is itself one of them is never limited
  --tags <list>      run exactly these axe-core tags, comma-separated, such as wcag2a,wcag2aa,best-practice.
                     Without it, axe-core's default rule set runs. The landmark rules, and the page-level
                     no-landmarks finding, need best-practice: a list without it runs none of them
  --fail-on <impact> the lowest impact that makes the exit 1: critical, serious, moderate or minor (the
                     default, so any violation does). Findings below it are still listed, and the exit is 0.
                     Advice and "needs a person to look" items never change the exit, and a page that
                     could not be scanned always exits 1
  --same-origin      abort every request to an origin other than the page's own, and say so in the report
                     (some of the page's content may then be missing)
  --offline          only a page on this machine (127.0.0.1, ::1, localhost) can be scanned; every request
                     off this machine is aborted and noted; no browser is downloaded

With no Chrome, and no --browser-channel, A11y Genie says so and downloads Playwright's Chromium once.

Commands:
  scan       load one page in a browser with a new, empty profile, run axe-core on it, and write
             scan.json and report.md. Exit 0: no findings. Exit 1: findings, or the page
             could not be scanned (the scan says why).

  rules      list every rule A11y Genie runs: axe-core's, at the version it pins, and its own genie/ rules,
             with impact, WCAG criteria and tags. --tags <list> keeps the rules with one of those tags;
             --json prints them as one JSON document (docs/JSON.md). It needs no browser and no network.
             Exit 0.

Exit codes: 0 no findings, 1 findings or not scanned, 2 a refusal (one Error: line and one Hint: line,
nothing written), 3 something unexpected, 130 Ctrl-C.

Commands (coming, none works yet):
  check      scan again and say what is new and what is fixed
  narrate    describe a keyboard workflow step by step
  cards      turn findings into cards
  checklist  the questions a scan cannot answer
  ignore     set a finding aside, with a reason and a date
  report     write a report again from a stored scan
  prompt     print the prompt file for a coding agent
`;

const HELP_HINT = "run a11y-genie --help to see what exists so far.";

const SERVE_HINT =
  "give a full address that starts with http:// or https://. To scan a built site, serve it first, for example: npx serve dist";

const FORMATS = ["md", "json"] as const;

/** What a page tried, in the CLI's one line. Counts only: page text is never printed here. */
const STOPPED_WORDS = {
  dialog: ["dialog", "dialogs", "dismissed"],
  popup: ["pop-up window", "pop-up windows", "closed"],
  download: ["download", "downloads", "cancelled"],
  "private-network": ["request to a private address", "requests to private addresses", "blocked"],
  offline: ["request off this machine", "requests off this machine", "aborted"],
  "other-origin": ["request to another origin", "requests to other origins", "blocked"],
} as const;

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

/** Refuses a target that is not on this machine, for `--offline`. */
function checkOfflineTarget(target: string): void {
  if (addressKindOfUrl(target) !== "loopback") {
    throw new Refusal(
      `--offline allows only a page on this machine, and ${new URL(target).origin} is not one.`,
      "serve the page on localhost, 127.0.0.1 or [::1], or run without --offline.",
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
    "no-download"?: boolean | undefined;
    "allow-private"?: boolean | undefined;
    tags?: string | undefined;
    "fail-on"?: string | undefined;
    "same-origin"?: boolean | undefined;
    offline?: boolean | undefined;
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
        "no-download": { type: "boolean" },
        "allow-private": { type: "boolean" },
        tags: { type: "string" },
        "fail-on": { type: "string" },
        "same-origin": { type: "boolean" },
        offline: { type: "boolean" },
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
  const tags = values.tags === undefined ? undefined : parseTags(values.tags);
  const failOn = values["fail-on"] === undefined ? DEFAULT_FAIL_ON : parseFailOn(values["fail-on"]);
  checkTarget(url);
  if (values.offline === true) checkOfflineTarget(url);
  if (values.out !== undefined) checkOutFolder(values.out);

  const record = await runScan({
    url,
    channel,
    named: values["browser-channel"] !== undefined,
    download: values["no-download"] !== true,
    allowPrivate: values["allow-private"] === true,
    sameOrigin: values["same-origin"] === true,
    offline: values.offline === true,
    failOn,
    ...(tags === undefined ? {} : { tags }),
    // `--offline` downloads nothing; the refusal names the flag the person gave.
    noDownloadFlag: values["no-download"] === true ? "--no-download" : "--offline",
  });

  const root = values.out ?? defaultScansDir();
  const json = scanJson(record);
  let folder: string;
  try {
    folder = makeScanFolder(root, record.target.origin, record.startedAt);
    // scan.json is the record every other file is made from, so it is always written.
    writeScanFile(folder, "scan.json", json);
    if (formats.has("md")) writeScanFile(folder, "report.md", renderReport(record));
  } catch (error) {
    refuseUnwritable(error, root);
  }

  // Under --json stdout holds the one document and everything for a person goes to stderr. Every line has
  // its terminal escapes and control characters stripped, since addresses in it are the page's to choose.
  const write = values.json ? console.error : console.log;
  const say = (line: string): void => write(printable(line));
  const found =
    record.summary.critical + record.summary.serious + record.summary.moderate + record.summary.minor;
  const page = record.pages[0];
  const missed = page?.notScanned[0];
  if (missed !== undefined) {
    // The reason is the scan's own words; the address is the one asked for.
    say(`${page?.url ?? url} was not scanned: ${missed.reason}.`);
  } else {
    say(
      found === 0
        ? emptyScanSentence(record)
        : `Found ${found} ${found === 1 ? "problem" : "problems"} on ${page?.url ?? url}, worst first: ` +
            `${record.summary.critical} critical, ${record.summary.serious} serious, ` +
            `${record.summary.moderate} moderate, ${record.summary.minor} minor.`,
    );
  }
  if (page?.requestedUrl !== undefined && page.url !== page.requestedUrl) {
    say(`It was redirected from ${page.requestedUrl} to ${page.url}.`);
  }
  const stopped = page?.stopped ?? [];
  if (stopped.length > 0) {
    const tried = stopped.map((entry) => {
      const [one, many, done] = STOPPED_WORDS[entry.kind];
      return `${entry.count} ${entry.count === 1 ? one : many} ${done}`;
    });
    say(`Stopped what the page tried: ${tried.join(", ")}. The report lists them.`);
  }
  if (found > 0 && missed === undefined && record.exit === 0) {
    say(`None is ${failOn} or worse, so the exit is 0 (--fail-on ${failOn}).`);
  }
  const review = record.summary.needsReview;
  if (review > 0) say(`${review} more ${review === 1 ? "needs" : "need"} a person to look.`);
  say(`Wrote ${folder}`);
  if (values.json) process.stdout.write(json);
  process.exitCode = record.exit;
}

async function main(args: string[]): Promise<void> {
  if (args[0] === "scan") return scan(args.slice(1));
  if (args[0] === "rules") return rulesCommand(args.slice(1), HELP_HINT);
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
  // A refusal or an error can quote what it was given or what the browser said: print it stripped too.
  if (error instanceof Refusal) {
    console.error(printable(`Error: ${error.message}`));
    console.error(printable(`Hint: ${error.hint}`));
    process.exitCode = EXIT.refusal;
  } else {
    const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
    console.error(printable(`Error: something unexpected went wrong: ${message}`));
    console.error("Hint: please report it at https://github.com/johnfrog76/a11y-genie/issues.");
    if (process.env.A11Y_GENIE_DEBUG) console.error(error);
    process.exitCode = EXIT.unexpected;
  }
}
