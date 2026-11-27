import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The publish workflow (.github/workflows/publish.yml, docs/RELEASING.md) stages a release on npm with trusted
// publishing. These hold its shape: only a version tag starts it, it carries no token, it checks the tag against
// package.json, it tests before it stages, and it stages rather than publishes.
const root = new URL("../../", import.meta.url);
const workflow = readFileSync(new URL(".github/workflows/publish.yml", root), "utf8");
const runs = [...workflow.matchAll(/^\s*- run: (.+)$/gm)].map((m) => (m[1] ?? "").trim());
const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8")) as {
  version: string;
  repository?: { type?: string; url?: string };
  dependencies: Record<string, string>;
};
const index = (run: string) => runs.indexOf(run);

describe("the publish workflow", () => {
  it("is started only by pushing a version tag", () => {
    const on = /^on:\n([\s\S]*?)\n\S/m.exec(workflow)?.[1] ?? "";
    expect(on).toBe('  push:\n    tags: ["v*"]\n');
  });

  it("carries no token: npm's trusted publishing is the only credential", () => {
    expect(workflow).not.toMatch(/NODE_AUTH_TOKEN|NPM_TOKEN|secrets\./);
    expect(workflow).toMatch(/^ {6}id-token: write$/m);
  });

  it("stages the version and never publishes it straight away", () => {
    expect(runs.at(-1)).toBe("npm stage publish");
    expect(runs.filter((run) => /\bnpm publish\b/.test(run))).toEqual([]);
  });

  it("checks the tag names package.json's version before anything else", () => {
    const check = runs.findIndex((run) => run.includes("$GITHUB_REF_NAME") && run.includes("package.json"));
    expect(check).toBeGreaterThanOrEqual(0);
    expect(check).toBeLessThan(index("npm ci"));
  });

  it("lints, typechecks, tests, builds and lists the package before it stages", () => {
    const stage = index("npm stage publish");
    for (const run of [
      "npm ci",
      "npm run lint",
      "npm run typecheck",
      "npm test",
      "npm run build",
      "npm pack --dry-run",
    ]) {
      expect(index(run), run).toBeGreaterThanOrEqual(0);
      expect(index(run), run).toBeLessThan(stage);
    }
  });

  it("installs an exact npm new enough to stage, and the browser at the pinned playwright-core", () => {
    const npm = /^npm install --global npm@(\d+)\.(\d+)\.(\d+)$/.exec(
      runs.find((r) => r.startsWith("npm install --global")) ?? "",
    );
    expect(npm).not.toBeNull();
    const [major, minor] = [Number(npm?.[1]), Number(npm?.[2])];
    expect(major > 11 || (major === 11 && minor >= 15)).toBe(true);
    expect(runs).toContain(
      `npx playwright-core@${pkg.dependencies["playwright-core"] ?? "?"} install --with-deps chromium`,
    );
  });

  it("runs on a GitHub-hosted runner, as trusted publishing needs", () => {
    expect(workflow).toMatch(/^ {4}runs-on: ubuntu-latest$/m);
  });
});

describe("package.json, for trusted publishing", () => {
  it("names this repository exactly, as npm requires", () => {
    expect(pkg.repository).toEqual({ type: "git", url: "git+https://github.com/johnfrog76/a11y-genie.git" });
  });
});
