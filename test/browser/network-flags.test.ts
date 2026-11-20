import { TEST_CHANNEL } from "../helpers/test-browser.js";
import { readFileSync } from "node:fs";
import type { Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { renderReport } from "../../src/report.js";
import {
  OFFLINE_NAVIGATION,
  OTHER_ORIGIN_NAVIGATION,
  runScan,
  type RunScanOptions,
} from "../../src/run-scan.js";
import type { ScanRecord } from "../../src/scan-record.js";
import { testBrowserIsInstalled, guardContext } from "../helpers/browser-guard.js";
import { startFixtureServer, type FixtureServer } from "../helpers/fixture-server.js";
import { validate } from "../helpers/json-schema.js";

// `--offline`, `--same-origin`, `--tags` and `--fail-on` (spec 4.2) against the real Chrome, from 127.0.0.1.
// Two loopback fixture servers: one is the page's own, the other stands in for a host out on the network
// (`--offline` reads it as off the machine through the test-only declared origins; `--same-origin` needs no
// declaring, since another port is another origin). The other server records every request it receives, so a
// stopped request is proved never to have arrived. Skipped, and says so, where Chrome is not installed.
const hasBrowser = await testBrowserIsInstalled();
const schema = JSON.parse(
  readFileSync(new URL("../../schema/scan-1.json", import.meta.url), "utf8"),
) as Record<string, never>;

describe.skipIf(!hasBrowser)(
  "the rule and network flags (skipped where the test browser is not installed)",
  () => {
    let server: FixtureServer;
    let far: FixtureServer;

    beforeAll(async () => {
      far = await startFixtureServer();
      server = await startFixtureServer(undefined, {
        redirects: {
          "/hostile/to-private/image": `${far.origin}/private/image-after-redirect`,
          "/hostile/to-private/fetch": `${far.origin}/private/fetch-after-redirect`,
          "/hostile/to-private/frame": `${far.origin}/private/frame-after-redirect`,
          "/hostile/elsewhere": `${far.origin}/clean.html`,
        },
      });
    });
    afterAll(async () => {
      await server.close();
      await far.close();
    });

    async function scan(path: string, options: Partial<RunScanOptions> = {}): Promise<ScanRecord> {
      const attempted: string[][] = [];
      const record = await runScan({
        url: server.url(path),
        channel: TEST_CHANNEL,
        ...options,
        onContext: async (context) => {
          // The guard lets both servers through to the product's own rules, and aborts anything else.
          attempted.push(await guardContext(context, [server.origin, far.origin]));
        },
      });
      expect(attempted.flat()).toEqual([]);
      expect(validate(schema, record)).toEqual([]);
      return record;
    }

    const settled = async (tab: Page) => {
      await tab.evaluate("window.privateDone");
    };
    const reach = (which: string) =>
      `hostile/private-network.html?case=${which}&private=${encodeURIComponent(far.origin)}`;
    const page = (record: ScanRecord) => {
      const first = record.pages[0];
      if (first === undefined) throw new Error("the record has no page");
      return first;
    };
    const arrived = (from: number) => far.requests.slice(from);

    /** How the page reaches the other server, and the address the stopped request was going to. */
    const reaches: [what: string, which: string, address: () => string][] = [
      ["a fetch", "fetch", () => `${far.origin}/private/fetch`],
      ["an iframe", "iframe", () => `${far.origin}/private/frame.html`],
      ["an image", "image", () => `${far.origin}/private/image.png`],
      ["a WebSocket", "websocket", () => `ws://127.0.0.1:${far.port}/private/socket`],
      ["a worker's fetch", "worker", () => `${far.origin}/private/worker`],
      ["an image's redirect hop", "redirect-image", () => `${far.origin}/private/image-after-redirect`],
      ["a fetch's redirect hop", "redirect-fetch", () => `${far.origin}/private/fetch-after-redirect`],
      ["an iframe's redirect hop", "redirect-frame", () => `${far.origin}/private/frame-after-redirect`],
    ];

    describe("--offline", () => {
      it.each(reaches)(
        "%s to a host off the machine is aborted before it arrives, and noted",
        async (_what, which, address) => {
          const from = far.requests.length;
          const record = await scan(reach(which), {
            offline: true,
            publicOrigins: [far.origin],
            onLoaded: settled,
          });
          expect(page(record).notScanned).toEqual([]);
          expect(arrived(from)).toEqual([]);
          expect(page(record).stopped).toEqual([{ kind: "offline", count: 1, examples: [address()] }]);
          expect(record.options).toEqual({ failOn: "minor", sameOrigin: false, offline: true });
          const report = renderReport(record);
          expect(report).toContain("1 request off this machine, aborted.");
          expect(report).toContain("`--offline`");
        },
      );

      it("lets the page's own loopback server through, and notes nothing", async () => {
        const record = await scan("clean.html", { offline: true, publicOrigins: [far.origin] });
        expect(page(record).notScanned).toEqual([]);
        expect(page(record).stopped).toEqual([]);
        expect(record.exit).toBe(0);
      });

      it("reads a page that is redirected off the machine as not scanned, and exits 1", async () => {
        const from = far.requests.length;
        const record = await scan("hostile/elsewhere", { offline: true, publicOrigins: [far.origin] });
        expect(page(record).notScanned).toEqual([{ state: "default", reason: OFFLINE_NAVIGATION }]);
        expect(record.exit).toBe(1);
        expect(arrived(from)).toEqual([]);
      });

      it("without the flag the same request arrives", async () => {
        const from = far.requests.length;
        const record = await scan(reach("fetch"), { publicOrigins: [far.origin], onLoaded: settled });
        expect(page(record).stopped).toEqual([]);
        expect(arrived(from)).toEqual(["GET /private/fetch"]);
      });
    });

    describe("--same-origin", () => {
      it.each(reaches)(
        "%s to another origin is aborted before it arrives, and noted",
        async (_what, which, address) => {
          const from = far.requests.length;
          const record = await scan(reach(which), { sameOrigin: true, onLoaded: settled });
          expect(page(record).notScanned).toEqual([]);
          expect(arrived(from)).toEqual([]);
          expect(page(record).stopped).toEqual([{ kind: "other-origin", count: 1, examples: [address()] }]);
          expect(record.options).toEqual({ failOn: "minor", sameOrigin: true, offline: false });
          const report = renderReport(record);
          expect(report).toContain("1 request to another origin, blocked.");
          expect(report).toContain("`--same-origin`");
          expect(report).toContain("some of the page's content");
        },
      );

      it("lets the page's own origin through, and notes nothing", async () => {
        const record = await scan("clean.html", { sameOrigin: true });
        expect(page(record).stopped).toEqual([]);
        expect(record.exit).toBe(0);
      });

      it("reads a page that moves itself to another origin as not scanned", async () => {
        const from = far.requests.length;
        const record = await scan(reach("navigate"), { sameOrigin: true, onLoaded: settled });
        expect(page(record).notScanned).toEqual([{ state: "default", reason: OTHER_ORIGIN_NAVIGATION }]);
        expect(arrived(from)).toEqual([]);
      });

      it("reads a page that is redirected to another origin as not scanned, and exits 1", async () => {
        const record = await scan("hostile/elsewhere", { sameOrigin: true });
        expect(page(record).notScanned).toEqual([{ state: "default", reason: OTHER_ORIGIN_NAVIGATION }]);
        expect(record.exit).toBe(1);
      });

      it("without the flag the same request arrives", async () => {
        const from = far.requests.length;
        await scan(reach("fetch"), { onLoaded: settled });
        expect(arrived(from)).toEqual(["GET /private/fetch"]);
      });
    });

    describe("--tags", () => {
      const ids = (record: ScanRecord) => record.findings.map((f) => `${f.rule.source}/${f.rule.id}`);

      it("with no tags records null, and the default rules run", async () => {
        const record = await scan("no-main.html");
        expect(record.engine.tags).toBeNull();
        expect(ids(record)).toEqual(["axe/landmark-one-main"]);
      });

      it("runs exactly the tags given, records them, and runs fewer rules", async () => {
        const all = await scan("no-main.html");
        const some = await scan("no-main.html", { tags: ["wcag2a"] });
        expect(some.engine.tags).toEqual(["wcag2a"]);
        expect(some.engine.rulesRun).toBeGreaterThan(0);
        expect(some.engine.rulesRun).toBeLessThan(all.engine.rulesRun);
        // The landmark rules are best practices: without that tag they do not run.
        expect(ids(some)).toEqual([]);
        expect(renderReport(some)).toContain("using the tags wcag2a");
      });

      it("with best-practice, the landmark rules run", async () => {
        const record = await scan("no-main.html", { tags: ["wcag2a", "best-practice"] });
        expect(record.engine.tags).toEqual(["wcag2a", "best-practice"]);
        expect(ids(record)).toEqual(["axe/landmark-one-main"]);
      });

      it("runs the product's own no-landmarks check only with best-practice", async () => {
        expect(ids(await scan("no-landmarks.html", { tags: ["wcag2a"] }))).toEqual([]);
        expect(ids(await scan("no-landmarks.html", { tags: ["best-practice"] }))).toContain(
          "genie/no-landmarks",
        );
      });
    });

    describe("--fail-on", () => {
      // no-main.html has one finding, landmark-one-main, and it is moderate.
      it("exits 0 over a page with only moderate findings when the floor is serious", async () => {
        const record = await scan("no-main.html", { failOn: "serious" });
        expect(record.summary).toMatchObject({ critical: 0, serious: 0, moderate: 1, minor: 0 });
        expect(record.findings).toHaveLength(1);
        expect(record.exit).toBe(0);
        expect(record.options?.failOn).toBe("serious");
        expect(renderReport(record)).toContain("at or above serious (`--fail-on`)");
      });

      it.each(["moderate", "minor"] as const)(
        "exits 1 over the same page when the floor is %s",
        async (failOn) => {
          expect((await scan("no-main.html", { failOn })).exit).toBe(1);
        },
      );

      it("exits 1 for a page that was not scanned, whatever the floor", async () => {
        const record = await scan("hostile/elsewhere", { sameOrigin: true, failOn: "critical" });
        expect(record.exit).toBe(1);
      });

      it("lets a page with a serious finding exit 1 at serious", async () => {
        // impact-mix.html carries findings of several impacts.
        const record = await scan("impact-mix.html", { failOn: "serious" });
        expect(record.summary.critical + record.summary.serious).toBeGreaterThan(0);
        expect(record.exit).toBe(1);
      });
    });
  },
);
