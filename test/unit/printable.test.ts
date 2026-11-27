import { describe, expect, it } from "vitest";
import { escapeJsonControls, printable, printableLine } from "../../src/printable.js";
import { controlsIn } from "../helpers/controls.js";

// Page text made safe to print (docs/ARCHITECTURE.md, *Hostile pages*): every terminal escape sequence and control character removed,
// whole. The characters are built from their codes, so this file holds none of them itself.
const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const ST = `${ESC}\\`;
const C1_CSI = String.fromCharCode(0x9b);
const C1_OSC = String.fromCharCode(0x9d);
const C1_ST = String.fromCharCode(0x9c);
const RLO = String.fromCharCode(0x202e);
const LRI = String.fromCharCode(0x2066);
const PDI = String.fromCharCode(0x2069);

describe("printable", () => {
  it.each([
    ["a colour (CSI SGR)", `${ESC}[31mred${ESC}[0m text`, "red text"],
    ["a cursor move and a line clear", `before${ESC}[2K${ESC}[1A${ESC}[10;20Hafter`, "beforeafter"],
    ["a private-mode CSI", `${ESC}[?1049hscreen${ESC}[?25l`, "screen"],
    ["an 8-bit CSI", `${C1_CSI}1;31mred`, "red"],
    ["a window title (OSC 0, BEL)", `${ESC}]0;pwned${BEL}title`, "title"],
    ["a window title (OSC 2, ST)", `${ESC}]2;pwned${ST}title`, "title"],
    ["an OSC 8 link", `${ESC}]8;;https://evil.example/${ST}Click me${ESC}]8;;${ST}`, "Click me"],
    ["an 8-bit OSC", `${C1_OSC}0;pwned${C1_ST}title`, "title"],
    ["an OSC never closed, to the end", `safe${ESC}]0;never closed`, "safe"],
    ["a DCS string", `${ESC}Pq#0;2;0;0;0${ST}after`, "after"],
    ["an APC string", `${ESC}_payload${ST}after`, "after"],
    ["a two-byte escape (RIS, a full reset)", `${ESC}cafter`, "after"],
    ["a charset escape", `${ESC}(0after`, "after"],
    ["a lone ESC at the end", `after${ESC}`, "after"],
    ["a carriage return that rewrites the line", `safe text\rEVIL`, "safe textEVIL"],
    ["a backspace", "ab\bc", "abc"],
    ["a bell and NUL", `a${BEL}b\u0000c`, "abc"],
    ["DEL", "a\u007fb", "ab"],
    ["the bidi overrides and isolates", `abc${RLO}fed${LRI}x${PDI}`, "abcfedx"],
  ])("removes %s", (_what, input, output) => {
    expect(printable(input)).toBe(output);
    expect(controlsIn(printable(input))).toEqual([]);
  });

  it("keeps newlines, tabs and ordinary text, other scripts and emoji included", () => {
    const text = "line one\n\tline two: café, 日本語, עברית, 🧞";
    expect(printable(text)).toBe(text);
  });

  it("leaves no control behind, whatever the mix", () => {
    const all = Array.from({ length: 0xa0 }, (_, code) => String.fromCharCode(code)).join("");
    expect(controlsIn(printable(`${all}${RLO}${LRI}${PDI}`))).toEqual([]);
  });

  it("printableLine puts the text on one line", () => {
    expect(printableLine(`  one\ntwo\t${ESC}[1mthree${ESC}[0m  `)).toBe("one two three");
  });
});

describe("escapeJsonControls", () => {
  it("writes DEL, C1, bidi and line separators as escapes, and parses back to the same value", () => {
    const value = { title: `a${C1_CSI}31m${RLO}b\u2028c\u007f${ESC}[0m` };
    const json = escapeJsonControls(JSON.stringify(value));
    expect(json).toBe(String.raw`{"title":"a\u009b31m\u202eb\u2028c\u007f\u001b[0m"}`);
    expect(JSON.parse(json)).toEqual(value);
    expect(controlsIn(json)).toEqual([]);
  });
});
