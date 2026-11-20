import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { CHECK_FLAGS } from "../../src/check-command.js";
import { NARRATE_FLAGS } from "../../src/narrate-command.js";
import { rulesCommand } from "../../src/rules-command.js";
import { SCAN_FLAGS } from "../../src/scan-command.js";

// docs/CLI.md is held to the parser: the flag tables the commands hand to `parseArgs` are the source of truth,
// and the doc's flag table says, in its last column, which commands take each flag. No browser runs here.

const doc = readFileSync(new URL("../../docs/CLI.md", import.meta.url), "utf8");

/** The flags `rules` takes. Its parser is inline in `rulesCommand`, so the first test holds this list to it. */
const RULES_FLAGS = ["tags", "json"];

/** Every command that works today, with the flags its parser accepts. `prompt` takes none. */
const COMMANDS: Record<string, string[]> = {
  scan: Object.keys(SCAN_FLAGS),
  check: Object.keys(CHECK_FLAGS),
  narrate: Object.keys(NARRATE_FLAGS),
  rules: RULES_FLAGS,
  prompt: [],
};

/** Flags that belong to no command: `--help` and `--version` are read by `src/cli.ts` itself. */
const GLOBAL_FLAGS = ["help", "version"];

/** The flag table of the doc: one entry for each row, with the commands its last column names. */
function documentedFlags(): Map<string, string[]> {
  const rows = new Map<string, string[]>();
  for (const line of doc.split("\n")) {
    const match = /^\| `--([a-z-]+)[^`]*` \|/.exec(line);
    if (match === null) continue;
    const cells = line.split(" | ");
    const last = (cells[cells.length - 1] ?? "").replace(/\s*\|\s*$/, "");
    rows.set(
      match[1] ?? "",
      last.split(",").map((c) => c.trim()),
    );
  }
  return rows;
}

/** Every `--flag` the doc names anywhere, in prose, examples and tables. */
function namedFlags(): Set<string> {
  return new Set([...doc.matchAll(/(?<![\w-])--([a-z][a-z-]*)/g)].map((m) => m[1] ?? ""));
}

describe("docs/CLI.md", () => {
  it("the list of rules' flags is the one its parser takes", async () => {
    const written = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      for (const flag of RULES_FLAGS) {
        const args = flag === "tags" ? ["--tags", "wcag2a"] : [`--${flag}`];
        expect(() => rulesCommand(args, "hint"), flag).not.toThrow();
      }
      expect(() => rulesCommand(["--not-a-flag"], "hint")).toThrow(/Unknown option/);
    } finally {
      written.mockRestore();
    }
  });

  it("has a section for every command", () => {
    for (const command of Object.keys(COMMANDS)) {
      expect(doc, command).toMatch(new RegExp(`^### \`${command}\`$`, "m"));
    }
  });

  it("has a row for every flag, naming each command that takes it", () => {
    const rows = documentedFlags();
    const expected = new Map<string, string[]>();
    for (const [command, flags] of Object.entries(COMMANDS)) {
      for (const flag of flags) expected.set(flag, [...(expected.get(flag) ?? []), command]);
    }
    for (const [flag, commands] of expected) {
      expect(rows.get(flag), `--${flag} has no row in the flag table`).toBeDefined();
      expect([...(rows.get(flag) ?? [])].sort(), `the commands of --${flag}`).toEqual([...commands].sort());
    }
  });

  it("has no row for a flag that no command takes", () => {
    const real = new Set(Object.values(COMMANDS).flat());
    for (const flag of documentedFlags().keys()) expect(real.has(flag), `--${flag} is not a flag`).toBe(true);
  });

  it("names no --flag that no command takes, anywhere", () => {
    const real = new Set([...Object.values(COMMANDS).flat(), ...GLOBAL_FLAGS]);
    for (const flag of namedFlags()) expect(real.has(flag), `--${flag} is not a flag`).toBe(true);
  });

  it("names --help and --version", () => {
    for (const flag of GLOBAL_FLAGS) expect(namedFlags().has(flag), `--${flag}`).toBe(true);
  });

  it("does not document a command that does not work yet", () => {
    for (const coming of ["cards", "checklist", "ignore", "report"]) {
      expect(doc, coming).not.toMatch(new RegExp(`^### \`${coming}\``, "m"));
    }
  });
});
