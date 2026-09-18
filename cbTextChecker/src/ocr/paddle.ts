import type { OcrItem } from "../types";

const OCR_CDN =
  "https://cdn.jsdelivr.net/npm/@paddleocr/paddleocr-js@0.4.2/+esm";
const WASM_PATHS =
  "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/";

/**
 * CORS-friendly PP-OCRv5 mobile ONNX tars (ustar + inference.yml).
 * Prefer hosts that return Access-Control-Allow-Origin: * (Figma Origin: null).
 */
const MODEL_URL_CANDIDATES = {
  det: [
    "https://files.catbox.moe/idrdk7.tar",
    "https://cdn.jsdelivr.net/gh/cb-nishikawa/figma_apprication@main/cbTextChecker/src/ocr/models/PP-OCRv5_mobile_det_onnx_infer.tar",
    "https://raw.githubusercontent.com/cb-nishikawa/figma_apprication/main/cbTextChecker/src/ocr/models/PP-OCRv5_mobile_det_onnx_infer.tar",
  ],
  rec: [
    "https://files.catbox.moe/5kfvxo.tar",
    "https://cdn.jsdelivr.net/gh/cb-nishikawa/figma_apprication@main/cbTextChecker/src/ocr/models/PP-OCRv5_mobile_rec_onnx_infer.tar",
    "https://raw.githubusercontent.com/cb-nishikawa/figma_apprication/main/cbTextChecker/src/ocr/models/PP-OCRv5_mobile_rec_onnx_infer.tar",
  ],
} as const;

interface PaddleOcrResultItem {
  text?: string;
  score?: number;
  poly?: Array<[number, number] | number[]>;
}

interface PaddleOcrResult {
  items?: PaddleOcrResultItem[];
}

type PaddleOCRInstance = {
  predict: (
    image: Blob | ImageBitmap | HTMLCanvasElement | HTMLImageElement
  ) => Promise<PaddleOcrResult[]>;
  dispose?: () => void | Promise<void>;
};

interface PaddleOCRStatic {
  create: (options: Record<string, unknown>) => Promise<PaddleOCRInstance>;
}

export interface OcrModelUrls {
  detUrl: string;
  recUrl: string;
}

let enginePromise: Promise<PaddleOCRInstance> | null = null;
let engineKey: string | null = null;
let cachedModelUrls: OcrModelUrls | null = null;

export function formatUnknownError(err: unknown): string {
  if (err instanceof Error) {
    return err.message || err.name;
  }
  if (typeof err === "string") {
    return err;
  }
  if (err && typeof err === "object") {
    const record = err as Record<string, unknown>;
    if (typeof record.message === "string" && record.message) {
      return record.message;
    }
    try {
      return JSON.stringify(err);
    } catch {
      return Object.prototype.toString.call(err);
    }
  }
  return String(err);
}

async function fetchModelArrayBuffer(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength < 1024) {
    throw new Error(`応答が短すぎます (${buffer.byteLength} bytes)`);
  }
  return buffer;
}

async function fetchFirstAvailable(
  urls: readonly string[],
  label: string
): Promise<ArrayBuffer> {
  const errors: string[] = [];
  for (const url of urls) {
    try {
      return await fetchModelArrayBuffer(url);
    } catch (err) {
      errors.push(`${url}: ${formatUnknownError(err)}`);
    }
  }
  throw new Error(
    `${label} の取得に失敗しました。\n${errors.join("\n")}`
  );
}

/** Download det/rec tars from CORS CDN and expose as blob: URLs for PaddleOCR.js. */
export async function loadOcrModelUrls(): Promise<OcrModelUrls> {
  if (cachedModelUrls) {
    return cachedModelUrls;
  }

  const [detBuf, recBuf] = await Promise.all([
    fetchFirstAvailable(MODEL_URL_CANDIDATES.det, "検出モデル"),
    fetchFirstAvailable(MODEL_URL_CANDIDATES.rec, "認識モデル"),
  ]);

  cachedModelUrls = {
    detUrl: URL.createObjectURL(
      new Blob([detBuf], { type: "application/x-tar" })
    ),
    recUrl: URL.createObjectURL(
      new Blob([recBuf], { type: "application/x-tar" })
    ),
  };
  return cachedModelUrls;
}

function normalizePoly(
  poly: PaddleOcrResultItem["poly"]
): Array<[number, number]> {
  if (!poly || poly.length === 0) {
    return [];
  }
  return poly.map((point) => {
    if (Array.isArray(point) && point.length >= 2) {
      return [Number(point[0]) || 0, Number(point[1]) || 0];
    }
    return [0, 0];
  });
}

export async function getOcrEngine(
  models: OcrModelUrls
): Promise<PaddleOCRInstance> {
  const key = `${models.detUrl}|${models.recUrl}`;
  if (enginePromise && engineKey === key) {
    return enginePromise;
  }

  engineKey = key;
  enginePromise = (async () => {
    const mod = (await import(/* @vite-ignore */ OCR_CDN)) as {
      PaddleOCR: PaddleOCRStatic;
      default?: { PaddleOCR?: PaddleOCRStatic };
    };
    const PaddleOCR = mod.PaddleOCR ?? mod.default?.PaddleOCR;
    if (!PaddleOCR) {
      throw new Error("PaddleOCR.js の読み込みに失敗しました");
    }

    return PaddleOCR.create({
      textDetectionModelName: "PP-OCRv5_mobile_det",
      textDetectionModelAsset: { url: models.detUrl },
      textRecognitionModelName: "PP-OCRv5_mobile_rec",
      textRecognitionModelAsset: { url: models.recUrl },
      worker: false,
      ortOptions: {
        backend: "wasm",
        wasmPaths: WASM_PATHS,
        numThreads: 1,
      },
    });
  })().catch((err) => {
    enginePromise = null;
    engineKey = null;
    throw err;
  });

  return enginePromise;
}

export async function runOcr(
  image: Blob,
  models: OcrModelUrls
): Promise<OcrItem[]> {
  const engine = await getOcrEngine(models);
  const [result] = await engine.predict(image);
  const items = result?.items ?? [];
  return items
    .map((item, index) => {
      const text = (item.text ?? "").trim();
      return {
        id: `ocr:${index}`,
        text,
        score: typeof item.score === "number" ? item.score : 0,
        poly: normalizePoly(item.poly),
      };
    })
    .filter((item) => item.text.length > 0);
}
