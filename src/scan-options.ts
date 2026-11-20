/** The values of `--timeout`, `--max-tabs` and `--storage-state`, checked before anything is scanned. */

import { readFileSync, statSync } from "node:fs";
import { printableLine } from "./printable.js";
import { Refusal } from "./refusal.js";
import { DEFAULT_MAX_TABS, MAX_MAX_TABS } from "./walk.js";

/** The longest `--timeout` taken, in seconds: an hour. A page that needs longer has something else wrong. */
export const MAX_TIMEOUT_SECONDS = 3600;

/** `--timeout <seconds>` as milliseconds. A whole or decimal number of seconds, above 0 and up to an hour. */
export function parseTimeout(text: string): number {
  const seconds = /^[0-9]+(\.[0-9]+)?$/.test(text) ? Number(text) : Number.NaN;
  if (!(seconds > 0) || seconds > MAX_TIMEOUT_SECONDS) {
    throw new Refusal(
      `--timeout takes a number of seconds above 0 and up to ${MAX_TIMEOUT_SECONDS}, not "${printableLine(text).slice(0, 40)}".`,
      "for example --timeout 30. The default is 60.",
    );
  }
  return Math.round(seconds * 1000);
}

/** `--max-tabs <n>`: a whole number of Tab presses from 1 to `MAX_MAX_TABS`, written in digits. */
export function parseMaxTabs(text: string): number {
  const tabs = /^[0-9]{1,5}$/.test(text) ? Number(text) : Number.NaN;
  if (!Number.isInteger(tabs) || tabs < 1 || tabs > MAX_MAX_TABS) {
    throw new Refusal(
      `--max-tabs takes a whole number of Tab presses from 1 to ${MAX_MAX_TABS}, not "${printableLine(text).slice(0, 40)}".`,
      `for example --max-tabs 500. The default is ${DEFAULT_MAX_TABS}.`,
    );
  }
  return tabs;
}

const MAX_STORAGE_STATE_BYTES = 10 * 1024 * 1024;

/**
 * Refuses a `--storage-state` that is not a readable file holding a Playwright storage state (a JSON object
 * with `cookies` and `origins` lists). Playwright reads it into each context; this tool never copies it, and
 * never prints what is in it.
 */
export function checkStorageState(path: string): void {
  const shown = printableLine(path).slice(0, 200);
  try {
    const stat = statSync(path);
    if (!stat.isFile() || stat.size > MAX_STORAGE_STATE_BYTES) {
      throw new Refusal(
        `--storage-state is not a file, or is over ${MAX_STORAGE_STATE_BYTES} bytes: ${shown}`,
        "give the path to a Playwright storage state file.",
      );
    }
    let state: unknown;
    try {
      state = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      state = undefined;
    }
    const holds = (key: string): boolean =>
      typeof state === "object" && state !== null && Array.isArray((state as Record<string, unknown>)[key]);
    if (!holds("cookies") || !holds("origins")) {
      throw new Refusal(
        `--storage-state is not a Playwright storage state: ${shown}`,
        "it is a JSON file with cookies and origins lists, as page.context().storageState() writes.",
      );
    }
  } catch (error) {
    if (error instanceof Refusal) throw error;
    const code = (error as NodeJS.ErrnoException).code ?? "unreadable";
    throw new Refusal(
      `--storage-state cannot be read: ${shown} (${code})`,
      "give the path to a Playwright storage state file.",
    );
  }
}
