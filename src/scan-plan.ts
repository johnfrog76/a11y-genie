/**
 * What a run scans: the pages, and the states of each, from the command line's `--states` flags or from the
 * `--config` file (spec 4.1, 5.1). Every refusal here comes before a browser is opened.
 */

import { readConfigFile } from "./config.js";
import { Refusal } from "./refusal.js";
import { parseState, type State } from "./steps.js";
import type { PageSpec } from "./run-scan.js";

export interface PlanInput {
  /** The address on the command line, if one was given. */
  url: string | undefined;
  /** Every `--states` value, in the order given. */
  states: readonly string[];
  /** `--config`: the config file's path. */
  config: string | undefined;
}

export interface ScanPlan {
  /** The address the run is about: the first page's. */
  url: string;
  pages: PageSpec[];
}

/** Each `--states` value parsed, with a name given twice refused. */
export function parseStateFlags(values: readonly string[]): State[] {
  const states: State[] = [];
  for (const value of values) {
    const state = parseState(value);
    if (states.some((known) => known.name === state.name)) {
      throw new Refusal(
        `--states gives the state "${state.name}" twice.`,
        "each --states names one state, and no two may share a name: rename one, or join their steps into one state.",
      );
    }
    states.push(state);
  }
  return states;
}

/** The pages and states to scan. An address that is not `http:` or `https:` is the caller's to refuse first. */
export function planScan(input: PlanInput): ScanPlan {
  if (input.config === undefined) {
    if (input.url === undefined) {
      throw new Refusal("scan needs a page address to scan.", "run: a11y-genie scan <url>");
    }
    return { url: input.url, pages: [{ url: input.url, states: parseStateFlags(input.states) }] };
  }
  if (input.states.length > 0) {
    throw new Refusal(
      "--states and --config cannot be used together.",
      "put the states under their pages in the config file, or drop --config.",
    );
  }
  const config = readConfigFile(input.config);
  const base = input.url ?? config.baseUrl;
  if (base === undefined) {
    throw new Refusal(
      "scan --config needs a base address: the file has no baseUrl, and none was given.",
      "add baseUrl: http://localhost:5173 to the file, or run: a11y-genie scan <url> --config <file>",
    );
  }
  const origin = new URL(base).origin;
  const pages = config.pages.map((page): PageSpec => {
    const url = new URL(page.path, origin);
    if (url.origin !== origin) {
      throw new Refusal(
        `${input.config}, line ${page.line}: the path "${page.path.slice(0, 80)}" is not on ${origin}.`,
        "a page's path is beside the base address, on its own site.",
      );
    }
    return { url: url.href, key: page.key, states: page.states };
  });
  const first = pages[0] as PageSpec;
  return { url: first.url, pages };
}
