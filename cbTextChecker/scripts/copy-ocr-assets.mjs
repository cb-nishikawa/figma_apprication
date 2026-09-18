import { cpSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const ortSrc = join(root, "node_modules", "onnxruntime-web", "dist");
const modelsSrc = join(root, "src", "ocr", "models");

const ortFiles = [
  "ort-wasm-simd-threaded.wasm",
  "ort-wasm-simd-threaded.mjs",
  "ort-wasm-simd-threaded.jsep.wasm",
  "ort-wasm-simd-threaded.jsep.mjs",
];

const modelFiles = [
  "PP-OCRv5_mobile_det_onnx_infer.tar",
  "PP-OCRv5_mobile_rec_onnx_infer.tar",
];

mkdirSync(join(dist, "ort"), { recursive: true });
mkdirSync(join(dist, "models"), { recursive: true });

for (const file of ortFiles) {
  const from = join(ortSrc, file);
  if (!existsSync(from)) {
    console.warn(`skip missing ORT asset: ${file}`);
    continue;
  }
  cpSync(from, join(dist, "ort", file));
}

for (const file of modelFiles) {
  const from = join(modelsSrc, file);
  if (!existsSync(from)) {
    throw new Error(
      `Missing OCR model: ${from}\nRun: npm run fetch:ocr-models`
    );
  }
  cpSync(from, join(dist, "models", file));
}

// Ensure Vite-emitted ORT chunks in dist root are also available under ort/
for (const name of readdirSync(dist)) {
  if (
    name.startsWith("ort-wasm") ||
    name.startsWith("ui-ort") ||
    name.includes("ort.bundle")
  ) {
    cpSync(join(dist, name), join(dist, "ort", name));
  }
}

console.log("Copied OCR assets to dist/ort and dist/models");
