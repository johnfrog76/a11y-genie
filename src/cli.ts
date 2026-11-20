#!/usr/bin/env node
import { checkCommand } from "./check-command.js";
import { packageInfo } from "./package-info.js";
import { EXIT } from "./exit-codes.js";
import { installInterruptHandler } from "./interrupt.js";
import { printable } from "./printable.js";
import { usePrivateTemp } from "./private-temp.js";
import { narrateCommand } from "./narrate-command.js";
import { promptCommand } from "./prompt-command.js";
import { Refusal } from "./refusal.js";
import { rulesCommand } from "./rules-command.js";
import { scanCommand } from "./scan-command.js";

const HELP = `A11y Genie: an accessibility scanner for agents and people.

It never says a site is "accessible" or "compliant". Automated checks find some problems, not all of them.

Usage:
  a11y-genie --version
  a11y-genie --help
  a11y-genie rules [--tags <list>] [--json]
  a11y-genie prompt
  a11y-genie scan <url> [--states "<name>: <steps>"]... [--json] [--out <folder>] [--format md,json,html]
                  [--browser-channel chrome|msedge|chromium] [--no-download] [--allow-private]
                  [--tags <list>] [--fail-on <impact>] [--same-origin] [--offline]
                  [--timeout <seconds>] [--max-tabs <n>] [--storage-state <file>] [--commit <sha>]
  a11y-genie scan [<url>] --config <file> [the same flags, but not --states]
  a11y-genie narrate <url> --flow "<steps>" [--json] [--out <folder>] [--format md,json,html]
                  [--browser-channel chrome|msedge|chromium] [--no-download] [--allow-private]
                  [--fail-on <impact>] [--same-origin] [--offline] [--timeout <seconds>]
                  [--max-tabs <n>] [--storage-state <file>] [--commit <sha>]
  a11y-genie check --baseline <scan> [<url>] [scan's flags]

Flags:
  --states           a state of the page beside the default one, as "<name>: <steps>" (steps are
                     separated by ";"): --states "menu-open: click button 'Menu'; wait menu"
                     Repeat the flag for more states. Each state is scanned from a fresh load
  --config <file>    scan the pages and states a YAML file lists, and narrate its workflows
                     (docs/CONFIG.md); the address is optional when the file has a baseUrl, and one given
                     here takes its place
  --flow "<steps>"   narrate only: the keys to press, separated by ";" (docs/STEPS.md):
                     --flow "Tab; Tab; Enter". A step may also be "Tab to button 'Save'" or "click ..."
  --timeout          seconds one page in one state may take, from its first request to the end of
                     its scan; default 60. Past it, that state reads "not scanned"
  --max-tabs <n>     the most Tab presses in the keyboard walk of each state, and in a "Tab to" step;
                     default 200, up to 1000. A walk that reaches it is recorded as cut
  --storage-state    a Playwright storage state file, for signed-in pages. It is read and never
                     copied into the scan
  --json             print scan.json on stdout; everything else goes to stderr
  --out <folder>     where the scan folder goes; default is the per-user scans folder
  --format           which files to write, comma-separated: md (report.md), json (scan.json alone)
                     and html (report.html, one file that opens from disk); default md,json,html.
                     scan.json is always written
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
  --commit <sha>     the commit the scan is of, recorded in scan.json; default GITHUB_SHA when it is set
  --baseline <scan>  check only: the scan.json to compare with, or the scan folder it is in

With no Chrome, and no --browser-channel, A11y Genie says so and downloads Playwright's Chromium once.

Commands:
  scan       load each page, in each state, in a browser with a new, empty profile, run axe-core on
             it, and write scan.json, report.md and report.html. Exit 0: no findings. Exit 1:
             findings, or a page or state could not be scanned (the scan says why). When the site
             was scanned before, the first line says what is new and what is fixed since then, or why
             the two cannot be compared; the exit reads only this scan.

  check      scan as scan does, with the same flags, and compare with --baseline by finding id and
             element: each finding is new, still open or fixed, and the first line counts them:
             "2 fixed, 0 new, 3 still open (worst: serious, color-contrast on settings)". Exit 0: no new
             violation at or above --fail-on (findings still open from the baseline do not fail it).
             Exit 1: a new one, or a page or state not scanned, whose findings read still open and
             unverified, never fixed. A baseline of another site, or of other pages, states or --tags,
             is refused (exit 2).

  narrate    load the page in a browser with a new, empty profile, press the keys of --flow one at a time,
             and after each say what a screen reader would: the focused element's name, then its role and
             state, read from the browser's accessibility tree. After Enter, Space or a click it also says
             where focus went, the name of a dialog that opened, and text added to a live region. The
             transcript is printed, and written to narration/flow.txt in the scan folder beside scan.json
             (a config's workflows each get narration/<name>.txt on scan --config). A step that leaves
             focus on a control with no name is genie/unnamed-step (serious, WCAG 4.1.2). Exit 0: none.
             Exit 1: one, or a flow that stopped early (the transcript says why). Exit 2: a refusal.

  rules      list every rule A11y Genie runs: axe-core's, at the version it pins, and its own genie/ rules,
             with impact, WCAG criteria and tags. --tags <list> keeps the rules with one of those tags;
             --json prints them as one JSON document (docs/JSON.md). It needs no browser and no network.
             Exit 0.

  prompt     print the prompt file for a coding agent: how to run scan, fix, rescan on a project it can
             edit, and when to stop. It needs no browser and no network. Exit 0.

Exit codes: 0 no findings (for check, no new ones), 1 findings (for check, new ones) or not scanned,
2 a refusal (one Error: line and one Hint: line, nothing written), 3 something unexpected, 130 Ctrl-C.

Commands (coming, none works yet):
  cards      turn findings into cards
  checklist  the questions a scan cannot answer
  ignore     set a finding aside, with a reason and a date
  report     write a report again from a stored scan
`;

const HELP_HINT = "run a11y-genie --help to see what exists so far.";

async function main(args: string[]): Promise<void> {
  // `--version` anywhere on the line wins, before any command reads its arguments (docs/EXIT-CODES.md).
  if (args.includes("--version")) {
    console.log(packageInfo().version);
    return;
  }
  if (args[0] === "scan") return scanCommand(args.slice(1), HELP_HINT);
  if (args[0] === "check") return checkCommand(args.slice(1), HELP_HINT);
  if (args[0] === "narrate") return narrateCommand(args.slice(1), HELP_HINT);
  if (args[0] === "rules") return rulesCommand(args.slice(1), HELP_HINT);
  if (args[0] === "prompt") return promptCommand(args.slice(1), HELP_HINT);
  if (args.length === 0 || args.includes("--help")) {
    process.stdout.write(HELP);
  } else {
    throw new Refusal(`unknown command or flag: ${args[0]}`, HELP_HINT);
  }
}

usePrivateTemp();
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
