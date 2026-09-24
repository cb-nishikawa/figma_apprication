import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const shareRoot = join(root, "share");
const packDir = join(shareRoot, "CbImageExport");
const zipPath = join(shareRoot, "CbImageExport.zip");

const distCode = join(root, "dist", "code.js");
const distUi = join(root, "dist", "ui.html");

const sourceManifest = JSON.parse(
  readFileSync(join(root, "manifest.json"), "utf8")
);

const shareManifest = {
  ...sourceManifest,
  main: "code.js",
  ui: "ui.html",
};

const readmeTxt = `画像一括書き出しくん（共有パック）
========================

このフォルダだけで Figma に読み込めます。Node.js / npm は不要です。

読み込み手順
------------
1. この zip を解凍する（すでにフォルダの場合はそのまま）
2. Figma Desktop を開く
3. メニュー: Plugins → Development → Import plugin from manifest…
4. このフォルダ内の manifest.json を選択する
5. Plugins → Development から起動する

含まれているファイル
--------------------
- manifest.json … プラグイン定義
- code.js ……… プラグイン本体
- ui.html ……… UI（CSS/JS をインライン）
`;

rmSync(shareRoot, { recursive: true, force: true });
mkdirSync(packDir, { recursive: true });

cpSync(distCode, join(packDir, "code.js"));
cpSync(distUi, join(packDir, "ui.html"));
writeFileSync(
  join(packDir, "manifest.json"),
  `${JSON.stringify(shareManifest, null, 2)}\n`,
  "utf8"
);
writeFileSync(join(packDir, "README.txt"), readmeTxt, "utf8");

execFileSync("zip", ["-r", "-q", zipPath, "CbImageExport"], {
  cwd: shareRoot,
  stdio: "inherit",
});

console.log(`Created ${packDir}`);
console.log(`Created ${zipPath}`);
