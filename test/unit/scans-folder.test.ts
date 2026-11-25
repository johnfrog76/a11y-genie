import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultScansDir } from "../../src/scans-folder.js";

// An empty setting is unset: `join("", "a11y-genie")` and `resolve("")` would be the working folder.
describe("defaultScansDir", () => {
  const home = join("/home", "me");

  it("treats an empty LOCALAPPDATA as unset on Windows", () => {
    expect(defaultScansDir({ LOCALAPPDATA: "" }, "win32", home)).toBe(
      join(home, "AppData", "Local", "a11y-genie"),
    );
    expect(defaultScansDir({ LOCALAPPDATA: join("C:", "L") }, "win32", home)).toBe(
      join("C:", "L", "a11y-genie"),
    );
  });

  it("treats an empty XDG_DATA_HOME as unset on Linux", () => {
    expect(defaultScansDir({ XDG_DATA_HOME: "" }, "linux", home)).toBe(
      join(home, ".local", "share", "a11y-genie"),
    );
    expect(defaultScansDir({ XDG_DATA_HOME: "/x" }, "linux", home)).toBe(join("/x", "a11y-genie"));
  });

  it("treats an empty A11Y_GENIE_SCANS_DIR as unset", () => {
    expect(defaultScansDir({ A11Y_GENIE_SCANS_DIR: "" }, "darwin", home)).toBe(
      join(home, "Library", "Application Support", "a11y-genie"),
    );
    expect(defaultScansDir({ A11Y_GENIE_SCANS_DIR: "/s" }, "darwin", home)).toBe("/s");
  });
});
