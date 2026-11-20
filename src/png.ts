/**
 * A small PNG reader, for the screenshots `genie/focus-visible` compares (src/focus-visible.ts). It reads what
 * Chrome's screenshots are: 8 bits a channel, RGB or RGBA, not interlaced. Anything else is refused, and the
 * check then lists the element under *needs review*. It uses Node's own zlib, so it needs no dependency.
 *
 * The bytes come from the browser's own screenshot of the page, never from the page itself, and they stay in
 * memory: nothing here writes a file.
 */

import { inflateSync } from "node:zlib";

/** A decoded image: `width` by `height` pixels, four bytes each (red, green, blue, alpha), row by row. */
export interface Rgba {
  width: number;
  height: number;
  data: Uint8Array;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The largest image read, in pixels: a padded element on a large screen is far smaller. */
const MAX_PIXELS = 4096 * 4096;

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** Decodes a PNG of 8-bit RGB or RGBA, not interlaced. Throws on anything else. */
export function decodePng(png: Uint8Array): Rgba {
  const bytes = Buffer.from(png.buffer, png.byteOffset, png.byteLength);
  if (bytes.length < 8 || SIGNATURE.some((b, i) => bytes[i] !== b)) throw new Error("not a PNG");
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat: Buffer[] = [];
  let at = 8;
  while (at + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.toString("latin1", at + 4, at + 8);
    const body = bytes.subarray(at + 8, at + 8 + length);
    if (body.length !== length) throw new Error("a PNG chunk is cut short");
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const depth = body[8];
      const colour = body[9];
      const interlace = body[12];
      if (depth !== 8 || (colour !== 2 && colour !== 6) || interlace !== 0) {
        throw new Error("a PNG of a kind this reader does not read");
      }
      channels = colour === 6 ? 4 : 3;
    } else if (type === "IDAT") {
      idat.push(body);
    } else if (type === "IEND") {
      break;
    }
    at += 12 + length;
  }
  if (channels === 0 || width === 0 || height === 0 || width * height > MAX_PIXELS) {
    throw new Error("a PNG with no usable header");
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) throw new Error("a PNG with too little image data");
  const rows = new Uint8Array(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const from = y * (stride + 1) + 1;
    const row = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const value = raw[from + x] ?? 0;
      const left = x >= channels ? (rows[row + x - channels] ?? 0) : 0;
      const up = y > 0 ? (rows[row - stride + x] ?? 0) : 0;
      const upLeft = y > 0 && x >= channels ? (rows[row - stride + x - channels] ?? 0) : 0;
      let out: number;
      if (filter === 0) out = value;
      else if (filter === 1) out = value + left;
      else if (filter === 2) out = value + up;
      else if (filter === 3) out = value + ((left + up) >> 1);
      else if (filter === 4) out = value + paeth(left, up, upLeft);
      else throw new Error("a PNG row with an unknown filter");
      rows[row + x] = out & 0xff;
    }
  }
  if (channels === 4) return { width, height, data: rows };
  const data = new Uint8Array(width * height * 4);
  for (let i = 0, j = 0; i < rows.length; i += 3, j += 4) {
    data[j] = rows[i] ?? 0;
    data[j + 1] = rows[i + 1] ?? 0;
    data[j + 2] = rows[i + 2] ?? 0;
    data[j + 3] = 255;
  }
  return { width, height, data };
}

/**
 * How many pixels differ between two images of the same size, a pixel counting when any of its red, green and
 * blue differ by more than `tolerance` (0 to 255). Alpha is not compared: a screenshot is opaque.
 */
export function changedPixels(a: Rgba, b: Rgba, tolerance: number): number {
  if (a.width !== b.width || a.height !== b.height) throw new Error("two images of different sizes");
  let changed = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    for (let c = 0; c < 3; c += 1) {
      if (Math.abs((a.data[i + c] ?? 0) - (b.data[i + c] ?? 0)) > tolerance) {
        changed += 1;
        break;
      }
    }
  }
  return changed;
}
