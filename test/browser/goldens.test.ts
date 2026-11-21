import { TEST_CHANNEL, TEST_ENGINE_BROWSER } from "../helpers/test-browser.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { renderReport } from "../../src/report.js";
import { parseStateFlags } from "../../src/scan-plan.js";
import { runScan } from "../../src/run-scan.js";
import { expectGolden, GOLDEN_PAGES, GOLDEN_STATES, normalise } from "../helpers/goldens.js";
import { testBrowserIsInstalled, guardContext } from "../helpers/browser-guard.js";
import { startFixtureServer, type FixtureServer } from "../helpers/fixture-server.js";
import { validate } from "../helpers/json-schema.js";
import { readFileSync } from "node:fs";

// Scans each of the golden fixture pages (the four original ones, and no-landmarks) in the tests' browser (Playwright's
// Chromium unless test/helpers/test-browser.ts is told otherwise) and compares what it writes with the goldens in
// test/goldens/, after taking out the port, times, versions and the browser's name. The name is checked here instead,
// against the browser that was launched. UPDATE_GOLDENS=1 rewrites them for review in the diff. Skipped, and says so,
// where the test browser is not installed.
const hasBrowser = await testBrowserIsInstalled();
const schema = JSON.parse(
  readFileSync(new URL("../../schema/scan-1.json", import.meta.url), "utf8"),
) as Record<string, never>;

describe.skipIf(!hasBrowser)(
  "goldens for the fixture pages (skipped where the test browser is not installed)",
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
        pages: [{ url: server.url(`${name}.html`), states: parseStateFlags(GOLDEN_STATES[name] ?? []) }],
        channel: TEST_CHANNEL,
        onContext: async (context) => {
          attempted.push(await guardContext(context, server.origin));
        },
      });
      expect(attempted.flat()).toEqual([]);
      expect(validate(schema, record)).toEqual([]);
      expect(record.exit).toBe(record.findings.length > 0 ? 1 : 0);
      // The goldens read every browser as Chrome; the record itself names the one that ran ("chromium-headless-shell"
      // by default).
      expect(record.engine.fallback).toBe(false);
      expect(record.engine.browser).toMatch(new RegExp(`^${TEST_ENGINE_BROWSER} \\d+(\\.\\d+)*$`));

      const normal = normalise(record);
      expectGolden(name, "scan.json", `${JSON.stringify(normal, null, 2)}\n`);
      expectGolden(name, "report.md", renderReport(normal));
    });
  },
);
