import { createRequire } from "node:module";
import type { Browser, BrowserContext, Page } from "playwright-core";
import { scanPage } from "./axe.js";
import { FocusGuard } from "./focus-guard.js";
import { actionSteps, applyMedia, runSteps, SETTLE_MS, StepFailure } from "./drive.js";
import type { BrowserChannel } from "./browser.js";
import { withChosenBrowser, type BrowserChoiceDeps } from "./browser-choice.js";
import {
  armContext,
  CONTEXT_OPTIONS,
  isAllowedScheme,
  LIMITS,
  redirectsOf,
  STOPPED_KINDS,
  testPublicOrigins,
  type ContextGuard,
  type Limits,
  type Stopped,
  type StoppedKind,
} from "./context.js";
import type { AxeScan } from "./finding.js";
import { pageKeyOf } from "./map-axe.js";
import { packageInfo } from "./package-info.js";
import { narrateSteps, type WorkflowResult, type WorkflowSpec } from "./narrate.js";
import { Refusal } from "./refusal.js";
import type { NoDownloadFlag } from "./browser-choice.js";
import type { Impact } from "./finding.js";
import { DEFAULT_FAIL_ON } from "./rule-flags.js";
import { buildPagesRecord, type PageResult, type ScanRecord, type StateResult } from "./scan-record.js";
import type { State } from "./steps.js";
import { DEFAULT_MAX_TABS } from "./walk.js";

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
  const reason = noAnswerReason(error, timeoutMs);
  if (reason === null) return null;
  return new Refusal(
    `${new URL(url).origin} did not answer: ${reason}.`,
    "check the address, and that the server is running.",
  );
}

/** Why a page did not answer, in this tool's words, or null when the error is something else. */
export function noAnswerReason(error: unknown, timeoutMs: number): string | null {
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
  return reason;
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
/** Why a page reads *not scanned* when its own frame was stopped going to a private address. */
export const PRIVATE_NAVIGATION =
  "it went to a loopback, link-local or private address, which a public page may not reach, and the scan stopped it (--allow-private lets it through)";

export const OFFLINE_NAVIGATION =
  "it went to an address that is not on this machine, and --offline stopped it";
export const OTHER_ORIGIN_NAVIGATION = "it went to another origin, and --same-origin stopped it";

/** Why a page reads *not scanned* when a network rule stopped its own frame, by the rule that did. */
const NAVIGATION_REASONS: Partial<Record<StoppedKind, string>> = {
  "private-network": PRIVATE_NAVIGATION,
  offline: OFFLINE_NAVIGATION,
  "other-origin": OTHER_ORIGIN_NAVIGATION,
};

function navigationReason(guard: Pick<ContextGuard, "blockedNavigation">): string | undefined {
  const kind = guard.blockedNavigation;
  return kind === undefined ? undefined : NAVIGATION_REASONS[kind];
}

export function answeredButNotScanned(
  error: unknown,
  guard: Pick<ContextGuard, "redirectCapReached" | "blockedNavigation">,
  limits: Limits,
): string | undefined {
  const stopped = navigationReason(guard);
  if (stopped !== undefined) return stopped;
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

/** One page to scan, and the states to scan it in beside `default`, which always runs first. */
export interface PageSpec {
  /** The full address. Every page of a run is on the first one's origin. */
  url: string;
  /** The page's name in finding ids; without it, from the address's path (D6). */
  key?: string;
  states: State[];
}

export interface RunScanOptions {
  /** The address the run is about: the first page's, and the origin the private-network rule judges. */
  url: string;
  /** The pages to scan, in order. Default: just `url`, in the default state. */
  pages?: PageSpec[];
  /** `--storage-state`: a Playwright storage state file, read for each state's context and never copied. */
  storageState?: string;
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
  /** `--allow-private`: a public page may reach loopback, link-local and private addresses. */
  allowPrivate?: boolean;
  /** `--same-origin`: requests to any origin but the target's are aborted and noted. */
  sameOrigin?: boolean;
  /**
   * `--offline`: only a loopback target, every request off loopback aborted and noted, and no browser
   * download. The command has checked the target; this makes the download refuse.
   */
  offline?: boolean;
  /** `--tags`: the axe-core tags to run, or none for axe-core's default rule set. */
  tags?: readonly string[];
  /** `--fail-on`: the lowest impact that makes the exit 1. Default `minor`. */
  failOn?: Impact;
  /** `--max-tabs`: the keyboard walk's limit, and the most presses a `Tab to` step makes. Default 200. */
  maxTabs?: number;
  /**
   * The flows to narrate (src/narrate.ts), each on the page its `page` names, from a fresh load, after that
   * page's states. `scan --config` passes the file's `workflows`; `narrate` passes its `--flow`.
   */
  workflows?: WorkflowSpec[];
  /**
   * `narrate`: only the flows run. The pages are loaded for them, and axe-core and the keyboard walk do not
   * run, so the record has no axe-core results.
   */
  narrateOnly?: boolean;
  /** The flag a refused download names. Default: `--offline` when `offline`, else `--no-download`. */
  noDownloadFlag?: NoDownloadFlag;
  /**
   * For tests only: origins read as public (src/context.ts, `TEST_PUBLIC_ORIGINS_ENV`, which is read when
   * this is not given). It can only turn the private-network rule on for a loopback target.
   */
  publicOrigins?: readonly string[];
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

/** What one state of one page is: where it is, what it is called, and whether it is the run's first load. */
interface Unit {
  url: string;
  key: string;
  state: State;
  /** The run's first load, the only one whose failure to answer is a refusal. */
  first: boolean;
}

type Loaded =
  | { scanned: true; axe: AxeScan; url: string; redirects: number }
  | { scanned: false; reason: string; url: string; redirects: number };

/** What loading a page gave: where it ended, or why it cannot be used. */
type PageLoad = { ok: true; redirects: number } | { ok: false; reason: string; redirects: number };

/**
 * Loads the page, inside the page time limit counted by `left`: the first request, the load, and what a
 * hostile page may have done meanwhile (src/context.ts). A page that does not answer is a refusal (thrown) when
 * it is the run's first; every other failure reads *not scanned*, with why.
 */
async function loadPage(
  tab: Page,
  guard: ContextGuard,
  options: RunScanOptions,
  limits: Limits,
  unit: { url: string; first: boolean },
  left: () => number,
): Promise<PageLoad> {
  const requested = unit.url;
  const seconds = limits.pageMs / 1000;
  const failed = (reason: string, redirects = 0): PageLoad => ({ ok: false, reason, redirects });

  // Wait for the answer only; the load itself is held to the page time limit below.
  const timeout = Math.min(navigationTimeoutMs(), left());
  let redirects: number;
  try {
    const response = await tab.goto(requested, { timeout, waitUntil: "commit" });
    redirects = redirectsOf(response?.request());
  } catch (error) {
    const why = answeredButNotScanned(error, guard, limits);
    if (why !== undefined) return failed(why);
    if (!unit.first) {
      // Only the first page of a run must answer; a later one that does not reads *not scanned*.
      const reason = noAnswerReason(error, timeout);
      if (reason !== null) return failed(`it did not answer: ${reason}`);
    }
    throw noAnswerRefusal(error, requested, timeout) ?? error;
  }

  try {
    await tab.waitForLoadState("load", { timeout: left() });
  } catch (error) {
    if (tab.isClosed()) return failed("the page closed itself before it finished loading", redirects);
    if ((error as Error).name !== "TimeoutError") throw error;
    return failed(`it did not finish loading within ${seconds} seconds`, redirects);
  }
  const stoppedGoing = navigationReason(guard);
  if (stoppedGoing !== undefined) return failed(stoppedGoing, redirects);
  const loadedUrl = tab.url();
  if (!isAllowedScheme(loadedUrl)) {
    return failed(`it went to ${schemeOf(loadedUrl)}, which is not http: or https:`, redirects);
  }

  await options.onLoaded?.(tab);
  return { ok: true, redirects };
}

/**
 * Loads the page and runs axe-core on it, inside the page time limit. A page that does not answer is a
 * refusal (thrown); a page that answers and then breaks a rule of src/context.ts reads *not scanned*.
 */
async function loadAndScan(
  tab: Page,
  guard: ContextGuard,
  options: RunScanOptions,
  limits: Limits,
  unit: Unit,
): Promise<Loaded> {
  const requested = unit.url;
  const deadline = Date.now() + limits.pageMs;
  const left = () => Math.max(1, deadline - Date.now());
  const seconds = limits.pageMs / 1000;
  const notScanned = (reason: string, redirects = 0): Loaded => ({
    scanned: false,
    reason,
    url: requested,
    redirects,
  });

  const load = await loadPage(tab, guard, options, limits, unit, left);
  if (!load.ok) return notScanned(load.reason, load.redirects);
  const redirects = load.redirects;

  if (actionSteps(unit.state.steps).length > 0) {
    let done: unknown;
    try {
      done = await within(runSteps(tab, unit.state.steps, left, maxTabsOf(options)), left());
    } catch (error) {
      if (error instanceof StepFailure) return notScanned(error.message, redirects);
      if (tab.isClosed()) return notScanned("the page closed itself while its steps ran", redirects);
      throw error;
    }
    if (done === TIMED_OUT) {
      return notScanned(`its steps did not finish within ${seconds} seconds`, redirects);
    }
    // Let what the steps started settle (spec 5.2): the network quiet, then a short wait.
    await tab.waitForLoadState("networkidle", { timeout: Math.min(2_000, left()) }).catch(() => undefined);
    await tab.waitForTimeout(Math.min(SETTLE_MS, left())).catch(() => undefined);
    if (tab.isClosed()) return notScanned("the page closed itself while its steps ran", redirects);
    const stoppedSteps = navigationReason(guard);
    if (stoppedSteps !== undefined) return notScanned(stoppedSteps, redirects);
  }

  let navigations = 0;
  tab.on("framenavigated", (frame) => {
    if (frame === tab.mainFrame()) navigations += 1;
  });
  let axe: AxeScan | typeof TIMED_OUT;
  try {
    axe = await within(
      scanPage(tab, unit.key, options.tags ?? null, { maxTabs: maxTabsOf(options) }),
      left(),
    );
  } catch (error) {
    // A page that moves while axe-core reads it leaves nothing to read: say so rather than fail.
    if (navigations > 0 || tab.isClosed()) {
      return notScanned("it went to another address while it was being scanned", redirects);
    }
    throw error;
  }
  if (axe === TIMED_OUT) return notScanned(`the scan did not finish within ${seconds} seconds`, redirects);
  const stoppedAfter = navigationReason(guard);
  if (stoppedAfter !== undefined) return notScanned(stoppedAfter, redirects);
  const finalUrl = tab.url();
  if (!isAllowedScheme(finalUrl)) {
    return notScanned(`it went to ${schemeOf(finalUrl)}, which is not http: or https:`, redirects);
  }
  return { scanned: true, axe, url: finalUrl, redirects };
}

/** `--max-tabs`, or its default. */
function maxTabsOf(options: RunScanOptions): number {
  return options.maxTabs ?? DEFAULT_MAX_TABS;
}

/** The scheme of an address, such as `about:`, for a reason; the address itself is the page's to choose. */
function schemeOf(url: string): string {
  try {
    return `an ${new URL(url).protocol} address`;
  } catch {
    return "an address that is not valid";
  }
}

/** The pages' `stopped` lists as one: counts added, the first few examples kept. */
function mergeStopped(lists: Stopped[][], limits: Limits): Stopped[] {
  const merged = new Map<Stopped["kind"], Stopped>();
  for (const entry of lists.flat()) {
    const into = merged.get(entry.kind) ?? { kind: entry.kind, count: 0, examples: [] };
    into.count += entry.count;
    for (const example of entry.examples) {
      if (into.examples.length < limits.stoppedExamples) into.examples.push(example);
    }
    merged.set(entry.kind, into);
  }
  return STOPPED_KINDS.flatMap((kind) => merged.get(kind) ?? []);
}

/** What narrating one flow left: its result, where its page ended, and what the page tried. */
interface Narrated {
  result: WorkflowResult;
  landed?: { url: string; redirects: number };
  stopped: Stopped[];
}

/** The browser's words when the page the readers belong to went away under them (Chrome 158). */
const PAGE_WENT_AWAY =
  /Execution context was destroyed|Cannot find context|Target (page, context or browser )?has been closed|Session closed|Inspected target navigated or closed/;

/**
 * Narrates one flow (src/narrate.ts) on a fresh load of its page, in a context of its own, held to the page
 * time limit and the rules of src/context.ts. A page that stops it, a step that fails and a flow that runs
 * out of time leave `notScanned` on the result, with the steps read before.
 */
async function narrateWorkflow(
  browser: Browser,
  options: RunScanOptions,
  limits: Limits,
  page: { url: string; key: string },
  flow: WorkflowSpec,
  first: boolean,
): Promise<Narrated> {
  const context = await browser.newContext({
    ...CONTEXT_OPTIONS,
    ...(options.storageState === undefined ? {} : { storageState: options.storageState }),
  });
  try {
    const guard = await armContext(context, limits, {
      target: options.url,
      allowPrivate: options.allowPrivate ?? false,
      publicOrigins: options.publicOrigins ?? testPublicOrigins(),
      sameOrigin: options.sameOrigin ?? false,
      offline: options.offline ?? false,
    });
    await options.onContext?.(context);
    const tab = await context.newPage();
    await guard.watchMainPage(tab);
    const deadline = Date.now() + limits.pageMs;
    const left = () => Math.max(1, deadline - Date.now());
    const seconds = limits.pageMs / 1000;
    const result: WorkflowResult = { name: flow.name, page: page.key, steps: [], evidence: [] };
    const narrated = (landed?: Narrated["landed"]): Narrated => ({
      result,
      ...(landed === undefined ? {} : { landed }),
      stopped: guard.stopped(),
    });

    const load = await loadPage(tab, guard, options, limits, { url: page.url, first }, left);
    if (!load.ok) {
      result.notScanned = load.reason;
      return narrated();
    }
    const landed = { url: tab.url(), redirects: load.redirects };
    const halted = (): string | undefined => {
      const stopped = navigationReason(guard);
      if (stopped !== undefined) return stopped;
      const url = tab.url();
      return isAllowedScheme(url) ? undefined : `it went to ${schemeOf(url)}, which is not http: or https:`;
    };
    let done: string | undefined | typeof TIMED_OUT;
    try {
      done = await within(
        narrateSteps(tab, flow.steps, { msLeft: left, maxTabs: maxTabsOf(options), halted }, result),
        left(),
      );
    } catch (error) {
      if (tab.isClosed()) result.notScanned = "the page closed itself while its steps ran";
      else if (error instanceof Error && PAGE_WENT_AWAY.test(error.message)) {
        result.notScanned = "the page went to another address while its steps were read";
      } else throw error;
      return narrated(landed);
    }
    if (done === TIMED_OUT) result.notScanned = `its steps did not finish within ${seconds} seconds`;
    else if (done !== undefined) result.notScanned = done;
    return narrated(landed);
  } finally {
    await context.close().catch(() => undefined);
  }
}

/**
 * Scans each page in each of its states (spec 5.2): for every state, `default` first, a new browser context
 * of a browser with a new, empty profile, guarded by src/context.ts, with a fresh load of the page, so no
 * state leaks into another. The state's media is set, the page loads, its steps run, and axe-core reads it.
 * Returns the record.
 */
export async function runScan(options: RunScanOptions): Promise<ScanRecord> {
  const startedAt = stamp();
  const limits: Limits = { ...LIMITS, ...options.limits };
  const specs = options.pages ?? [{ url: options.url, states: [] }];
  const choice = {
    channel: options.channel,
    named: options.named ?? true,
    // `--offline` downloads nothing, whatever `download` says.
    download: options.offline === true ? false : (options.download ?? false),
    noDownloadFlag: options.noDownloadFlag ?? (options.offline === true ? "--offline" : "--no-download"),
    deps: options.browserDeps,
  };
  return withChosenBrowser(choice, async (browser, used) => {
    const pages: PageResult[] = [];
    let first = true;
    for (const spec of specs) {
      const key = spec.key ?? pageKeyOf(spec.url);
      const states: StateResult[] = [];
      const stopped: Stopped[][] = [];
      let landed: { url: string; redirects: number } | undefined;
      let defaultLoad: { url: string; redirects: number } | undefined;
      for (const state of options.narrateOnly === true ? [] : [DEFAULT_STATE, ...spec.states]) {
        const context = await browser.newContext({
          ...CONTEXT_OPTIONS,
          ...(options.storageState === undefined ? {} : { storageState: options.storageState }),
        });
        try {
          const guard = await armContext(context, limits, {
            target: options.url,
            allowPrivate: options.allowPrivate ?? false,
            publicOrigins: options.publicOrigins ?? testPublicOrigins(),
            sameOrigin: options.sameOrigin ?? false,
            offline: options.offline ?? false,
          });
          await options.onContext?.(context);
          const tab = await context.newPage();
          // Before the page loads, so the focus guard is first in line in its documents (src/focus-guard.ts).
          await FocusGuard.install(tab).catch(() => undefined);
          await guard.watchMainPage(tab);
          await applyMedia(tab, state.steps);
          const loaded = await loadAndScan(tab, guard, options, limits, { url: spec.url, key, state, first });
          first = false;
          stopped.push(guard.stopped());
          if (state === DEFAULT_STATE) defaultLoad = { url: loaded.url, redirects: loaded.redirects };
          landed ??= loaded.scanned ? { url: loaded.url, redirects: loaded.redirects } : undefined;
          states.push(
            loaded.scanned
              ? { name: state.name, axe: loaded.axe }
              : { name: state.name, axe: null, notScanned: loaded.reason },
          );
        } finally {
          await context.close().catch(() => undefined);
        }
      }
      // The flows asked for on this page, each from a fresh load, after its states.
      const flows: WorkflowResult[] = [];
      for (const flow of (options.workflows ?? []).filter((candidate) => candidate.page === key)) {
        const ran = await narrateWorkflow(browser, options, limits, { url: spec.url, key }, flow, first);
        first = false;
        flows.push(ran.result);
        stopped.push(ran.stopped);
        landed ??= ran.landed;
      }
      if (options.narrateOnly === true) {
        // No axe-core: the page's one state is the flows' own load, and holds nothing but what they found.
        defaultLoad = landed;
        states.push({
          name: "default",
          axe: { axeCore: installedAxeVersion(), rulesRun: 0, findings: [], needsReview: [] },
        });
      }
      // The page is where its default state ended; failing that, where the first state that loaded did.
      const where =
        defaultLoad !== undefined && states[0]?.axe !== null ? defaultLoad : (landed ?? defaultLoad);
      pages.push({
        key,
        url: where?.url ?? spec.url,
        requestedUrl: spec.url,
        redirects: where?.redirects ?? 0,
        stopped: mergeStopped(stopped, limits),
        states,
        ...(flows.length === 0 ? {} : { workflows: flows }),
      });
    }
    return buildPagesRecord({
      ...(options.narrateOnly === true ? { command: "narrate" as const } : {}),
      tool: packageInfo(),
      browser: `${used.channel} ${browser.version()}`,
      fallback: used.fallback,
      startedAt,
      finishedAt: stamp(),
      axeCore: installedAxeVersion(),
      pages,
      limits,
      tags: options.tags ?? null,
      failOn: options.failOn ?? DEFAULT_FAIL_ON,
      sameOrigin: options.sameOrigin ?? false,
      offline: options.offline ?? false,
    });
  });
}

/** The state every page is scanned in first: no steps. */
const DEFAULT_STATE: State = { name: "default", steps: [] };
