import type { BrowserContext } from "playwright-core";
import { withBrowser } from "../../src/browser.js";
import { Refusal } from "../../src/refusal.js";

/** Whether the machine's Chrome can be launched. Browser tests skip themselves, by name, where it cannot. */
export async function chromeIsInstalled(): Promise<boolean> {
  try {
    await withBrowser("chrome", async () => undefined);
    return true;
  } catch (error) {
    // withBrowser refuses when the channel is not installed; any other error is a real failure.
    if (error instanceof Refusal) return false;
    throw error;
  }
}

/**
 * The browser-side half of the no-network guard (test/helpers/no-network.ts covers Node only).
 *
 * Routes every request the context makes: a request to `origin` (the fixture server) goes on, and any
 * other is aborted before it leaves the browser and recorded. A test asserts the record is empty, so a
 * fixture or a library that reaches out is caught. `data:` URLs are not requests and are not routed.
 */
export async function guardContext(context: BrowserContext, origin: string): Promise<string[]> {
  const attempted: string[] = [];
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    if (new URL(url).origin === origin) {
      await route.continue();
    } else {
      attempted.push(url);
      await route.abort("blockedbyclient");
    }
  });
  return attempted;
}
