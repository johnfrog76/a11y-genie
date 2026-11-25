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
 *   So the redirect cap below counts hops from the page's `request` events, not from a route, and the
 *   private-network rule stops hops with the DevTools Protocol's `Fetch` domain (`FetchGuard`, below).
 * - WebSockets do not go through `context.route()` either: `context.routeWebSocket()` sees them.
 */

import type { BrowserContext, BrowserContextOptions, CDPSession, Page, Request } from "playwright-core";
import { addressKindOfUrl } from "./private-address.js";

/** The limits a scan holds a page to. The spec's numbers (8A.1) where it gives one. */
export interface Limits {
  /**
   * How long one page may take, from the first request to the end of axe-core, in milliseconds. The spec's
   * per-state limit: 60 s, and `--timeout` sets it. Past it, the page reads *not scanned*.
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
  /**
   * The largest `scan.json` may be, in bytes. The spec's 50 MB. Past it, walks lose stops first, then elements
   * are cut and counted (`fitToSize` in src/scan-record.ts).
   */
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
export const STOPPED_KINDS = [
  "dialog",
  "popup",
  "download",
  "private-network",
  "offline",
  "other-origin",
] as const;
export type StoppedKind = (typeof STOPPED_KINDS)[number];

export interface Stopped {
  kind: StoppedKind;
  /** How many times the page tried it. */
  count: number;
  /**
   * The first few, quoted from the page and cut short: a dialog's type and message, or an address (a
   * pop-up's, a download's, or the address a blocked request was going to).
   */
  examples: string[];
}

/**
 * For tests only: a comma-separated list of origins to read as public, so the private-network rule can be
 * proved on loopback servers. It is used only when the address scanned is on one of those origins, and then
 * only those origins read public: it can turn the rule on for a loopback target, never off for a public
 * one.
 */
export const TEST_PUBLIC_ORIGINS_ENV = "A11Y_GENIE_TEST_PUBLIC_ORIGINS";

/** The origins `TEST_PUBLIC_ORIGINS_ENV` names, or none. */
export function testPublicOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env[TEST_PUBLIC_ORIGINS_ENV] ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin !== "");
}

/** What the private-network rule needs to know about a scan. */
export interface NetworkOptions {
  /** The address the scan loads. The rule holds only when its host is public. */
  target?: string;
  /** `--allow-private`: a public page may reach loopback, link-local and private addresses. */
  allowPrivate?: boolean;
  /** For tests only: origins read as public, as `TEST_PUBLIC_ORIGINS_ENV` says. */
  publicOrigins?: readonly string[];
  /** `--same-origin`: a request to any origin but the target's is aborted. */
  sameOrigin?: boolean;
  /** `--offline`: a request to any address that is not loopback is aborted. */
  offline?: boolean;
}

/** The schemes a request leaves the browser by, so the only ones the rule judges. `data:` and `blob:` do not. */
const NETWORK_SCHEMES = ["http:", "https:", "ws:", "wss:"];

function originOf(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    // A WebSocket's origin is read as the http one it shares a host and port with.
    const scheme =
      parsed.protocol === "ws:" ? "http:" : parsed.protocol === "wss:" ? "https:" : parsed.protocol;
    return `${scheme}//${parsed.host}`;
  } catch {
    return undefined;
  }
}

/**
 * The private-network rule (spec 8A.1): when the address scanned is public, a request to a loopback,
 * link-local, private or unspecified address (src/private-address.ts) is aborted. The host is judged as
 * written, never looked up (gap G7).
 */
export interface PrivateNetworkRule {
  /** Whether a request to `url` is stopped. */
  blocks(url: string): boolean;
}

/**
 * The rule for one scan, or undefined when it does not hold: the target is itself loopback or private (the
 * usual dev server, not limited), or `--allow-private` was given.
 */
export function privateNetworkRule(options: NetworkOptions): PrivateNetworkRule | undefined {
  if (options.target === undefined || options.allowPrivate === true) return undefined;
  const targetOrigin = originOf(options.target);
  const declared = (options.publicOrigins ?? []).map(originOf);
  const publicOrigins = (
    targetOrigin !== undefined && declared.includes(targetOrigin) ? declared : []
  ).filter((origin): origin is string => origin !== undefined);
  const blocks = (url: string): boolean => {
    let scheme: string;
    try {
      scheme = new URL(url).protocol;
    } catch {
      return false;
    }
    if (!NETWORK_SCHEMES.includes(scheme)) return false;
    const origin = originOf(url);
    if (origin !== undefined && publicOrigins.includes(origin)) return false;
    const kind = addressKindOfUrl(url);
    return kind !== undefined && kind !== "public";
  };
  if (blocks(options.target)) return undefined;
  return { blocks };
}

/**
 * What a scan's network rules decide about a request: which of them, if any, stops it. Made by
 * `networkRule` from the private-network rule above and the two flags that add to it, so the route, the
 * WebSocket route and `FetchGuard` ask one question and every stop is noted under its own kind.
 */
export interface NetworkRule {
  /** The kind a request to `url` is stopped as, or undefined when it may go. The first rule that holds wins. */
  kindOf(url: string): StoppedKind | undefined;
  /** Whether a request to `url` is stopped. */
  blocks(url: string): boolean;
}

/**
 * The rules for one scan, or undefined when none holds. In the order they are asked:
 * 1. `--offline`: any address that is not loopback (src/private-address.ts) is off the machine. The tests'
 *    declared origins read as off it, except the target's own, so a second loopback server can stand in
 *    for a host out on the network.
 * 2. `--same-origin`: any origin but the target's.
 * 3. the private-network rule.
 *
 * Only requests that leave the browser by `http:`, `https:`, `ws:` or `wss:` are judged.
 */
export function networkRule(options: NetworkOptions): NetworkRule | undefined {
  const privateRule = privateNetworkRule(options);
  const targetOrigin = options.target === undefined ? undefined : originOf(options.target);
  const offline = options.offline === true;
  const sameOrigin = options.sameOrigin === true && targetOrigin !== undefined;
  if (privateRule === undefined && !offline && !sameOrigin) return undefined;
  const declaredOff = new Set(
    (options.publicOrigins ?? []).map(originOf).filter((o): o is string => o !== undefined),
  );
  const kindOf = (url: string): StoppedKind | undefined => {
    let scheme: string;
    try {
      scheme = new URL(url).protocol;
    } catch {
      return undefined;
    }
    if (!NETWORK_SCHEMES.includes(scheme)) return undefined;
    const origin = originOf(url);
    if (offline) {
      const onMachine =
        addressKindOfUrl(url) === "loopback" && !(declaredOff.has(origin ?? "") && origin !== targetOrigin);
      if (!onMachine) return "offline";
    }
    if (sameOrigin && origin !== targetOrigin) return "other-origin";
    if (privateRule?.blocks(url)) return "private-network";
    return undefined;
  };
  return { kindOf, blocks: (url) => kindOf(url) !== undefined };
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

/** A DevTools Protocol session, or one below it reached through `Target.sendMessageToTarget`. */
type SessionPath = readonly string[];

/** `Fetch.requestPaused`'s fields this guard reads (DevTools Protocol, Chrome 158). */
interface PausedRequest {
  requestId: string;
  request: { url: string };
  frameId?: string;
  resourceType?: string;
}

function isPausedRequest(value: unknown): value is PausedRequest {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  const request = v.request as Record<string, unknown> | undefined;
  return typeof v.requestId === "string" && typeof request?.url === "string";
}

/**
 * The network rules for every request of one page, redirect hops included, by the DevTools
 * Protocol's `Fetch` domain. Playwright's `route()` sees only the first request of a redirect chain
 * (checked at playwright-core 1.65.1), so the hops after it are judged here, in a session of our own beside
 * Playwright's: Chrome pauses each request for both, and a request this session fails never leaves.
 *
 * A frame on another site runs in a process of its own (site isolation) with its own target, and a
 * dedicated worker has one too. The page's session attaches to each as it starts, held until it is armed
 * (`waitForDebuggerOnStart`), and each attaches to its own in turn. They are reached through
 * `Target.sendMessageToTarget`, because Playwright's session object cannot send to a flattened child.
 */
class FetchGuard {
  private nextId = 1_000_000;
  private mainFrameId: string | undefined;

  constructor(
    private readonly session: CDPSession,
    private readonly rule: NetworkRule,
    private readonly onBlocked: (kind: StoppedKind, url: string, mainFrame: boolean) => void,
  ) {}

  async start(): Promise<void> {
    this.session.on("Fetch.requestPaused", (event) => this.paused([], event));
    this.session.on("Target.attachedToTarget", (event) => this.attached([], event));
    this.session.on("Target.receivedMessageFromTarget", (event) => this.received([], event));
    const { frameTree } = await this.session.send("Page.getFrameTree");
    this.mainFrameId = frameTree.frame.id;
    await this.session.send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
    await this.session.send("Target.setAutoAttach", {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: false,
    });
  }

  /** Sends a command to the session at `path`. Answers are not waited for; a failure is ignored. */
  private send(path: SessionPath, method: string, params: object = {}): void {
    if (path.length === 0) {
      this.session.send(method as "Fetch.continueRequest", params as never).catch(() => undefined);
      return;
    }
    let message: { id: number; method: string; params: object } = { id: this.nextId++, method, params };
    for (let i = path.length - 1; i >= 1; i -= 1) {
      message = {
        id: this.nextId++,
        method: "Target.sendMessageToTarget",
        params: { sessionId: path[i], message: JSON.stringify(message) },
      };
    }
    this.session
      .send("Target.sendMessageToTarget", { sessionId: path[0] as string, message: JSON.stringify(message) })
      .catch(() => undefined);
  }

  private paused(path: SessionPath, event: unknown): void {
    if (!isPausedRequest(event)) return;
    const url = event.request.url;
    const kind = this.rule.kindOf(url);
    if (kind !== undefined) {
      const mainFrame =
        path.length === 0 && event.resourceType === "Document" && event.frameId === this.mainFrameId;
      this.onBlocked(kind, url, mainFrame);
      this.send(path, "Fetch.failRequest", { requestId: event.requestId, errorReason: "BlockedByClient" });
    } else {
      this.send(path, "Fetch.continueRequest", { requestId: event.requestId });
    }
  }

  /**
   * A new target below `path`: a frame on another site, or a dedicated worker. Armed, then let run. A
   * worker has no `Fetch` domain (its requests are paused in its page's session) and says so; the rest
   * still apply.
   */
  private attached(path: SessionPath, event: unknown): void {
    const sessionId = (event as { sessionId?: unknown }).sessionId;
    if (typeof sessionId !== "string") return;
    const child = [...path, sessionId];
    this.send(child, "Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
    this.send(child, "Target.setAutoAttach", {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: false,
    });
    this.send(child, "Runtime.runIfWaitingForDebugger");
  }

  /** An event from a target below `path`, wrapped once for each level. */
  private received(path: SessionPath, event: unknown): void {
    const { sessionId, message } = event as { sessionId?: unknown; message?: unknown };
    if (typeof sessionId !== "string" || typeof message !== "string") return;
    let inner: { method?: unknown; params?: unknown };
    try {
      inner = JSON.parse(message) as typeof inner;
    } catch {
      return;
    }
    const at = [...path, sessionId];
    if (inner.method === "Fetch.requestPaused") this.paused(at, inner.params);
    else if (inner.method === "Target.attachedToTarget") this.attached(at, inner.params);
    else if (inner.method === "Target.receivedMessageFromTarget") this.received(at, inner.params);
  }
}

/**
 * Watches one browser context for what a hostile page tries, stops it, and keeps the record. Made by
 * `armContext`, before any page opens.
 */
export class ContextGuard {
  private readonly tried = new Map<StoppedKind, Stopped>();
  private tooManyRedirects = false;
  private blockedNavigationKind: StoppedKind | undefined;
  private mainPage: Page | undefined;

  /** `rule` is the network rules, or undefined when none holds for this scan. */
  constructor(
    private readonly limits: Limits,
    readonly rule?: NetworkRule,
  ) {}

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

  /** Which rule stopped the scanned page's own frame going somewhere, or undefined when none did. */
  get blockedNavigation(): StoppedKind | undefined {
    return this.blockedNavigationKind;
  }

  /** A request a network rule stopped. */
  blocked(kind: StoppedKind, url: string, mainFrame: boolean): void {
    this.note(kind, url);
    if (mainFrame && this.blockedNavigationKind === undefined) this.blockedNavigationKind = kind;
  }

  /**
   * Whether a request comes from the scanned page: any of its frames, or its workers. A navigation whose
   * frame does not exist yet is a new page's, a pop-up's (playwright-core 1.65.1 has no frame for it).
   */
  fromMainPage(request: Request): boolean {
    try {
      return request.frame().page() === this.mainPage;
    } catch {
      return !request.isNavigationRequest();
    }
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
   * closed, which stops the browser following the chain. When the private-network rule holds, every request
   * of the page, its frames and its workers, redirect hops included, is judged by it (`FetchGuard`).
   * Awaited before the page loads anything.
   */
  async watchMainPage(page: Page): Promise<void> {
    this.mainPage = page;
    const rule = this.rule;
    if (rule !== undefined) {
      const session = await page.context().newCDPSession(page);
      await new FetchGuard(session, rule, (kind, url, mainFrame) =>
        this.blocked(kind, url, mainFrame),
      ).start();
    }
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
 *   closed at once and noted. axe-core's own page has no opener and is left alone;
 * - when a network rule holds (the private-network rule: a public target, no `--allow-private`; or
 *   `--same-origin`; or `--offline`; `networkRule`): a context route aborts the
 *   first request of every chain it stops, from any page, frame or worker, and
 *   `routeWebSocket` closes every WebSocket it stops before it connects, since WebSockets do not pass
 *   through `route`. Both are noted. Redirect hops do not pass through `route` either: `watchMainPage`
 *   stops those of the scanned page, and the route lets no other page (a pop-up) load anything at all, so a
 *   pop-up's chain never starts.
 */
export async function armContext(
  context: BrowserContext,
  limits: Limits = LIMITS,
  network: NetworkOptions = {},
): Promise<ContextGuard> {
  const rule = networkRule(network);
  const guard = new ContextGuard(limits, rule);
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
  if (rule !== undefined) {
    await context.route("**/*", async (route) => {
      const request = route.request();
      const kind = rule.kindOf(request.url());
      if (kind !== undefined) {
        let mainFrame = false;
        try {
          mainFrame = request.isNavigationRequest() && request.frame() === request.frame().page().mainFrame();
        } catch {
          // a request with no frame is not a navigation of the page
        }
        guard.blocked(kind, request.url(), mainFrame && guard.fromMainPage(request));
        await route.abort("blockedbyclient");
      } else if (!guard.fromMainPage(request)) {
        await route.abort("blockedbyclient");
      } else {
        await route.fallback();
      }
    });
    await context.routeWebSocket(
      (url) => rule.blocks(url.href),
      async (socket) => {
        guard.note(rule.kindOf(socket.url()) ?? "private-network", socket.url());
        await socket.close();
      },
    );
  }
  return guard;
}

/** The redirect count for a loaded page: how many hops came before the response it ended on. */
export function redirectsOf(request: Request | undefined): number {
  return request === undefined ? 0 : hopsBefore(request);
}
