import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  MEASURED_CHROMIUM_BUILD,
  chromiumBuildFolder,
  chromiumCacheFolder,
  chromiumIsInstalled,
  downloadSize,
  installerArgs,
  installerHint,
  playwrightCoreVersion,
  runInstaller,
} from "../../src/chromium-download.js";
import { Refusal } from "../../src/refusal.js";

// Nothing here downloads. The real installer runs only with --dry-run, which prints what it would fetch
// and fetches nothing, and vitest.config.ts points every Playwright download at a dead loopback port.

const require = createRequire(import.meta.url);
const temps: string[] = [];
function temp(): string {
  const folder = mkdtempSync(join(tmpdir(), "a11y-genie-chromium-"));
  temps.push(folder);
  return folder;
}
afterEach(() => {
  for (const folder of temps.splice(0)) rmSync(folder, { recursive: true, force: true });
});

describe("playwright-core's installer", () => {
  it("is the cli.js beside playwright-core's package.json, at the pinned version", () => {
    const [cli, ...rest] = installerArgs(false);
    expect(cli).toBe(join(dirname(require.resolve("playwright-core/package.json")), "cli.js"));
    expect(existsSync(cli!)).toBe(true);
    expect(rest).toEqual(["install", "--no-shell", "--no-remove", "--no-progress", "chromium"]);
    expect(installerArgs(true)).not.toContain("--no-progress");
    expect(playwrightCoreVersion()).toBe("1.65.1");
  });

  it("asks only for Chromium and FFmpeg, not the headless shell (dry run, no network)", () => {
    const args = installerArgs(false).filter((arg) => arg !== "--no-progress");
    const result = spawnSync(process.execPath, [...args, "--dry-run"], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`(playwright chromium v${MEASURED_CHROMIUM_BUILD})`);
    expect(result.stdout).toContain("playwright ffmpeg");
    expect(result.stdout).not.toContain("chromium-headless-shell");
    // The test setting reached the child: any real download would go to a dead loopback port.
    expect(result.stdout).toContain(`Download url:        ${process.env.PLAYWRIGHT_DOWNLOAD_HOST}/`);
  });

  it("is the build whose download was measured; an upgrade must be measured again", () => {
    const browsers = JSON.parse(
      readFileSync(join(dirname(require.resolve("playwright-core/package.json")), "browsers.json"), "utf8"),
    ) as { browsers: { name: string; revision: string }[] };
    expect(browsers.browsers.find((b) => b.name === "chromium")?.revision).toBe(MEASURED_CHROMIUM_BUILD);
  });

  it("has a hint a person can run, naming the same version", () => {
    expect(installerHint()).toBe("npx playwright-core@1.65.1 install --no-shell chromium");
  });
});

describe("the download's size", () => {
  it("is the measured size for the platform, or the largest measured", () => {
    expect(downloadSize("darwin", "arm64")).toBe("about 200 MB");
    expect(downloadSize("linux", "x64")).toBe("about 210 MB");
    expect(downloadSize("win32", "x64")).toBe("about 220 MB");
    expect(downloadSize("freebsd", "x64")).toBe("about 220 MB");
  });
});

describe("the cache", () => {
  const exe = "/home/someone/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome";

  it("is the folder above the chromium-<build> folder", () => {
    expect(chromiumBuildFolder(exe)).toBe("/home/someone/.cache/ms-playwright/chromium-1255");
    expect(chromiumCacheFolder(exe)).toBe("/home/someone/.cache/ms-playwright");
  });

  it("follows PLAYWRIGHT_BROWSERS_PATH, as playwright-core does", () => {
    const folder = temp();
    const result = spawnSync(
      process.execPath,
      ["-e", "console.log(require('playwright-core').chromium.executablePath())"],
      { encoding: "utf8", env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: folder } },
    );
    expect(chromiumCacheFolder(result.stdout.trim())).toBe(folder);
  });

  it("reads a build as installed only when it is whole", () => {
    const build = join(temp(), "chromium-1255");
    const executable = join(build, "chrome-linux64", "chrome");
    expect(chromiumIsInstalled(executable)).toBe(false);
    mkdirSync(dirname(executable), { recursive: true });
    writeFileSync(executable, "");
    expect(chromiumIsInstalled(executable)).toBe(false); // stopped part-way: no marker yet
    writeFileSync(join(build, "INSTALLATION_COMPLETE"), "");
    expect(chromiumIsInstalled(executable)).toBe(true);
  });
});

describe("runInstaller", () => {
  function stub(code: number): string {
    const file = join(temp(), "installer.mjs");
    writeFileSync(file, `process.exit(${code});\n`);
    return file;
  }

  it("resolves when the installer exits 0", async () => {
    await expect(runInstaller([stub(0)])).resolves.toBeUndefined();
  });

  it("refuses, saying how it ended, when the installer fails", async () => {
    const refusal = await runInstaller([stub(1)]).catch((e: unknown) => e);
    expect(refusal).toBeInstanceOf(Refusal);
    expect((refusal as Refusal).message).toBe(
      "the download of Playwright's Chromium did not finish: the installer exited with code 1.",
    );
    expect((refusal as Refusal).hint).toBe(
      `check the network and run again, or download it yourself: ${installerHint()}`,
    );
  });
});
