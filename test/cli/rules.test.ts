import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { IMPACTS } from "../../src/finding.js";
import { genieRules } from "../../src/genie-rules.js";
import "../../src/click-on-non-control.js";
import "../../src/keyboard-trap.js";
import "../../src/landmarks.js";
import "../../src/skip-link.js";

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
    expect(stdout).toContain("genie/click-on-non-control");
    expect(stdout).toContain("genie/skip-link");
    expect(stdout).toContain("genie/keyboard-trap");
    expect(stdout).toContain("genie/focus-not-returned");
    expect(stdout).toContain("genie/focus-visible");
    expect(stdout).toContain("genie/unnamed-step");
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
    // A tag no own rule carries leaves them all out; one tag of a rule's keeps it. `wcag2aa` keeps exactly the
    // level-AA own rules, and `wcag2a` the level-A ones.
    const none = JSON.parse(run("--tags", "wcag21aa", "--json").stdout) as Doc;
    expect(none.rules.some((r) => r.source === "genie")).toBe(false);
    const levelAA = JSON.parse(run("--tags", "wcag2aa", "--json").stdout) as Doc;
    expect(levelAA.rules.filter((r) => r.source === "genie").map((r) => r.id)).toEqual(["focus-visible"]);
    const levelA = JSON.parse(run("--tags", "wcag2a", "--json").stdout) as Doc;
    expect(levelA.rules.filter((r) => r.source === "genie").map((r) => r.id)).toEqual([
      "click-on-non-control",
      "focus-not-returned",
      "keyboard-trap",
      "unnamed-step",
    ]);
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
    const landmarks = doc.rules.find((r) => r.source === "genie" && r.id === "no-landmarks");
    expect(landmarks).toMatchObject({ impact: "moderate", wcag: ["1.3.1", "2.4.1"] });
    const click = doc.rules.find((r) => r.source === "genie" && r.id === "click-on-non-control");
    expect(click).toMatchObject({ impact: "serious", wcag: ["2.1.1", "4.1.2"] });
    expect(click?.tags).toEqual(["cat.keyboard", "wcag2a", "wcag211", "wcag412"]);
    const trap = doc.rules.find((r) => r.source === "genie" && r.id === "keyboard-trap");
    expect(trap).toMatchObject({
      impact: "critical",
      wcag: ["2.1.2"],
      tags: ["cat.keyboard", "wcag2a", "wcag212"],
    });
    const notReturned = doc.rules.find((r) => r.source === "genie" && r.id === "focus-not-returned");
    expect(notReturned).toMatchObject({
      impact: "moderate",
      wcag: ["2.4.3"],
      tags: ["cat.keyboard", "wcag2a", "wcag243"],
    });
    // Tagged wcag2a like the other level-A own rules; it only changes --tags listings, since a flow someone asks to
    // narrate is always read, whatever --tags says.
    const unnamedStep = doc.rules.find((r) => r.source === "genie" && r.id === "unnamed-step");
    expect(unnamedStep).toMatchObject({
      impact: "serious",
      wcag: ["4.1.2"],
      tags: ["cat.name-role-value", "wcag2a", "wcag412"],
    });
    const focusVisible = doc.rules.find((r) => r.source === "genie" && r.id === "focus-visible");
    expect(focusVisible).toMatchObject({
      impact: "serious",
      wcag: ["2.4.7"],
      tags: ["cat.keyboard", "wcag2aa", "wcag247"],
    });
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
