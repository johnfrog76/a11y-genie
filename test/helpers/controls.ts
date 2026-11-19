/**
 * The terminal escapes and control characters in `text`, in order: every C0 control but tab and newline,
 * DEL, every C1 control, and the bidirectional embeddings, overrides and isolates. What src/printable.ts
 * must never leave in printed text, counted independently of it.
 */
export function controlsIn(text: string): string[] {
  return [...text].filter((char) => {
    const code = char.charCodeAt(0);
    if (char === "\n" || char === "\t") return false;
    return (
      code < 0x20 ||
      (code >= 0x7f && code <= 0x9f) ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069)
    );
  });
}
