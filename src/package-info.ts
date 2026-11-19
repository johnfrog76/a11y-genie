import { readFileSync } from "node:fs";

/** The package's own name and version, read from `package.json` next to `dist/`. */
export function packageInfo(): { name: string; version: string } {
  const url = new URL("../package.json", import.meta.url);
  const { name, version } = JSON.parse(readFileSync(url, "utf8")) as { name: string; version: string };
  return { name, version };
}
