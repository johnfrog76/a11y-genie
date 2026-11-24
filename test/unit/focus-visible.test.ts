import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  changedStyles,
  clipOf,
  COMPARED_STYLES,
  PAD_PX,
  verdictOf,
  VISIBLE_SHARE,
} from "../../src/focus-visible.js";
import { changedPixels, cropImage, decodePng, maskArea, type Rgba } from "../../src/png.js";

/** A PNG of 8-bit RGB (colour type 2), each row with the given filter type, for the reader to read back. */
function png(
  width: number,
  height: number,
  pixel: (x: number, y: number) => [number, number, number],
  filter = 0,
): Buffer {
  const chunk = (type: string, body: Buffer): Buffer => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0);
    head.write(type, 4, "latin1");
    return Buffer.concat([head, body, Buffer.alloc(4)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw: number[] = [];
  for (let y = 0; y < height; y += 1) {
    raw.push(filter);
    for (let x = 0; x < width; x += 1) {
      const here = pixel(x, y);
      // Filter 1 (Sub) stores each byte less the byte one pixel to the left.
      const left = filter === 1 && x > 0 ? pixel(x - 1, y) : [0, 0, 0];
      for (let c = 0; c < 3; c += 1) raw.push(((here[c] ?? 0) - (left[c] ?? 0)) & 0xff);
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.from(raw))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

describe("genie/focus-visible, without a browser", () => {
  it("reads back an RGB PNG, unfiltered and Sub-filtered, and counts changed pixels past the tolerance", () => {
    const white = (): [number, number, number] => [255, 255, 255];
    const ring = (x: number, y: number): [number, number, number] =>
      y === 0 ? [26, 95, 180] : x === 3 ? [250, 250, 250] : [255, 255, 255];
    const a = decodePng(png(4, 3, white));
    const b = decodePng(png(4, 3, ring, 1));
    expect([a.width, a.height, a.data.length]).toEqual([4, 3, 48]);
    expect([...b.data.subarray(0, 4)]).toEqual([26, 95, 180, 255]);
    // The top row changed; the faint column (5 levels) counts only with no tolerance.
    expect(changedPixels(a, b, 16)).toBe(4);
    expect(changedPixels(a, b, 0)).toBe(6);
  });

  it("refuses what is not a PNG it reads", () => {
    expect(() => decodePng(Buffer.from("not a png"))).toThrow();
  });

  it("decides by the share of changed pixels, then by the styles", () => {
    expect(verdictOf(VISIBLE_SHARE, [])).toEqual({ kind: "visible" });
    expect(verdictOf(0.5, ["box-shadow"])).toEqual({ kind: "visible" });
    expect(verdictOf(0, [])).toEqual({ kind: "hidden" });
    // Never a finding when something changed: a person looks.
    expect(verdictOf(0, ["background-color"]).kind).toBe("review");
    expect(verdictOf(VISIBLE_SHARE / 2, []).kind).toBe("review");
  });

  it("compares the styles of the element and its ancestors by name", () => {
    const row = COMPARED_STYLES.map(() => "x");
    const other = [...row];
    other[COMPARED_STYLES.indexOf("box-shadow")] = "y";
    expect(changedStyles([row, row], [row, row])).toEqual([]);
    expect(changedStyles([row, other], [row, row])).toEqual(["box-shadow"]);
  });

  it("pads the box and keeps the clip inside the window", () => {
    expect(clipOf({ x: 10.5, y: 20, width: 30, height: 10, viewWidth: 800, viewHeight: 600 })).toEqual({
      x: 10.5 - PAD_PX - 0.5,
      y: 20 - PAD_PX,
      width: 30 + 2 * PAD_PX + 1,
      height: 10 + 2 * PAD_PX,
    });
    expect(clipOf({ x: 0, y: 0, width: 10, height: 10, viewWidth: 800, viewHeight: 600 })).toMatchObject({
      x: 0,
      y: 0,
    });
    expect(
      clipOf({ x: -9999, y: 0, width: 40, height: 20, viewWidth: 800, viewHeight: 600 }),
    ).toBeUndefined();
  });
});

describe("the witness's crop and mask", () => {
  /** A width by height image whose pixel at (x, y) has red x, green y and blue 0. */
  const grid = (width: number, height: number): Rgba => {
    const data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y += 1)
      for (let x = 0; x < width; x += 1) data.set([x, y, 0, 255], (y * width + x) * 4);
    return { width, height, data };
  };

  it("crops the padded box out of the window shot, pixel for pixel", () => {
    const part = cropImage(grid(10, 8), { x: 3, y: 2, width: 4, height: 3 });
    expect([part.width, part.height]).toEqual([4, 3]);
    expect(Array.from(part.data.subarray(0, 4))).toEqual([3, 2, 0, 255]);
    expect(Array.from(part.data.subarray(part.data.length - 4))).toEqual([6, 4, 0, 255]);
  });

  it("refuses a crop outside the window", () => {
    expect(() => cropImage(grid(10, 8), { x: 8, y: 0, width: 4, height: 2 })).toThrow();
  });

  it("leaves out the previous stop's box, cut to the image, so only the rest is compared", () => {
    const now = grid(6, 6);
    const then: Rgba = { width: 6, height: 6, data: new Uint8Array(6 * 6 * 4) };
    expect(changedPixels(now, then, 0)).toBeGreaterThan(0);
    maskArea(then, now, { x: -2, y: -2, width: 20, height: 20 });
    expect(changedPixels(now, then, 0)).toBe(0);
    const partly: Rgba = { width: 6, height: 6, data: new Uint8Array(6 * 6 * 4) };
    maskArea(partly, now, { x: 0, y: 0, width: 6, height: 3 });
    expect(Array.from(partly.data.subarray(6 * 3 * 4, 6 * 3 * 4 + 4))).toEqual([0, 0, 0, 0]);
  });
});
