import type { BrowserContext } from "playwright-core";
import { scanPage } from "./axe.js";
import { withBrowser, type BrowserChannel } from "./browser.js";
import { pageKeyOf } from "./map-axe.js";
import { packageInfo } from "./package-info.js";
import { buildScanRecord, type ScanRecord } from "./scan-record.js";

export interface RunScanOptions {
  url: string;
  channel: BrowserChannel;
  /** Called with the new browser context before the page loads. Tests use it to install the no-network guard. */
  onContext?: (context: BrowserContext) => Promise<void>;
}

/** The time as `2026-11-19T20:14:03Z`: ISO 8601, to the second, in UTC. */
function stamp(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Loads one URL in a new context of a browser with a new, empty profile, scans it, and returns the record. */
export async function runScan(options: RunScanOptions): Promise<ScanRecord> {
  const startedAt = stamp();
  return withBrowser(options.channel, async (browser) => {
    const context = await browser.newContext();
    await options.onContext?.(context);
    const tab = await context.newPage();
    await tab.goto(options.url);
    const axe = await scanPage(tab);
    return buildScanRecord({
      tool: packageInfo(),
      browser: `${options.channel} ${browser.version()}`,
      url: tab.url(),
      pageKey: pageKeyOf(tab.url()),
      startedAt,
      finishedAt: stamp(),
      axe,
    });
  });
}
