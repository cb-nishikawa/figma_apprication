import { zlibSync } from "fflate";

/**
 * PNG の「圧縮率（%）」は色数削減（量子化）で実現する。可逆画像のため
 * canvas の toBlob では品質引数が効かず、ここで median-cut でパレットを
 * 作って Floyd–Steinberg でディザリングし、自前エンコーダで書き出す。
 * 圧縮（deflate）は既存依存の fflate を利用する。
 */

interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** % → 色数（2〜256）。100 は 256 のため量子化なし扱い。 */
export function colorsForQuality(quality: number): number {
  return Math.max(2, Math.min(256, Math.round((256 * quality) / 100)));
}

/** PNG bytes を maxColors 色以下へ量子化して返す。 */
export async function quantizePng(
  pngBytes: number[],
  maxColors: number
): Promise<Uint8Array<ArrayBuffer>> {
  if (maxColors >= 256) {
    return new Uint8Array(pngBytes);
  }
  const blob = new Blob([new Uint8Array(pngBytes)], { type: "image/png" });
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  if (canvas.width === 0 || canvas.height === 0) {
    bitmap.close();
    return new Uint8Array(pngBytes);
  }
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    bitmap.close();
    throw new Error("canvas 2D を取得できません");
  }
  try {
    ctx.drawImage(bitmap, 0, 0);
  } finally {
    bitmap.close();
  }
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return encodeQuantized(image.data, image.width, image.height, maxColors);
}

function encodeQuantized(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  maxColors: number
): Uint8Array<ArrayBuffer> {
  const count = width * height;
  if (count === 0) {
    return new Uint8Array();
  }
  const px: RGBA[] = [];
  for (let i = 0; i < count; i++) {
    const a = data[i * 4 + 3];
    if (a > 0) {
      px.push({ r: data[i * 4], g: data[i * 4 + 1], b: data[i * 4 + 2], a });
    }
  }
  if (px.length === 0) {
    const palette: RGBA[] = [{ r: 0, g: 0, b: 0, a: 0 }];
    return encodePng({ palette, indices: new Uint8Array(count), width, height });
  }
  const palette = medianCut(px, maxColors);
  const hasTransparent = count !== px.length;
  if (hasTransparent && !palette.some((p) => p.a === 0)) {
    palette.push({ r: 0, g: 0, b: 0, a: 0 });
  }
  const indices = floydSteinberg(data, width, height, palette);
  return encodePng({ palette, indices, width, height });
}

function medianCut(px: RGBA[], maxColors: number): RGBA[] {
  const arr = px.map((_, i) => i);
  const boxes: { start: number; end: number }[] = [{ start: 0, end: arr.length }];
  while (boxes.length < maxColors) {
    let bestBox = -1;
    let bestRange = -1;
    let bestInfo: BoxInfo | null = null;
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i];
      if (box.end - box.start < 2) {
        continue;
      }
      const info = boxInfo(px, arr, box.start, box.end);
      const range = Math.max(
        info.rMax - info.rMin,
        info.gMax - info.gMin,
        info.bMax - info.bMin
      );
      if (range > bestRange) {
        bestRange = range;
        bestBox = i;
        bestInfo = info;
      }
    }
    if (bestBox < 0 || !bestInfo) {
      break;
    }
    const box = boxes[bestBox];
    const channel = channelOfLargestRange(bestInfo);
    const sub = arr.slice(box.start, box.end);
    sub.sort((x, y) => {
      const dx = px[x];
      const dy = px[y];
      const diff = channelValue(dx, channel) - channelValue(dy, channel);
      return diff !== 0 ? diff : dx.a - dy.a;
    });
    for (let j = 0; j < sub.length; j++) {
      arr[box.start + j] = sub[j];
    }
    const mid = box.start + Math.floor((box.end - box.start) / 2);
    boxes.splice(
      bestBox,
      1,
      { start: box.start, end: mid },
      { start: mid, end: box.end }
    );
  }
  return boxes.map((box) => boxAverage(px, arr, box.start, box.end));
}

interface BoxInfo {
  rMin: number;
  gMin: number;
  bMin: number;
  rMax: number;
  gMax: number;
  bMax: number;
}

function boxInfo(px: RGBA[], arr: number[], start: number, end: number): BoxInfo {
  let rMin = 255, gMin = 255, bMin = 255;
  let rMax = 0, gMax = 0, bMax = 0;
  for (let i = start; i < end; i++) {
    const p = px[arr[i]];
    if (p.r < rMin) rMin = p.r;
    if (p.g < gMin) gMin = p.g;
    if (p.b < bMin) bMin = p.b;
    if (p.r > rMax) rMax = p.r;
    if (p.g > gMax) gMax = p.g;
    if (p.b > bMax) bMax = p.b;
  }
  return { rMin, gMin, bMin, rMax, gMax, bMax };
}

type Channel = "r" | "g" | "b";

function channelOfLargestRange(info: BoxInfo): Channel {
  const r = info.rMax - info.rMin;
  const g = info.gMax - info.gMin;
  const b = info.bMax - info.bMin;
  if (r >= g && r >= b) return "r";
  if (g >= r && g >= b) return "g";
  return "b";
}

function channelValue(p: RGBA, channel: Channel): number {
  return p[channel];
}

function boxAverage(px: RGBA[], arr: number[], start: number, end: number): RGBA {
  let r = 0, g = 0, b = 0, a = 0;
  for (let i = start; i < end; i++) {
    const p = px[arr[i]];
    r += p.r;
    g += p.g;
    b += p.b;
    a += p.a;
  }
  const n = end - start;
  return { r: r / n, g: g / n, b: b / n, a: a / n };
}

function floydSteinberg(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  palette: RGBA[]
): Uint8Array {
  const size = width * height;
  const r = new Float64Array(size);
  const g = new Float64Array(size);
  const b = new Float64Array(size);
  const a = new Float64Array(size);
  for (let i = 0; i < size; i++) {
    r[i] = data[i * 4];
    g[i] = data[i * 4 + 1];
    b[i] = data[i * 4 + 2];
    a[i] = data[i * 4 + 3];
  }
  const out = new Uint8Array(size);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const k = y * width + x;
      const pi = nearestPalette(palette, r[k], g[k], b[k], a[k]);
      out[k] = pi;
      const p = palette[pi];
      if (a[k] === 0) {
        continue;
      }
      diffuse(r, r[k] - p.r, width, height, x, y);
      diffuse(g, g[k] - p.g, width, height, x, y);
      diffuse(b, b[k] - p.b, width, height, x, y);
    }
  }
  return out;
}

function diffuse(
  channel: Float64Array,
  err: number,
  width: number,
  height: number,
  x: number,
  y: number
): void {
  const apply = (xx: number, yy: number, weight: number): void => {
    if (xx < 0 || xx >= width || yy < 0 || yy >= height) {
      return;
    }
    channel[yy * width + xx] += err * weight;
  };
  apply(x + 1, y, 7 / 16);
  apply(x - 1, y + 1, 3 / 16);
  apply(x, y + 1, 5 / 16);
  apply(x + 1, y + 1, 1 / 16);
}

function nearestPalette(palette: RGBA[], r: number, g: number, b: number, a: number): number {
  if (a === 0) {
    for (let i = 0; i < palette.length; i++) {
      if (palette[i].a === 0) return i;
    }
  }
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const p = palette[i];
    const dr = p.r - r;
    const dg = p.g - g;
    const db = p.b - b;
    const da = p.a - a;
    const d = dr * dr + dg * dg + db * db + da * da * 0.25;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

interface EncodeData {
  palette: RGBA[];
  indices: Uint8Array;
  width: number;
  height: number;
}

function encodePng({ palette, indices, width, height }: EncodeData): Uint8Array<ArrayBuffer> {
  const plte = new Uint8Array(palette.length * 3);
  for (let i = 0; i < palette.length; i++) {
    plte[i * 3] = clamp8(palette[i].r);
    plte[i * 3 + 1] = clamp8(palette[i].g);
    plte[i * 3 + 2] = clamp8(palette[i].b);
  }
  const hasAlpha = palette.some((p) => p.a < 255);
  const trns = hasAlpha
    ? Uint8Array.from(palette, (p) => clamp8(p.a))
    : null;

  const raw = new Uint8Array(height * (1 + width));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x++) {
      raw[rowStart + 1 + x] = indices[y * width + x];
    }
  }
  const idat = zlibSync(raw);

  const chunks: Uint8Array[] = [
    makeChunk("IHDR", makeIhdr(width, height)),
    makeChunk("PLTE", plte),
  ];
  if (trns) {
    chunks.push(makeChunk("tRNS", trns));
  }
  chunks.push(makeChunk("IDAT", new Uint8Array(idat)));
  chunks.push(makeChunk("IEND", new Uint8Array()));

  const total = 8 + chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  out.set(Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10), 0);
  let pos = 8;
  for (const chunk of chunks) {
    out.set(chunk, pos);
    pos += chunk.length;
  }
  return out;
}

function makeIhdr(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(13);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  bytes[8] = 8; // bit depth
  bytes[9] = 3; // color type: indexed
  bytes[10] = 0; // compression
  bytes[11] = 0; // filter
  bytes[12] = 0; // interlace
  return bytes;
}

function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = Uint8Array.from(type, (c) => c.charCodeAt(0));
  const chunk = new Uint8Array(4 + 4 + data.length + 4);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  const crcInput = new Uint8Array(typeBytes.length + data.length);
  crcInput.set(typeBytes, 0);
  crcInput.set(data, typeBytes.length);
  view.setUint32(8 + data.length, crc32(crcInput) >>> 0);
  return chunk;
}

const CRC_TABLE = new Uint32Array(256).map(
  (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    return c >>> 0;
  }
);

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function clamp8(value: number): number {
  if (value < 0) return 0;
  if (value > 255) return 255;
  return Math.round(value);
}