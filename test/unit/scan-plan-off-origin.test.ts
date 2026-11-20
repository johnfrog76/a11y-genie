import { describe, expect, it, vi } from "vitest";
import { Refusal } from "../../src/refusal.js";
import { planScan } from "../../src/scan-plan.js";

// config.ts already refuses a path that is not a single "/" path, so the off-origin refusal in scan-plan.ts is a
// second line of defence. It is reached here by standing in for the config reader, to prove that what it prints
// of the config path and the page path is cleaned of terminal escapes, as config.ts cleans its own.
vi.mock("../../src/config.js", () => ({
  readConfigFile: () => ({
    baseUrl: "http://127.0.0.1:5173",
    workflows: [],
    pages: [{ path: "//evil.example/\u001b[31mx\u001b]0;title\u0007", key: "x", line: 3, states: [] }],
  }),
}));

describe("the off-origin refusal", () => {
  it("prints the config path and the page path with no escape or control character in them", () => {
    let message = "";
    try {
      planScan({ url: undefined, states: [], config: "a\u001b[31m.yaml" });
    } catch (error) {
      if (!(error instanceof Refusal)) throw error;
      message = error.message;
    }
    expect(message).toBe('a.yaml, line 3: the path "//evil.example/x" is not on http://127.0.0.1:5173.');
  });
});
