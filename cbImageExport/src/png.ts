import { zlibSync } from "fflate";

/**
 * PNG の「圧縮率（%）」は色数削減（量子化）で実現する。可逆画像のため
 * canvas の toBlob では品質引数が効かない。
 *
 * 量子化は視覚品質を優先した実装:
 *  - ユニーク色 ≤ maxColors なら量子化・ディザリングを行わず完全一致でパレット化
 *  - パレットは γ 線形化 + プレマルチプライド（α 込み）空間の
 *    重み付き k-means（k-means++ シード + Lloyd 収束）で構築
 *  - ディザリングはプレマルチ線形空間の Floyd–Steinberg（蛇行スキャン・2 行バッファ）
 * 伸張（deflate）は既存依存の fflate を利用する。
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

// ---------- 色空間変換 ----------

/**
 * 量子化・距離・ディザは「線形の立方根（CIE-L* 近似）」空間で行う。
 * 線形空間は暗部のベクトルが小さく暗色の判別が潰れるため、
 * γ 線形化に加えて立方根で圧縮し、暗部も含め視覚的な差を均等に扱う。
 */
const LIN_LUT: Float64Array = new Float64Array(256);
const CUBE_LUT: Float64Array = new Float64Array(256);
for (let c = 0; c < 256; c++) {
  const v = c / 255;
  LIN_LUT[c] =
    v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  CUBE_LUT[c] = Math.cbrt(LIN_LUT[c]);
}

/** 立方根空間の値（プレマルチ解除済み・線形 [0,1]）→ sRGB byte。 */
function cubeToByte(v: number): number {
  const clamped = v < 0 ? 0 : v > 1 ? 1 : v;
  const lin = clamped * clamped * clamped;
  if (lin <= 0.0031308) {
    return clamp8(lin * 12.92 * 255);
  }
  return clamp8((1.055 * Math.pow(lin, 1 / 2.4) - 0.055) * 255);
}

// α 差分の距離重み（プレマルチ空間の合成色差に α 差を弱く加味）。0〜1。
const ALPHA_DIST_WEIGHT = 0.15;

export interface QuantizedResult {
  palette: RGBA[];
  indices: Uint8Array;
  width: number;
  height: number;
}

/** RGBA を量子化してパレット PNG バイトへ。テスト（Node）でも利用できる純粋関数。 */
export function encodeQuantized(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  maxColors: number
): Uint8Array<ArrayBuffer> {
  const result = quantizeImageData(data, width, height, maxColors);
  return encodePng(result);
}

/**
 * RGBA 画像データを maxColors 色以下へ量子化する。
 * - ユニーク色 ≤ maxColors: 量子化なし（完全一致パレット）
 * - それ以外: 5bit ヒストグラムの k-means パレット + プレマルチ空間 F–S ディザリング
 */
export function quantizeImageData(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  maxColors: number
): QuantizedResult {
  const count = width * height;
  if (count === 0) {
    return { palette: [], indices: new Uint8Array(), width, height };
  }
  const exact = collectExact(data, count, maxColors);
  if (!exact.clustered) {
    return exactPalette(data, count, exact, width, height);
  }
  const transparent = exact.hasTransparent;
  const budget = transparent ? maxColors - 1 : maxColors;
  const histogram = buildHistogram(data, count);
  const centers = cluster(histogram, Math.max(1, budget));
  const palette = centersToPalette(centers);
  if (transparent) {
    palette.push({ r: 0, g: 0, b: 0, a: 0 });
  }
  const indices = dither(data, width, height, palette);
  return { palette, indices, width, height };
}

// ---------- ユニーク色の収集 ----------

interface ExactInfo {
  colors: number[];
  colorsKeyed: Map<number, number>;
  hasTransparent: boolean;
  clustered: boolean;
}

function collectExact(
  data: Uint8ClampedArray,
  count: number,
  maxColors: number
): ExactInfo {
  const colorsKeyed = new Map<number, number>();
  const colors: number[] = [];
  let hasTransparent = false;
  let clustered = false;
  for (let i = 0; i < count; i++) {
    const off = i * 4;
    const k = packColor(data[off], data[off + 1], data[off + 2], data[off + 3]);
    if (data[off + 3] === 0) {
      hasTransparent = true;
    }
    if (!colorsKeyed.has(k)) {
      if (colors.length >= maxColors) {
        clustered = true;
        continue;
      }
      colorsKeyed.set(k, colors.length);
      colors.push(k);
    }
  }
  return { colors, colorsKeyed, hasTransparent, clustered };
}

function exactPalette(
  data: Uint8ClampedArray,
  count: number,
  exact: ExactInfo,
  width: number,
  height: number
): QuantizedResult {
  const palette = exact.colors.map((k) => unpackColor(k));
  const indices = new Uint8Array(count);
  const keyed = exact.colorsKeyed;
  for (let i = 0; i < count; i++) {
    const off = i * 4;
    indices[i] = keyed.get(
      packColor(data[off], data[off + 1], data[off + 2], data[off + 3])
    )!;
  }
  return { palette, indices, width, height };
}

function packColor(r: number, g: number, b: number, a: number): number {
  return (r | (g << 8) | (b << 16) | (a << 24)) >>> 0;
}

function unpackColor(k: number): RGBA {
  return { r: k & 0xff, g: (k >>> 8) & 0xff, b: (k >>> 16) & 0xff, a: k >>> 24 };
}

// ---------- ヒストグラム（5bit / チャンネル、プレマルチ線形の合算） ----------

interface HistBin {
  count: number;
  sumPr: number;
  sumPg: number;
  sumPb: number;
  sumA: number;
}

/** プレマルチ線形空間（各プレマルチ ρ∈[0,1]、α∈[0,1]）の中心。 */
interface Center {
  pr: number;
  pg: number;
  pb: number;
  a: number;
}

function buildHistogram(data: Uint8ClampedArray, count: number): HistBin[] {
  const map = new Map<number, HistBin>();
  for (let i = 0; i < count; i++) {
    const off = i * 4;
    const r = data[off];
    const g = data[off + 1];
    const b = data[off + 2];
    const a = data[off + 3];
    const key =
      (r >> 3) |
      ((g >> 3) << 5) |
      ((b >> 3) << 10) |
      ((a >> 3) << 15) |
      (a === 0 ? 0x80000000 : 0);
    const av = a / 255;
    const bin = map.get(key);
    if (bin) {
      bin.count++;
      bin.sumPr += CUBE_LUT[r] * av;
      bin.sumPg += CUBE_LUT[g] * av;
      bin.sumPb += CUBE_LUT[b] * av;
      bin.sumA += av;
    } else {
      map.set(key, {
        count: 1,
        sumPr: CUBE_LUT[r] * av,
        sumPg: CUBE_LUT[g] * av,
        sumPb: CUBE_LUT[b] * av,
        sumA: av,
      });
    }
  }
  return [...map.values()];
}

// ---------- k-means パレット構築 ----------

function cluster(bins: HistBin[], maxColors: number): Center[] {
  if (bins.length === 0) {
    return [];
  }
  const k = Math.min(maxColors, bins.length);
  const rep: Center[] = bins.map((bin) => ({
    pr: bin.sumPr / bin.count,
    pg: bin.sumPg / bin.count,
    pb: bin.sumPb / bin.count,
    a: bin.sumA / bin.count,
  }));
  const assign = new Int32Array(bins.length).fill(-1);

  // k-means++（決定的: count × minDist² が最大のビンをシードに追加）
  let first = 0;
  for (let i = 1; i < bins.length; i++) {
    if (bins[i].count > bins[first].count) {
      first = i;
    }
  }
  const centers: Center[] = [rep[first]];
  assign[first] = 0;
  while (centers.length < k) {
    let bestIdx = -1;
    let bestScore = -1;
    for (let i = 0; i < bins.length; i++) {
      if (assign[i] >= 0) {
        continue;
      }
      let dMin = Infinity;
      for (let c = 0; c < centers.length; c++) {
        const d = distRep(rep[i], centers[c]);
        if (d < dMin) {
          dMin = d;
        }
      }
      const score = bins[i].count * dMin;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) {
      break;
    }
    centers.push(rep[bestIdx]);
    assign[bestIdx] = centers.length - 1;
  }

  // Lloyd 収束
  const sums = new Float64Array(centers.length * 4);
  const counts = new Float64Array(centers.length);
  const MAX_ITERS = 12;
  for (let iter = 0; iter < MAX_ITERS; iter++) {
    sums.fill(0);
    counts.fill(0);
    let changed = false;
    for (let i = 0; i < bins.length; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < centers.length; c++) {
        const d = distRep(rep[i], centers[c]);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      if (assign[i] !== best) {
        assign[i] = best;
        changed = true;
      }
      sums[best * 4] += bins[i].sumPr;
      sums[best * 4 + 1] += bins[i].sumPg;
      sums[best * 4 + 2] += bins[i].sumPb;
      sums[best * 4 + 3] += bins[i].sumA;
      counts[best] += bins[i].count;
    }
    for (let c = 0; c < centers.length; c++) {
      const n = counts[c];
      if (n === 0) {
        continue;
      }
      centers[c] = {
        pr: sums[c * 4] / n,
        pg: sums[c * 4 + 1] / n,
        pb: sums[c * 4 + 2] / n,
        a: sums[c * 4 + 3] / n,
      };
    }
    if (!changed) {
      break;
    }
  }
  return centers;
}

function distRep(c: Center, p: Center): number {
  const dr = c.pr - p.pr;
  const dg = c.pg - p.pg;
  const db = c.pb - p.pb;
  const da = c.a - p.a;
  return dr * dr + dg * dg + db * db + ALPHA_DIST_WEIGHT * da * da;
}

/** プレマルチ立方根中心をストレート RGBA に戻す。 */
function centersToPalette(centers: Center[]): RGBA[] {
  const palette: RGBA[] = [];
  for (const c of centers) {
    const aByte = clamp8(c.a * 255);
    let r = 0;
    let g = 0;
    let b = 0;
    if (c.a > 0) {
      const inv = 1 / c.a;
      r = cubeToByte(c.pr * inv);
      g = cubeToByte(c.pg * inv);
      b = cubeToByte(c.pb * inv);
    }
    palette.push({ r, g, b, a: aByte });
  }
  return palette;
}

// ---------- ディザリング（プレマルチ線形・蛇行スキャン・2 行バッファ） ----------

function dither(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  palette: RGBA[]
): Uint8Array {
  const size = width * height;
  const out = new Uint8Array(size);
  if (size === 0) {
    return out;
  }
  const n = palette.length;
  const palPr = new Float64Array(n);
  const palPg = new Float64Array(n);
  const palPb = new Float64Array(n);
  const palA = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const p = palette[i];
    const av = p.a / 255;
    palPr[i] = CUBE_LUT[p.r] * av;
    palPg[i] = CUBE_LUT[p.g] * av;
    palPb[i] = CUBE_LUT[p.b] * av;
    palA[i] = av;
  }
  const transparentIdx = palette.findIndex((p) => p.a === 0);

  // 2 行分のエラーバッファ。レイアウト: [R row0, R row1, G row0, G row1, B row0, B row1]
  const w = width;
  const err = new Float64Array(w * 2 * 3);

  for (let y = 0; y < height; y++) {
    const curRow = y & 1;
    const nxtRow = curRow ^ 1;
    // 次の行のバッファを毎行クリア（前の行の拡散分が残っている）
    err.fill(0, nxtRow * w, nxtRow * w + w);
    err.fill(0, (2 + nxtRow) * w, (2 + nxtRow) * w + w);
    err.fill(0, (4 + nxtRow) * w, (4 + nxtRow) * w + w);

    const dir = (y & 1) === 0 ? 1 : -1;
    const startX = dir === 1 ? 0 : width - 1;
    const rowOff = y * width;

    for (let xi = 0; xi < width; xi++) {
      const x = startX + dir * xi;
      const k = rowOff + x;
      const off = k * 4;
      const a = data[off + 3];
      if (a === 0) {
        out[k] = transparentIdx >= 0 ? transparentIdx : 0;
        continue;
      }
      const av = a / 255;
      const curBase = curRow * w + x;
      let vpr = CUBE_LUT[data[off]] * av + err[curBase];
      let vpg = CUBE_LUT[data[off + 1]] * av + err[(2 + curRow) * w + x];
      let vpb = CUBE_LUT[data[off + 2]] * av + err[(4 + curRow) * w + x];

      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < n; i++) {
        const dr = vpr - palPr[i];
        const dg = vpg - palPg[i];
        const db = vpb - palPb[i];
        const da = av - palA[i];
        const d = dr * dr + dg * dg + db * db + ALPHA_DIST_WEIGHT * da * da;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      out[k] = best;
      vpr -= palPr[best];
      vpg -= palPg[best];
      vpb -= palPb[best];

      // 蛇行スキャン: 進行方向の同段隣 + 次段に 3-5-1-7 型で拡散
      const sib = x + dir; // 同段の「まだ未処理」側
      if (sib >= 0 && sib < width) {
        err[curBase + dir] += vpr * (7 / 16);
        err[(2 + curRow) * w + sib] += vpg * (7 / 16);
        err[(4 + curRow) * w + sib] += vpb * (7 / 16);
      }
      const back = x - dir;
      if (back >= 0 && back < width) {
        err[nxtRow * w + back] += vpr * (3 / 16);
        err[(2 + nxtRow) * w + back] += vpg * (3 / 16);
        err[(4 + nxtRow) * w + back] += vpb * (3 / 16);
      }
      err[nxtRow * w + x] += vpr * (5 / 16);
      err[(2 + nxtRow) * w + x] += vpg * (5 / 16);
      err[(4 + nxtRow) * w + x] += vpb * (5 / 16);
      const fwd = x + dir;
      if (fwd >= 0 && fwd < width) {
        err[nxtRow * w + fwd] += vpr * (1 / 16);
        err[(2 + nxtRow) * w + fwd] += vpg * (1 / 16);
        err[(4 + nxtRow) * w + fwd] += vpb * (1 / 16);
      }
    }
  }
  return out;
}

// ---------- PNG 書き出し ----------

function encodePng({ palette, indices, width, height }: QuantizedResult): Uint8Array<ArrayBuffer> {
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