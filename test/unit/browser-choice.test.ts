import type { Browser, LaunchOptions } from "playwright-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NO_BROWSER_ENV, BrowserNotFound, type Launcher } from "../../src/browser.js";
import {
  fallbackLines,
  noDownloadRefusal,
  withChosenBrowser,
  type BrowserChoice,
  type BrowserChoiceDeps,
} from "../../src/browser-choice.js";
import { downloadSize, installerHint } from "../../src/chromium-download.js";
import { Refusal } from "../../src/refusal.js";

// No browser runs and nothing is downloaded here: the launcher, the installer and the cache are stand-ins.
// They stand for a machine with no Chrome on it, the case the fallback is for.

const CACHE = "/home/someone/.cache/ms-playwright";
const NOT_FOUND =
  "browserType.launch: Chromium distribution 'chrome' is not found at /opt/google/chrome/chrome";

/** A machine: which branded browsers it has, and whether Playwright's Chromium is in the cache. */
function machine(has: { chrome?: boolean; msedge?: boolean; chromium?: boolean } = {}) {
  const state = { chromium: has.chromium ?? false };
  const launched: LaunchOptions[] = [];
  const said: string[] = [];
  const installs = vi.fn(async () => {
    state.chromium = true;
  });
  const launcher: Launcher = async (options) => {
    launched.push(options);
    const channel = options.channel as "chrome" | "msedge" | "chromium";
    const present = channel === "chromium" ? state.chromium : (has[channel] ?? false);
    if (!present) {
      throw new Error(
        channel === "chromium"
          ? `browserType.launch: Executable doesn't exist at ${CACHE}/chromium-1255/chrome-linux64/chrome`
          : NOT_FOUND.replace("'chrome'", `'${channel}'`),
      );
    }
    return { close: async () => {}, version: () => "159.0.8154.6" } as unknown as Browser;
  };
  const deps: BrowserChoiceDeps = {
    launcher,
    chromiumInstalled: () => state.chromium,
    installChromium: installs,
    cacheFolder: () => CACHE,
    say: (line) => said.push(line),
  };
  return { deps, launched, said, installs, state };
}

function run(choice: Omit<BrowserChoice, "deps">, deps: BrowserChoiceDeps) {
  return withChosenBrowser({ ...choice, deps }, async (_browser, used) => used);
}

const DEFAULT = { channel: "chrome", named: false, download: true } as const;
const lines = fallbackLines(downloadSize(), CACHE);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("with Chrome installed", () => {
  it("launches Chrome, says nothing and downloads nothing", async () => {
    const m = machine({ chrome: true });
    expect(await run(DEFAULT, m.deps)).toEqual({ channel: "chrome", fallback: false });
    expect(m.launched.map((o) => o.channel)).toEqual(["chrome"]);
    expect(m.said).toEqual([]);
    expect(m.installs).not.toHaveBeenCalled();
  });
});

describe("with no Chrome, and no --browser-channel", () => {
  it("says so in one line, downloads Playwright's Chromium once, and launches it", async () => {
    const m = machine();
    expect(await run(DEFAULT, m.deps)).toEqual({ channel: "chromium", fallback: true });
    expect(m.said).toEqual([lines.downloading]);
    expect(m.installs).toHaveBeenCalledOnce();
    expect(m.launched).toEqual([
      { channel: "chrome", headless: true, handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false },
      { channel: "chromium", headless: true, handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false },
    ]);
  });

  it("does not download again on a second run", async () => {
    const m = machine();
    await run(DEFAULT, m.deps);
    m.said.length = 0;
    expect(await run(DEFAULT, m.deps)).toEqual({ channel: "chromium", fallback: true });
    expect(m.installs).toHaveBeenCalledOnce();
    expect(m.said).toEqual([lines.using]);
  });

  it("says the size and the cache in the line", () => {
    expect(lines.downloading).toBe(
      `Chrome was not found, so A11y Genie is downloading Playwright's Chromium (${downloadSize()}) once, into ${CACHE}. --browser-channel names another browser.`,
    );
    expect(lines.downloading).toMatch(/\(about \d+ MB\)/);
  });

  it("with --no-download, refuses with one Error and one Hint, and downloads nothing", async () => {
    const m = machine();
    const refusal = await run({ ...DEFAULT, download: false }, m.deps).catch((e: unknown) => e);
    expect(refusal).toBeInstanceOf(Refusal);
    expect((refusal as Refusal).message).toBe(
      "Chrome was not found on this machine, and --no-download stops A11y Genie from downloading Playwright's Chromium.",
    );
    expect((refusal as Refusal).hint).toBe(
      `Install Chrome, or run with --browser-channel msedge if that one is installed, or download Playwright's Chromium yourself: ${installerHint()}`,
    );
    expect(m.installs).not.toHaveBeenCalled();
    expect(m.said).toEqual([]);
    expect(m.launched.map((o) => o.channel)).toEqual(["chrome"]);
  });

  it("with --no-download and Chromium already in the cache, uses it", async () => {
    const m = machine({ chromium: true });
    expect(await run({ ...DEFAULT, download: false }, m.deps)).toEqual({
      channel: "chromium",
      fallback: true,
    });
    expect(m.installs).not.toHaveBeenCalled();
  });

  it("refuses when the download fails, and launches nothing after it", async () => {
    const m = machine();
    const failed = new Refusal("the download of Playwright's Chromium did not finish: x.", "hint");
    m.deps.installChromium = async () => {
      throw failed;
    };
    await expect(run(DEFAULT, m.deps)).rejects.toBe(failed);
    expect(m.said).toEqual([lines.downloading]);
    expect(m.launched.map((o) => o.channel)).toEqual(["chrome"]);
  });

  it("refuses when the installer finishes but the browser is still missing", async () => {
    const m = machine();
    m.deps.installChromium = async () => {};
    const refusal = await run(DEFAULT, m.deps).catch((e: unknown) => e);
    expect(refusal).toBeInstanceOf(Refusal);
    expect((refusal as Refusal).message).toMatch(/^the download of Playwright's Chromium did not finish: /);
  });
});

describe("a named --browser-channel", () => {
  it("a named chrome that is missing is refused, never replaced", async () => {
    const m = machine({ chromium: true });
    const refusal = await run({ ...DEFAULT, named: true }, m.deps).catch((e: unknown) => e);
    expect(refusal).toBeInstanceOf(BrowserNotFound);
    expect((refusal as Refusal).message).toBe("Chrome was not found on this machine.");
    expect(m.launched.map((o) => o.channel)).toEqual(["chrome"]);
    expect(m.installs).not.toHaveBeenCalled();
  });

  it("an msedge that is missing is refused, never replaced", async () => {
    const m = machine({ chrome: true, chromium: true });
    const refusal = await run({ channel: "msedge", named: true, download: true }, m.deps).catch(
      (e: unknown) => e,
    );
    expect(refusal).toBeInstanceOf(BrowserNotFound);
    expect((refusal as Refusal).message).toBe("Microsoft Edge was not found on this machine.");
    expect(m.launched.map((o) => o.channel)).toEqual(["msedge"]);
  });

  it("chromium uses Playwright's Chromium directly, downloading it once if needed", async () => {
    const m = machine({ chrome: true });
    const choice = { channel: "chromium", named: true, download: true } as const;
    expect(await run(choice, m.deps)).toEqual({ channel: "chromium", fallback: false });
    expect(m.said).toEqual([lines.downloadingNamed]);
    expect(await run(choice, m.deps)).toEqual({ channel: "chromium", fallback: false });
    expect(m.installs).toHaveBeenCalledOnce();
    expect(m.said).toEqual([lines.downloadingNamed]);
    expect(m.launched.map((o) => o.channel)).toEqual(["chromium", "chromium"]);
  });

  it("chromium with --no-download and no Chromium is refused", async () => {
    const m = machine({ chrome: true });
    const refusal = await run({ channel: "chromium", named: true, download: false }, m.deps).catch(
      (e: unknown) => e,
    );
    expect(refusal).toEqual(noDownloadRefusal(false));
    expect((refusal as Refusal).hint).toContain(installerHint());
    expect(m.installs).not.toHaveBeenCalled();
    expect(m.launched).toEqual([]);
  });
});

describe(`${NO_BROWSER_ENV}=1`, () => {
  it("reads every browser as missing and turns the download into a refusal", async () => {
    vi.stubEnv(NO_BROWSER_ENV, "1");
    const said: string[] = [];
    const refusal = await withChosenBrowser(
      { ...DEFAULT, deps: { say: (line) => said.push(line), cacheFolder: () => CACHE } },
      async () => "launched",
    ).catch((e: unknown) => e);
    expect(refusal).toBeInstanceOf(Refusal);
    expect((refusal as Refusal).message).toBe(
      `the download of Playwright's Chromium did not finish: downloads are turned off by ${NO_BROWSER_ENV}.`,
    );
    expect(said).toEqual([lines.downloading]);
  });
});

describe("errors that are not a missing browser", () => {
  it("pass on unchanged, and never fall back", async () => {
    const m = machine({ chromium: true });
    m.deps.launcher = async () => {
      throw new Error("Target page, context or browser has been closed");
    };
    await expect(run(DEFAULT, m.deps)).rejects.toThrow("Target page, context or browser has been closed");
    expect(m.installs).not.toHaveBeenCalled();
  });

  it("a refusal from the run itself is not taken for a missing browser", async () => {
    const m = machine({ chrome: true, chromium: true });
    const own = new Refusal("http://127.0.0.1:9 did not answer: the connection was refused.", "hint");
    await expect(
      withChosenBrowser({ ...DEFAULT, deps: m.deps }, async () => {
        throw own;
      }),
    ).rejects.toBe(own);
    expect(m.launched.map((o) => o.channel)).toEqual(["chrome"]);
  });
});
