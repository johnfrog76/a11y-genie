import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { NO_BROWSER_ENV } from "../../src/browser.js";

// Runs the built command (npm test builds first), as a person would.
const cli = new URL("../../dist/cli.js", import.meta.url).pathname;

function run(args: string[], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

function lines(text: string): string[] {
  return text.split("\n").filter((line) => line !== "");
}

describe("a11y-genie scan, the browser", () => {
  it("with no Chrome, exits 2 with one Error: line and one Hint: line", () => {
    const result = run(["scan"], { [NO_BROWSER_ENV]: "1" });
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    const err = lines(result.stderr);
    expect(err).toHaveLength(2);
    expect(err[0]).toMatch(/^Error: Chrome was not found/);
    expect(err[1]).toMatch(/^Hint: /);
  });

  it("with no Edge, names Edge and points back at chrome", () => {
    const result = run(["scan", "--browser-channel", "msedge"], { [NO_BROWSER_ENV]: "1" });
    expect(result.status).toBe(2);
    const err = lines(result.stderr);
    expect(err).toHaveLength(2);
    expect(err[0]).toMatch(/^Error: Microsoft Edge was not found/);
    expect(err[1]).toMatch(/^Hint: .*--browser-channel chrome/);
  });

  it("a browser that is really missing is refused the same way (skipped where Edge is installed)", (ctx) => {
    const result = run(["scan", "--browser-channel", "msedge"]);
    if (result.status === 0) ctx.skip();
    expect(result.status).toBe(2);
    const err = lines(result.stderr);
    expect(err).toHaveLength(2);
    expect(err[0]).toMatch(/^Error: Microsoft Edge was not found/);
    expect(err[1]).toMatch(/^Hint: /);
  });

  it("launches Chrome and says nothing was scanned (skipped where Chrome is not installed)", (ctx) => {
    const result = run(["scan"]);
    if (result.status === 2 && result.stderr.includes("Chrome was not found")) ctx.skip();
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/^Launched chrome \d+\./);
    expect(result.stderr).toContain("Nothing was scanned");
  });

  it("refuses a --browser-channel it does not know, with one Error: and one Hint:", () => {
    const result = run(["scan", "--browser-channel", "firefox"]);
    expect(result.status).toBe(2);
    const err = lines(result.stderr);
    expect(err).toEqual(["Error: unknown --browser-channel: firefox", "Hint: use one of: chrome, msedge."]);
  });

  it("refuses an unknown flag on scan, with one Error: and one Hint:", () => {
    const result = run(["scan", "--nope"]);
    expect(result.status).toBe(2);
    const err = lines(result.stderr);
    expect(err).toHaveLength(2);
    expect(err[0]).toMatch(/^Error: /);
    expect(err[1]).toMatch(/^Hint: /);
  });
});
