import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BANNER,
  BANNER_LINES,
  BANNER_MAX_COLUMNS,
  BANNER_MAX_LINES,
  type BannerContext,
  shouldShowBanner,
  withBanner,
} from "../../src/banner.js";

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

describe("when the drawing is shown", () => {
  const terminal: BannerContext = { isTTY: true, columns: 100, env: {}, json: false };
  const widest = Math.max(...BANNER_LINES.map((line) => line.length));

  const table: [string, Partial<BannerContext>, boolean][] = [
    ["at a wide terminal", {}, true],
    ["when the terminal is exactly as wide as the drawing", { columns: widest }, true],
    ["when the terminal is one column too narrow", { columns: widest - 1 }, false],
    ["when the width is not known", { columns: undefined }, true],
    ["when the terminal reports no width (0)", { columns: 0 }, true],
    ["under --json", { json: true }, false],
    ["when the stream is not a terminal", { isTTY: false }, false],
    ["when isTTY is not set", { isTTY: undefined }, false],
    ["in CI", { env: { CI: "true" } }, false],
    ["with CI=1", { env: { CI: "1" } }, false],
    ["with CI=yes", { env: { CI: "yes" } }, false],
    ["with CI=TRUE", { env: { CI: "TRUE" } }, false],
    ["with CI empty", { env: { CI: "" } }, true],
    ["with CI=0", { env: { CI: "0" } }, true],
    ["with CI=false", { env: { CI: "false" } }, true],
    ["with CI=False", { env: { CI: "False" } }, true],
  ];
  it.each(table)("%s", (_name, change, shown) => {
    expect(shouldShowBanner({ ...terminal, ...change })).toBe(shown);
  });

  it("gives the same answer with and without NO_COLOR, since the drawing has no colour", () => {
    expect(shouldShowBanner({ ...terminal, env: { NO_COLOR: "1" } })).toBe(shouldShowBanner(terminal));
    expect(shouldShowBanner({ ...terminal, env: { NO_COLOR: "1", CI: "1" } })).toBe(false);
  });

  it("puts the drawing and an empty line above the text only when told to", () => {
    expect(withBanner("text\n", true)).toBe(`${BANNER}\ntext\n`);
    expect(withBanner("text\n", false)).toBe("text\n");
  });

  it("prints no escape sequence", () => {
    expect(withBanner("text\n", true)).not.toContain("\x1b");
  });
});
