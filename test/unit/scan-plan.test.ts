import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { Refusal } from "../../src/refusal.js";
import { checkStorageState, parseTimeout } from "../../src/scan-options.js";
import { parseStateFlags, planScan } from "../../src/scan-plan.js";
import { StepError } from "../../src/steps.js";
import { mergeStates } from "../../src/merge-states.js";

const folder = mkdtempSync(join(tmpdir(), "a11y-genie-plan-"));
afterAll(() => rmSync(folder, { recursive: true, force: true }));
function file(name: string, text: string): string {
  const path = join(folder, name);
  writeFileSync(path, text);
  return path;
}

function refusal(run: () => unknown): Refusal {
  try {
    run();
  } catch (error) {
    if (error instanceof Refusal) return error;
    throw error;
  }
  throw new Error("expected a refusal");
}

describe("--states", () => {
  it("parses each value into a state, in order", () => {
    expect(
      parseStateFlags(["menu-open: click button 'Menu'", "dark: colorScheme dark"]).map((s) => s.name),
    ).toEqual(["menu-open", "dark"]);
  });

  it("refuses a name given twice, naming it", () => {
    const error = refusal(() => parseStateFlags(["dark: colorScheme dark", "dark: reducedMotion"]));
    expect(error.message).toBe('--states gives the state "dark" twice.');
    expect(error.hint).toMatch(/no two may share a name/);
  });

  it("refuses a step that does not parse, naming the step and its place", () => {
    const error = refusal(() => parseStateFlags(["menu: click button 'Menu'", "bad: Tab; clik"]));
    expect(error).toBeInstanceOf(StepError);
    expect(error.message).toBe('--states step 2 "clik", column 11: "clik" is not a step.');
  });

  it("refuses an engine prefix in a selector", () => {
    const error = refusal(() => parseStateFlags(["a: click css 'xpath=//a'"]));
    expect((error as StepError).code).toBe("selector-engine");
  });

  it("plans one page with the states of the flags", () => {
    const plan = planScan({
      url: "http://127.0.0.1:1/a",
      states: ["dark: colorScheme dark"],
      config: undefined,
    });
    expect(plan.url).toBe("http://127.0.0.1:1/a");
    expect(plan.pages).toHaveLength(1);
    expect(plan.pages[0]?.states.map((s) => s.name)).toEqual(["dark"]);
  });
});

describe("--config", () => {
  const yaml =
    "baseUrl: http://127.0.0.1:5173\npages:\n  - path: /\n  - key: settings\n    path: /settings?tab=1\n";

  it("plans every page beside the base address", () => {
    const plan = planScan({ url: undefined, states: [], config: file("a.yaml", yaml) });
    expect(plan.pages.map((page) => [page.key, page.url])).toEqual([
      ["home", "http://127.0.0.1:5173/"],
      ["settings", "http://127.0.0.1:5173/settings?tab=1"],
    ]);
    expect(plan.url).toBe("http://127.0.0.1:5173/");
  });

  it("takes the address on the command line in place of baseUrl", () => {
    const plan = planScan({ url: "http://127.0.0.1:9999/ignored", states: [], config: file("b.yaml", yaml) });
    expect(plan.pages.map((page) => page.url)).toEqual([
      "http://127.0.0.1:9999/",
      "http://127.0.0.1:9999/settings?tab=1",
    ]);
  });

  it("refuses with no base address anywhere", () => {
    const error = refusal(() =>
      planScan({ url: undefined, states: [], config: file("c.yaml", "pages:\n  - path: /\n") }),
    );
    expect(error.message).toBe(
      "scan --config needs a base address: the file has no baseUrl, and none was given.",
    );
  });

  it("prints the config path and a page path clean when it refuses a page that is off the origin", () => {
    const dirty = file(
      "off\u001b[31m-origin\u001b]0;title\u0007.yaml",
      'baseUrl: http://127.0.0.1:5173\npages:\n  - path: "//evil.example/x"\n',
    );
    const error = refusal(() => planScan({ url: undefined, states: [], config: dirty }));
    expect(error.message).toContain("line 3: the path");
    expect(error.message).toContain("off-origin.yaml");
    // eslint-disable-next-line no-control-regex
    expect(error.message).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/);
  });

  it("refuses --states beside --config", () => {
    const error = refusal(() =>
      planScan({ url: undefined, states: ["a: Tab"], config: file("d.yaml", yaml) }),
    );
    expect(error.message).toBe("--states and --config cannot be used together.");
  });

  it("refuses a file that is missing, or is a folder, saying so", () => {
    expect(
      refusal(() => planScan({ url: undefined, states: [], config: join(folder, "nope.yaml") })).message,
    ).toMatch(/^--config cannot be read: .*nope\.yaml \(ENOENT\)$/);
    expect(refusal(() => planScan({ url: undefined, states: [], config: folder })).message).toMatch(
      /^--config is not a file: /,
    );
  });

  it("refuses a config whose bad key it names, with the file", () => {
    const path = file("e.yaml", "pages:\n  - path: /\n    colour: red\n");
    expect(refusal(() => planScan({ url: "http://127.0.0.1:1", states: [], config: path })).message).toBe(
      `${path}, line 3: unknown key "colour" in a page; the keys it takes are key, path, states.`,
    );
  });
});

describe("--timeout and --storage-state", () => {
  it("reads seconds, whole or decimal, as milliseconds", () => {
    expect(parseTimeout("30")).toBe(30_000);
    expect(parseTimeout("0.5")).toBe(500);
  });

  it.each(["0", "-1", "abc", "", "1e3", "3601", "NaN", " 5"])("refuses --timeout %j", (text) => {
    expect(refusal(() => parseTimeout(text)).message).toMatch(
      /^--timeout takes a number of seconds above 0 and up to 3600/,
    );
  });

  it("reads a storage state file, and refuses what is not one", () => {
    expect(() => checkStorageState(file("s.json", '{"cookies":[],"origins":[]}'))).not.toThrow();
    expect(refusal(() => checkStorageState(file("t.json", "{}"))).message).toMatch(
      /is not a Playwright storage state/,
    );
    expect(refusal(() => checkStorageState(file("u.json", "not json"))).message).toMatch(
      /is not a Playwright storage state/,
    );
    expect(refusal(() => checkStorageState(join(folder, "nope.json"))).message).toMatch(
      /cannot be read: .*\(ENOENT\)$/,
    );
  });
});

describe("merging states", () => {
  const item = (id: string, impact: "critical" | "serious" | "minor", ...targets: string[][]) => ({
    id,
    impact,
    elements: targets.map((target) => ({ target })),
  });

  it("makes one item of an id, one element of a target, and lists the states in the order scanned", () => {
    const merged = mergeStates([
      { state: "default", items: [item("a", "minor", ["p"])] },
      { state: "dark", items: [item("a", "serious", ["p"], ["q"]), item("b", "minor", ["r"])] },
    ]);
    expect(merged.map((m) => [m.id, m.impact, m.elements.map((e) => [e.target, e.states])])).toEqual([
      [
        "a",
        "serious",
        [
          [["p"], ["default", "dark"]],
          [["q"], ["dark"]],
        ],
      ],
      ["b", "minor", [[["r"], ["dark"]]]],
    ]);
  });

  it("tells two elements apart by their whole target", () => {
    const merged = mergeStates([
      { state: "default", items: [item("a", "minor", ["#f", "button"])] },
      { state: "x", items: [item("a", "minor", ["button"])] },
    ]);
    expect(merged[0]?.elements.map((e) => e.states)).toEqual([["default"], ["x"]]);
  });

  it("gives one id per rule per page, whatever the number of states", () => {
    const merged = mergeStates([
      { state: "default", items: [item("a", "minor", ["p"]), item("b", "minor", ["p"])] },
      { state: "x", items: [item("b", "minor", ["p"]), item("a", "minor", ["q"])] },
      { state: "y", items: [item("a", "minor", ["p"])] },
    ]);
    expect(merged.map((m) => m.id)).toEqual(["a", "b"]);
    expect(new Set(merged.map((m) => m.id)).size).toBe(merged.length);
  });

  it("lists states in the order they were asked for, default first, whatever order the runs arrive in", () => {
    const runs = [
      { state: "dark", items: [item("a", "minor", ["p"])] },
      { state: "default", items: [item("a", "minor", ["p"])] },
      { state: "menu", items: [item("a", "minor", ["p"])] },
    ];
    const merged = mergeStates(runs, ["default", "menu", "dark"]);
    expect(merged[0]?.elements[0]?.states).toEqual(["default", "menu", "dark"]);
  });

  it("orders elements by the first state they were found in, then by target", () => {
    const merged = mergeStates([
      { state: "default", items: [item("a", "minor", ["#z"], ["#b"])] },
      { state: "dark", items: [item("a", "minor", ["#a"], ["#b"])] },
    ]);
    expect(merged[0]?.elements.map((e) => [e.target[0], e.states])).toEqual([
      ["#b", ["default", "dark"]],
      ["#z", ["default"]],
      ["#a", ["dark"]],
    ]);
  });

  it("takes the worst impact any state gave, and the first state's wording", () => {
    const withHelp = (impact: "serious" | "minor" | "critical", help: string) => ({
      ...item("a", impact, ["p"]),
      help,
    });
    const merged = mergeStates([
      { state: "default", items: [withHelp("serious", "first")] },
      { state: "dark", items: [withHelp("critical", "second")] },
      { state: "wide", items: [withHelp("minor", "third")] },
    ]);
    expect(merged[0]?.impact).toBe("critical");
    expect((merged[0] as unknown as { help: string }).help).toBe("first");
  });

  it("gives the same output for the same input in a different order", () => {
    const runs = [
      { state: "default", items: [item("a", "minor", ["#y"], ["#x"]), item("b", "serious", ["#m"])] },
      { state: "dark", items: [item("b", "serious", ["#m"], ["#c"]), item("a", "minor", ["#x"])] },
    ];
    const order = ["default", "dark"];
    const flipped = [
      { state: "dark", items: [...(runs[1]?.items ?? [])].reverse() },
      { state: "default", items: [...(runs[0]?.items ?? [])].reverse() },
    ].map((run) => ({
      ...run,
      items: run.items.map((i) => ({ ...i, elements: [...i.elements].reverse() })),
    }));
    const sorted = (items: ReturnType<typeof mergeStates>) =>
      [...items].sort((a, b) => (a.id < b.id ? -1 : 1));
    expect(sorted(mergeStates(flipped, order))).toEqual(sorted(mergeStates(runs, order)));
  });
});
