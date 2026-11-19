import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Runs the built command (npm test builds first), as a person would.
const cli = new URL("../../dist/cli.js", import.meta.url).pathname;
const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
  version: string;
};

describe("a11y-genie --version", () => {
  it("prints package.json's version", () => {
    const out = execFileSync(process.execPath, [cli, "--version"], { encoding: "utf8" });
    expect(out.trim()).toBe(pkg.version);
  });

  it("--help names the verbs as coming", () => {
    const out = execFileSync(process.execPath, [cli, "--help"], { encoding: "utf8" });
    expect(out).toContain("coming");
    expect(out).toContain("scan");
  });
});
