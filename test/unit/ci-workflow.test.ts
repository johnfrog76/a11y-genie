import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// CI (.github/workflows/ci.yml) runs the browser tests and the deck page's smoke test, which need Playwright's
// headless shell; nothing else installs it on a fresh runner.
const root = new URL("../../", import.meta.url);
const workflow = readFileSync(new URL(".github/workflows/ci.yml", root), "utf8");
const runs = [...workflow.matchAll(/^\s*- run: (.+)$/gm)].map((m) => (m[1] ?? "").trim());
const pinned = (
  JSON.parse(readFileSync(new URL("package.json", root), "utf8")) as {
    dependencies: Record<string, string>;
  }
).dependencies["playwright-core"];

describe("CI", () => {
  const install = runs.findIndex((run) => /^npx playwright-core@\S+ install --with-deps chromium$/.test(run));

  it("installs Playwright's browser, with its system libraries, at the pinned playwright-core", () => {
    expect(install).toBeGreaterThanOrEqual(0);
    expect(runs[install]).toBe(`npx playwright-core@${pinned ?? "?"} install --with-deps chromium`);
  });

  it("installs it before the tests and the deck page's smoke test", () => {
    expect(install).toBeLessThan(runs.indexOf("npm test"));
    expect(install).toBeLessThan(runs.indexOf("npm run smoke"));
  });
});
