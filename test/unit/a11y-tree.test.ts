import { describe, expect, it } from "vitest";
import { accessibleOf, roleWordsOf, statesOf } from "../../src/a11y-tree.js";
import { LIMITS } from "../../src/context.js";
import { controlsIn } from "../helpers/controls.js";

// The spoken line built from a node of the DevTools Protocol's accessibility tree (docs/ARCHITECTURE.md,
// *Reading the accessibility tree*), with no browser: the order of the parts, the words for roles and states, the unnamed
// form, and page text kept as data. The escape characters are built from their codes, so this file holds
// none of them itself.
const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const RLO = String.fromCharCode(0x202e);

/** A node as the protocol gives it: `{ value }` fields, and properties by name. */
function node(role: string, name: string, properties: Record<string, unknown> = {}, value?: unknown) {
  return {
    nodeId: "1",
    role: { type: "role", value: role },
    name: { type: "computedString", value: name },
    ...(value === undefined ? {} : { value: { type: "string", value } }),
    properties: Object.entries(properties).map(([key, v]) => ({ name: key, value: { type: "x", value: v } })),
  };
}

describe("the spoken line", () => {
  it.each([
    ["a button", node("button", "Save"), "Save, button"],
    ["a required field", node("textbox", "Email", { required: true }), "Email, edit text, required"],
    [
      "a menu button",
      node("button", "Menu", { hasPopup: "menu", expanded: false }),
      "Menu, menu button, collapsed",
    ],
    ["a heading", node("heading", "Intro", { level: 2 }), "Intro, heading, level 2"],
    ["a field with a value", node("textbox", "City", {}, "Oslo"), "City, edit text, Oslo"],
    ["a value equal to the name, said once", node("combobox", "UTC", {}, "UTC"), "UTC, combo box"],
    [
      "every state, in order",
      node("checkbox", "All", {
        checked: "mixed",
        selected: true,
        disabled: true,
        readonly: true,
        required: true,
        invalid: "true",
      }),
      "All, check box, partly checked, selected, disabled, read only, required, invalid",
    ],
    [
      "a state that does not hold, unsaid",
      node("textbox", "Name", { required: false, invalid: "false" }),
      "Name, edit text",
    ],
    ["a toggle button", node("button", "Mute", { pressed: "false" }), "Mute, toggle button, not pressed"],
    ["a role the table does not list", node("LabelText", "Label"), "Label, label text"],
  ])("%s", (_, ax, spoken) => {
    expect(accessibleOf(ax).spoken).toBe(spoken);
  });

  it("puts the place in a set after the states and before the value", () => {
    const ax = node("option", "Pacific", { selected: true }, "x");
    expect(accessibleOf(ax, { setPosition: { position: 3, size: 12 } }).spoken).toBe(
      "Pacific, option, selected, 3 of 12, x",
    );
  });

  it("prefers the value text worked out apart to the number", () => {
    const ax = node("slider", "Volume", { valuetext: "" }, 7);
    expect(accessibleOf(ax).spoken).toBe("Volume, slider, 7");
    expect(accessibleOf(ax, { valueText: "seven" }).spoken).toBe("Volume, slider, seven");
  });

  it("gives the unnamed form for a role with no name: the role, and the rest", () => {
    expect(accessibleOf(node("button", ""))).toMatchObject({ unnamed: true, spoken: "button", name: "" });
    expect(accessibleOf(node("checkbox", "  ", { checked: "true" }))).toMatchObject({
      unnamed: true,
      spoken: "check box, checked",
    });
  });

  it("is not unnamed, and says nothing, for a role that says nothing", () => {
    expect(accessibleOf(node("generic", ""))).toMatchObject({ roleWords: "", unnamed: false, spoken: "" });
  });

  it("reads a node with nothing in it, or junk in its fields, as no role and no name", () => {
    for (const junk of [undefined, null, 7, {}, { role: 5, name: { value: ["x"] }, properties: "no" }]) {
      expect(accessibleOf(junk)).toEqual({
        role: null,
        roleWords: "",
        name: "",
        value: "",
        states: [],
        unnamed: false,
        spoken: "",
      });
    }
  });

  it("makes a hostile name and value printable, on one line", () => {
    const name = `${ESC}[31mRed${ESC}[0m and${BEL}\nbell${RLO}`;
    const read = accessibleOf(node("textbox", name, {}, `${ESC}]0;title${BEL}typed`));
    expect(read.name).toBe("Red and bell");
    expect(read.value).toBe("typed");
    expect(read.spoken).toBe("Red and bell, edit text, typed");
    expect(controlsIn(read.spoken)).toEqual([]);
  });

  it("cuts a long name to the excerpt limit", () => {
    const read = accessibleOf(node("button", "a".repeat(400)));
    expect(read.name).toBe(`${"a".repeat(LIMITS.excerptChars)}…`);
  });

  it("never takes a role word from the object's prototype", () => {
    expect(roleWordsOf("constructor", new Map())).toBe("constructor");
    expect(roleWordsOf("toString", new Map())).toBe("to string");
  });

  it("says no state for a value it does not know", () => {
    expect(
      statesOf(
        new Map<string, unknown>([
          ["checked", "maybe"],
          ["expanded", "yes"],
        ]),
      ),
    ).toEqual([]);
  });
});
