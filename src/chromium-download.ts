import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";
import { chromium } from "playwright-core";
import { onInterrupted } from "./interrupt.js";
import { Refusal } from "./refusal.js";

/**
 * Playwright's Chromium: where it lives, whether it is there, and how it is downloaded.
 *
 * The download is playwright-core's own installer, its CLI's `install` command, run as a child process
 * under this Node (`process.execPath`), so nothing is installed globally. Checked at playwright-core
 * 1.65.1; docs/ARCHITECTURE.md (V10) has the measurements.
 */

const require = createRequire(import.meta.url);

/** playwright-core's folder. Its `package.json` is exported, and its CLI, `cli.js`, sits beside it. */
function playwrightCoreFolder(): string {
  return dirname(require.resolve("playwright-core/package.json"));
}

/** The installed playwright-core's version, read from its package.json, so the hint names the same one. */
export function playwrightCoreVersion(): string {
  const text = readFileSync(join(playwrightCoreFolder(), "package.json"), "utf8");
  return (JSON.parse(text) as { version: string }).version;
}

/**
 * The installer's arguments, after `process.execPath`:
 *
 * - `install chromium` fetches Playwright's Chromium (Chrome for Testing) and FFmpeg, which playwright-core
 *   installs with it;
 * - `--no-shell` skips Chrome Headless Shell, a second Chromium build of about 100 MB. A11y Genie launches
 *   `channel: "chromium"`, the full build, which runs the same headless mode as the branded Chrome;
 * - `--no-remove` stops the installer from deleting other Playwright browsers in the shared cache that it
 *   thinks no one uses. A tool that fetches its own browser has no business removing anyone else's;
 * - `--no-progress` when stderr is not a terminal, so an agent's log gets a few lines, not a progress bar.
 */
export function installerArgs(progress: boolean = process.stderr.isTTY === true): string[] {
  const args = [join(playwrightCoreFolder(), "cli.js"), "install", "--no-shell", "--no-remove"];
  if (!progress) args.push("--no-progress");
  args.push("chromium");
  return args;
}

/** The same download, for a person to run themselves. A refusal's hint names it. */
export function installerHint(): string {
  return `npx playwright-core@${playwrightCoreVersion()} install --no-shell chromium`;
}

/**
 * The download's size, measured from Playwright's servers for playwright-core 1.65.1 (Chromium
 * 159.0.8154.6, build 1255, plus FFmpeg build 1013), on 2026-11-19, in megabytes of 1,000,000 bytes.
 * docs/ARCHITECTURE.md (V10) has each file. A test pins the build, so an upgrade is measured again.
 */
const DOWNLOAD_MB: Record<string, number> = {
  "darwin-arm64": 200,
  "darwin-x64": 210,
  "linux-x64": 210,
  "linux-arm64": 210,
  "win32-x64": 220,
};

/** The build the sizes above were measured for. */
export const MEASURED_CHROMIUM_BUILD = "1255";

export function downloadSize(platform: string = process.platform, arch: string = process.arch): string {
  // The largest measured size, where this platform was not measured.
  return `about ${DOWNLOAD_MB[`${platform}-${arch}`] ?? 220} MB`;
}

/** Where playwright-core keeps Playwright's Chromium: the executable it launches for `channel: "chromium"`. */
export function chromiumExecutable(): string {
  return chromium.executablePath();
}

/**
 * The build's folder (`chromium-<build>`) holds the executable, and Playwright's cache holds the build's
 * folder: `~/Library/Caches/ms-playwright` on macOS, `~/.cache/ms-playwright` on Linux,
 * `%LOCALAPPDATA%\ms-playwright` on Windows, or `PLAYWRIGHT_BROWSERS_PATH` when it is set.
 */
export function chromiumBuildFolder(executable: string = chromiumExecutable()): string {
  let folder = dirname(executable);
  while (!/^chromium-\d+$/.test(basename(folder))) {
    const up = dirname(folder);
    if (up === folder) throw new Error(`not inside a chromium-<build> folder: ${executable}`);
    folder = up;
  }
  return folder;
}

export function chromiumCacheFolder(executable: string = chromiumExecutable()): string {
  return dirname(chromiumBuildFolder(executable));
}

/**
 * Whether Playwright's Chromium is installed, whole. playwright-core writes `INSTALLATION_COMPLETE` in the
 * build's folder after unpacking, so a download stopped part-way reads as not installed, and the
 * installer starts it again.
 */
export function chromiumIsInstalled(executable: string = chromiumExecutable()): boolean {
  return existsSync(executable) && existsSync(join(chromiumBuildFolder(executable), "INSTALLATION_COMPLETE"));
}

export function downloadFailedRefusal(reason: string): Refusal {
  return new Refusal(
    `the download of Playwright's Chromium did not finish: ${reason}.`,
    `check the network and run again, or download it yourself: ${installerHint()}`,
  );
}

/**
 * How long Ctrl-C waits for the installer to stop after sending it SIGINT, in milliseconds, before it sends
 * SIGKILL. It is below `CLEANUP_CAP_MS`, so the kill comes before src/interrupt.ts exits anyway.
 */
export const INSTALLER_STOP_MS = 3_000;

/** How long the installer may take to go after SIGKILL, which it cannot catch. */
const KILLED_MS = 1_000;

/**
 * Runs playwright-core's installer as a child and waits for it. Its output goes to our stderr, never stdout,
 * so `--json` keeps stdout for the one document. Ctrl-C stops it: SIGINT, then a wait for it to exit (it is
 * writing into this run's private temp folder, which goes when this process exits), then SIGKILL after
 * `INSTALLER_STOP_MS` if it is still there.
 */
export function runInstaller(args: string[] = installerArgs()): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: ["ignore", 2, 2] });
    const exited = new Promise<void>((done) => child.once("exit", () => done()));
    const gone = () => child.pid === undefined || child.exitCode !== null || child.signalCode !== null;
    const forget = onInterrupted(async () => {
      if (gone()) return;
      child.kill("SIGINT");
      if (await exitsWithin(exited, INSTALLER_STOP_MS)) return;
      child.kill("SIGKILL");
      await exitsWithin(exited, KILLED_MS);
    });
    child.on("error", (error) => {
      forget();
      reject(downloadFailedRefusal(error.message));
    });
    child.on("close", (code, signal) => {
      forget();
      if (code === 0) resolve();
      else
        reject(
          downloadFailedRefusal(
            signal !== null
              ? `the installer was stopped by ${signal}`
              : `the installer exited with code ${code}`,
          ),
        );
    });
  });
}

/** Whether `exited` settles within `ms`. */
async function exitsWithin(exited: Promise<void>, ms: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<boolean>((done) => {
    timer = setTimeout(() => done(false), ms);
  });
  try {
    return await Promise.race([exited.then(() => true), late]);
  } finally {
    clearTimeout(timer);
  }
}
