import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { builtCli } from "../helpers/built-cli.js";

// Runs the built command (npm test builds first), as a person would.
const cli = builtCli();
const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
  version: string;
};

describe("a11y-genie --version", () => {
  it("prints package.json's version", () => {
    const out = execFileSync(process.execPath, [cli, "--version"], { encoding: "utf8" });
    expect(out.trim()).toBe(pkg.version);
  });

  it("wins anywhere on the line: after a command, it prints the version and exits 0", () => {
    for (const args of [
      ["rules", "--version"],
      ["scan", "--version"],
      ["scan", "http://127.0.0.1:9", "--version"],
    ]) {
      const out = execFileSync(process.execPath, [cli, ...args], { encoding: "utf8" });
      expect(out.trim()).toBe(pkg.version);
    }
  });

  it("--help names the verbs as coming", () => {
    const out = execFileSync(process.execPath, [cli, "--help"], { encoding: "utf8" });
    expect(out).toContain("coming");
    expect(out).toContain("scan");
  });

  it("--help prints the same help anywhere on the line, and exits 0", () => {
    const top = execFileSync(process.execPath, [cli, "--help"], { encoding: "utf8" });
    for (const args of [
      ["scan", "--help"],
      ["check", "--help"],
      ["narrate", "--help"],
      ["rules", "--help"],
      ["prompt", "--help"],
      ["scan", "http://127.0.0.1:9", "--help"],
    ]) {
      expect(execFileSync(process.execPath, [cli, ...args], { encoding: "utf8" })).toBe(top);
    }
  });

  it("--help says what each exit code means, with --fail-on and the signals", () => {
    const out = execFileSync(process.execPath, [cli, "--help"], { encoding: "utf8" });
    expect(out).toContain("0 no finding at or above --fail-on");
    expect(out).toContain("129 terminal closed, 130 Ctrl-C, 143 kill");
    expect(out).toContain("Advice never changes the exit");
    expect(out).not.toContain("Exit 0: no findings.");
  });
});
