import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BANNER, BANNER_LINES, BANNER_MAX_COLUMNS, BANNER_MAX_LINES } from "../../src/banner.js";

const README = readFileSync(fileURLToPath(new URL("../../README.md", import.meta.url)), "utf8");

describe("the genie and his bottle", () => {
  it("fits a small terminal: at most 18 lines of at most 72 columns", () => {
    expect(BANNER_MAX_LINES).toBe(18);
    expect(BANNER_MAX_COLUMNS).toBe(72);
    expect(BANNER_LINES.length).toBeGreaterThan(0);
    expect(BANNER_LINES.length).toBeLessThanOrEqual(BANNER_MAX_LINES);
    for (const line of BANNER_LINES) {
      expect(line.length).toBeLessThanOrEqual(BANNER_MAX_COLUMNS);
    }
  });

  it("is printable ASCII only, with no tab and no trailing space", () => {
    for (const line of BANNER_LINES) {
      expect(line).toMatch(/^[\x20-\x7e]*$/);
      expect(line).toBe(line.trimEnd());
    }
  });

  it("has no blank line at either end, so nothing pads it", () => {
    expect(BANNER_LINES[0]?.trim()).not.toBe("");
    expect(BANNER_LINES.at(-1)?.trim()).not.toBe("");
  });

  it("is one string, a newline after every line", () => {
    expect(BANNER).toBe(`${BANNER_LINES.join("\n")}\n`);
  });

  it("is the drawing at the head of the README, character for character", () => {
    const hero = /^# A11y Genie\n\n```text\n([\s\S]*?)```\n/.exec(README);
    expect(hero).not.toBeNull();
    expect(hero?.[1]).toBe(BANNER);
  });
});
