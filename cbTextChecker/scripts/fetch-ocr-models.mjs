import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "src", "ocr", "models");
mkdirSync(outDir, { recursive: true });

const files = [
  "PP-OCRv5_mobile_det_onnx_infer.tar",
  "PP-OCRv5_mobile_rec_onnx_infer.tar",
];

const obsolete = [
  "PP-OCRv6_tiny_det_onnx_infer.tar",
  "PP-OCRv6_tiny_rec_onnx_infer.tar",
];

const base =
  "https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0";

for (const file of obsolete) {
  const dest = join(outDir, file);
  if (existsSync(dest)) {
    rmSync(dest);
    console.log(`removed: ${file}`);
  }
}

for (const file of files) {
  const dest = join(outDir, file);
  if (existsSync(dest)) {
    console.log(`exists: ${file}`);
    continue;
  }
  const url = `${base}/${file}`;
  console.log(`download: ${url}`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download ${file}: ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(dest, buf);
  console.log(`saved: ${file} (${buf.length} bytes)`);
}
