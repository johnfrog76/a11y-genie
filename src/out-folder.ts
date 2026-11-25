import { accessSync, constants, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Refusal } from "./refusal.js";

function kindOf(path: string): "folder" | "other" | "missing" {
  try {
    return statSync(path).isDirectory() ? "folder" : "other";
  } catch {
    return "missing";
  }
}

function writable(folder: string): boolean {
  try {
    accessSync(folder, constants.W_OK | constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Refuses an `--out` that a scan could not be written to, before anything is scanned. `--out` may be a
 * folder that exists, or a new folder whose parent exists; it is never made, and neither is its parent,
 * until a scan is ready to be written, and a new one is removed again if the write fails (src/scans-folder.ts).
 */
export function checkOutFolder(out: string): void {
  const folder = resolve(out);
  const kind = kindOf(folder);
  if (kind === "other") {
    throw new Refusal(
      `--out is not a folder: ${out}`,
      "give a folder, or a new name inside a folder that exists.",
    );
  }
  if (kind === "folder") {
    if (!writable(folder)) {
      throw new Refusal(`--out cannot be written to: ${out}`, "choose a folder you may write to.");
    }
    return;
  }
  const parent = dirname(folder);
  const parentKind = kindOf(parent);
  if (parentKind !== "folder") {
    throw new Refusal(
      `--out cannot be made, because ${parentKind === "other" ? "the path above it is not a folder" : "the folder above it does not exist"}: ${out}`,
      "make the folder above it first, or choose another --out.",
    );
  }
  if (!writable(parent)) {
    throw new Refusal(
      `--out cannot be made, because the folder above it cannot be written to: ${out}`,
      "choose a folder you may write to.",
    );
  }
}
