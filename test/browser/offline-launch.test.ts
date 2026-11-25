import { TEST_CHANNEL } from "../helpers/test-browser.js";
import { createSocket, type Socket as UdpSocket } from "node:dgram";
import { createServer, type Server } from "node:net";
import { chromium } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { offlineSwitches, withBrowser } from "../../src/browser.js";
import { runScan } from "../../src/run-scan.js";
import { testBrowserIsInstalled } from "../helpers/browser-guard.js";
import { startFixtureServer, type FixtureServer } from "../helpers/fixture-server.js";

// `--offline` at the launch (src/browser.ts, offlineSwitches): what the browser does with the switches, so that
// nothing it starts itself leaves the machine. The product's proxy is a port nothing answers on; here it is a
// proxy on 127.0.0.1 that records the first line of each connection and refuses it, so the test can see every
// connection that would have left the machine go to it instead. Nothing here reaches the network: the page,
// the proxy and the stand-in STUN server are all on 127.0.0.1, and every name but localhost is looked up as
// not found.
const hasBrowser = await testBrowserIsInstalled();

describe.skipIf(!hasBrowser)(
  "--offline at the launch (skipped where the test browser is not installed)",
  () => {
    let server: FixtureServer;
    let proxy: Server;
    let proxyUrl = "";
    const proxied: string[] = [];
    let stun: UdpSocket;
    let stunPort = 0;
    let stunHits = 0;

    beforeAll(async () => {
      server = await startFixtureServer();
      proxy = createServer((socket) => {
        socket.once("data", (chunk) => {
          proxied.push(chunk.toString("latin1").split("\r\n")[0] ?? "");
          socket.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n");
        });
        socket.on("error", () => undefined);
      });
      await new Promise<void>((done) => proxy.listen(0, "127.0.0.1", done));
      const address = proxy.address();
      if (address === null || typeof address === "string") throw new Error("the proxy has no port");
      proxyUrl = `http://127.0.0.1:${address.port.toString()}`;
      stun = createSocket("udp4");
      stun.on("message", () => {
        stunHits += 1;
      });
      await new Promise<void>((done) => stun.bind(0, "127.0.0.1", done));
      stunPort = stun.address().port;
    });
    afterAll(async () => {
      await server.close();
      await new Promise((done) => proxy.close(done));
      stun.close();
    });

    /** Runs `use` on a page of the browser launched the way `--offline` launches it, with the recording proxy. */
    async function offline<T>(use: (page: import("playwright-core").Page) => Promise<T>): Promise<T> {
      return withBrowser(
        TEST_CHANNEL,
        async (browser) => {
          const context = await browser.newContext();
          try {
            return await use(await context.newPage());
          } finally {
            await context.close();
          }
        },
        // The product's own launch options, with the proxy swapped for the recording one.
        (options) => chromium.launch({ ...options, args: offlineSwitches(proxyUrl) }),
        { offline: true },
      );
    }

    it("still loads a page on this machine, by 127.0.0.1, localhost and a *.localhost name", async () => {
      const port = new URL(server.origin).port;
      const titles = await offline(async (page) => {
        const seen: string[] = [];
        for (const host of ["127.0.0.1", "localhost", "app.localhost"]) {
          await page.goto(`http://${host}:${port}/clean.html`);
          seen.push(await page.title());
        }
        return seen;
      });
      expect(new Set(titles).size).toBe(1);
      expect(titles[0]).not.toBe("");
    });

    it("sends a page's fetch, a dedicated worker's WebSocket and a shared worker's fetch off the machine to the proxy", async () => {
      proxied.length = 0;
      await offline(async (page) => {
        await page.goto(server.url("clean.html"));
        // In the page, as a string: the tests compile without the browser's own types.
        await page.evaluate(`(async () => {
          const settle = (start) => new Promise((done) => { start(done); setTimeout(done, 3000); });
          await fetch("http://page.example.test/x").catch(() => undefined);
          await settle((done) => {
            const source = 'const s = new WebSocket("wss://worker.example.test/x"); s.onerror = s.onclose = () => postMessage(0);';
            new Worker(URL.createObjectURL(new Blob([source]))).onmessage = () => done();
          });
          await settle((done) => {
            const source = 'onconnect = (e) => fetch("https://shared.example.test/x").catch(() => 0).then(() => e.ports[0].postMessage(0));';
            new SharedWorker(URL.createObjectURL(new Blob([source]))).port.onmessage = () => done();
          });
        })()`);
      });
      expect(proxied).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/^GET http:\/\/page\.example\.test\/x /),
          "CONNECT worker.example.test:443 HTTP/1.1",
          "CONNECT shared.example.test:443 HTTP/1.1",
        ]),
      );
    });

    it("sends no WebRTC UDP at all, not even to a STUN server on this machine", async () => {
      stunHits = 0;
      const candidates = await offline(async (page) => {
        await page.goto(server.url("clean.html"));
        return (await page.evaluate(`new Promise((done) => {
          const seen = [];
          const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:127.0.0.1:${stunPort.toString()}" }] });
          pc.onicecandidate = (event) => {
            if (event.candidate === null) done(seen);
            else seen.push(event.candidate.type + "/" + event.candidate.protocol);
          };
          pc.createDataChannel("x");
          pc.createOffer().then((offer) => pc.setLocalDescription(offer));
          setTimeout(() => done(seen), 3000);
        })`)) as string[];
      });
      await new Promise((done) => setTimeout(done, 300));
      expect(candidates).toEqual([]);
      expect(stunHits).toBe(0);
    });

    it("scans a page on a *.localhost name under --offline", async () => {
      const port = new URL(server.origin).port;
      const record = await runScan({
        url: `http://app.localhost:${port}/clean.html`,
        channel: TEST_CHANNEL,
        offline: true,
      });
      expect(record.summary.notScanned).toBe(0);
    });
  },
);
