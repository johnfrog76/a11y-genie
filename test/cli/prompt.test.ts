import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// Runs the built command (npm test builds first), as a person would. `prompt` needs no browser or network.
const cli = new URL("../../dist/cli.js", import.meta.url).pathname;
const promptBytes = readFileSync(new URL("../../agentic/fix-loop.prompt.md", import.meta.url));
const prompt = promptBytes.toString("utf8");
const schema = JSON.parse(
  readFileSync(new URL("../../schema/scan-1.json", import.meta.url), "utf8"),
) as Schema;

function run(args: string[], cwd?: string): { status: number | null; stdout: Buffer; stderr: string } {
  const r = spawnSync(process.execPath, [cli, ...args], { cwd });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr.toString("utf8") };
}

/** The part of `--help` that describes what works today: everything above the commands still coming. */
function helpOfWhatExists(): string {
  const help = run(["--help"]).stdout.toString("utf8");
  const coming = help.indexOf("Commands (coming");
  expect(coming).toBeGreaterThan(0);
  return help.slice(0, coming);
}

interface Schema {
  type?: string;
  properties?: Record<string, Schema>;
  items?: Schema;
  oneOf?: Schema[];
  $ref?: string;
  $defs?: Record<string, Schema>;
}

/** Resolves a field path such as `findings[].elements[].selector` in the JSON Schema, or says where it fails. */
function resolve(path: string): Schema | string {
  const deref = (s: Schema): Schema => {
    if (s.$ref === undefined) return s;
    const name = s.$ref.replace("#/$defs/", "");
    const target = schema.$defs?.[name];
    if (target === undefined) throw new Error(`no $defs/${name}`);
    return deref(target);
  };
  const child = (s: Schema, key: string): Schema | undefined => {
    const here = deref(s);
    const direct = here.properties?.[key];
    if (direct !== undefined) return direct;
    for (const branch of here.oneOf ?? []) {
      const found = child(branch, key);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  let node: Schema = schema;
  for (const part of path.split(".")) {
    const isArray = part.endsWith("[]");
    const key = isArray ? part.slice(0, -2) : part;
    const next = child(node, key);
    if (next === undefined) return `${path}: no "${key}"`;
    node = deref(next);
    if (isArray) {
      if (node.items === undefined) return `${path}: "${key}" is not an array`;
      node = deref(node.items);
    }
  }
  return node;
}

/** Every inline code span of the prompt: the text between single backticks, fenced blocks left out. */
function inlineCode(text: string): string[] {
  const withoutFences = text.replace(/^```[^]*?^```/gm, "");
  return [...withoutFences.matchAll(/`([^`\n]+)`/g)].map((m) => m[1] ?? "");
}

/** The inline code spans that read as a field of `scan.json`: a dotted path or one with `[]`, not a file name. */
function fieldPaths(): string[] {
  const spans = inlineCode(prompt).flatMap((span) => span.split(/,\s*/));
  return [
    ...new Set(
      spans.filter(
        (s) =>
          /^[a-z][A-Za-z0-9]*(\[\])?(\.[a-z][A-Za-z0-9]*(\[\])?)*$/.test(s) &&
          (s.includes(".") || s.includes("[]")) &&
          !/\.(json|md|ya?ml|ts|js)$/.test(s),
      ),
    ),
  ];
}

describe("a11y-genie prompt", () => {
  const temps: string[] = [];
  afterAll(() => {
    for (const t of temps) rmSync(t, { recursive: true, force: true });
  });

  it("prints agentic/fix-loop.prompt.md byte for byte, and exits 0", () => {
    const { status, stdout, stderr } = run(["prompt"]);
    expect(status).toBe(0);
    expect(stderr).toBe("");
    expect(Buffer.compare(stdout, promptBytes)).toBe(0);
  });

  it("reads the file from the package, not from the working directory", () => {
    const cwd = mkdtempSync(join(tmpdir(), "a11y-genie-prompt-"));
    temps.push(cwd);
    mkdirSync(join(cwd, "agentic"));
    writeFileSync(join(cwd, "agentic", "fix-loop.prompt.md"), "not the package's prompt\n");
    const { status, stdout } = run(["prompt"], cwd);
    expect(status).toBe(0);
    expect(Buffer.compare(stdout, promptBytes)).toBe(0);
  });

  it("refuses an argument, with one Error: line and one Hint: line", () => {
    const { status, stdout, stderr } = run(["prompt", "extra"]);
    expect(status).toBe(2);
    expect(stdout.length).toBe(0);
    expect(stderr).toBe(
      'Error: prompt takes no argument, and got: "extra"\nHint: run a11y-genie --help to see what exists so far.\n',
    );
  });

  it("is listed in --help as a command that works", () => {
    const help = helpOfWhatExists();
    expect(help).toMatch(/^ {2}a11y-genie prompt$/m);
    expect(help).toMatch(/^ {2}prompt {5}/m);
  });
});

describe("the prompt file", () => {
  it("names every stop of the table", () => {
    for (const stop of ["Clean", "Budget spent", "Stuck", "Regression", "Blocked", "Refused"]) {
      expect(prompt).toContain(`| **${stop}** |`);
    }
  });

  it("shows every output line", () => {
    for (const line of ["FIXED ", "OPEN  ", "STUCK ", "NEW   ", "BLOCKED "]) {
      expect(prompt).toMatch(new RegExp(`^${line}\\S`, "m"));
    }
  });

  it("holds the decided budget: 6 rounds, and stuck after 2", () => {
    expect(prompt).toContain("6 rounds");
    expect(prompt).toContain("after 2 rounds");
  });

  it("names only flags that --help lists", () => {
    const help = helpOfWhatExists();
    const flags = [...new Set([...prompt.matchAll(/(?<![\w-])--[a-z][a-z-]*/g)].map((m) => m[0]))];
    expect(flags).toContain("--baseline");
    expect(flags).toContain("--json");
    for (const flag of flags) expect(help, flag).toMatch(new RegExp(`(?<![\\w-])${flag}(?![\\w-])`));
  });

  it("names only commands that --help lists as working", () => {
    const help = helpOfWhatExists();
    const commands = [...new Set([...prompt.matchAll(/\ba11y-genie\s+([a-z]+)/g)].map((m) => m[1] ?? ""))];
    expect(commands).toEqual(expect.arrayContaining(["scan", "check", "prompt"]));
    for (const command of commands)
      expect(help, command).toMatch(new RegExp(`^ {2}a11y-genie ${command}\\b`, "m"));
  });

  it("names only fields that schema/scan-1.json has", () => {
    const paths = fieldPaths();
    for (const path of [
      "summary.notScanned",
      "pages[].notScanned",
      "findings[].id",
      "findings[].rule.id",
      "findings[].impact",
      "findings[].fix",
      "findings[].status",
      "findings[].unverified",
      "findings[].elements[].selector",
      "findings[].elements[].html",
    ]) {
      expect(paths).toContain(path);
    }
    for (const path of paths) expect(resolve(path), path).toBeTypeOf("object");
  });

  it("names only statuses the schema has, and every one of them", () => {
    const statuses = (schema.$defs?.["status"] as { enum: string[] }).enum;
    expect(statuses).toEqual(["new", "still", "fixed"]);
    for (const status of statuses) expect(inlineCode(prompt)).toContain(status);
  });

  it("the field-path check would catch a field the schema does not have", () => {
    expect(resolve("findings[].elements[].selector")).toBeTypeOf("object");
    expect(resolve("findings[].nope")).toBe('findings[].nope: no "nope"');
    expect(resolve("summary[].new")).toBe('summary[].new: "summary" is not an array');
  });
});
