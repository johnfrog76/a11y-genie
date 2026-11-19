#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { BROWSER_CHANNELS, DEFAULT_CHANNEL, isBrowserChannel, withBrowser } from "./browser.js";
import { Refusal } from "./refusal.js";

const HELP = `A11y Genie: an accessibility scanner for agents and people.

It never says a site is "accessible" or "compliant". Automated checks find some problems, not all of them.

Usage:
  a11y-genie --version
  a11y-genie --help
  a11y-genie scan [--browser-channel chrome|msedge]

Flags:
  --browser-channel  which installed browser to launch: chrome (the default) or msedge

Commands:
  scan       so far it only launches the browser with a new, empty profile and closes it;
             it does not load or check a page yet

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

function version(): string {
  const url = new URL("../package.json", import.meta.url);
  return (JSON.parse(readFileSync(url, "utf8")) as { version: string }).version;
}

/** The `scan` stub: proves the browser launches, until a later change makes it load a page. */
async function scan(args: string[]): Promise<void> {
  let values: { "browser-channel"?: string | undefined };
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args,
      options: { "browser-channel": { type: "string" } },
      allowPositionals: true,
      strict: true,
    }));
  } catch (error) {
    throw new Refusal((error as Error).message, HELP_HINT);
  }
  if (positionals.length > 0) {
    throw new Refusal(`scan does not take a page yet: ${positionals[0]}`, HELP_HINT);
  }

  const channel = values["browser-channel"] ?? DEFAULT_CHANNEL;
  if (!isBrowserChannel(channel)) {
    throw new Refusal(`unknown --browser-channel: ${channel}`, `use one of: ${BROWSER_CHANNELS.join(", ")}.`);
  }

  const browserVersion = await withBrowser(channel, async (browser) => {
    const page = await browser.newPage();
    await page.goto("about:blank");
    return browser.version();
  });
  console.error(`Launched ${channel} ${browserVersion} with a new, empty profile, and closed it.`);
  console.error("Nothing was scanned: scan does not load pages yet.");
  // Exit 0 never stands for a page nobody saw: nothing scanned is exit 1, as a page that could not be scanned is.
  process.exitCode = 1;
}

async function main(args: string[]): Promise<void> {
  if (args[0] === "scan") return scan(args.slice(1));
  if (args.includes("--version")) {
    console.log(version());
  } else if (args.length === 0 || args.includes("--help")) {
    process.stdout.write(HELP);
  } else {
    throw new Refusal(`unknown command or flag: ${args[0]}`, HELP_HINT);
  }
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  if (error instanceof Refusal) {
    console.error(`Error: ${error.message}`);
    console.error(`Hint: ${error.hint}`);
    process.exitCode = 2;
  } else {
    const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
    console.error(`Error: something unexpected went wrong: ${message}`);
    console.error("Hint: please report it at https://github.com/johnfrog76/a11y-genie/issues.");
    if (process.env.A11Y_GENIE_DEBUG) console.error(error);
    process.exitCode = 3;
  }
}
