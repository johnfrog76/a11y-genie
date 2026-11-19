import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { NO_BROWSER_ENV } from "../../src/browser.js";

// Runs the built command (npm test builds first), as a person would.
const PAGE = "http://127.0.0.1:9/";
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
  it("with no Chrome, says it is downloading Playwright's Chromium, in one line, before anything else", () => {
    // NO_BROWSER_ENV turns the download into a refusal, so this run fetches nothing.
    const result = run(["scan", PAGE], { [NO_BROWSER_ENV]: "1" });
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    const err = lines(result.stderr);
    expect(err).toHaveLength(3);
    expect(err[0]).toMatch(
      /^Chrome was not found, so A11y Genie is downloading Playwright's Chromium \(about \d+ MB\) once, into .+ms-playwright\. --browser-channel names another browser\.$/,
    );
    expect(err[1]).toBe(
      `Error: the download of Playwright's Chromium did not finish: downloads are turned off by ${NO_BROWSER_ENV}.`,
    );
    expect(err[2]).toMatch(/^Hint: .*npx playwright-core@1\.65\.1 install --no-shell chromium$/);
  });

  it("with no Chrome and --json, keeps stdout empty and says it all on stderr", () => {
    const result = run(["scan", PAGE, "--json"], { [NO_BROWSER_ENV]: "1" });
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(lines(result.stderr)[0]).toMatch(/^Chrome was not found, so A11y Genie is downloading/);
  });

  it("with no Chrome and --no-download, refuses with one Error: and one Hint:, and downloads nothing", () => {
    const result = run(["scan", PAGE, "--no-download"], { [NO_BROWSER_ENV]: "1" });
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(lines(result.stderr)).toEqual([
      "Error: Chrome was not found on this machine, and --no-download stops A11y Genie from downloading Playwright's Chromium.",
      "Hint: Install Chrome, or run with --browser-channel msedge if that one is installed, or download Playwright's Chromium yourself: npx playwright-core@1.65.1 install --no-shell chromium",
    ]);
  });

  it("a named --browser-channel chrome that is missing is refused, never replaced", () => {
    const result = run(["scan", PAGE, "--browser-channel", "chrome"], { [NO_BROWSER_ENV]: "1" });
    expect(result.status).toBe(2);
    expect(lines(result.stderr)).toEqual([
      "Error: Chrome was not found on this machine.",
      "Hint: Install Chrome, or run with --browser-channel chromium to use Playwright's Chromium (downloaded once), or msedge if that one is installed.",
    ]);
  });

  it("with no Edge, names Edge and points back at chrome", () => {
    const result = run(["scan", PAGE, "--browser-channel", "msedge"], { [NO_BROWSER_ENV]: "1" });
    expect(result.status).toBe(2);
    const err = lines(result.stderr);
    expect(err).toHaveLength(2);
    expect(err[0]).toBe("Error: Microsoft Edge was not found on this machine.");
    expect(err[1]).toMatch(/^Hint: .*--browser-channel chrome/);
  });

  it("--browser-channel chromium with --no-download and no Chromium is refused", () => {
    const result = run(["scan", PAGE, "--browser-channel", "chromium", "--no-download"], {
      [NO_BROWSER_ENV]: "1",
    });
    expect(result.status).toBe(2);
    expect(lines(result.stderr)).toEqual([
      "Error: Playwright's Chromium is not installed on this machine, and --no-download stops A11y Genie from downloading it.",
      "Hint: download it yourself: npx playwright-core@1.65.1 install --no-shell chromium, or run with another --browser-channel.",
    ]);
  });

  it("a browser that is really missing is refused the same way (skipped where Edge is installed)", (ctx) => {
    const result = run(["scan", PAGE, "--browser-channel", "msedge"]);
    if (result.status !== 2) ctx.skip();
    expect(result.status).toBe(2);
    const err = lines(result.stderr);
    expect(err).toHaveLength(2);
    expect(err[0]).toBe("Error: Microsoft Edge was not found on this machine.");
    expect(err[1]).toMatch(/^Hint: /);
  });

  it("refuses a scan with no page address, with one Error: and one Hint:", () => {
    const result = run(["scan"]);
    expect(result.status).toBe(2);
    expect(lines(result.stderr)).toEqual([
      "Error: scan needs a page address to scan.",
      "Hint: run: a11y-genie scan <url>",
    ]);
  });

  it("refuses a --browser-channel it does not know, with one Error: and one Hint:", () => {
    const result = run(["scan", PAGE, "--browser-channel", "firefox"]);
    expect(result.status).toBe(2);
    const err = lines(result.stderr);
    expect(err).toEqual([
      "Error: unknown --browser-channel: firefox",
      "Hint: use one of: chrome, msedge, chromium.",
    ]);
  });

  it("refuses an unknown flag on scan, with one Error: and one Hint:", () => {
    const result = run(["scan", PAGE, "--nope"]);
    expect(result.status).toBe(2);
    const err = lines(result.stderr);
    expect(err).toHaveLength(2);
    expect(err[0]).toMatch(/^Error: /);
    expect(err[1]).toMatch(/^Hint: /);
  });
});
