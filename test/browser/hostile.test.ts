import { TEST_CHANNEL } from "../helpers/test-browser.js";
import { readFileSync } from "node:fs";
import type { Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withBrowser } from "../../src/browser.js";
import { armContext, CONTEXT_OPTIONS, LIMITS, type Limits } from "../../src/context.js";
import { renderReport } from "../../src/report.js";
import { PRIVATE_NAVIGATION, runScan } from "../../src/run-scan.js";
import { scanJson, type ScanRecord } from "../../src/scan-record.js";
import { testBrowserIsInstalled, guardContext } from "../helpers/browser-guard.js";
import { controlsIn } from "../helpers/controls.js";
import { startFixtureServer, type FixtureServer } from "../helpers/fixture-server.js";
import { validate } from "../helpers/json-schema.js";

// Each defence of the browser context (src/context.ts, spec 8A.1) against its own hostile fixture page in
// test/fixtures/site/hostile/, scanned in the machine's real Chrome from 127.0.0.1. Every test checks the
// defence held, and that the scan still ended: scanned, or *not scanned* with its reason. Every request the
// browser makes off the two fixture servers is aborted, and each scan checks none was tried. Skipped, and
// says so, where Chrome is not installed.
const hasBrowser = await testBrowserIsInstalled();
const schema = JSON.parse(
  readFileSync(new URL("../../schema/scan-1.json", import.meta.url), "utf8"),
) as Record<string, never>;

/** A short page time limit, so the pages that never finish are given up on quickly. */
const SHORT: Partial<Limits> = { pageMs: 3000 };

describe("the context's options, in one place", () => {
  it("refuse downloads, grant no permission and block service workers", () => {
    expect(CONTEXT_OPTIONS).toEqual({ acceptDownloads: false, permissions: [], serviceWorkers: "block" });
  });

  it("hold the limits docs/ARCHITECTURE.md gives, under *The caps*", () => {
    expect(LIMITS).toEqual({
      pageMs: 60_000,
      redirects: 10,
      elementsPerFinding: 500,
      excerptChars: 160,
      scanJsonBytes: 50 * 1024 * 1024,
      stoppedExamples: 5,
    });
  });
});

describe.skipIf(!hasBrowser)(
  "hostile pages: the browser context (skipped where the test browser is not installed)",
  () => {
    let server: FixtureServer;
    let elsewhere: FixtureServer;
    /** The private-network rule's stand-in for a service on the person's machine or network. */
    let privateServer: FixtureServer;
    /** The same fixture server by another name, so a frame from it is on another site. */
    let otherSite: string;

    beforeAll(async () => {
      // A second fixture server, for a redirect to another origin.
      elsewhere = await startFixtureServer();
      privateServer = await startFixtureServer();
      const toPrivate = Object.fromEntries(
        ["image", "fetch", "frame", "worker", "popup", "top"].map((name) => [
          `/hostile/to-private/${name}`,
          `${privateServer.origin}/private/${name}-after-redirect`,
        ]),
      );
      const chain = (name: string, hops: number): Record<string, string> =>
        Object.fromEntries(
          Array.from({ length: hops }, (_, i) => [
            `/hostile/${name}/${i + 1}`,
            i + 1 === hops ? "/clean.html" : `/hostile/${name}/${i + 2}`,
          ]),
        );
      server = await startFixtureServer(undefined, {
        redirects: {
          "/hostile/to-file": "file:///etc/hosts",
          "/hostile/to-chrome": "chrome://version",
          "/hostile/to-data": "data:text/html,<p>redirected</p>",
          "/hostile/to-about": "about:blank",
          "/hostile/to-javascript": "javascript:alert(1)",
          "/hostile/elsewhere": `${elsewhere.origin}/clean.html`,
          ...chain("three", 3),
          ...chain("twelve", 12),
          ...toPrivate,
        },
      });
      otherSite = `http://localhost:${server.port}`;
    });
    afterAll(async () => {
      await server.close();
      await elsewhere.close();
      await privateServer.close();
    });

    interface Scan {
      record: ScanRecord;
      elapsedMs: number;
    }

    /**
     * Scans one fixture path in a guarded context, and checks no request left the fixture servers. Unless a
     * test says otherwise, `publicOrigins` is empty, so every target is loopback and the private-network
     * rule does not hold.
     */
    async function scan(
      path: string,
      options: {
        limits?: Partial<Limits>;
        onLoaded?: (page: Page) => Promise<void>;
        publicOrigins?: readonly string[];
        allowPrivate?: boolean;
      } = {},
    ): Promise<Scan> {
      const attempted: string[][] = [];
      const started = Date.now();
      const record = await runScan({
        url: server.url(path),
        channel: TEST_CHANNEL,
        ...options,
        onContext: async (context) => {
          attempted.push(
            await guardContext(context, [server.origin, elsewhere.origin, privateServer.origin, otherSite]),
          );
        },
      });
      expect(attempted.flat()).toEqual([]);
      expect(validate(schema, record)).toEqual([]);
      return { record, elapsedMs: Date.now() - started };
    }

    function page(record: ScanRecord) {
      const first = record.pages[0];
      if (first === undefined) throw new Error("the record has no page");
      return first;
    }

    function expectScanned(record: ScanRecord): void {
      expect(page(record).notScanned).toEqual([]);
      expect(record.engine.rulesRun).toBeGreaterThan(50);
    }

    function expectNotScanned(record: ScanRecord, reason: RegExp): void {
      expect(page(record).notScanned).toHaveLength(1);
      expect(page(record).notScanned[0]?.reason).toMatch(reason);
      expect(record.summary.notScanned).toBe(1);
      expect(record.exit).toBe(1);
      expect(record.findings).toEqual([]);
      // A page nobody saw never reads as if nothing was found.
      expect(renderReport(record)).not.toContain("No problems found");
      expect(renderReport(record)).toContain("was not scanned");
    }

    describe("downloads are refused", () => {
      it("a download the page starts is cancelled and noted, and the page is scanned", async () => {
        const { record } = await scan("hostile/download.html");
        expectScanned(record);
        expect(page(record).stopped).toEqual([
          { kind: "download", count: 1, examples: [server.url("hostile/payload.bin")] },
        ]);
      });

      it("a page that answers with a file to download reads not scanned", async () => {
        const { record } = await scan("hostile/payload.bin");
        expectNotScanned(record, /answered with a file to download, and downloads are refused/);
      });
    });

    describe("permissions are denied", () => {
      it("geolocation, the camera, the microphone and notifications are not granted", async () => {
        let answers: Record<string, string> = {};
        const { record } = await scan("hostile/permissions.html", {
          onLoaded: async (tab) => {
            await tab.evaluate("window.permissionsDone");
            answers = await tab.evaluate<Record<string, string>>("window.permissionAnswers");
          },
        });
        expectScanned(record);
        expect(answers).toMatchObject({
          "query geolocation": "denied",
          "query camera": "denied",
          "query microphone": "denied",
          "query notifications": "denied",
          "notification request": "denied",
          // 1 is PERMISSION_DENIED.
          position: "error 1",
        });
        // Refused outright, or never answered: either way, no stream.
        expect(answers.camera).not.toBe("granted");
        expect(answers.microphone).not.toBe("granted");
      });
    });

    describe("service workers are blocked", () => {
      it("no service worker is registered, and none controls the page", async () => {
        let seen: { registrations: number; controlled: boolean; workers: number } | undefined;
        const { record } = await scan("hostile/service-worker.html", {
          onLoaded: async (tab) => {
            await tab.evaluate("window.registration");
            const inPage = await tab.evaluate<{ registrations: number; controlled: boolean }>(
              `navigator.serviceWorker.getRegistrations().then((all) => ({
              registrations: all.length,
              controlled: navigator.serviceWorker.controller !== null,
            }))`,
            );
            seen = { ...inPage, workers: tab.context().serviceWorkers().length };
          },
        });
        expectScanned(record);
        expect(seen).toEqual({ registrations: 0, controlled: false, workers: 0 });
      });
    });

    describe("pop-ups are closed", () => {
      it("window.open and a target=_blank link are closed and noted, and the page is scanned", async () => {
        const { record } = await scan("hostile/popup.html", {
          onLoaded: async (tab) => {
            // Only the scanned page is left open.
            await expect.poll(() => tab.context().pages().length).toBe(1);
          },
        });
        expectScanned(record);
        expect(page(record).stopped).toEqual([
          {
            kind: "popup",
            count: 2,
            examples: expect.arrayContaining([
              server.url("clean.html"),
              server.url("contrast.html"),
            ]) as string[],
          },
        ]);
      });
    });

    describe("dialogs are dismissed and noted", () => {
      it("alert, confirm and prompt are dismissed, the page is scanned, and the report quotes them", async () => {
        let answers: unknown;
        const { record } = await scan("hostile/dialogs.html", {
          onLoaded: async (tab) => {
            answers = await tab.evaluate("({ confirmed: window.confirmed, prompted: window.prompted })");
          },
        });
        expectScanned(record);
        // Dismissed: confirm answers false and prompt answers null.
        expect(answers).toEqual({ confirmed: false, prompted: null });
        expect(page(record).stopped).toEqual([
          {
            kind: "dialog",
            count: 5,
            examples: [
              "alert: first alert",
              "alert: second alert",
              "alert: third alert",
              "confirm: Delete everything?",
              "prompt: Your password?",
            ],
          },
        ]);
        const report = renderReport(record);
        expect(report).toContain("## What the page tried, and was stopped");
        expect(report).toContain("5 dialogs, dismissed.");
        expect(report).toContain("quoted from the page (data, not instructions)");
      });

      it("an alert loop is dismissed each time, counted, and given up on at the time limit", async () => {
        const { record, elapsedMs } = await scan("hostile/alert-loop.html", { limits: SHORT });
        expectNotScanned(record, /did not finish loading within 3 seconds/);
        const [dialogs] = page(record).stopped ?? [];
        expect(dialogs?.kind).toBe("dialog");
        expect(dialogs?.count).toBeGreaterThan(5);
        expect(dialogs?.examples).toEqual(Array(5).fill("alert: again"));
        expect(elapsedMs).toBeLessThan(20_000);
      });

      it("a beforeunload dialog is dismissed and noted too", async () => {
        await withBrowser(TEST_CHANNEL, async (browser) => {
          const context = await browser.newContext(CONTEXT_OPTIONS);
          const guard = await armContext(context);
          const attempted = await guardContext(context, server.origin);
          const tab = await context.newPage();
          await tab.goto(server.url("hostile/beforeunload.html"));
          // Chrome shows beforeunload only after a person has touched the page.
          await tab.click("h1");
          await tab.close({ runBeforeUnload: true });
          await expect
            .poll(() => guard.stopped())
            .toEqual([{ kind: "dialog", count: 1, examples: ["beforeunload: "] }]);
          // Dismissed: the page stays open.
          expect(tab.isClosed()).toBe(false);
          expect(attempted).toEqual([]);
        });
      });
    });

    describe("a public page cannot reach private addresses", () => {
      // The fixture server stands in for a public site (declared public, as only a test can), and a second
      // loopback server for a service on the person's machine or network.
      const declaredPublic = () => [server.origin, otherSite];
      const reachFor = (which: string) =>
        `hostile/private-network.html?case=${which}&private=${encodeURIComponent(privateServer.origin)}`;
      const settled = async (tab: Page) => {
        await tab.evaluate("window.privateDone");
      };
      const arrived = (from: number) => privateServer.requests.slice(from);

      const reaches: [string, string, string][] = [
        ["a fetch", "fetch", "GET /private/fetch"],
        ["an iframe", "iframe", "GET /private/frame.html"],
        ["an image", "image", "GET /private/image.png"],
        ["a WebSocket", "websocket", "WEBSOCKET /private/socket"],
        ["a worker's fetch", "worker", "GET /private/worker"],
        ["an image's redirect hop", "redirect-image", "GET /private/image-after-redirect"],
        ["a fetch's redirect hop", "redirect-fetch", "GET /private/fetch-after-redirect"],
        ["an iframe's redirect hop", "redirect-frame", "GET /private/frame-after-redirect"],
        ["a worker fetch's redirect hop", "worker-redirect", "GET /private/worker-after-redirect"],
        [
          "a redirect hop inside a frame on another site",
          "cross-site-frame",
          "GET /private/image-after-redirect",
        ],
      ];

      it.each(reaches)("%s is aborted before it arrives, and noted", async (_what, which, request) => {
        const from = privateServer.requests.length;
        const { record } = await scan(reachFor(which), {
          publicOrigins: declaredPublic(),
          onLoaded: settled,
        });
        expectScanned(record);
        expect(arrived(from)).toEqual([]);
        const path = request.split(" ")[1] ?? "";
        const address = `${request.startsWith("WEBSOCKET") ? "ws" : "http"}://127.0.0.1:${privateServer.port}${path}`;
        expect(page(record).stopped).toEqual([{ kind: "private-network", count: 1, examples: [address] }]);
        const report = renderReport(record);
        expect(report).toContain("1 request to a private address, blocked.");
        expect(report).toContain(address);
      });

      it.each(reaches)("with --allow-private, %s arrives", async (_what, which, request) => {
        const from = privateServer.requests.length;
        const { record } = await scan(reachFor(which), {
          publicOrigins: declaredPublic(),
          allowPrivate: true,
          onLoaded: settled,
        });
        expectScanned(record);
        expect(arrived(from)).toContain(request);
        expect(page(record).stopped).toEqual([]);
      });

      it("a known gap: a dedicated worker's WebSocket is not caught, and arrives (SECURITY.md)", async () => {
        // Neither routeWebSocket, nor Fetch, nor Network.setBlockedURLs sees a worker's WebSocket at
        // playwright-core 1.65.1 and Chrome 158. This pins the finding: if it starts failing, the gap has
        // closed, and the docs should say so.
        const from = privateServer.requests.length;
        const { record } = await scan(reachFor("worker-websocket"), {
          publicOrigins: declaredPublic(),
          onLoaded: settled,
        });
        expectScanned(record);
        expect(arrived(from)).toContain("WEBSOCKET /private/worker-socket");
      });

      it("V12, at playwright-core 1.65.1: route() sees only the first request of a chain, and no WebSocket", async () => {
        await withBrowser(TEST_CHANNEL, async (browser) => {
          const context = await browser.newContext(CONTEXT_OPTIONS);
          const routed: string[] = [];
          await context.route("**/*", async (route) => {
            routed.push(new URL(route.request().url()).pathname);
            await route.continue();
          });
          const attempted = await guardContext(context, [server.origin, privateServer.origin]);
          const tab = await context.newPage();
          const from = privateServer.requests.length;
          for (const which of ["redirect-image", "websocket"]) {
            await tab.goto(server.url(reachFor(which)));
            await settled(tab);
          }
          // Both arrived; route() saw the first request of the redirect, and neither the hop nor the socket.
          expect(arrived(from)).toEqual(
            expect.arrayContaining(["GET /private/image-after-redirect", "WEBSOCKET /private/socket"]),
          );
          expect(routed).toContain("/hostile/to-private/image");
          expect(routed).not.toContain("/private/image-after-redirect");
          expect(routed).not.toContain("/private/socket");
          expect(attempted).toEqual([]);
        });
      });

      it("the page keeps the rule when it moves to another site, in another process", async () => {
        await withBrowser(TEST_CHANNEL, async (browser) => {
          const context = await browser.newContext(CONTEXT_OPTIONS);
          const guard = await armContext(context, LIMITS, {
            target: server.url("clean.html"),
            publicOrigins: declaredPublic(),
          });
          const attempted = await guardContext(context, [server.origin, privateServer.origin, otherSite]);
          const tab = await context.newPage();
          await guard.watchMainPage(tab);
          const from = privateServer.requests.length;
          await tab.goto(server.url("clean.html"));
          await tab.goto(`${otherSite}/${reachFor("redirect-image")}`);
          await settled(tab);
          expect(arrived(from)).toEqual([]);
          expect(guard.stopped()).toEqual([
            {
              kind: "private-network",
              count: 1,
              examples: [privateServer.url("private/image-after-redirect")],
            },
          ]);
          expect(attempted).toEqual([]);
        });
      });

      it("a loopback target is not limited: its page reaches its own kind", async () => {
        const from = privateServer.requests.length;
        const { record } = await scan(reachFor("image"), { onLoaded: settled });
        expectScanned(record);
        expect(arrived(from)).toContain("GET /private/image.png");
        expect(page(record).stopped).toEqual([]);
      });

      it("a pop-up loads nothing, so its redirect hop to a private address never starts", async () => {
        const from = privateServer.requests.length;
        const { record } = await scan(reachFor("popup-redirect"), {
          publicOrigins: declaredPublic(),
          onLoaded: settled,
        });
        expectScanned(record);
        expect(arrived(from)).toEqual([]);
        expect(page(record).stopped?.map((entry) => entry.kind)).toEqual(["popup"]);
      });

      it("a public page that redirects to a private address reads not scanned", async () => {
        const from = privateServer.requests.length;
        const { record } = await scan("hostile/to-private/top", { publicOrigins: declaredPublic() });
        expectNotScanned(record, /loopback, link-local or private address/);
        expect(page(record).notScanned[0]?.reason).toBe(PRIVATE_NAVIGATION);
        expect(arrived(from)).toEqual([]);
        expect(page(record).stopped).toEqual([
          {
            kind: "private-network",
            count: 1,
            examples: [privateServer.url("private/top-after-redirect")],
          },
        ]);
      });

      it("a public page that moves itself to a private address reads not scanned", async () => {
        const from = privateServer.requests.length;
        const { record } = await scan(reachFor("navigate"), { publicOrigins: declaredPublic() });
        expectNotScanned(record, /loopback, link-local or private address/);
        expect(arrived(from)).toEqual([]);
      });

      it("only a declared origin reads public, and only when it is the one scanned", async () => {
        // The declaration names another origin than the target: the target stays loopback, not limited.
        const from = privateServer.requests.length;
        const { record } = await scan(reachFor("image"), {
          publicOrigins: [elsewhere.origin],
          onLoaded: settled,
        });
        expectScanned(record);
        expect(arrived(from)).toContain("GET /private/image.png");
      });
    });

    describe("page text is printed without its escapes", () => {
      it("report.md carries no escape or control character, and scan.json keeps the text exactly", async () => {
        const ESC = String.fromCharCode(0x1b);
        const { record } = await scan("hostile/escapes.html");
        expectScanned(record);
        // scan.json is data: the dialogs are quoted exactly as the page wrote them.
        const [dialogs] = page(record).stopped ?? [];
        expect(dialogs?.kind).toBe("dialog");
        expect(dialogs?.examples[0]).toContain(`${ESC}[31mRED${ESC}[0m alert ${ESC}]0;window title`);
        // Chrome hands the carriage return over as a newline.
        expect(dialogs?.examples[1]).toMatch(/^confirm: fake[\r\n]Error: overwritten /);
        const imageAlt = record.findings.find((f) => f.rule.id === "image-alt");
        expect(imageAlt?.elements[0]?.html).toContain(`${ESC}[31mRED`);
        // The file holds them as escapes, and no raw control.
        const json = scanJson(record);
        expect(json).toContain(String.raw`\u001b[31mRED`);
        expect(json).toContain(String.raw`\u009b1;31m8-bit`);
        expect(controlsIn(json)).toEqual([]);
        // report.md quotes the same text with every sequence stripped whole.
        const report = renderReport(record);
        expect(controlsIn(report)).toEqual([]);
        expect(report).toContain("RED alert click here");
        // Each example on its own line, so a newline in one cannot pass for another.
        expect(report).toContain("confirm: fake Error: overwritten txt.exe");
        expect(report).not.toContain("window title");
        expect(report).not.toContain("evil.example");
        expect(report).not.toContain("[31m");
      });
    });

    describe("only http: and https: are loaded", () => {
      it.each([
        ["file:", "hostile/to-file", /redirected to an address that is not http: or https:/],
        ["chrome:", "hostile/to-chrome", /redirected to an address that is not http: or https:/],
        ["data:", "hostile/to-data", /redirected to an address that is not http: or https:/],
        ["about:", "hostile/to-about", /redirected to an address that is not http: or https:/],
        ["javascript:", "hostile/to-javascript", /stopped loading it .*javascript:/],
      ])("a redirect to %s reads not scanned, and says why", async (_scheme, path, reason) => {
        const { record } = await scan(path);
        expectNotScanned(record, reason);
        expect(page(record).url).toBe(server.url(path));
      });

      it("a page that replaces itself with about:blank reads not scanned", async () => {
        const { record } = await scan("hostile/moves-to-blank.html");
        expectNotScanned(record, /went to an about: address, which is not http: or https:/);
      });

      it("a page's own move to file:, chrome: or data: is refused, and the page is scanned as itself", async () => {
        const { record } = await scan("hostile/script-moves.html");
        expectScanned(record);
        expect(page(record).url).toBe(server.url("hostile/script-moves.html"));
      });
    });

    describe("redirects are followed to a cap, and the final address is recorded", () => {
      it("three redirects are followed, and both addresses are recorded", async () => {
        const { record } = await scan("hostile/three/1");
        expectScanned(record);
        expect(page(record)).toMatchObject({
          requestedUrl: server.url("hostile/three/1"),
          url: server.url("clean.html"),
          redirects: 3,
        });
        expect(renderReport(record)).toContain("after 3 redirects it ended on");
      });

      it("past ten redirects the scan stops following, and the page reads not scanned", async () => {
        const { record } = await scan("hostile/twelve/1");
        expectNotScanned(record, /redirected more than 10 times, so the scan stopped following it/);
      });

      it("a redirect to another origin is scanned there, recorded, and reported", async () => {
        const { record } = await scan("hostile/elsewhere");
        expectScanned(record);
        expect(record.target.origin).toBe(server.origin);
        expect(page(record)).toMatchObject({
          requestedUrl: server.url("hostile/elsewhere"),
          url: elsewhere.url("clean.html"),
          redirects: 1,
        });
        expect(renderReport(record)).toContain("which is another origin than the one asked for");
      });
    });

    describe("the time, element and size caps", () => {
      it("a page whose load never ends reads not scanned at the time limit", async () => {
        const { record, elapsedMs } = await scan("hostile/busy-load.html", { limits: SHORT });
        expectNotScanned(record, /did not finish loading within 3 seconds/);
        expect(elapsedMs).toBeLessThan(20_000);
      });

      it("a page that never lets axe-core run reads not scanned at the time limit", async () => {
        const { record, elapsedMs } = await scan("hostile/busy-after-load.html", { limits: SHORT });
        expectNotScanned(record, /the scan did not finish within 3 seconds/);
        expect(elapsedMs).toBeLessThan(20_000);
      });

      it("a finding keeps 500 elements and counts the rest, each quoted element cut to 160 characters", async () => {
        const { record } = await scan("hostile/many-elements.html");
        expectScanned(record);
        const imageAlt = record.findings.find((f) => f.rule.id === "image-alt");
        expect(imageAlt?.elements).toHaveLength(500);
        expect(imageAlt?.elementsCut).toBe(100);
        for (const element of imageAlt?.elements ?? []) {
          expect([...element.html].length).toBeLessThanOrEqual(161);
          expect(element.html.endsWith("…")).toBe(true);
        }
        expect(record.limits).toMatchObject({ elementsPerFinding: 500, excerptChars: 160 });
        expect(renderReport(record)).toContain("500 listed, and 100 more not listed");
      });

      it("scan.json is held to its size limit, and what was cut is counted in it", async () => {
        const limit = 60_000;
        const { record } = await scan("hostile/many-elements.html", { limits: { scanJsonBytes: limit } });
        expectScanned(record);
        expect(Buffer.byteLength(scanJson(record))).toBeLessThanOrEqual(limit);
        const imageAlt = record.findings.find((f) => f.rule.id === "image-alt");
        expect(imageAlt?.elements.length).toBeGreaterThanOrEqual(1);
        expect((imageAlt?.elements.length ?? 0) + (imageAlt?.elementsCut ?? 0)).toBe(600);
        expect(record.limits?.scanJsonBytes).toBe(limit);
      });

      it("a scan.json that cannot be cut to fit reads not scanned", async () => {
        const { record } = await scan("hostile/many-elements.html", { limits: { scanJsonBytes: 3000 } });
        expectNotScanned(record, /larger than the 3000 byte limit on scan.json/);
      });
    });
  },
);
