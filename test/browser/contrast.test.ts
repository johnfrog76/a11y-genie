import { TEST_CHANNEL } from "../helpers/test-browser.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { renderReport } from "../../src/report.js";
import { runScan } from "../../src/run-scan.js";
import { testBrowserIsInstalled, guardContext } from "../helpers/browser-guard.js";
import { startFixtureServer, type FixtureServer } from "../helpers/fixture-server.js";

// For contrast, the report names the exact pair of colours that failed. Run in the machine's real
// Chrome on contrast.html; skipped, and says so, where Chrome is not installed. The ratio is whatever
// axe-core measured, which the test reads from the record rather than typing.
const hasBrowser = await testBrowserIsInstalled();

describe.skipIf(!hasBrowser)(
  "the colour pair on contrast.html (skipped where the test browser is not installed)",
  () => {
    let server: FixtureServer;
    beforeAll(async () => {
      server = await startFixtureServer();
    });
    afterAll(async () => {
      await server.close();
    });

    it("#9a9a9a on #ffffff, 2.81, needs 4.5", async () => {
      const attempted: string[][] = [];
      const record = await runScan({
        url: server.url("contrast.html"),
        channel: TEST_CHANNEL,
        onContext: async (context) => {
          attempted.push(await guardContext(context, server.origin));
        },
      });
      expect(attempted.flat()).toEqual([]);
      const pair = record.findings[0]?.elements[0]?.colorPair;
      expect(pair).toEqual({
        foreground: "#9a9a9a",
        background: "#ffffff",
        ratio: 2.81,
        required: 4.5,
        fontSize: "12.0pt (16px)",
        fontWeight: "normal",
      });
      // The same number is in axe-core's own sentence, so the pair cannot drift from it.
      expect(record.findings[0]?.elements[0]?.failure).toContain(`contrast of ${pair?.ratio} `);
      expect(renderReport(record)).toContain("#9a9a9a on #ffffff, 2.81, needs 4.5");
    });
  },
);
