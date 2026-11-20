import type { Browser, LaunchOptions } from "playwright-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BrowserNotFound,
  NO_BROWSER_ENV,
  isNotInstalledError,
  withBrowser,
  type Launcher,
} from "../../src/browser.js";
import { Refusal } from "../../src/refusal.js";

// No browser runs here: the launcher is a stand-in.
function fakeBrowser() {
  const close = vi.fn(async () => {});
  return { browser: { close } as unknown as Browser, close };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("withBrowser", () => {
  it("asks playwright-core for the channel, headless, and never for a profile folder", async () => {
    const { browser } = fakeBrowser();
    const seen: LaunchOptions[] = [];
    const launcher: Launcher = async (options) => {
      seen.push(options);
      return browser;
    };
    await withBrowser("msedge", async () => undefined, launcher);
    expect(seen).toEqual([
      { channel: "msedge", headless: true, handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false },
    ]);
  });

  it("closes the browser when the run throws", async () => {
    const { browser, close } = fakeBrowser();
    await expect(
      withBrowser(
        "chrome",
        async () => {
          throw new Error("boom");
        },
        async () => browser,
      ),
    ).rejects.toThrow("boom");
    expect(close).toHaveBeenCalledOnce();
  });

  it("turns playwright-core's not-found error into a refusal", async () => {
    const launcher: Launcher = async () => {
      throw new Error(
        "browserType.launch: Chromium distribution 'chrome' is not found at /opt/google/chrome/chrome\n" +
          'Run "npx playwright install chrome"',
      );
    };
    const refusal = await withBrowser("chrome", async () => undefined, launcher).catch((e: unknown) => e);
    expect(refusal).toBeInstanceOf(Refusal);
    expect(refusal).toBeInstanceOf(BrowserNotFound);
    expect((refusal as Refusal).message).toBe("Chrome was not found on this machine.");
    expect((refusal as Refusal).hint).toContain("--browser-channel chromium");
    expect((refusal as Refusal).hint).toContain("msedge");
  });

  it("turns a missing Playwright's Chromium into a refusal, and never downloads it", async () => {
    const launcher: Launcher = async () => {
      throw new Error(
        "browserType.launch: Executable doesn't exist at /cache/chromium-1255/chrome-linux64/chrome",
      );
    };
    const refusal = await withBrowser("chromium", async () => undefined, launcher).catch((e: unknown) => e);
    expect(refusal).toBeInstanceOf(BrowserNotFound);
    expect((refusal as Refusal).message).toBe("Playwright's Chromium is not installed on this machine.");
  });

  it("passes other launch errors through unchanged", async () => {
    const launcher: Launcher = async () => {
      throw new Error("Target page, context or browser has been closed");
    };
    const error = await withBrowser("chrome", async () => undefined, launcher).catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(Refusal);
  });

  it(`refuses without launching when ${NO_BROWSER_ENV}=1`, async () => {
    vi.stubEnv(NO_BROWSER_ENV, "1");
    const launcher = vi.fn<Launcher>();
    await expect(withBrowser("chrome", async () => undefined, launcher)).rejects.toBeInstanceOf(Refusal);
    expect(launcher).not.toHaveBeenCalled();
  });
});

describe("isNotInstalledError", () => {
  it("knows playwright-core's not-installed messages", () => {
    expect(isNotInstalledError(new Error("Chromium distribution 'msedge' is not found at /x"))).toBe(true);
    expect(isNotInstalledError(new Error("Chromium distribution 'msedge' is not supported on linux"))).toBe(
      true,
    );
    expect(isNotInstalledError(new Error("browserType.launch: Executable doesn't exist at /x/chrome"))).toBe(
      true,
    );
    expect(isNotInstalledError(new Error("Timeout 180000ms exceeded."))).toBe(false);
    expect(isNotInstalledError("not an error")).toBe(false);
  });
});
