import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Overrides the per-user scans folder. Tests set it to a temporary folder, and a person may set it to keep
 * scans somewhere else. `--out` wins over it.
 */
export const SCANS_DIR_ENV = "A11Y_GENIE_SCANS_DIR";

/** A setting that is set to something: an empty one is as good as unset, and `resolve("")` is the working folder. */
function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value === "" ? undefined : value;
}

/**
 * The per-user scans folder, outside any scanned project: `~/.local/share/a11y-genie` on Linux
 * (under `XDG_DATA_HOME` when set), `~/Library/Application Support/a11y-genie` on macOS, and
 * `%LOCALAPPDATA%\a11y-genie` on Windows.
 */
export function defaultScansDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string {
  const override = nonEmpty(env[SCANS_DIR_ENV]);
  if (override !== undefined) return override;
  if (platform === "darwin") return join(home, "Library", "Application Support", "a11y-genie");
  if (platform === "win32")
    return join(nonEmpty(env.LOCALAPPDATA) ?? join(home, "AppData", "Local"), "a11y-genie");
  return join(nonEmpty(env.XDG_DATA_HOME) ?? join(home, ".local", "share"), "a11y-genie");
}

/** A site's folder name, from its origin: `http://localhost:5173` is `localhost-5173`. Safe as one path part. */
export function originKey(origin: string): string {
  const url = new URL(origin);
  const host = url.hostname
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/^[.-]+/, "");
  const key = url.port === "" ? host : `${host}-${url.port}`;
  return key === "" ? "site" : key;
}

/** A scan's folder name, from its start time: `2026-11-19T20:14:03Z` is `2026-11-19T20-14-03Z`. */
export function scanFolderName(startedAt: string): string {
  return startedAt.replace(/:/g, "-");
}

/** Makes the scan's folder under `<root>/<origin key>/`, adding `-2`, `-3` if a scan began the same second. */
export function makeScanFolder(root: string, origin: string, startedAt: string): string {
  const site = join(root, originKey(origin));
  mkdirSync(site, { recursive: true });
  const name = scanFolderName(startedAt);
  for (let n = 1; ; n++) {
    const folder = join(site, n === 1 ? name : `${name}-${n}`);
    try {
      mkdirSync(folder);
      return folder;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
}

export function writeScanFile(folder: string, name: string, text: string): void {
  writeFileSync(join(folder, name), text, "utf8");
}
