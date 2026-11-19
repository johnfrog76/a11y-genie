import { createRequire } from "node:module";
import type { BrowserContext, Page } from "playwright-core";
import { scanPage } from "./axe.js";
import type { BrowserChannel } from "./browser.js";
import { withChosenBrowser, type BrowserChoiceDeps } from "./browser-choice.js";
import {
  armContext,
  CONTEXT_OPTIONS,
  isAllowedScheme,
  LIMITS,
  redirectsOf,
  type ContextGuard,
  type Limits,
} from "./context.js";
import type { AxeScan } from "./finding.js";
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
 * The errors that mean the page did answer, and then went somewhere it may not, are not refusals: see
 * `answeredButNotScanned`.
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

/**
 * The browser's errors for a page that answered and then went where it may not (checked at playwright-core
 * 1.65.1 and Chrome 158), with what the scan says about each. These read *not scanned*, not a refusal.
 */
const ANSWERED_BUT_STOPPED: Record<string, string> = {
  ERR_UNSAFE_REDIRECT:
    "it redirected to an address that is not http: or https: (such as file:, chrome: or data:), and the browser stopped it",
  ERR_INVALID_REDIRECT: "it redirected to an address that is not valid, and the browser stopped it",
  ERR_UNKNOWN_URL_SCHEME: "it went to an address that is not http: or https:, and the browser stopped it",
  ERR_DISALLOWED_URL_SCHEME: "it went to an address that is not http: or https:, and the browser stopped it",
  ERR_TOO_MANY_REDIRECTS: "it redirected more times than the browser follows",
  ERR_ABORTED:
    "the browser stopped loading it (net::ERR_ABORTED), as it does for a redirect to javascript: or an empty answer",
};

/** Playwright's words when the page asked for answers with a file to download (playwright-core 1.65.1). */
const DOWNLOAD_STARTED = /Download is starting/;

/**
 * Why a page that answered reads *not scanned*, from the error its load ended with, or undefined when the
 * error is not one of these.
 */
export function answeredButNotScanned(
  error: unknown,
  guard: Pick<ContextGuard, "redirectCapReached">,
  limits: Limits,
): string | undefined {
  if (guard.redirectCapReached) {
    return `it redirected more than ${limits.redirects} times, so the scan stopped following it`;
  }
  if (!(error instanceof Error)) return undefined;
  if (DOWNLOAD_STARTED.test(error.message)) {
    return "it answered with a file to download, and downloads are refused";
  }
  const code = /net::(ERR_[A-Z0-9_]+)/.exec(error.message)?.[1];
  return code === undefined ? undefined : ANSWERED_BUT_STOPPED[code];
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
  /** Called with the page once it has loaded, before axe-core runs. Tests use it to look at the page. */
  onLoaded?: (page: Page) => Promise<void>;
  /** The limits the page is held to (src/context.ts). Tests shorten them; `--timeout` will set `pageMs`. */
  limits?: Partial<Limits>;
}

/** The time as `2026-11-19T20:14:03Z`: ISO 8601, to the second, in UTC. */
function stamp(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** The installed axe-core's version, for a record whose page was never scanned. */
function installedAxeVersion(): string {
  const require = createRequire(import.meta.url);
  return (require("axe-core/package.json") as { version: string }).version;
}

const TIMED_OUT = Symbol("timed out");

/** `work`, or `TIMED_OUT` if it has not settled within `ms`. A late failure of `work` is ignored. */
async function within<T>(work: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  work.catch(() => undefined);
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

type Loaded =
  | { scanned: true; axe: AxeScan; url: string; redirects: number }
  | { scanned: false; reason: string; url: string; redirects: number };

/**
 * Loads the page and runs axe-core on it, inside the page time limit. A page that does not answer is a
 * refusal (thrown); a page that answers and then breaks a rule of src/context.ts reads *not scanned*.
 */
async function loadAndScan(
  tab: Page,
  guard: ContextGuard,
  options: RunScanOptions,
  limits: Limits,
): Promise<Loaded> {
  const requested = options.url;
  const deadline = Date.now() + limits.pageMs;
  const left = () => Math.max(1, deadline - Date.now());
  const seconds = limits.pageMs / 1000;
  const notScanned = (reason: string, redirects = 0): Loaded => ({
    scanned: false,
    reason,
    url: requested,
    redirects,
  });

  // Wait for the answer only; the load itself is held to the page time limit below.
  const timeout = Math.min(navigationTimeoutMs(), left());
  let redirects: number;
  try {
    const response = await tab.goto(requested, { timeout, waitUntil: "commit" });
    redirects = redirectsOf(response?.request());
  } catch (error) {
    const why = answeredButNotScanned(error, guard, limits);
    if (why !== undefined) return notScanned(why);
    throw noAnswerRefusal(error, requested, timeout) ?? error;
  }

  try {
    await tab.waitForLoadState("load", { timeout: left() });
  } catch (error) {
    if (tab.isClosed()) return notScanned("the page closed itself before it finished loading", redirects);
    if ((error as Error).name !== "TimeoutError") throw error;
    return notScanned(`it did not finish loading within ${seconds} seconds`, redirects);
  }
  const loadedUrl = tab.url();
  if (!isAllowedScheme(loadedUrl)) {
    return notScanned(`it went to ${schemeOf(loadedUrl)}, which is not http: or https:`, redirects);
  }

  await options.onLoaded?.(tab);

  let navigations = 0;
  tab.on("framenavigated", (frame) => {
    if (frame === tab.mainFrame()) navigations += 1;
  });
  let axe: AxeScan | typeof TIMED_OUT;
  try {
    axe = await within(scanPage(tab, pageKeyOf(requested)), left());
  } catch (error) {
    // A page that moves while axe-core reads it leaves nothing to read: say so rather than fail.
    if (navigations > 0 || tab.isClosed()) {
      return notScanned("it went to another address while it was being scanned", redirects);
    }
    throw error;
  }
  if (axe === TIMED_OUT) return notScanned(`the scan did not finish within ${seconds} seconds`, redirects);
  const finalUrl = tab.url();
  if (!isAllowedScheme(finalUrl)) {
    return notScanned(`it went to ${schemeOf(finalUrl)}, which is not http: or https:`, redirects);
  }
  return { scanned: true, axe, url: finalUrl, redirects };
}

/** The scheme of an address, such as `about:`, for a reason; the address itself is the page's to choose. */
function schemeOf(url: string): string {
  try {
    return `an ${new URL(url).protocol} address`;
  } catch {
    return "an address that is not valid";
  }
}

/**
 * Loads one URL in a new context of a browser with a new, empty profile, scans it, and returns the record.
 * The context is made and guarded by src/context.ts.
 */
export async function runScan(options: RunScanOptions): Promise<ScanRecord> {
  const startedAt = stamp();
  const limits: Limits = { ...LIMITS, ...options.limits };
  const choice = {
    channel: options.channel,
    named: options.named ?? true,
    download: options.download ?? false,
    deps: options.browserDeps,
  };
  return withChosenBrowser(choice, async (browser, used) => {
    const context = await browser.newContext(CONTEXT_OPTIONS);
    const guard = armContext(context, limits);
    await options.onContext?.(context);
    const tab = await context.newPage();
    guard.watchMainPage(tab);
    const loaded = await loadAndScan(tab, guard, options, limits);
    return buildScanRecord({
      tool: packageInfo(),
      browser: `${used.channel} ${browser.version()}`,
      fallback: used.fallback,
      requestedUrl: options.url,
      url: loaded.url,
      redirects: loaded.redirects,
      pageKey: pageKeyOf(options.url),
      startedAt,
      finishedAt: stamp(),
      axe: loaded.scanned ? loaded.axe : null,
      axeCore: loaded.scanned ? loaded.axe.axeCore : installedAxeVersion(),
      ...(loaded.scanned ? {} : { notScanned: loaded.reason }),
      stopped: guard.stopped(),
      limits,
    });
  });
}
