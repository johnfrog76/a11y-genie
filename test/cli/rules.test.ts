import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { IMPACTS } from "../../src/finding.js";
import { genieRules } from "../../src/genie-rules.js";
import "../../src/landmarks.js";

// Runs the built command (npm test builds first), as a person would. `rules` needs no browser or network.
const cli = new URL("../../dist/cli.js", import.meta.url).pathname;
const axe = createRequire(import.meta.url)("axe-core") as {
  version: string;
  getRules(): { ruleId: string; tags: string[] }[];
};

function run(...args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [cli, "rules", ...args], { encoding: "utf8" });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

interface Doc {
  engine: { axeCore: string };
  tags: string[] | null;
  rules: {
    source: string;
    id: string;
    impact: string | null;
    wcag: string[];
    tags: string[];
    help: string;
    helpUrl: string;
  }[];
}

describe("a11y-genie rules", () => {
  it("every genie/ rule is listed", () => {
    const own = genieRules();
    expect(own.length).toBeGreaterThan(0);
    const { status, stdout } = run();
    expect(status).toBe(0);
    for (const g of own) expect(stdout).toContain(`genie/${g.rule.id}`);
    expect(stdout).toContain("genie/no-landmarks");
    expect(stdout).toContain(`axe-core ${axe.version}`);
  });

  it("lists as many axe-core rules as axe.getRules() has", () => {
    const doc = JSON.parse(run("--json").stdout) as Doc;
    expect(doc.engine.axeCore).toBe(axe.version);
    expect(doc.rules.filter((r) => r.source === "axe")).toHaveLength(axe.getRules().length);
    const text = run()
      .stdout.split("\n")
      .filter((l) => l.startsWith("axe/"));
    expect(text).toHaveLength(axe.getRules().length);
  });

  it("--tags keeps the rules that carry one of the tags", () => {
    const doc = JSON.parse(run("--tags", "wcag2aa,best-practice", "--json").stdout) as Doc;
    expect(doc.tags).toEqual(["wcag2aa", "best-practice"]);
    const expected = axe
      .getRules()
      .filter((r) => r.tags.includes("wcag2aa") || r.tags.includes("best-practice")).length;
    expect(doc.rules.filter((r) => r.source === "axe")).toHaveLength(expected);
    expect(doc.rules.some((r) => r.id === "no-landmarks")).toBe(true);
    for (const r of doc.rules)
      expect(r.tags.some((t) => ["wcag2aa", "best-practice"].includes(t))).toBe(true);
    // A tag the product's own rules lack leaves them out.
    const wcag = JSON.parse(run("--tags", "wcag2a", "--json").stdout) as Doc;
    expect(wcag.rules.some((r) => r.source === "genie")).toBe(false);
  });

  it("--json matches the documented shape", () => {
    const { status, stdout, stderr } = run("--json");
    expect(status).toBe(0);
    expect(stderr).toBe("");
    const doc = JSON.parse(stdout) as Doc;
    expect(Object.keys(doc).sort()).toEqual(["engine", "rules", "tags"]);
    expect(doc.tags).toBeNull();
    for (const r of doc.rules) {
      expect(Object.keys(r).sort()).toEqual(["help", "helpUrl", "id", "impact", "source", "tags", "wcag"]);
      expect(["axe", "genie"]).toContain(r.source);
      expect(r.id).not.toBe("");
      expect(r.impact === null || (IMPACTS as readonly string[]).includes(r.impact)).toBe(true);
      expect(r.wcag.every((c) => /^\d\.\d\.\d{1,2}$/.test(c))).toBe(true);
    }
    // At the pinned axe-core every rule states an impact.
    expect(doc.rules.filter((r) => r.impact === null)).toEqual([]);
    const colour = doc.rules.find((r) => r.id === "color-contrast");
    expect(colour).toMatchObject({ source: "axe", impact: "serious", wcag: ["1.4.3"] });
    const own = doc.rules.find((r) => r.source === "genie");
    expect(own).toMatchObject({ id: "no-landmarks", impact: "moderate", wcag: ["1.3.1", "2.4.1"] });
  });

  it("refuses a bad flag with one Error line and one Hint line, and exit 2", () => {
    for (const args of [["--nope"], ["--tags", "nope"], ["--tags", ""], ["extra"]]) {
      const { status, stdout, stderr } = run(...args);
      expect(status).toBe(2);
      expect(stdout).toBe("");
      const lines = stderr.trimEnd().split("\n");
      expect(lines).toHaveLength(2);
      expect(lines[0]).toMatch(/^Error: /);
      expect(lines[1]).toMatch(/^Hint: /);
    }
  });
});
