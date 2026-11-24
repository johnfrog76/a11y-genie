import type { Browser, LaunchOptions } from "playwright-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BrowserNotFound,
  HEADLESS_SHELL_ENV,
  NO_BROWSER_ENV,
  engineBrowserName,
  isNotInstalledError,
  OFFLINE_PROXY,
  offlineSwitches,
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

  it("adds no switch unless --offline, and the offline switches with it", async () => {
    const { browser } = fakeBrowser();
    const seen: LaunchOptions[] = [];
    const launcher: Launcher = async (options) => {
      seen.push(options);
      return browser;
    };
    await withBrowser("chrome", async () => undefined, launcher, { offline: false });
    await withBrowser("chrome", async () => undefined, launcher, { offline: true });
    expect(seen[0]?.args).toBeUndefined();
    expect(seen[1]?.args).toEqual(offlineSwitches());
  });

  it("sends --offline's connections to a dead loopback proxy, holds WebRTC to it, and looks up loopback names only", () => {
    expect(OFFLINE_PROXY).toBe("http://127.0.0.1:9");
    expect(offlineSwitches()).toEqual([
      "--proxy-server=http://127.0.0.1:9",
      "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
      "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE *.localhost, EXCLUDE 127.*, EXCLUDE [::1]",
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

describe(`the tests' headless shell, ${HEADLESS_SHELL_ENV}=1`, () => {
  function recording() {
    const { browser } = fakeBrowser();
    const seen: LaunchOptions[] = [];
    const launcher: Launcher = async (options) => {
      seen.push(options);
      return browser;
    };
    return { seen, launcher };
  }
  const HANDLERS_OFF = { handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false };

  it("launches chromium with no channel, headless, which is playwright-core's headless shell", async () => {
    vi.stubEnv(HEADLESS_SHELL_ENV, "1");
    const { seen, launcher } = recording();
    await withBrowser("chromium", async () => undefined, launcher);
    expect(seen).toEqual([{ headless: true, ...HANDLERS_OFF }]);
    expect(engineBrowserName("chromium")).toBe("chromium-headless-shell");
  });

  it("leaves chrome and msedge as they are", async () => {
    vi.stubEnv(HEADLESS_SHELL_ENV, "1");
    const { seen, launcher } = recording();
    await withBrowser("chrome", async () => undefined, launcher);
    await withBrowser("msedge", async () => undefined, launcher);
    expect(seen.map((options) => options.channel)).toEqual(["chrome", "msedge"]);
    expect(engineBrowserName("chrome")).toBe("chrome");
  });

  it("without it, chromium is launched by its channel and named by it", async () => {
    vi.stubEnv(HEADLESS_SHELL_ENV, "");
    const { seen, launcher } = recording();
    await withBrowser("chromium", async () => undefined, launcher);
    expect(seen).toEqual([{ channel: "chromium", headless: true, ...HANDLERS_OFF }]);
    expect(engineBrowserName("chromium")).toBe("chromium");
  });

  it("says the shell is missing, by name, when it is", async () => {
    vi.stubEnv(HEADLESS_SHELL_ENV, "1");
    const launcher: Launcher = async () => {
      throw new Error(
        "browserType.launch: Executable doesn't exist at /cache/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell",
      );
    };
    const refusal = await withBrowser("chromium", async () => undefined, launcher).catch((e: unknown) => e);
    expect(refusal).toBeInstanceOf(BrowserNotFound);
    expect((refusal as Refusal).message).toBe(
      `Playwright's headless shell is not installed on this machine, and ${HEADLESS_SHELL_ENV}=1 asks for it.`,
    );
    expect((refusal as Refusal).hint).toBe(
      `install it once: npx playwright-core@1.65.1 install chromium, or unset ${HEADLESS_SHELL_ENV}.`,
    );
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
