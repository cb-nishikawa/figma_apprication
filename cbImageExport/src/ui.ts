import "./ui.css";
import excludeIcon from "./assets/exclude.svg?raw";
import exportIcon from "./assets/export.svg?raw";
import hamburgerIcon from "./assets/hamburger.svg?raw";
import type { PluginToUiMessage, UiToPluginMessage } from "./messages";
import { closeAllTargetPopovers, createTargetPicker, unregisterPicker } from "./targetPicker";
import type {
  ExportConfig,
  ExportConstraint,
  ExportFormat,
  ExportOptions,
  ExportRequest,
  ExportResultItem,
  FrameTarget,
  ImageListItem,
  RecentFrame,
} from "./types";
import {
  DEFAULT_EXCLUDE_OPTIONS,
  DEFAULT_EXPORT_CONSTRAINT,
  DEFAULT_QUALITY,
  EXPORT_FORMATS,
} from "./types";
import { colorsForQuality, quantizePng } from "./png";
import { avifEncode } from "./avif";
import { zipEntries, type ZipEntry } from "./zip";

const MIN_UI_HEIGHT = 320;
const MAX_UI_HEIGHT = 900;

const DEFAULT_CONFIG: ExportConfig = {
  format: "PNG",
  constraint: { ...DEFAULT_EXPORT_CONSTRAINT },
};

const targetPickerRoot = document.getElementById(
  "target-picker-root"
) as HTMLDivElement;
const rescanBtn = document.getElementById("rescan") as HTMLButtonElement;
const exportAllBtn = document.getElementById(
  "export-all"
) as HTMLButtonElement;
const selectAllEl = document.getElementById("select-all") as HTMLInputElement;
const assetUrlTriggerEl = document.getElementById(
  "asset-url-trigger"
) as HTMLButtonElement;
const resultsEl = document.getElementById("results") as HTMLUListElement;
const errorEl = document.getElementById("error") as HTMLParagraphElement;
const statusEl = document.getElementById("status") as HTMLParagraphElement;
const resizeHandle = document.getElementById(
  "resize-handle"
) as HTMLDivElement;

let items: ImageListItem[] = [];
let frameTargets: FrameTarget[] = [];
let recentFrames: RecentFrame[] = [];
let targetId: string | null = null;
const checkedIds = new Set<string>();
const configsByNode = new Map<string, ExportConfig[]>();
const excludeOptionsById = new Map<string, ExportOptions>();
const nameOverridesById = new Map<string, string>();
const rowErrorById = new Map<string, string>();
let activeExportDir: FileSystemDirectoryHandle | null = null;
/** 現在の対象フレームの書き出し先パス（未設定は空文字）。 */
let currentAssetPath = "";
/** 歯車ポップオーバーの入力欄を現在の対象フレームのパスへ同期する関数。 */
let assetUrlInputSync: (() => void) | null = null;

function postToPlugin(msg: UiToPluginMessage): void {
  parent.postMessage({ pluginMessage: msg }, "*");
}

let targetPicker: ReturnType<typeof createTargetPicker> | null = null;

function getSelectedTarget(): FrameTarget | null {
  return frameTargets.find((t) => t.id === targetId) ?? null;
}

function mountTargetPicker(): void {
  targetPickerRoot.replaceChildren();
  if (targetPicker) {
    unregisterPicker(targetPicker);
  }
  targetPicker = createTargetPicker({
    emptyLabel: "フレーム未選択",
    ariaLabel: "対象フレーム",
    getLabel: () => getSelectedTarget()?.label ?? "",
    getSelectedId: () => targetId,
    getTargets: () => frameTargets,
    getRecent: () => recentFrames,
    onApplySelection: () => {
      postToPlugin({ type: "SET_FRAME_FROM_SELECTION" });
    },
    onPick: (id) => {
      postToPlugin({ type: "SET_FRAME_NODE", nodeId: id });
    },
    onPickRecent: (id) => {
      postToPlugin({ type: "SET_FRAME_NODE", nodeId: id });
    },
  });
  targetPickerRoot.append(targetPicker.root);
}

function showError(message: string | null): void {
  if (!message) {
    errorEl.hidden = true;
    errorEl.textContent = "";
    return;
  }
  errorEl.hidden = false;
  errorEl.textContent = message;
}

function showStatus(message: string | null): void {
  if (!message) {
    statusEl.hidden = true;
    statusEl.textContent = "";
    return;
  }
  statusEl.hidden = false;
  statusEl.textContent = message;
}

/**
 * Parse a constraint input. Accepts "512w" / "512h" / "0.5x" and bare
 * numbers (e.g. "2" → SCALE). Returns null when invalid.
 */
function parseConstraint(raw: string): ExportConstraint | null {
  const match = raw
    .trim()
    .toLowerCase()
    .match(/^(\d+(?:\.\d+)?)\s*([xwh])?$/);
  if (!match) {
    return null;
  }
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  const kind = match[2] ?? "x";
  const type = kind === "w" ? "WIDTH" : kind === "h" ? "HEIGHT" : "SCALE";
  return { type, value };
}

/** Format a constraint for display, always with a suffix (1x / 2x / 512w). */
function formatConstraint(constraint: ExportConstraint): string {
  switch (constraint.type) {
    case "WIDTH":
      return `${constraint.value}w`;
    case "HEIGHT":
      return `${constraint.value}h`;
    default:
      return `${constraint.value}x`;
  }
}

function configsFor(id: string): ExportConfig[] {
  return configsByNode.get(id) ?? [];
}

function excludeOptionsFor(id: string): ExportOptions {
  return excludeOptionsById.get(id) ?? { ...DEFAULT_EXCLUDE_OPTIONS };
}

function nameFor(item: ImageListItem): string {
  const override = nameOverridesById.get(item.id)?.trim();
  return override || item.name;
}

/** Reflect the row's export configs to the actual Figma layer. */
function syncExportSettings(id: string): void {
  postToPlugin({
    type: "SET_EXPORT_SETTINGS",
    nodeId: id,
    configs: configsFor(id).map((config) => ({ ...config })),
  });
}

function bytesToObjectUrl(bytes: number[], mime: string): string {
  const arr = new Uint8Array(bytes);
  const blob = new Blob([arr], { type: mime });
  return URL.createObjectURL(blob);
}

function extFor(format: ExportFormat): string {
  switch (format) {
    case "JPG":
      return "jpg";
    case "SVG":
      return "svg";
    case "PDF":
      return "pdf";
    case "WEBP":
      return "webp";
    case "AVIF":
      return "avif";
    default:
      return "png";
  }
}

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").trim() || "export";
}

/** ファイル名のサイズサフィックス。1x はなし、SVG / PDF はサイズ指定が効かないためなし。 */
function constraintSuffix(
  constraint: ExportConstraint,
  format: ExportFormat
): string {
  if (format === "SVG" || format === "PDF") {
    return "";
  }
  if (constraint.type === "SCALE" && constraint.value === 1) {
    return "";
  }
  return `_${formatConstraint(constraint)}`;
}

/** 設定した書き出し先パスにファイル名を結合した URL。 */
function assetUrlFor(id: string, config: ExportConfig): string {
  const item = items.find((entry) => entry.id === id);
  const name = nameFor(item ?? { id, name: "export", thumbBytes: [] });
  const fileName = `${sanitizeFilename(name)}${constraintSuffix(
    config.constraint,
    config.format
  )}.${extFor(config.format)}`;
  const path = currentAssetPath.trim();
  if (!path) {
    return fileName;
  }
  return `${path.replace(/\/+$/, "")}/${fileName}`;
}

function downloadUint8(data: Uint8Array, fileName: string, mime: string): void {
  const blob = new Blob([new Uint8Array(data)], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function timestampForName(): string {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** Final bytes for a result: raster formats are re-encoded at quality here. */
async function bytesForResult(
  result: ExportResultItem
): Promise<Uint8Array<ArrayBuffer>> {
  const quality = qualityFor(result.id, result.format);
  if (result.format === "JPG") {
    return canvasEncode(result.bytes!, "image/jpeg", quality / 100);
  }
  if (result.format === "WEBP") {
    return canvasEncode(result.bytes!, "image/webp", quality / 100);
  }
  if (result.format === "AVIF") {
    return avifEncode(await pngToImageData(result.bytes!), quality);
  }
  if (result.format === "PNG" && quality < 100) {
    return quantizePng(result.bytes!, colorsForQuality(quality));
  }
  return new Uint8Array(result.bytes!);
}

/** 圧縮率（%）を設定から取得。未設定は形式ごとの既定値。 */
function defaultQualityFor(format: ExportFormat): number {
  // PNG は無劣化画像なので、明示指定が無ければ 100（量子化なし）。
  return format === "PNG" ? 100 : DEFAULT_QUALITY;
}

function qualityFor(id: string, format: ExportFormat): number {
  const config = configsFor(id).find((c) => c.format === format);
  return config?.quality ?? defaultQualityFor(format);
}

/** Figma が出力した PNG バイトをデコードして RGBA の ImageData にする。 */
async function pngToImageData(pngBytes: number[]): Promise<ImageData> {
  const blob = new Blob([new Uint8Array(pngBytes)], { type: "image/png" });
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("canvas 2D を取得できません");
  }
  try {
    ctx.drawImage(bitmap, 0, 0);
  } finally {
    bitmap.close();
  }
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/**
 * Decode PNG bytes drawn from Figma and re-encode with the requested raster
 * codec / quality (JPEG / WebP; AVIF は avifEncode を使用する)。
 * Chromium は非対応 MIME を静かに PNG へフォールバックするため、出力 MIME を検証する。
 */
async function canvasEncode(
  pngBytes: number[],
  mime: string,
  quality: number
): Promise<Uint8Array<ArrayBuffer>> {
  const imageData = await pngToImageData(pngBytes);
  const canvas = document.createElement("canvas");
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("canvas 2D を取得できません");
  }
  ctx.putImageData(imageData, 0, 0);
  const out = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) =>
        b ? resolve(b) : reject(new Error("画像変換に失敗しました")),
      mime,
      quality
    );
  });
  if (out.type !== mime) {
    throw new Error(
      `画像変換の出力形式が想定と異なります（${out.type || "不明"}）。対応していない形式です`
    );
  }
  return new Uint8Array(await out.arrayBuffer());
}

function createFormatSelect(
  current: ExportFormat,
  onChange: (format: ExportFormat) => void
): HTMLSelectElement {
  const select = document.createElement("select");
  select.className = "config-format";
  select.setAttribute("aria-label", "書き出し形式");
  for (const format of EXPORT_FORMATS) {
    const option = document.createElement("option");
    option.value = format;
    option.textContent = format;
    if (format === current) {
      option.selected = true;
    }
    select.appendChild(option);
  }
  select.addEventListener("click", (event) => event.stopPropagation());
  select.addEventListener("change", () => {
    onChange(select.value as ExportFormat);
  });
  return select;
}

function createConstraintInput(
  config: ExportConfig,
  onChange?: () => void
): HTMLInputElement {
  const input = document.createElement("input");
  input.className = "config-scale";
  input.type = "text";
  input.inputMode = "decimal";
  input.value = formatConstraint(config.constraint);
  input.setAttribute("aria-label", "書き出しサイズ");
  input.title = "倍率・寸法: 1x / 2x / 0.5x / 512w / 512h";
  input.addEventListener("click", (event) => event.stopPropagation());
  input.addEventListener("input", () => {
    const parsed = parseConstraint(input.value);
    if (parsed) {
      config.constraint = parsed;
    }
  });
  input.addEventListener("change", () => {
    const parsed = parseConstraint(input.value);
    if (parsed) {
      config.constraint = parsed;
    } else {
      input.value = formatConstraint(config.constraint);
    }
    onChange?.();
  });
  return input;
}

function createNameInput(item: ImageListItem): HTMLInputElement {
  const input = document.createElement("input");
  input.className = "result-name-input";
  input.type = "text";
  input.value = nameFor(item);
  input.setAttribute("aria-label", "レイヤー名");
  input.title = "レイヤー名";
  input.addEventListener("click", (event) => event.stopPropagation());
  input.addEventListener("change", () => {
    const next = input.value.trim();
    const current = nameFor(item);
    if (!next || next === current) {
      input.value = current;
      return;
    }
    nameOverridesById.set(item.id, next);
    postToPlugin({ type: "RENAME_NODE", nodeId: item.id, name: next });
  });
  return input;
}

function createAddButton(id: string): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "config-add";
  btn.textContent = "+";
  btn.title = "書き出し形式を追加";
  btn.setAttribute("aria-label", "書き出し形式を追加");
  btn.addEventListener("click", (event) => {
    event.stopPropagation();
    const existing = configsByNode.get(id);
    if (existing) {
      existing.push({ ...DEFAULT_CONFIG });
    } else {
      configsByNode.set(id, [{ ...DEFAULT_CONFIG }]);
    }
    syncExportSettings(id);
    renderList();
  });
  return btn;
}

function createExportButton(id: string): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn-icon row-export";
  btn.title = "この行を書き出し";
  btn.setAttribute("aria-label", "この行を書き出し");
  btn.innerHTML = exportIcon;
  btn.addEventListener("click", (event) => {
    event.stopPropagation();
    exportRows([id]);
  });
  return btn;
}

function createRemoveButton(id: string, index: number): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "config-remove";
  btn.textContent = "-";
  btn.title = "この書き出し形式を削除";
  btn.setAttribute("aria-label", "この書き出し形式を削除");
  btn.addEventListener("click", (event) => {
    event.stopPropagation();
    configsByNode.get(id)?.splice(index, 1);
    syncExportSettings(id);
    renderList();
  });
  return btn;
}

const EXCLUDE_OPTION_DEFS: Array<{
  key: keyof ExportOptions;
  label: string;
}> = [
  { key: "excludeEffects", label: "エフェクト" },
  { key: "excludeStrokes", label: "線" },
  { key: "excludeCornerRadius", label: "角丸" },
];

const EXCLUDE_POPOVER_TITLE = "チェック項目を除外する";

function closeAllExcludeMenus(except?: HTMLElement): void {
  document.querySelectorAll<HTMLElement>(".exclude-popover").forEach((panel) => {
    if (except && panel === except) {
      return;
    }
    panel.hidden = true;
    const trigger = panel
      .closest(".exclude-menu")
      ?.querySelector<HTMLButtonElement>(".exclude-trigger");
    trigger?.setAttribute("aria-expanded", "false");
  });
}

function createExcludeMenu(id: string): HTMLElement {
  const menu = document.createElement("div");
  menu.className = "exclude-menu";

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "btn-icon exclude-trigger";
  trigger.title = EXCLUDE_POPOVER_TITLE;
  trigger.setAttribute("aria-label", EXCLUDE_POPOVER_TITLE);
  trigger.setAttribute("aria-haspopup", "true");
  trigger.setAttribute("aria-expanded", "false");
  trigger.innerHTML = excludeIcon;

  const panel = document.createElement("div");
  panel.className = "exclude-popover";
  panel.hidden = true;
  panel.setAttribute("role", "group");
  panel.setAttribute("aria-label", EXCLUDE_POPOVER_TITLE);

  const title = document.createElement("div");
  title.className = "exclude-title";
  title.textContent = EXCLUDE_POPOVER_TITLE;

  const checks = document.createElement("div");
  checks.className = "exclude-checks";
  for (const def of EXCLUDE_OPTION_DEFS) {
    const wrap = document.createElement("label");
    wrap.className = "exclude-check";
    wrap.title = `${def.label}を除外する`;

    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = excludeOptionsFor(id)[def.key];
    input.addEventListener("change", () => {
      const next = { ...excludeOptionsFor(id) };
      next[def.key] = input.checked;
      excludeOptionsById.set(id, next);
    });

    const text = document.createElement("span");
    text.textContent = def.label;

    wrap.append(input, text);
    checks.append(wrap);
  }

  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    closeAllExcludeMenus();
    closeAllTargetPopovers();
    closeAllCopyMenus();
    closeAssetUrlPopover();
    const willOpen = panel.hidden;
    panel.hidden = !willOpen;
    trigger.setAttribute("aria-expanded", willOpen ? "true" : "false");
  });

  panel.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  panel.append(title, checks);
  menu.append(trigger, panel);
  return menu;
}

const COPY_POPOVER_TITLE = "urlをコピー";

function closeAllCopyMenus(except?: HTMLElement): void {
  document.querySelectorAll<HTMLElement>(".copy-popover").forEach((panel) => {
    if (except && panel === except) {
      return;
    }
    panel.hidden = true;
    const trigger = panel
      .closest(".copy-menu")
      ?.querySelector<HTMLButtonElement>(".copy-trigger");
    trigger?.setAttribute("aria-expanded", "false");
  });
}

function closeAssetUrlPopover(): void {
  const panel =
    document.querySelector<HTMLElement>(".asset-url-popover");
  if (panel) {
    panel.hidden = true;
  }
  assetUrlTriggerEl.setAttribute("aria-expanded", "false");
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

/** 設定行の品質の横に置く URL コピーメニュー（除外メニューと同形状）。 */
function createCopyMenu(id: string, config: ExportConfig): HTMLElement {
  const menu = document.createElement("div");
  menu.className = "copy-menu";

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "btn-icon copy-trigger";
  trigger.title = COPY_POPOVER_TITLE;
  trigger.setAttribute("aria-label", COPY_POPOVER_TITLE);
  trigger.setAttribute("aria-haspopup", "true");
  trigger.setAttribute("aria-expanded", "false");
  trigger.innerHTML = hamburgerIcon;

  const panel = document.createElement("div");
  panel.className = "exclude-popover copy-popover";
  panel.hidden = true;
  panel.setAttribute("role", "menu");
  panel.setAttribute("aria-label", COPY_POPOVER_TITLE);

  const title = document.createElement("div");
  title.className = "exclude-title";
  title.textContent = COPY_POPOVER_TITLE;

  const preview = document.createElement("div");
  preview.className = "copy-preview";
  preview.textContent = assetUrlFor(id, config);

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "btn-primary copy-button";
  copyBtn.textContent = "urlをコピー";
  copyBtn.addEventListener("click", async () => {
    const ok = await copyText(assetUrlFor(id, config));
    copyBtn.textContent = ok ? "コピーしました" : "コピーに失敗";
    window.setTimeout(() => {
      copyBtn.textContent = "urlをコピー";
    }, 1200);
  });

  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    closeAllExcludeMenus();
    closeAllCopyMenus(panel);
    closeAssetUrlPopover();
    const willOpen = panel.hidden;
    preview.textContent = assetUrlFor(id, config);
    copyBtn.textContent = "urlをコピー";
    panel.hidden = !willOpen;
    trigger.setAttribute("aria-expanded", willOpen ? "true" : "false");
  });

  panel.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  panel.append(title, preview, copyBtn);
  menu.append(trigger, panel);
  return menu;
}

/** 画像一覧ヘッダーの歯車から開く、書き出し先パス設定ポップオーバー。 */
function setupAssetUrlMenu(): void {
  const wrapper = assetUrlTriggerEl.parentElement;
  if (!wrapper) {
    return;
  }

  const panel = document.createElement("div");
  panel.className = "exclude-popover asset-url-popover";
  panel.hidden = true;
  panel.setAttribute("role", "group");
  panel.setAttribute("aria-label", "URL コピー設定");

  const title = document.createElement("div");
  title.className = "exclude-title";
  title.textContent = "URL コピー設定";

  const field = document.createElement("label");
  field.className = "asset-url-field";
  field.textContent = "書き出し先パス";

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "/assets/images/";
  input.value = currentAssetPath;
  input.spellcheck = false;
  input.addEventListener("input", () => {
    input.setAttribute("data-dirty", "1");
    postToPlugin({
      type: "SET_ASSET_URL_CONFIG",
      nodeId: targetId,
      path: input.value,
    });
  });

  const syncInput = (): void => {
    assetUrlTriggerEl.disabled = !targetId;
    if (!targetId) {
      closeAssetUrlPopover();
      return;
    }
    const dirty = input.getAttribute("data-dirty") === "1";
    if (!dirty || document.activeElement !== input) {
      input.value = currentAssetPath;
    }
    if (!currentAssetPath) {
      input.removeAttribute("data-dirty");
    }
  };

  field.append(input);
  panel.append(title, field);

  assetUrlTriggerEl.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!targetId) {
      return;
    }
    closeAllExcludeMenus();
    closeAllCopyMenus();
    closeAssetUrlPopover();
    const willOpen = panel.hidden;
    syncInput();
    panel.hidden = !willOpen;
    assetUrlTriggerEl.setAttribute("aria-expanded", willOpen ? "true" : "false");
  });
  panel.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  wrapper.appendChild(panel);
  syncInput();
  assetUrlInputSync = syncInput;
}

function createQualityInput(
  config: ExportConfig,
  onChange?: () => void
): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "config-quality";

  const input = document.createElement("input");
  input.type = "number";
  input.min = "1";
  input.max = "100";
  input.step = "1";
  input.value = String(config.quality ?? defaultQualityFor(config.format));
  input.setAttribute("aria-label", "圧縮率");
  input.title = "圧縮率（%）";
  input.addEventListener("click", (event) => event.stopPropagation());
  input.addEventListener("change", () => {
    const parsed = Math.round(Number(input.value));
    const next = Number.isFinite(parsed)
      ? Math.min(100, Math.max(1, parsed))
      : DEFAULT_QUALITY;
    config.quality = next;
    input.value = String(next);
    onChange?.();
  });

  const unit = document.createElement("span");
  unit.textContent = "%";

  wrap.append(input, unit);
  return wrap;
}

function updateQualityVisibility(qualityWrap: HTMLDivElement, format: ExportFormat): void {
  const visible =
    format === "PNG" || format === "JPG" || format === "WEBP" ||
    format === "AVIF";
  qualityWrap.style.display = visible ? "inline-flex" : "none";
}

/** SVG / PDF はサイズ指定が効かないため、サイズ入力を非活性にする。 */
function updateConstraintDisabled(
  sizeInput: HTMLInputElement,
  format: ExportFormat
): void {
  sizeInput.disabled = format === "SVG" || format === "PDF";
}

function createConfigRow(id: string, config: ExportConfig, index: number): HTMLElement {
  const row = document.createElement("div");
  row.className = "config-row";

  const size = createConstraintInput(config, () => {
    syncExportSettings(id);
  });

  const quality = createQualityInput(config, () => {
    syncExportSettings(id);
  });

  const format = createFormatSelect(config.format, (next) => {
    config.format = next;
    updateConstraintDisabled(size, next);
    updateQualityVisibility(quality, next);
    if (config.quality == null) {
      const input = quality.querySelector("input");
      if (input) {
        input.value = String(defaultQualityFor(next));
      }
    }
    syncExportSettings(id);
  });
  updateConstraintDisabled(size, config.format);
  updateQualityVisibility(quality, config.format);

  const remove = createRemoveButton(id, index);
  const copy = createCopyMenu(id, config);

  row.append(remove, size, format, quality, copy);
  return row;
}

function renderList(): void {
  resultsEl.innerHTML = "";

  if (items.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = statusEl.hidden
      ? "まだ画像やエクスポート設定のあるレイヤーがありません"
      : statusEl.textContent || "まだ画像やエクスポート設定のあるレイヤーがありません";
    resultsEl.appendChild(li);
    selectAllEl.checked = false;
    exportAllBtn.disabled = true;
    return;
  }

  exportAllBtn.disabled = false;

  let allChecked = true;
  for (const item of items) {
    if (!checkedIds.has(item.id)) {
      allChecked = false;
    }

    const li = document.createElement("li");
    li.className = "result-row";
    if (rowErrorById.has(item.id)) {
      li.classList.add("is-error");
      li.title = rowErrorById.get(item.id) ?? "";
    }

    li.addEventListener("mouseenter", () => {
      postToPlugin({ type: "HOVER_ROW", nodeId: item.id });
    });
    li.addEventListener("mouseleave", () => {
      postToPlugin({ type: "HOVER_ROW", nodeId: null });
    });

    const check = document.createElement("input");
    check.type = "checkbox";
    check.className = "result-check";
    check.checked = checkedIds.has(item.id);
    check.addEventListener("click", (event) => event.stopPropagation());
    check.addEventListener("change", () => {
      if (check.checked) {
        checkedIds.add(item.id);
      } else {
        checkedIds.delete(item.id);
      }
      renderList();
    });

    let thumb: HTMLElement;
    if (item.thumbBytes && item.thumbBytes.length > 0) {
      const img = document.createElement("img");
      img.className = "result-thumb";
      img.alt = "";
      img.src = bytesToObjectUrl(item.thumbBytes, "image/png");
      thumb = img;
    } else {
      const placeholder = document.createElement("div");
      placeholder.className = "result-thumb is-placeholder";
      placeholder.textContent = "—";
      thumb = placeholder;
    }
    thumb.addEventListener("click", () => {
      postToPlugin({ type: "FOCUS_NODE", nodeId: item.id });
    });

    const head = document.createElement("div");
    head.className = "result-head";
    const nameInput = createNameInput(item);
    head.append(
      check,
      thumb,
      nameInput,
      createExcludeMenu(item.id),
      createExportButton(item.id),
      createAddButton(item.id)
    );

    const configBox = document.createElement("div");
    configBox.className = "config-box";
    const configs = configsFor(item.id);
    for (let i = 0; i < configs.length; i += 1) {
      configBox.appendChild(createConfigRow(item.id, configs[i], i));
    }

    li.append(head, configBox);
    resultsEl.appendChild(li);
  }

  selectAllEl.checked = items.length > 0 && allChecked;
}

async function handleExportResults(results: ExportResultItem[]): Promise<void> {
  let okCount = 0;

  if (activeExportDir) {
    const dir = activeExportDir;
    activeExportDir = null;
    for (const result of results) {
      if (!result.ok || !result.bytes) {
        rowErrorById.set(
          result.id,
          result.message ?? "書き出しに失敗しました"
        );
        continue;
      }
      const name = nameOverridesById.get(result.id)?.trim() || result.name;
      const fileName = `${sanitizeFilename(name)}${constraintSuffix(
        result.constraint,
        result.format
      )}.${extFor(result.format)}`;
      try {
        const data = await bytesForResult(result);
        const handle = await dir.getFileHandle(fileName, { create: true });
        const writable = await handle.createWritable();
        await writable.write(data);
        await writable.close();
        rowErrorById.delete(result.id);
        okCount += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        rowErrorById.set(result.id, `保存に失敗: ${message}`);
      }
    }
  } else {
    const entries: ZipEntry[] = [];
    const usedNames = new Set<string>();
    for (const result of results) {
      if (result.ok && result.bytes) {
        const name = nameOverridesById.get(result.id)?.trim() || result.name;
        const ext = extFor(result.format);
        const base = sanitizeFilename(name) + constraintSuffix(
          result.constraint,
          result.format
        );
        let fileName = `${base}.${ext}`;
        let i = 2;
        while (usedNames.has(fileName)) {
          fileName = `${base}_${i}.${ext}`;
          i += 1;
        }
        usedNames.add(fileName);
        try {
          const data = await bytesForResult(result);
          entries.push({
            name: fileName,
            data,
          });
          rowErrorById.delete(result.id);
          okCount += 1;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          rowErrorById.set(result.id, `書き出しに失敗: ${message}`);
        }
      } else {
        rowErrorById.set(
          result.id,
          result.message ?? "書き出しに失敗しました"
        );
      }
    }
    if (okCount > 0) {
      const zip = zipEntries(entries);
      downloadUint8(zip, `cbImageExport-${timestampForName()}.zip`, "application/zip");
    }
  }

  showStatus(null);
  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    showError(
      failed.length === 1
        ? failed[0].message ?? "書き出しに失敗しました"
        : `${failed.length} 件の書き出しに失敗しました`
    );
  }
  renderList();
}

rescanBtn.addEventListener("click", () => {
  showError(null);
  postToPlugin({ type: "SCAN_TARGET" });
});

document.addEventListener(
  "click",
  (event) => {
    const target = event.target as Element | null;
    if (target && target.closest?.(".exclude-menu")) {
      return;
    }
    if (target && target.closest?.(".copy-menu")) {
      return;
    }
    if (target && target.closest?.(".asset-url-popover")) {
      return;
    }
    if (target === assetUrlTriggerEl) {
      return;
    }
    closeAllExcludeMenus();
    closeAllCopyMenus();
    closeAssetUrlPopover();
  },
  true
);

async function exportRows(targetIds: string[]): Promise<void> {
  const requests: ExportRequest[] = [];
  for (const id of targetIds) {
    for (const config of configsFor(id)) {
      requests.push({
        id,
        format: config.format,
        constraint: { ...config.constraint },
        options: excludeOptionsFor(id),
      });
    }
  }
  if (requests.length === 0) {
    showError("書き出し設定がありません");
    return;
  }
  if (typeof window.showDirectoryPicker === "function") {
    try {
      activeExportDir = await window.showDirectoryPicker({ id: "cb-image-export" });
    } catch {
      return;
    }
  }
  showError(null);
  showStatus("書き出し中…");
  postToPlugin({ type: "EXPORT_NODES", items: requests });
}

exportAllBtn.addEventListener("click", () => {
  const targets = items.filter((item) => checkedIds.has(item.id));
  if (targets.length === 0) {
    showError("書き出す画像にチェックを入れてください");
    return;
  }
  exportRows(targets.map((item) => item.id));
});

selectAllEl.addEventListener("change", () => {
  if (selectAllEl.checked) {
    for (const item of items) {
      checkedIds.add(item.id);
    }
  } else {
    checkedIds.clear();
  }
  renderList();
});

window.onmessage = (event: MessageEvent) => {
  const msg = event.data?.pluginMessage as PluginToUiMessage | undefined;
  if (!msg) {
    return;
  }
  if (msg.type === "FRAME_TARGETS") {
    frameTargets = msg.targets;
    recentFrames = msg.recent;
    targetId = msg.targetId;
    currentAssetPath = msg.assetUrlPath;
    targetPicker?.refresh();
    assetUrlInputSync?.();
    return;
  }
  if (msg.type === "SELECTION_EMPTY") {
    targetPicker?.openHistoryPopover();
    return;
  }
  if (msg.type === "ASSET_URL_CONFIG") {
    if (msg.nodeId === targetId) {
      currentAssetPath = msg.path;
      assetUrlInputSync?.();
    }
    return;
  }
  if (msg.type === "IMAGE_LIST") {
    items = msg.items;
    const valid = new Set(items.map((i) => i.id));
    for (const id of [...checkedIds]) {
      if (!valid.has(id)) {
        checkedIds.delete(id);
      }
    }
    for (const id of [...configsByNode.keys()]) {
      if (!valid.has(id)) {
        configsByNode.delete(id);
      }
    }
    for (const item of items) {
      configsByNode.set(item.id, (item.exportConfigs ?? []).map((config) => ({
        ...config,
        constraint: { ...config.constraint },
      })));
    }
    for (const id of [...excludeOptionsById.keys()]) {
      if (!valid.has(id)) {
        excludeOptionsById.delete(id);
      }
    }
    for (const id of [...rowErrorById.keys()]) {
      if (!valid.has(id)) {
        rowErrorById.delete(id);
      }
    }
    for (const id of [...nameOverridesById.keys()]) {
      if (!valid.has(id)) {
        nameOverridesById.delete(id);
      }
    }
    showStatus(msg.message ?? null);
    showError(null);
    renderList();
    return;
  }
  if (msg.type === "EXPORT_RESULT") {
    void handleExportResults(msg.results);
    return;
  }
  if (msg.type === "ERROR") {
    showError(msg.message);
  }
};

function setupResize(): void {
  let dragging = false;
  let startY = 0;
  let startHeight = 0;

  const onMove = (event: PointerEvent) => {
    if (!dragging) {
      return;
    }
    const next = Math.min(
      MAX_UI_HEIGHT,
      Math.max(MIN_UI_HEIGHT, startHeight + (event.clientY - startY))
    );
    postToPlugin({ type: "RESIZE_UI", height: next });
  };

  const onUp = () => {
    if (!dragging) {
      return;
    }
    dragging = false;
    document.body.classList.remove("is-resizing");
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  };

  resizeHandle.addEventListener("pointerdown", (event) => {
    dragging = true;
    startY = event.clientY;
    startHeight = window.innerHeight;
    document.body.classList.add("is-resizing");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });
}

setupResize();
mountTargetPicker();
setupAssetUrlMenu();
postToPlugin({ type: "LIST_FRAME_TARGETS" });
renderList();