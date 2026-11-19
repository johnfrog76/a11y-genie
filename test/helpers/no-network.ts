import http from "node:http";
import https from "node:https";
import net from "node:net";

/**
 * A guard that makes any Node-side request off loopback fail.
 *
 * What it covers:
 * - `fetch`, `http.request`/`http.get` and `https.request`/`https.get` called in the test process.
 * - Every TCP connection opened through `net` (`net.connect`, `net.createConnection`,
 *   `new net.Socket().connect`), which is what `http`, `https`, `tls` and `fetch` use underneath.
 *
 * What it does not cover:
 * - A browser launched by a test. Its traffic never passes through Node. A browser-side
 *   guard (routing every browser context and aborting anything not served by the fixture
 *   server) comes with the browser tests, in a later issue.
 * - UDP (`dgram`), DNS lookups on their own, `http2`, and child processes.
 * - Unix-socket and named-pipe connections, which stay on the machine.
 *
 * Loopback means `127.0.0.1`, any other `127.x.x.x`, `::1` and `localhost`.
 * A blocked attempt rejects or throws at once, and is also recorded, so a test that
 * swallows the error still fails: the setup file checks the record after every test.
 */

const STATE = Symbol.for("a11y-genie.no-network");
interface State {
  installed: boolean;
  blocked: string[];
}
const g = globalThis as typeof globalThis & { [STATE]?: State };
const state: State = (g[STATE] ??= { installed: false, blocked: [] });

export class OffLoopbackError extends Error {
  constructor(target: string) {
    super(`Test tried to reach ${target}, which is not loopback. Tests may only use 127.0.0.1.`);
    this.name = "OffLoopbackError";
  }
}

export function isLoopbackHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  return h === "localhost" || h === "::1" || /^127(\.\d{1,3}){3}$/.test(h);
}

function block(target: string): never {
  state.blocked.push(target);
  throw new OffLoopbackError(target);
}

/** Returns the off-loopback attempts seen since the last call, and clears the record. */
export function takeBlockedAttempts(): string[] {
  return state.blocked.splice(0);
}

function urlTarget(input: unknown): string | undefined {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  if (typeof input === "object" && input !== null && "url" in input)
    return String((input as { url: unknown }).url);
  return undefined;
}

function checkUrl(raw: string): void {
  let host: string;
  try {
    host = new URL(raw).hostname;
  } catch {
    return; // not an absolute URL; the real call will refuse it itself
  }
  if (!isLoopbackHost(host)) block(raw);
}

/** Pulls the host out of the argument forms `Socket.connect` accepts. */
function connectHost(args: unknown[]): string | undefined {
  // `net.connect` hands `Socket.connect` an already-normalised `[options, callback]` array.
  const first = Array.isArray(args[0]) ? (args[0] as unknown[])[0] : args[0];
  if (typeof first === "object" && first !== null) {
    const opts = first as { path?: string; host?: string };
    if (opts.path !== undefined) return undefined; // unix socket
    return opts.host ?? "localhost";
  }
  if (typeof first === "string") return undefined; // connect(path)
  const second = args[1];
  return typeof second === "string" ? second : "localhost"; // connect(port[, host])
}

/** Patches the Node network entry points. Safe to call more than once. */
export function installNoNetworkGuard(): void {
  if (state.installed) return;
  state.installed = true;

  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    try {
      const target = urlTarget(input);
      if (target !== undefined) checkUrl(target);
    } catch (err) {
      return Promise.reject(err);
    }
    return realFetch(input, init);
  }) as typeof fetch;

  for (const mod of [http, https] as const) {
    for (const name of ["request", "get"] as const) {
      const real = mod[name] as (...a: unknown[]) => unknown;
      (mod as unknown as Record<string, unknown>)[name] = (...args: unknown[]) => {
        const first = args[0];
        const opts =
          typeof first === "object" && first !== null && !(first instanceof URL)
            ? (first as { hostname?: string; host?: string })
            : undefined;
        const target = opts ? (opts.hostname ?? opts.host) : urlTarget(first);
        if (opts) {
          if (target !== undefined && !isLoopbackHost(target.replace(/:\d+$/, ""))) block(target);
        } else if (target !== undefined) {
          checkUrl(target);
        }
        return real.apply(mod, args);
      };
    }
  }

  const realConnect = net.Socket.prototype.connect as (this: net.Socket, ...a: unknown[]) => net.Socket;
  net.Socket.prototype.connect = function (this: net.Socket, ...args: unknown[]) {
    const host = connectHost(args);
    if (host !== undefined && !isLoopbackHost(host)) block(host);
    return realConnect.apply(this, args);
  } as typeof net.Socket.prototype.connect;
}
