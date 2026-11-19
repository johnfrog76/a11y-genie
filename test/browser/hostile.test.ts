import { readFileSync } from "node:fs";
import type { Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withBrowser } from "../../src/browser.js";
import { armContext, CONTEXT_OPTIONS, LIMITS, type Limits } from "../../src/context.js";
import { renderReport } from "../../src/report.js";
import { runScan } from "../../src/run-scan.js";
import { scanJson, type ScanRecord } from "../../src/scan-record.js";
import { chromeIsInstalled, guardContext } from "../helpers/browser-guard.js";
import { startFixtureServer, type FixtureServer } from "../helpers/fixture-server.js";
import { validate } from "../helpers/json-schema.js";

// Each defence of the browser context (src/context.ts, spec 8A.1) against its own hostile fixture page in
// test/fixtures/site/hostile/, scanned in the machine's real Chrome from 127.0.0.1. Every test checks the
// defence held, and that the scan still ended: scanned, or *not scanned* with its reason. Every request the
// browser makes off the two fixture servers is aborted, and each scan checks none was tried. Skipped, and
// says so, where Chrome is not installed.
const hasChrome = await chromeIsInstalled();
const schema = JSON.parse(
  readFileSync(new URL("../../schema/scan-1.json", import.meta.url), "utf8"),
) as Record<string, never>;

/** A short page time limit, so the pages that never finish are given up on quickly. */
const SHORT: Partial<Limits> = { pageMs: 3000 };

describe("the context's options, in one place", () => {
  it("refuse downloads, grant no permission and block service workers", () => {
    expect(CONTEXT_OPTIONS).toEqual({ acceptDownloads: false, permissions: [], serviceWorkers: "block" });
  });

  it("hold the spec's limits, and conservative ones where it gives none", () => {
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

describe.skipIf(!hasChrome)(
  "hostile pages: the browser context (skipped where Chrome is not installed)",
  () => {
    let server: FixtureServer;
    let elsewhere: FixtureServer;

    beforeAll(async () => {
      // A second fixture server, for a redirect to another origin.
      elsewhere = await startFixtureServer();
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
        },
      });
    });
    afterAll(async () => {
      await server.close();
      await elsewhere.close();
    });

    interface Scan {
      record: ScanRecord;
      elapsedMs: number;
    }

    /** Scans one fixture path in a guarded context, and checks no request left the fixture servers. */
    async function scan(
      path: string,
      options: { limits?: Partial<Limits>; onLoaded?: (page: Page) => Promise<void> } = {},
    ): Promise<Scan> {
      const attempted: string[][] = [];
      const started = Date.now();
      const record = await runScan({
        url: server.url(path),
        channel: "chrome",
        ...options,
        onContext: async (context) => {
          attempted.push(await guardContext(context, [server.origin, elsewhere.origin]));
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
        await withBrowser("chrome", async (browser) => {
          const context = await browser.newContext(CONTEXT_OPTIONS);
          const guard = armContext(context);
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
