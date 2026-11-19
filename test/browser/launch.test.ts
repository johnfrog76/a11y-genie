import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname } from "node:path";
import { chromium, type Browser } from "playwright-core";
import { describe, expect, it } from "vitest";
import { isNotInstalledError, withBrowser } from "../../src/browser.js";
import { Refusal } from "../../src/refusal.js";

// These tests launch the machine's real Chrome. Where Chrome is not installed they are skipped,
// and say so in their names. They load only about:blank and chrome:// pages: no network.
async function chromeIsInstalled(): Promise<boolean> {
  try {
    const browser = await chromium.launch({ channel: "chrome" });
    await browser.close();
    return true;
  } catch (error) {
    if (isNotInstalledError(error)) return false;
    throw error;
  }
}

const hasChrome = await chromeIsInstalled();

/** The profile folder the running browser uses, read from its own chrome://version page. */
async function profileFolder(browser: Browser): Promise<string> {
  const page = await browser.newPage();
  await page.goto("chrome://version");
  const profilePath = (await page.locator("#profile_path").innerText()).trim();
  await page.close();
  // chrome://version names the profile inside the folder (".../Default"); the folder is its parent.
  return dirname(profilePath);
}

describe.skipIf(!hasChrome)("the installed Chrome (skipped where Chrome is not installed)", () => {
  it("runs on a new profile folder in the temp folder, deleted after the run", async () => {
    const started = Date.now();
    let folder = "";
    await withBrowser("chrome", async (browser) => {
      folder = await profileFolder(browser);
      expect(existsSync(folder)).toBe(true);
      expect(folder.startsWith(realpathSync(tmpdir()))).toBe(true);
      expect(basename(folder)).toMatch(/^playwright_chromiumdev_profile-/);
      // New: the folder was made for this run, not reused.
      expect(statSync(folder).birthtimeMs).toBeGreaterThanOrEqual(started - 1000);
    });
    expect(folder).not.toBe("");
    expect(existsSync(folder)).toBe(false);
  });

  it("gives each run its own profile folder", async () => {
    const first = await withBrowser("chrome", profileFolder);
    const second = await withBrowser("chrome", profileFolder);
    expect(first).not.toBe(second);
  });

  it("deletes the profile folder when the run throws", async () => {
    let folder = "";
    await expect(
      withBrowser("chrome", async (browser) => {
        folder = await profileFolder(browser);
        throw new Error("the run failed part-way");
      }),
    ).rejects.toThrow("the run failed part-way");
    expect(folder).not.toBe("");
    expect(existsSync(folder)).toBe(false);
  });

  it("launches the branded Chrome, not Playwright's Chromium", async () => {
    await withBrowser("chrome", async (browser) => {
      const page = await browser.newPage();
      await page.goto("chrome://version");
      const executable = await page.locator("#executable_path").innerText();
      expect(executable).toMatch(/Google Chrome|google-chrome|chrome\.exe/i);
      expect(executable).not.toMatch(/ms-playwright/);
    });
  });
});

describe("a browser that is not installed", () => {
  it("leaves no profile or artifacts folder behind (skipped where Edge is installed)", async (ctx) => {
    const playwrightFolders = () =>
      readdirSync(tmpdir()).filter((name) => /^playwright(_chromiumdev_profile|-artifacts)-/.test(name));
    const before = new Set(playwrightFolders());
    const outcome = await withBrowser("msedge", async () => "launched").catch((e: unknown) => e);
    if (outcome === "launched") ctx.skip();
    expect(outcome).toBeInstanceOf(Refusal);
    expect(playwrightFolders().filter((name) => !before.has(name))).toEqual([]);
  });
});
