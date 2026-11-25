import { describe, expect, it } from "vitest";
import { isSelectorSyntaxError } from "../../src/drive.js";

describe("isSelectorSyntaxError", () => {
  it("is true for the words Playwright uses for a selector it cannot parse", () => {
    expect(
      isSelectorSyntaxError(
        'locator.click: Unexpected token "" while parsing css selector "[x". Did you mean to CSS.escape it?',
      ),
    ).toBe(true);
  });

  it("is false for a failure that is not the selector's, such as a navigation", () => {
    expect(
      isSelectorSyntaxError(
        "locator.evaluate: Execution context was destroyed, most likely because of a navigation",
      ),
    ).toBe(false);
    expect(isSelectorSyntaxError("")).toBe(false);
  });
});
