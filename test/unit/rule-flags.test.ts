import { describe, expect, it } from "vitest";
import { networkRule } from "../../src/context.js";
import { Refusal } from "../../src/refusal.js";
import { atOrAbove, axeTags, DEFAULT_FAIL_ON, parseFailOn, parseTags } from "../../src/rule-flags.js";

// `--tags`, `--fail-on` and the network rules, with no browser.

describe("--tags", () => {
  it("knows the tags from axe-core's own rules, sorted", () => {
    const tags = axeTags();
    expect(tags).toEqual([...tags].sort());
    expect(tags).toEqual(
      expect.arrayContaining(["wcag2a", "wcag2aa", "wcag21aa", "best-practice", "cat.aria"]),
    );
  });

  it("takes a comma-separated list in the order given, without repeats", () => {
    expect(parseTags("wcag2aa, wcag2a,wcag2aa")).toEqual(["wcag2aa", "wcag2a"]);
  });

  it.each(["nope", "WCAG2A", "wcag2a,,wcag2aa", ""])("refuses %j", (value) => {
    expect(() => parseTags(value)).toThrow(Refusal);
  });
});

describe("--fail-on", () => {
  it("defaults to minor, so any violation fails", () => {
    expect(DEFAULT_FAIL_ON).toBe("minor");
  });

  it.each(["critical", "serious", "moderate", "minor"])("takes %s", (impact) => {
    expect(parseFailOn(impact)).toBe(impact);
  });

  it.each(["severe", "Serious", "", "advice"])("refuses %j", (value) => {
    expect(() => parseFailOn(value)).toThrow(Refusal);
  });

  it("counts an impact at or above the floor, never below it", () => {
    expect(atOrAbove("critical", "serious")).toBe(true);
    expect(atOrAbove("serious", "serious")).toBe(true);
    expect(atOrAbove("moderate", "serious")).toBe(false);
    expect(atOrAbove("minor", "minor")).toBe(true);
    expect(atOrAbove("minor", "critical")).toBe(false);
  });
});

describe("the network rules", () => {
  const target = "http://127.0.0.1:5000/page";

  it("hold nothing for a loopback target with no flag", () => {
    expect(networkRule({ target })).toBeUndefined();
  });

  it("--offline stops every address that is not loopback, and nothing on it", () => {
    const rule = networkRule({ target, offline: true });
    expect(rule?.kindOf("https://example.com/a.js")).toBe("offline");
    expect(rule?.kindOf("http://192.168.0.5/")).toBe("offline");
    expect(rule?.kindOf("wss://example.com/socket")).toBe("offline");
    expect(rule?.kindOf("http://localhost:1/")).toBeUndefined();
    expect(rule?.kindOf("http://127.0.0.1:6000/other-port")).toBeUndefined();
    expect(rule?.kindOf("http://[::1]:1/")).toBeUndefined();
    expect(rule?.kindOf("data:text/plain,hi")).toBeUndefined();
    expect(rule?.kindOf("blob:http://127.0.0.1:5000/id")).toBeUndefined();
  });

  it("--offline reads a declared test origin as off the machine, but never the target's own", () => {
    const rule = networkRule({
      target,
      offline: true,
      publicOrigins: ["http://127.0.0.1:6000", "http://127.0.0.1:5000"],
    });
    expect(rule?.kindOf("http://127.0.0.1:6000/x")).toBe("offline");
    expect(rule?.kindOf("http://127.0.0.1:5000/x")).toBeUndefined();
  });

  it("--same-origin stops every origin but the target's, another port and scheme included", () => {
    const rule = networkRule({ target, sameOrigin: true });
    expect(rule?.kindOf("http://127.0.0.1:5000/other.css")).toBeUndefined();
    expect(rule?.kindOf("ws://127.0.0.1:5000/socket")).toBeUndefined();
    expect(rule?.kindOf("http://127.0.0.1:5001/")).toBe("other-origin");
    expect(rule?.kindOf("https://127.0.0.1:5000/")).toBe("other-origin");
    expect(rule?.kindOf("http://localhost:5000/")).toBe("other-origin");
    expect(rule?.kindOf("https://cdn.example.com/")).toBe("other-origin");
    expect(rule?.kindOf("data:image/png;base64,AAAA")).toBeUndefined();
  });

  it("asks --offline first, then --same-origin, then the private-network rule", () => {
    const pub = "https://example.com/page";
    // A public target: the private-network rule holds; a request to loopback is stopped as private-network.
    expect(networkRule({ target: pub })?.kindOf("http://127.0.0.1:1/")).toBe("private-network");
    // With --same-origin the same request is another origin first.
    expect(networkRule({ target: pub, sameOrigin: true })?.kindOf("http://127.0.0.1:1/")).toBe(
      "other-origin",
    );
    expect(networkRule({ target: pub, sameOrigin: true })?.kindOf("https://example.com/a")).toBeUndefined();
  });

  it("--allow-private turns the private-network rule off, and not the flags beside it", () => {
    const pub = "https://example.com/page";
    expect(networkRule({ target: pub, allowPrivate: true })).toBeUndefined();
    expect(
      networkRule({ target: pub, allowPrivate: true, sameOrigin: true })?.kindOf("http://10.0.0.1/"),
    ).toBe("other-origin");
  });
});
