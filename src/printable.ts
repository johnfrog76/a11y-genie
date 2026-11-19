/**
 * Page text, made safe to print (spec 8A.1, "Text from the page in our outputs"). A page chooses its own
 * title, addresses, dialog messages and markup, and can put terminal escape sequences in them: to colour or
 * hide text, move the cursor, rewrite the window title, or show a link (OSC 8) whose text is not where it
 * goes. Everything the command prints, and everything `report.md` quotes, passes through `printable` first.
 * `scan.json` keeps the page's text exactly, as data: `scanJson` writes the same characters as escapes.
 */

// The escape sequences ECMA-48 defines, each removed whole, with its 7-bit (ESC) and 8-bit (C1) forms:
// - OSC, DCS, SOS, PM and APC: a string up to BEL or ST (ESC \ or U+009C), or to the end when it is never
//   closed, as a terminal would swallow it. OSC 8 links and window titles are OSC strings;
// - CSI: ESC [ or U+009B, parameter bytes, intermediate bytes and a final byte (colours, cursor moves);
// - any other escape: ESC, intermediate bytes and a final byte.
const SEQUENCES = new RegExp(
  [
    String.raw`(?:\u001b[\]PX^_]|[\u0090\u0098\u009d\u009e\u009f])[\s\S]*?(?:\u0007|\u001b\\|\u009c|$)`,
    String.raw`(?:\u001b\[|\u009b)[\u0030-\u003f]*[\u0020-\u002f]*[\u0040-\u007e]?`,
    String.raw`\u001b[\u0020-\u002f]*[\u0030-\u007e]?`,
  ].join("|"),
  "g",
);

// What is left: every C0 control but tab and newline, carriage return included (it rewrites the line it is
// on), DEL, every C1 control, and the bidirectional embeddings, overrides and isolates, which can make text
// read in an order other than the one it is in.
// eslint-disable-next-line no-control-regex
const CONTROLS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g;

/** `text` with every terminal escape sequence and control character removed. Tabs and newlines stay. */
export function printable(text: string): string {
  return text.replace(SEQUENCES, "").replace(CONTROLS, "");
}

/** `printable(text)` on one line: tabs and newlines become single spaces, and the ends are trimmed. */
export function printableLine(text: string): string {
  return printable(text).replace(/\s+/g, " ").trim();
}

// Characters JSON may hold as they are, but that are written as `\u` escapes in `scan.json`, so the file
// (and `--json` on a terminal) carries no raw control: DEL, the C1 controls, the bidirectional controls, and
// the line and paragraph separators. JSON.stringify already escapes the C0 controls.
const JSON_ESCAPED = /[\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;

/** JSON text with the characters above written as `\u` escapes. It parses to exactly the same value. */
export function escapeJsonControls(json: string): string {
  return json.replace(JSON_ESCAPED, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
}
