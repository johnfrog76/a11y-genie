/**
 * Hostile pages: the browser context. Every page is assumed to be written by someone who wants the tool to
 * misbehave (spec 8A.1), so every defence the browser context holds is set here, in one place, for a
 * reviewer to read together. docs/ARCHITECTURE.md ("Hostile pages") lists each one with the test that
 * proves it, and test/browser/hostile.test.ts holds those tests.
 *
 * What the browser itself already does, checked with playwright-core 1.65.1 and Chrome 158:
 * - A redirect to `file:`, `chrome:`, `data:` or `about:` fails the load with `net::ERR_UNSAFE_REDIRECT`,
 *   and one to `javascript:` with `net::ERR_ABORTED`. The page reads *not scanned*.
 * - A page's own script cannot move the top frame to `file:`, `chrome:` or `data:`: Chrome refuses it
 *   ("Not allowed to load local resource", "Not allowed to navigate top frame to data URL") and the page
 *   stays where it is, to be scanned as itself.
 * - Only the first request of a redirect chain goes through `context.route()`; the hops after it do not.
 *   So the redirect cap below counts hops from the page's `request` events, not from a route.
 *
 * The private-network rule (issue #9) is the next defence and belongs here too: see `armContext`.
 */

import type { BrowserContext, BrowserContextOptions, Page, Request } from "playwright-core";

/** The limits a scan holds a page to. The spec's numbers (8A.1) where it gives one. */
export interface Limits {
  /**
   * How long one page may take, from the first request to the end of axe-core, in milliseconds. The spec's
   * per-state limit: 60 s, and `--timeout` will set it (M3). Past it, the page reads *not scanned*.
   */
  pageMs: number;
  /**
   * How many redirects are followed for the page asked for. The spec gives no number; Chrome's own limit
   * is 20. Ten is the conservative choice, and past it the page reads *not scanned*.
   */
  redirects: number;
  /** The most elements kept per finding; the rest are counted (`elementsCut`). The spec's 500. */
  elementsPerFinding: number;
  /** The longest an element's quoted HTML may be, in characters. The spec's 160. */
  excerptChars: number;
  /** The largest `scan.json` may be, in bytes. The spec's 50 MB. Past it, elements are cut and counted. */
  scanJsonBytes: number;
  /** How many examples are kept of each kind of thing a page tried and was stopped from doing. */
  stoppedExamples: number;
}

export const LIMITS: Readonly<Limits> = Object.freeze({
  pageMs: 60_000,
  redirects: 10,
  elementsPerFinding: 500,
  excerptChars: 160,
  scanJsonBytes: 50 * 1024 * 1024,
  stoppedExamples: 5,
});

/** The only schemes a page may be loaded from. Anything else reads *not scanned*. */
export const ALLOWED_SCHEMES: readonly string[] = ["http:", "https:"];

export function isAllowedScheme(url: string): boolean {
  try {
    return ALLOWED_SCHEMES.includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

/**
 * The options every browser context is made with.
 *
 * - `acceptDownloads: false`: a download is cancelled before anything is written. A page that answers with
 *   a file to download reads *not scanned*; a download the page starts later is noted.
 * - `permissions: []`: nothing is granted. Geolocation, camera, microphone and notifications are denied.
 * - `serviceWorkers: "block"`: no service worker is registered, so none can answer the page's requests or
 *   outlive the page.
 */
export const CONTEXT_OPTIONS: Readonly<BrowserContextOptions> = Object.freeze({
  acceptDownloads: false,
  permissions: [],
  serviceWorkers: "block",
});

/** What a page tried that the scan stopped. Listed in `scan.json` under `pages[].stopped`. */
export const STOPPED_KINDS = ["dialog", "popup", "download"] as const;
export type StoppedKind = (typeof STOPPED_KINDS)[number];

export interface Stopped {
  kind: StoppedKind;
  /** How many times the page tried it. */
  count: number;
  /** The first few, quoted from the page and cut short: a dialog's type and message, or an address. */
  examples: string[];
}

function cut(text: string, limit: number): string {
  const chars = [...text];
  return chars.length <= limit ? text : `${chars.slice(0, limit).join("")}…`;
}

/** How many redirects came before `request`. */
function hopsBefore(request: Request): number {
  let hops = 0;
  for (let r = request.redirectedFrom(); r !== null; r = r.redirectedFrom()) hops += 1;
  return hops;
}

/**
 * Watches one browser context for what a hostile page tries, stops it, and keeps the record. Made by
 * `armContext`, before any page opens.
 */
export class ContextGuard {
  private readonly tried = new Map<StoppedKind, Stopped>();
  private tooManyRedirects = false;

  constructor(private readonly limits: Limits) {}

  /** What the page tried and was stopped from doing, in a fixed order, only the kinds it tried. */
  stopped(): Stopped[] {
    return STOPPED_KINDS.flatMap((kind) => {
      const entry = this.tried.get(kind);
      return entry === undefined ? [] : [{ ...entry, examples: [...entry.examples] }];
    });
  }

  /** Whether the page asked for went past the redirect cap, so the scan stopped following it. */
  get redirectCapReached(): boolean {
    return this.tooManyRedirects;
  }

  note(kind: StoppedKind, example: string): void {
    const entry = this.tried.get(kind) ?? { kind, count: 0, examples: [] };
    entry.count += 1;
    if (entry.examples.length < this.limits.stoppedExamples) {
      entry.examples.push(cut(example, this.limits.excerptChars));
    }
    this.tried.set(kind, entry);
  }

  /** Dialogs are dismissed and noted; downloads are cancelled and noted. Every page in the context. */
  armPage(page: Page): void {
    page.on("dialog", (dialog) => {
      this.note("dialog", `${dialog.type()}: ${dialog.message()}`);
      dialog.dismiss().catch(() => undefined);
    });
    page.on("download", (download) => {
      this.note("download", download.url());
      download.cancel().catch(() => undefined);
    });
  }

  /**
   * The page the scan loads. Every redirect of its main frame is counted, and past the cap the page is
   * closed, which stops the browser following the chain.
   */
  watchMainPage(page: Page): void {
    page.on("request", (request) => {
      if (this.tooManyRedirects || !request.isNavigationRequest()) return;
      let mainFrame: boolean;
      try {
        mainFrame = request.frame() === page.mainFrame();
      } catch {
        return; // a request with no frame (a service worker's) is not the page's navigation
      }
      if (mainFrame && hopsBefore(request) > this.limits.redirects) {
        this.tooManyRedirects = true;
        page.close().catch(() => undefined);
      }
    });
  }
}

/**
 * Sets the defences on a new context, before any page opens:
 * - every page (the scanned page, axe-core's own, and any pop-up) gets the dialog and download rules;
 * - a pop-up (any page with an opener: `window.open`, `target="_blank"`, with or without `noopener`) is
 *   closed at once and noted. axe-core's own page has no opener and is left alone.
 *
 * Issue #9 adds the private-network rule here: a context route that aborts requests from a public target
 * to loopback, link-local and private addresses, and `routeWebSocket` for WebSockets, which `route` does
 * not see. Remember, when it does, that redirect hops after the first request do not go through `route`.
 */
export function armContext(context: BrowserContext, limits: Limits = LIMITS): ContextGuard {
  const guard = new ContextGuard(limits);
  context.on("page", (page) => {
    guard.armPage(page);
    page
      .opener()
      .then(async (opener) => {
        if (opener === null) return;
        guard.note("popup", page.url());
        await page.close();
      })
      .catch(() => undefined);
  });
  return guard;
}

/** The redirect count for a loaded page: how many hops came before the response it ended on. */
export function redirectsOf(request: Request | undefined): number {
  return request === undefined ? 0 : hopsBefore(request);
}
