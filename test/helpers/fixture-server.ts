import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** Where the fixture pages live. */
export const FIXTURE_SITE_DIR = fileURLToPath(new URL("../fixtures/site/", import.meta.url));

/** The only address the server binds to. Tests never listen on anything else. */
export const FIXTURE_HOST = "127.0.0.1";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8",
};
// Anything else, `.bin` among them, is served as application/octet-stream, which a browser downloads.

export interface FixtureServer {
  /** The origin, such as `http://127.0.0.1:41234`, with no trailing slash. */
  readonly origin: string;
  readonly port: number;
  /** The full URL of a page in the fixtures folder, such as `clean.html`. */
  url(page: string): string;
  /** Stops listening and drops open connections. */
  close(): Promise<void>;
}

export interface FixtureServerOptions {
  /**
   * Paths that answer with a `302` to the address given, such as `{ "/to-file": "file:///etc/hosts" }`.
   * The hostile-page tests use them for redirects the static files cannot make.
   */
  redirects?: Record<string, string>;
}

/**
 * Serves a folder of static files from 127.0.0.1 on a random free port.
 * Start it in `beforeAll` and close it in `afterAll`, so each test file has its own.
 */
export async function startFixtureServer(
  root: string = FIXTURE_SITE_DIR,
  options: FixtureServerOptions = {},
): Promise<FixtureServer> {
  const rootDir = normalize(root.endsWith(sep) ? root : root + sep);
  const redirects = new Map(Object.entries(options.redirects ?? {}));

  const server: Server = createServer((req, res) => {
    void (async () => {
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { allow: "GET, HEAD" }).end();
        return;
      }
      let pathname: string;
      try {
        pathname = decodeURIComponent(new URL(req.url ?? "/", "http://fixture.invalid").pathname);
      } catch {
        res.writeHead(400).end();
        return;
      }
      const location = redirects.get(pathname);
      if (location !== undefined) {
        res.writeHead(302, { location, "cache-control": "no-store" }).end();
        return;
      }
      const file = normalize(join(rootDir, pathname));
      // Refuse anything that climbs out of the fixtures folder.
      if (!file.startsWith(rootDir)) {
        res.writeHead(403).end();
        return;
      }
      try {
        const body = await readFile(file);
        res.writeHead(200, {
          "content-type": CONTENT_TYPES[extname(file)] ?? "application/octet-stream",
          "content-length": body.length,
          "cache-control": "no-store",
        });
        res.end(req.method === "HEAD" ? undefined : body);
      } catch {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Not found");
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, FIXTURE_HOST, resolve);
  });
  const { port } = server.address() as AddressInfo;
  const origin = `http://${FIXTURE_HOST}:${port}`;

  return {
    origin,
    port,
    url: (page) => `${origin}/${page.replace(/^\/+/, "")}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
        server.closeAllConnections();
      }),
  };
}
