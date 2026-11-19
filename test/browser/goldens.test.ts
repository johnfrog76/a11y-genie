import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { renderReport } from "../../src/report.js";
import { runScan } from "../../src/run-scan.js";
import { expectGolden, GOLDEN_PAGES, normalise } from "../helpers/goldens.js";
import { chromeIsInstalled, guardContext } from "../helpers/browser-guard.js";
import { startFixtureServer, type FixtureServer } from "../helpers/fixture-server.js";
import { validate } from "../helpers/json-schema.js";
import { readFileSync } from "node:fs";

// Scans each of the four original fixture pages in the machine's real Chrome and compares what it writes
// with the goldens in test/goldens/, after taking out the port, times and versions. UPDATE_GOLDENS=1
// rewrites them for review in the diff. Skipped, and says so, where Chrome is not installed.
const hasChrome = await chromeIsInstalled();
const schema = JSON.parse(
  readFileSync(new URL("../../schema/scan-1.json", import.meta.url), "utf8"),
) as Record<string, never>;

describe.skipIf(!hasChrome)(
  "goldens for the four fixture pages (skipped where Chrome is not installed)",
  () => {
    let server: FixtureServer;
    beforeAll(async () => {
      server = await startFixtureServer();
    });
    afterAll(async () => {
      await server.close();
    });

    it.each(GOLDEN_PAGES)("%s.html gives its golden scan.json and report.md", async (name) => {
      const attempted: string[][] = [];
      const record = await runScan({
        url: server.url(`${name}.html`),
        channel: "chrome",
        onContext: async (context) => {
          attempted.push(await guardContext(context, server.origin));
        },
      });
      expect(attempted.flat()).toEqual([]);
      expect(validate(schema, record)).toEqual([]);
      expect(record.exit).toBe(record.findings.length > 0 ? 1 : 0);

      const normal = normalise(record);
      expectGolden(name, "scan.json", `${JSON.stringify(normal, null, 2)}\n`);
      expectGolden(name, "report.md", renderReport(normal));
    });
  },
);
