import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultScansDir, MAX_SITE_FOLDER, oldOriginKey, originKey } from "../../src/scans-folder.js";

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

// A site's folder name (issue #162): one path part on every system, the scheme kept, the length capped.

describe("a site's folder name", () => {
  it("keeps the scheme, so http and https never share a folder", () => {
    expect(originKey("http://example.com")).not.toBe(originKey("https://example.com"));
    expect(originKey("http://localhost:5173")).toBe("http_localhost-5173");
    expect(originKey("https://example.com")).toBe("https_example.com");
    expect(originKey("https://Example.COM:8443")).toBe("https_example.com-8443");
  });

  it("is never a name the old scheme made, so an old folder and a new one never mix", () => {
    for (const origin of ["http://example.com", "https://localhost:5173", "http://http-example.com"]) {
      expect(originKey(origin)).not.toBe(oldOriginKey(origin));
      expect(originKey(origin)).toMatch(/_/);
      expect(oldOriginKey(origin)).not.toMatch(/_/);
    }
    expect(oldOriginKey("http://localhost:5173")).toBe("localhost-5173");
  });

  it("caps a long host, and two long hosts that differ only at the end get different names", () => {
    const long = `${"a".repeat(296)}.com`;
    const one = originKey(`https://${long}`);
    const two = originKey(`https://${long.slice(0, -5)}b.com`);
    expect(one.length).toBeLessThanOrEqual(MAX_SITE_FOLDER);
    expect(two.length).toBeLessThanOrEqual(MAX_SITE_FOLDER);
    expect(one).toMatch(/^https_a+_[0-9a-f]{10}$/);
    expect(one).not.toBe(two);
    expect(originKey(`http://${long}`)).not.toBe(one);
  });

  it("adds the hash when the host had to change, so two hosts never fold into one name", () => {
    expect(originKey("http://[::1]:4173")).toMatch(/^http_1-4173_[0-9a-f]{10}$/);
    expect(originKey("http://[::1]:4173")).not.toBe(originKey("http://[::2]:4173"));
    expect(originKey("http://example.com.")).toMatch(/^http_example\.com_[0-9a-f]{10}$/);
    expect(originKey("http://example.com.")).not.toBe(originKey("http://example.com"));
  });

  it("is safe as one path part on macOS, Linux and Windows", () => {
    for (const origin of ["http://[::1]:4173", "https://example.com", `https://${"x".repeat(300)}`]) {
      expect(originKey(origin)).toMatch(/^[a-z0-9][a-z0-9._-]*[a-z0-9]$/);
    }
  });
});
