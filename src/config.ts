/**
 * The config file (spec 5.1): the pages to scan, their states, and the workflows `narrate` will run. YAML (the
 * subset src/yaml-subset.ts reads), validated whole before anything is scanned. An unknown key, a missing
 * key, a value of the wrong kind and a step that does not parse are each a refusal that names the file, the
 * line and the key. docs/CONFIG.md shows the file.
 *
 * It is data only: a list of steps, never a script. The steps are the grammar of src/steps.ts, one string per
 * step, parsed here and run by src/drive.ts.
 */

import { readFileSync, statSync } from "node:fs";
import { pageKeyOf } from "./map-axe.js";
import { printableLine } from "./printable.js";
import { Refusal } from "./refusal.js";
import { parseStateName, parseStep, type State, type Step } from "./steps.js";
import { parseYamlSubset, YamlError, type YamlEntry, type YamlNode } from "./yaml-subset.js";

/** The biggest config file read, in bytes. A page's steps are short; this is far above any real file. */
export const MAX_CONFIG_BYTES = 1024 * 1024;

export interface ConfigPage {
  /** The name in finding ids: the file's `key`, or the path read as `pageKeyOf` reads a URL. */
  key: string;
  /** The path, starting with `/`, beside the base address. */
  path: string;
  /** The line the page starts on, for refusals that come after the file is read. */
  line: number;
  /** The page's states beside `default`, in the file's order. */
  states: State[];
}

export interface ConfigWorkflow {
  name: string;
  /** A page `key` of this file. */
  page: string;
  steps: Step[];
  /** The line the workflow's steps start on, for refusals that come after the file is read. */
  line: number;
}

export interface Config {
  /** The file's `baseUrl`, or undefined when it has none (the address on the command line is used). */
  baseUrl: string | undefined;
  pages: ConfigPage[];
  workflows: ConfigWorkflow[];
}

const TOP_KEYS = ["baseUrl", "pages", "workflows"];
const PAGE_KEYS = ["key", "path", "states"];
const STATE_KEYS = ["name", "steps"];
const WORKFLOW_KEYS = ["name", "page", "steps"];

/** A page key in the file: letters, digits, `.`, `_`, `-` and `/`, starting with a letter or a digit. */
const PAGE_KEY = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;

const SHAPE_HINT =
  "see docs/CONFIG.md for the config file: baseUrl, pages (key, path, states) and workflows.";

class Reading {
  constructor(private readonly file: string) {}

  /** A refusal naming the file, the line and what is wrong. */
  refuse(line: number, problem: string, hint = SHAPE_HINT): never {
    throw new Refusal(`${this.file}, line ${line}: ${printableLine(problem)}`, hint);
  }

  /** What a step's refusal calls its source: the file and the line. */
  source(line: number): string {
    return `${this.file} line ${line}`;
  }

  mapping(node: YamlNode, where: string, allowed: readonly string[]): Map<string, YamlEntry> {
    if (node.kind !== "mapping") this.refuse(node.line, `${where} must be a set of "key: value" lines.`);
    const found = new Map<string, YamlEntry>();
    for (const entry of node.entries) {
      if (!allowed.includes(entry.key)) {
        this.refuse(
          entry.line,
          `unknown key "${entry.key}" in ${where}; the keys it takes are ${allowed.join(", ")}.`,
        );
      }
      found.set(entry.key, entry);
    }
    return found;
  }

  text(entry: YamlEntry, where: string): string {
    if (entry.value.kind !== "string" || entry.value.value === "") {
      this.refuse(entry.line, `"${entry.key}" in ${where} must be text.`);
    }
    return entry.value.value;
  }

  required(found: Map<string, YamlEntry>, key: string, where: string, line: number): YamlEntry {
    const entry = found.get(key);
    if (entry === undefined) this.refuse(line, `${where} needs a "${key}".`);
    return entry;
  }

  list(entry: YamlEntry, where: string): YamlNode[] {
    if (entry.value.kind !== "sequence" || entry.value.items.length === 0) {
      this.refuse(entry.line, `"${entry.key}" in ${where} must be a list with at least one item.`);
    }
    return entry.value.items;
  }

  steps(entry: YamlEntry, where: string, use: "state" | "flow"): Step[] {
    return this.list(entry, where).map((item) => {
      if (item.kind !== "string" || item.value === "") {
        this.refuse(item.line, `each step in ${where} must be one string, such as "click button 'Menu'".`);
      }
      return parseStep(item.value, { source: this.source(item.line), use });
    });
  }
}

/** Reads and checks the config text; `file` is how its refusals name it. */
export function parseConfig(source: string, file: string): Config {
  const read = new Reading(printableLine(file));
  let root: YamlNode;
  try {
    root = parseYamlSubset(source);
  } catch (error) {
    if (error instanceof YamlError) return read.refuse(error.line, error.problem, error.hint);
    throw error;
  }
  if (root.kind === "null") read.refuse(1, "the file is empty.");
  const top = read.mapping(root, "the file", TOP_KEYS);

  let baseUrl: string | undefined;
  const base = top.get("baseUrl");
  if (base !== undefined) {
    baseUrl = read.text(base, "the file");
    let protocol: string;
    try {
      protocol = new URL(baseUrl).protocol;
    } catch {
      return read.refuse(
        base.line,
        `"baseUrl" is not a web address: ${JSON.stringify(baseUrl.slice(0, 80))}.`,
      );
    }
    if (protocol !== "http:" && protocol !== "https:") {
      read.refuse(base.line, `"baseUrl" must start with http:// or https://, and this one is ${protocol}`);
    }
  }

  const pagesEntry = read.required(top, "pages", "the file", root.line);
  const keys = new Set<string>();
  const pages = read.list(pagesEntry, "the file").map((node): ConfigPage => {
    const found = read.mapping(node, "a page", PAGE_KEYS);
    const path = read.text(read.required(found, "path", "a page", node.line), "a page");
    if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) {
      read.refuse(
        found.get("path")?.line ?? node.line,
        `"path" must start with a single "/", such as /settings: a page is on the base address's own site.`,
      );
    }
    const keyEntry = found.get("key");
    const key =
      keyEntry === undefined
        ? pageKeyOf(new URL(path, "http://localhost").href)
        : read.text(keyEntry, "a page");
    if (keyEntry !== undefined && !PAGE_KEY.test(key)) {
      read.refuse(
        keyEntry?.line ?? node.line,
        `"${key.slice(0, 40)}" is not a page key: letters, digits, ".", "_", "-" and "/", up to 100 characters.`,
      );
    }
    if (keys.has(key)) {
      read.refuse(
        keyEntry?.line ?? node.line,
        `the page key "${key}" is used twice; give one of them a "key".`,
      );
    }
    keys.add(key);

    const names = new Set<string>();
    const statesEntry = found.get("states");
    const states =
      statesEntry === undefined
        ? []
        : read.list(statesEntry, "a page").map((item): State => {
            const state = read.mapping(item, "a state", STATE_KEYS);
            const nameEntry = read.required(state, "name", "a state", item.line);
            const name = parseStateName(read.text(nameEntry, "a state"), read.source(nameEntry.line));
            if (names.has(name))
              read.refuse(nameEntry.line, `the state "${name}" is given twice on this page.`);
            names.add(name);
            const steps = read.steps(read.required(state, "steps", "a state", item.line), "a state", "state");
            return { name, steps };
          });
    return { key, path, line: node.line, states };
  });

  const workflows: ConfigWorkflow[] = [];
  const workflowsEntry = top.get("workflows");
  if (workflowsEntry !== undefined) {
    const names = new Set<string>();
    for (const node of read.list(workflowsEntry, "the file")) {
      const found = read.mapping(node, "a workflow", WORKFLOW_KEYS);
      const nameEntry = read.required(found, "name", "a workflow", node.line);
      const name = read.text(nameEntry, "a workflow");
      if (names.has(name)) read.refuse(nameEntry.line, `the workflow "${name.slice(0, 40)}" is given twice.`);
      names.add(name);
      const pageEntry = read.required(found, "page", "a workflow", node.line);
      const page = read.text(pageEntry, "a workflow");
      if (!keys.has(page)) {
        read.refuse(
          pageEntry.line,
          `the workflow's page "${page.slice(0, 40)}" is not a page key in this file.`,
        );
      }
      const stepsEntry = read.required(found, "steps", "a workflow", node.line);
      const steps = read.steps(stepsEntry, "a workflow", "flow");
      workflows.push({ name, page, steps, line: stepsEntry.line });
    }
  }
  return { baseUrl, pages, workflows };
}

/** Reads the config file at `path`. A file that cannot be read, or is not a plain file, is a refusal. */
export function readConfigFile(path: string): Config {
  const shown = printableLine(path);
  let text: string;
  try {
    const stat = statSync(path);
    if (!stat.isFile())
      throw new Refusal(`--config is not a file: ${shown}`, "give the path to a YAML file.");
    if (stat.size > MAX_CONFIG_BYTES) {
      throw new Refusal(
        `--config is larger than ${MAX_CONFIG_BYTES} bytes: ${shown}`,
        "a config file lists pages and steps; this is not one.",
      );
    }
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (error instanceof Refusal) throw error;
    const code = (error as NodeJS.ErrnoException).code ?? "unreadable";
    throw new Refusal(
      `--config cannot be read: ${shown} (${code})`,
      "give the path to a YAML file you may read.",
    );
  }
  return parseConfig(text, path);
}
