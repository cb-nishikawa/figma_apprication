import glueFactoryRaw from "@jsquash/avif/codec/enc/avif_enc.js";
import wasmUrl from "@jsquash/avif/codec/enc/avif_enc.wasm?url";

interface AvifEncodeOptions {
  quality: number;
  qualityAlpha: number;
  denoiseLevel: number;
  tileColsLog2: number;
  tileRowsLog2: number;
  speed: number;
  subsample: number;
  chromaDeltaQ: boolean;
  sharpness: number;
  enableSharpYUV: boolean;
  tune: number;
  bitDepth: number;
  lossless: boolean;
}

interface AvifEncoderModule {
  encode(
    data: Uint8Array,
    width: number,
    height: number,
    options: AvifEncodeOptions
  ): Uint8Array | null;
}

type AvifGlueFactory = (opts?: {
  wasmBinary: Uint8Array;
  locateFile: (path: string) => string;
}) => Promise<AvifEncoderModule>;

const glueFactory = glueFactoryRaw as unknown as AvifGlueFactory;

let encoderPromise: Promise<AvifEncoderModule> | null = null;

function getEncoder(): Promise<AvifEncoderModule> {
  if (!encoderPromise) {
    encoderPromise = loadEncoder();
  }
  return encoderPromise;
}

async function loadEncoder(): Promise<AvifEncoderModule> {
  const wasmBinary = await wasmBytes();
  return glueFactory({
    wasmBinary,
    locateFile: () => "avif_enc.wasm",
  });
}

/** ビルド時は wasm が data URL としてインライン化される。dev では実 URL から取得。 */
async function wasmBytes(): Promise<Uint8Array> {
  if (wasmUrl.startsWith("data:")) {
    const base64 = wasmUrl.slice(wasmUrl.indexOf(",") + 1);
    const raw = atob(base64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
      bytes[i] = raw.charCodeAt(i);
    }
    return bytes;
  }
  const buffer = await (await fetch(wasmUrl)).arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * RGBA 画像データを libavif（WASM）で実エンコードする。
 * Figma / Chromium の canvas.toBlob("image/avif") は非対応のため PNG へ
 * フォールバックするので、本エンコーダを必ず使用する。
 * quality: 1..99 は libavif の quality、100 は lossless。
 */
export async function avifEncode(
  data: ImageData,
  quality: number
): Promise<Uint8Array<ArrayBuffer>> {
  const module = await getEncoder();
  const lossless = quality >= 100;
  const options: AvifEncodeOptions = {
    quality: lossless ? 100 : Math.min(99, Math.max(1, Math.round(quality))),
    qualityAlpha: -1,
    denoiseLevel: 0,
    tileRowsLog2: 0,
    tileColsLog2: 0,
    speed: 6,
    subsample: lossless ? 3 : 1,
    chromaDeltaQ: false,
    sharpness: 0,
    enableSharpYUV: false,
    tune: 0,
    bitDepth: 8,
    lossless,
  };
  const rgba = new Uint8Array(
    data.data.buffer,
    data.data.byteOffset,
    data.data.byteLength
  );
  const output = module.encode(rgba, data.width, data.height, options);
  if (!output || !isAvifBrand(output)) {
    throw new Error("AVIF エンコードに失敗しました（出力形式の検証に失敗）");
  }
  // module.encode の返り値は WASM ヒープのビュー。次回エンコードで破棄されるためコピーする。
  return new Uint8Array(output);
}

/** 出力が AVIF（ftyp box + avif/avis major brand）で始まるか検証する。 */
function isAvifBrand(out: Uint8Array): boolean {
  if (out.length < 12) {
    return false;
  }
  const brand = String.fromCharCode(
    ...Array.from(out.subarray(8, 12))
  );
  return (
    (out[4] === 0x66 &&
      out[5] === 0x74 &&
      out[6] === 0x79 &&
      out[7] === 0x70) &&
    (brand === "avif" || brand === "avis")
  );
}