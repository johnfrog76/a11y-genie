import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { KEY_NAMES, MODIFIER_KEYS } from "../../src/keys.js";

// The key names a step may press, held to the ones the installed playwright-core accepts. Its keyboard layout
// is read as data from its bundle (the object literal is JSON but for comments, trailing commas and one '"'),
// and the names are built from it the way playwright-core's buildLayoutClosure() builds them.
const require = createRequire(import.meta.url);

interface KeyDefinition {
  key: string;
  shiftKey?: string;
  location?: number;
}

function playwrightKeyNames(): Set<string> {
  const bundle = readFileSync(
    join(dirname(require.resolve("playwright-core/package.json")), "lib", "coreBundle.js"),
    "utf8",
  );
  const literal = /USKeyboardLayout = (\{[\s\S]*?\n {4}\});/.exec(bundle)?.[1];
  if (literal === undefined)
    throw new Error("playwright-core's USKeyboardLayout was not found in its bundle");
  const json = literal
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/,(\s*\})/g, "$1")
    .replaceAll(`'"'`, `"\\""`);
  const layout = JSON.parse(json) as Record<string, KeyDefinition>;
  const aliases: Record<string, string[]> = {
    ShiftLeft: ["Shift"],
    ControlLeft: ["Control"],
    AltLeft: ["Alt"],
    MetaLeft: ["Meta"],
    Enter: ["\n", "\r"],
  };
  const names = new Set<string>(["ControlOrMeta"]);
  for (const [code, definition] of Object.entries(layout)) {
    names.add(code);
    for (const alias of aliases[code] ?? []) names.add(alias);
    if (definition.location) continue;
    if (definition.key.length === 1) names.add(definition.key);
    if (definition.shiftKey) names.add(definition.shiftKey);
  }
  return names;
}

describe("KEY_NAMES", () => {
  it("is every key playwright-core presses, but the characters the step grammar spells out", () => {
    const spelled = [" ", ";", "'", "\n", "\r"];
    const expected = [...playwrightKeyNames()].filter((key) => !spelled.includes(key)).sort();
    expect([...KEY_NAMES].sort()).toEqual(expected);
  });

  it("spells each left-out character as a named key", () => {
    for (const key of ["Space", "Semicolon", "Quote", "Enter"]) expect(KEY_NAMES.has(key)).toBe(true);
  });

  it("has every modifier as a key of its own", () => {
    for (const key of MODIFIER_KEYS) expect(KEY_NAMES.has(key)).toBe(true);
  });
});
