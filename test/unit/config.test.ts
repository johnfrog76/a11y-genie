import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseConfig } from "../../src/config.js";
import { Refusal } from "../../src/refusal.js";
import { parseYamlSubset, YamlError } from "../../src/yaml-subset.js";

const example = readFileSync(new URL("../fixtures/config/spec-example.yaml", import.meta.url), "utf8");

function refusal(run: () => unknown): Refusal {
  try {
    run();
  } catch (error) {
    if (error instanceof Refusal) return error;
    throw error;
  }
  throw new Error("expected a refusal");
}

const config = (text: string) => parseConfig(text, "a11y-genie.yaml");
const PAGE = "pages:\n  - path: /\n";

describe("the config file", () => {
  it("reads a full example: pages, states and workflows", () => {
    const read = config(example);
    expect(read.baseUrl).toBe("http://localhost:5173");
    expect(read.pages.map((page) => [page.key, page.path, page.states.map((state) => state.name)])).toEqual([
      ["home", "/", []],
      ["settings", "/settings", ["menu-open", "dark", "delete-dialog"]],
    ]);
    expect(read.pages[1]?.states[0]?.steps).toEqual([
      { kind: "click", target: { by: "role", role: "button", name: "Menu" } },
      { kind: "wait", target: { by: "role", role: "menu" } },
    ]);
    expect(read.pages[1]?.states[1]?.steps).toEqual([{ kind: "colorScheme", scheme: "dark" }]);
    expect(read.workflows).toHaveLength(1);
    expect(read.workflows[0]?.page).toBe("settings");
  });

  it("names a page by its path when it has no key, as a URL's page key is", () => {
    expect(
      config("pages:\n  - path: /\n  - path: /settings/\n  - path: /a/b\n").pages.map((p) => p.key),
    ).toEqual(["home", "settings", "a/b"]);
  });

  it("needs no baseUrl: the address on the command line is used", () => {
    expect(config(PAGE).baseUrl).toBeUndefined();
  });

  it("reads comments, quotes of both kinds, and a block list for steps", () => {
    const read = config(
      [
        "# a comment",
        "pages:",
        "  - path: '/it''s'   # a comment after a value",
        "    states:",
        "      - name: one",
        "        steps:",
        "          - \"click button 'Save'\"",
        "          - 'Tab'",
        "          - Enter",
        "",
      ].join("\n"),
    );
    expect(read.pages[0]?.path).toBe("/it's");
    expect(read.pages[0]?.states[0]?.steps.map((step) => step.kind)).toEqual(["click", "press", "press"]);
  });

  it("refuses a key of its own that is not a page key", () => {
    expect(refusal(() => config("pages:\n  - key: Home page\n    path: /\n")).message).toBe(
      'a11y-genie.yaml, line 2: "Home page" is not a page key: letters, digits, ".", "_", "-" and "/", up to 100 characters.',
    );
  });

  // Every refusal names the file and the line, and says what is wrong.
  const REFUSED: { name: string; text: string; error: string }[] = [
    { name: "an empty file", text: "", error: "a11y-genie.yaml, line 1: the file is empty." },
    {
      name: "an unknown top-level key",
      text: `${PAGE}pagez: 1\n`,
      error:
        'a11y-genie.yaml, line 3: unknown key "pagez" in the file; the keys it takes are baseUrl, pages, workflows.',
    },
    {
      name: "an unknown key in a page",
      text: "pages:\n  - path: /\n    title: Home\n",
      error:
        'a11y-genie.yaml, line 3: unknown key "title" in a page; the keys it takes are key, path, states.',
    },
    {
      name: "an unknown key in a state",
      text: "pages:\n  - path: /\n    states:\n      - name: a\n        steps: [Tab]\n        wait: 5\n",
      error: 'a11y-genie.yaml, line 6: unknown key "wait" in a state; the keys it takes are name, steps.',
    },
    {
      name: "no pages",
      text: "baseUrl: http://localhost:1\n",
      error: 'a11y-genie.yaml, line 1: the file needs a "pages".',
    },
    {
      name: "an empty list of pages",
      text: "pages: []\n",
      error: 'a11y-genie.yaml, line 1: "pages" in the file must be a list with at least one item.',
    },
    {
      name: "a page with no path",
      text: "pages:\n  - key: home\n",
      error: 'a11y-genie.yaml, line 2: a page needs a "path".',
    },
    {
      name: "a path that is not a path",
      text: "pages:\n  - path: settings\n",
      error:
        'a11y-genie.yaml, line 2: "path" must start with a single "/", such as /settings: a page is on the base address\'s own site.',
    },
    {
      name: "a path that leaves the site",
      text: "pages:\n  - path: //example.com/x\n",
      error:
        'a11y-genie.yaml, line 2: "path" must start with a single "/", such as /settings: a page is on the base address\'s own site.',
    },
    {
      name: "a baseUrl that is not http",
      text: `baseUrl: file:///etc\n${PAGE}`,
      error: 'a11y-genie.yaml, line 1: "baseUrl" must start with http:// or https://, and this one is file:',
    },
    {
      name: "a baseUrl that is not an address",
      text: `baseUrl: example\n${PAGE}`,
      error: 'a11y-genie.yaml, line 1: "baseUrl" is not a web address: "example".',
    },
    {
      name: "the same page twice",
      text: "pages:\n  - path: /a\n  - path: /a\n",
      error: 'a11y-genie.yaml, line 3: the page key "a" is used twice; give one of them a "key".',
    },
    {
      name: "a state with no steps",
      text: "pages:\n  - path: /\n    states:\n      - name: a\n",
      error: 'a11y-genie.yaml, line 4: a state needs a "steps".',
    },
    {
      name: "a state with an empty list of steps",
      text: "pages:\n  - path: /\n    states:\n      - name: a\n        steps: []\n",
      error: 'a11y-genie.yaml, line 5: "steps" in a state must be a list with at least one item.',
    },
    {
      name: "a state called default",
      text: "pages:\n  - path: /\n    states:\n      - name: default\n        steps: [Tab]\n",
      error:
        'a11y-genie.yaml line 4 "default", column 1: the state cannot be called "default": that is the state every page is scanned in first.',
    },
    {
      name: "a state name given twice on a page",
      text: "pages:\n  - path: /\n    states:\n      - name: a\n        steps: [Tab]\n      - name: a\n        steps: [Tab]\n",
      error: 'a11y-genie.yaml, line 6: the state "a" is given twice on this page.',
    },
    {
      name: "a step that does not parse",
      text: "pages:\n  - path: /\n    states:\n      - name: a\n        steps: [\"clik button 'Menu'\"]\n",
      error: 'a11y-genie.yaml line 5 "clik button \'Menu\'", column 1: "clik" is not a step.',
    },
    {
      name: "a step with an engine prefix",
      text: "pages:\n  - path: /\n    states:\n      - name: a\n        steps: [\"click css 'text=Menu'\"]\n",
      error:
        'a11y-genie.yaml line 5 "click css \'text=Menu\'", column 12: a selector cannot start with "text=", which Playwright reads as another kind of selector.',
    },
    {
      name: "two steps in one string",
      text: 'pages:\n  - path: /\n    states:\n      - name: a\n        steps: ["Tab; Enter"]\n',
      error:
        'a11y-genie.yaml line 5 "Tab; Enter", column 4: a config step is one step, and this one has a ";" in it.',
    },
    {
      name: "a workflow with a media step",
      text: `${PAGE}workflows:\n  - name: w\n    page: home\n    steps: ["colorScheme dark"]\n`,
      error:
        'a11y-genie.yaml line 6 "colorScheme dark", column 1: colorScheme sets a state\'s media, and a flow has no media.',
    },
    {
      name: "a workflow on a page the file does not have",
      text: `${PAGE}workflows:\n  - name: w\n    page: nowhere\n    steps: [Tab]\n`,
      error: 'a11y-genie.yaml, line 5: the workflow\'s page "nowhere" is not a page key in this file.',
    },
    {
      name: "a key given twice",
      text: "pages:\n  - path: /\n    path: /a\n",
      error: 'a11y-genie.yaml, line 3: the key "path" is given twice.',
    },
    {
      name: "a tag",
      text: "pages: !!js/function x\n",
      error:
        'a11y-genie.yaml, line 1: "!" starts something this file does not take: no tags, anchors, aliases or block text.',
    },
    {
      name: "an anchor",
      text: "pages:\n  - &a\n    path: /\n",
      error:
        'a11y-genie.yaml, line 2: "&" starts something this file does not take: no tags, anchors, aliases or block text.',
    },
    {
      name: "a tab for indenting",
      text: "pages:\n\t- path: /\n",
      error: "a11y-genie.yaml, line 2: a tab is used to indent: use spaces.",
    },
    {
      name: "a quote never closed",
      text: 'baseUrl: "http://localhost:1\n',
      error: "a11y-genie.yaml, line 1: a quote is never closed.",
    },
    {
      name: "a value that is a list where text goes",
      text: "pages:\n  - path: [/]\n",
      error: 'a11y-genie.yaml, line 2: "path" in a page must be text.',
    },
  ];
  it.each(REFUSED)("refuses $name", ({ text, error }) => {
    expect(refusal(() => config(text)).message).toBe(error);
  });

  it("gives every refusal a hint", () => {
    for (const row of REFUSED) expect(refusal(() => config(row.text)).hint).not.toBe("");
  });

  it("cuts and cleans what it quotes of the file", () => {
    const error = refusal(() => config(`${PAGE}${"x".repeat(200)}\u001b[31m: 1\n`));
    expect(error.message).not.toContain("\u001b");
    expect(error.message.length).toBeLessThan(300);
  });
});

describe("the YAML subset", () => {
  it("never runs or expands anything: a tag, alias, merge key and block scalar are refused", () => {
    for (const text of [
      "a: *x\n",
      "a: &x 1\n",
      "<<: *x\n",
      "a: |\n  text\n",
      "a: >\n  text\n",
      "---\na: 1\n",
      "a: {b: 1}\n",
    ]) {
      expect(() => parseYamlSubset(text), text).toThrow(YamlError);
    }
  });

  it("reads numbers and booleans as the text they are", () => {
    const node = parseYamlSubset("a: 8080\nb: true\n");
    expect(
      node.kind === "mapping" &&
        node.entries.map((entry) => entry.value.kind === "string" && entry.value.value),
    ).toEqual(["8080", "true"]);
  });

  it("refuses a file longer than a config should be", () => {
    expect(() => parseYamlSubset("a: 1\n".repeat(6000))).toThrow(YamlError);
  });

  it("refuses a file nested far deeper than a config goes", () => {
    const deep = Array.from({ length: 40 }, (_, i) => `${" ".repeat(i * 2)}k${i}:`).join("\n");
    expect(() => parseYamlSubset(deep)).toThrow(YamlError);
  });
});
