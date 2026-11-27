import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

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
 * The per-user scans folder (spec 4.4), outside any scanned project: `~/.local/share/a11y-genie` on Linux
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

/** The longest a site's folder name may be, well under the 255 a path part may be on every system. */
export const MAX_SITE_FOLDER = 100;

/** The hash a site's folder name ends in when it was cut or its host changed: the full origin's, 10 hex digits. */
function originHash(origin: string): string {
  return createHash("sha256").update(origin).digest("hex").slice(0, 10);
}

/**
 * A site's folder name, from its origin: the scheme, `_`, the host, and the port when it is not the scheme's own.
 * `http://localhost:5173` is `http_localhost-5173`, and `https://example.com` is `https_example.com`. A host that
 * had to change to be one path part (`[::1]`, a trailing dot) adds `_` and a hash of the full origin, and so does a
 * name over `MAX_SITE_FOLDER` characters, cut to fit: two origins never share a name. Safe as one path part on
 * macOS, Linux and Windows. The `_` is never in a name of the old scheme (`oldOriginKey`), so the two never meet.
 */
export function originKey(origin: string): string {
  const url = new URL(origin);
  const scheme = url.protocol.replace(/:$/, "").replace(/[^a-z0-9]+/g, "");
  const host = url.hostname
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "");
  const name = `${scheme}_${host === "" ? "site" : host}${url.port === "" ? "" : `-${url.port}`}`;
  if (host === url.hostname && name.length <= MAX_SITE_FOLDER) return name;
  const hash = `_${originHash(url.origin)}`;
  const cut = name.slice(0, MAX_SITE_FOLDER - hash.length).replace(/[._-]+$/, "");
  return `${cut}${hash}`;
}

/**
 * The name the scans of a site went under before issue #162, kept only to find the last scan in it: the host and
 * port, `localhost-5173`, the same for `http` and `https`, and not cut. Nothing is written under it any more.
 */
export function oldOriginKey(origin: string): string {
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

/**
 * The start of the name of a scan folder still being written. It begins with a dot and is never a start time, so
 * the last-scan lookup (`latestScanFolder` in src/baseline.ts) never reads one as a scan. Only a crash part way
 * through a write can leave one behind.
 */
export const UNFINISHED_PREFIX = ".unfinished-";

/**
 * Writes a scan's folder under `<root>/<origin key>/` whole or not at all. `fill` writes the files into an
 * unfinished folder beside the final place, which is then renamed into place in one step, as `<start time>`, or
 * with `-2`, `-3` if a scan began the same second. When anything fails, the unfinished folder is removed, and so
 * are the site folder and the root if this write made them, and the error is thrown on.
 */
export function writeScanFolder(
  root: string,
  origin: string,
  startedAt: string,
  fill: (folder: string) => void,
): string {
  const site = join(root, originKey(origin));
  const firstMade = mkdirSync(site, { recursive: true });
  const name = scanFolderName(startedAt);
  let unfinished: string | undefined;
  try {
    unfinished = mkdtempSync(join(site, `${UNFINISHED_PREFIX}${name}-`));
    fill(unfinished);
    return renameIntoPlace(unfinished, site, name);
  } catch (error) {
    // The refusal names the write's own error, never one from cleaning up after it.
    try {
      if (unfinished !== undefined) rmSync(unfinished, { recursive: true, force: true });
    } catch {
      // Left for a person to delete; it is never read as a scan.
    }
    if (firstMade !== undefined) removeEmptyFolders(resolve(site), resolve(firstMade));
    throw error;
  }
}

/** Renames `unfinished` to `<site>/<name>`, or to `<name>-2`, `-3` when that name is taken. */
function renameIntoPlace(unfinished: string, site: string, name: string): string {
  for (let n = 1; ; n++) {
    const folder = join(site, n === 1 ? name : `${name}-${n}`);
    if (existsSync(folder)) continue;
    try {
      renameSync(unfinished, folder);
      return folder;
    } catch (error) {
      // Another scan took the name between the check and the rename.
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST" && code !== "ENOTEMPTY") throw error;
    }
  }
}

/** Removes `from` and the folders above it up to `upTo`, while each is empty: the ones a failed write made. */
function removeEmptyFolders(from: string, upTo: string): void {
  for (let folder = from; ; folder = dirname(folder)) {
    try {
      rmdirSync(folder);
    } catch {
      return;
    }
    if (folder === upTo || dirname(folder) === folder) return;
  }
}

export function writeScanFile(folder: string, name: string, text: string): void {
  writeFileSync(join(folder, name), text, "utf8");
}
