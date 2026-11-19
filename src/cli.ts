#!/usr/bin/env node
import { readFileSync } from "node:fs";

const HELP = `A11y Genie: an accessibility scanner for agents and people.

It never says a site is "accessible" or "compliant". Automated checks find some problems, not all of them.

Usage:
  a11y-genie --version
  a11y-genie --help

Commands (coming, none works yet):
  scan       scan a page and report what is wrong, worst first
  check      scan again and say what is new and what is fixed
  narrate    describe a keyboard workflow step by step
  cards      turn findings into cards
  rules      list the checks
  checklist  the questions a scan cannot answer
  ignore     set a finding aside, with a reason and a date
  report     write a report again from a stored scan
  prompt     print the prompt file for a coding agent
`;

function version(): string {
  const url = new URL("../package.json", import.meta.url);
  return (JSON.parse(readFileSync(url, "utf8")) as { version: string }).version;
}

const args = process.argv.slice(2);

if (args.includes("--version")) {
  console.log(version());
} else if (args.length === 0 || args.includes("--help")) {
  process.stdout.write(HELP);
} else {
  console.error(`Error: unknown command or flag: ${args[0]}`);
  console.error("Hint: run a11y-genie --help to see what exists so far.");
  process.exitCode = 2;
}
