import type { BrowserContext } from "playwright-core";
import { scanPage } from "./axe.js";
import type { BrowserChannel } from "./browser.js";
import { withChosenBrowser, type BrowserChoiceDeps } from "./browser-choice.js";
import { pageKeyOf } from "./map-axe.js";
import { packageInfo } from "./package-info.js";
import { Refusal } from "./refusal.js";
import { buildScanRecord, type ScanRecord } from "./scan-record.js";

/** How long the first page may take to answer before the scan refuses, in milliseconds. */
export const NAVIGATION_TIMEOUT_MS = 30_000;

/**
 * For tests only: a shorter navigation timeout, in milliseconds, so the no-answer refusal can be reached
 * without a 30 second wait. It is read only when it is a positive whole number.
 */
export const TEST_NAVIGATION_TIMEOUT_ENV = "A11Y_GENIE_TEST_NAV_TIMEOUT_MS";

function navigationTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const value = Number(env[TEST_NAVIGATION_TIMEOUT_ENV]);
  return Number.isInteger(value) && value > 0 ? value : NAVIGATION_TIMEOUT_MS;
}

/**
 * The refusal for a page that did not answer, or null when the error is something else. The browser's words
 * (checked at playwright-core 1.65.1): a `TimeoutError` when nothing came back in time, and
 * `net::ERR_<NAME>` for a failed connection: `ERR_CONNECTION_REFUSED`, `ERR_NAME_NOT_RESOLVED` and the rest.
 */
export function noAnswerRefusal(error: unknown, url: string, timeoutMs: number): Refusal | null {
  if (!(error instanceof Error)) return null;
  const code = /net::(ERR_[A-Z0-9_]+)/.exec(error.message)?.[1];
  const reasons: Record<string, string> = {
    ERR_CONNECTION_REFUSED: "the connection was refused",
    ERR_NAME_NOT_RESOLVED: "the host name was not found",
  };
  let reason: string;
  if (error.name === "TimeoutError") reason = `no answer within ${timeoutMs / 1000} seconds`;
  else if (code !== undefined) reason = reasons[code] ?? `the browser reported ${code}`;
  else return null;
  return new Refusal(
    `${new URL(url).origin} did not answer: ${reason}.`,
    "check the address, and that the server is running.",
  );
}

export interface RunScanOptions {
  url: string;
  channel: BrowserChannel;
  /**
   * Whether `--browser-channel` named the channel. Unless it is `false`, a missing browser is refused and
   * nothing falls back: only the command's default Chrome falls back to Playwright's Chromium.
   */
  named?: boolean;
  /** Whether Playwright's Chromium may be downloaded when it is needed. Default false: only the command opts in. */
  download?: boolean;
  /** For tests: stand-ins for the launch and the download. */
  browserDeps?: Partial<BrowserChoiceDeps>;
  /** Called with the new browser context before the page loads. Tests use it to install the no-network guard. */
  onContext?: (context: BrowserContext) => Promise<void>;
}

/** The time as `2026-11-19T20:14:03Z`: ISO 8601, to the second, in UTC. */
function stamp(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Loads one URL in a new context of a browser with a new, empty profile, scans it, and returns the record. */
export async function runScan(options: RunScanOptions): Promise<ScanRecord> {
  const startedAt = stamp();
  const choice = {
    channel: options.channel,
    named: options.named ?? true,
    download: options.download ?? false,
    deps: options.browserDeps,
  };
  return withChosenBrowser(choice, async (browser, used) => {
    const context = await browser.newContext();
    await options.onContext?.(context);
    const tab = await context.newPage();
    const timeout = navigationTimeoutMs();
    try {
      await tab.goto(options.url, { timeout });
    } catch (error) {
      throw noAnswerRefusal(error, options.url, timeout) ?? error;
    }
    const axe = await scanPage(tab);
    return buildScanRecord({
      tool: packageInfo(),
      browser: `${used.channel} ${browser.version()}`,
      fallback: used.fallback,
      url: tab.url(),
      pageKey: pageKeyOf(tab.url()),
      startedAt,
      finishedAt: stamp(),
      axe,
    });
  });
}
