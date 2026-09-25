import "./ui.css";
import excludeIcon from "./assets/exclude.svg?raw";
import type { PluginToUiMessage, UiToPluginMessage } from "./messages";
import { closeAllTargetPopovers, createTargetPicker, unregisterPicker } from "./targetPicker";
import type {
  ExportConfig,
  ExportFormat,
  ExportOptions,
  ExportRequest,
  ExportResultItem,
  FrameTarget,
  ImageListItem,
} from "./types";
import { DEFAULT_EXCLUDE_OPTIONS, EXPORT_FORMATS } from "./types";

const MIN_UI_HEIGHT = 320;
const MAX_UI_HEIGHT = 900;

const DEFAULT_CONFIG: ExportConfig = { format: "PNG", scale: 1 };

const targetPickerRoot = document.getElementById(
  "target-picker-root"
) as HTMLDivElement;
const rescanBtn = document.getElementById("rescan") as HTMLButtonElement;
const exportAllBtn = document.getElementById(
  "export-all"
) as HTMLButtonElement;
const selectAllEl = document.getElementById("select-all") as HTMLInputElement;
const resultsEl = document.getElementById("results") as HTMLUListElement;
const errorEl = document.getElementById("error") as HTMLParagraphElement;
const statusEl = document.getElementById("status") as HTMLParagraphElement;
const resizeHandle = document.getElementById(
  "resize-handle"
) as HTMLDivElement;

let items: ImageListItem[] = [];
let frameTargets: FrameTarget[] = [];
let targetId: string | null = null;
const checkedIds = new Set<string>();
const configsByNode = new Map<string, ExportConfig[]>();
const excludeOptionsById = new Map<string, ExportOptions>();
const nameOverridesById = new Map<string, string>();
const rowErrorById = new Map<string, string>();

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
    onApplySelection: () => {
      postToPlugin({ type: "SET_FRAME_FROM_SELECTION" });
    },
    onPick: (id) => {
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

function parseScale(raw: string): number {
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return 1;
  }
  return value;
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

function mimeFor(format: ExportFormat): string {
  switch (format) {
    case "JPG":
      return "image/jpeg";
    case "SVG":
      return "image/svg+xml";
    case "PDF":
      return "application/pdf";
    default:
      return "image/png";
  }
}

function extFor(format: ExportFormat): string {
  switch (format) {
    case "JPG":
      return "jpg";
    case "SVG":
      return "svg";
    case "PDF":
      return "pdf";
    default:
      return "png";
  }
}

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").trim() || "export";
}

function downloadBytes(
  bytes: number[],
  name: string,
  format: ExportFormat
): void {
  const url = bytesToObjectUrl(bytes, mimeFor(format));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${sanitizeFilename(name)}.${extFor(format)}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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

function createScaleInput(
  value: number,
  onInput: (raw: string) => void,
  onChange?: () => void
): HTMLInputElement {
  const input = document.createElement("input");
  input.className = "config-scale";
  input.type = "number";
  input.min = "0";
  input.step = "0.1";
  input.value = String(value);
  input.setAttribute("aria-label", "書き出し倍率");
  input.title = "2 なら 2 倍、0.5 なら半分、未入力なら等倍";
  input.addEventListener("click", (event) => event.stopPropagation());
  input.addEventListener("input", () => onInput(input.value));
  input.addEventListener("change", () => {
    onInput(input.value);
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

function createRemoveButton(id: string, index: number): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "config-remove";
  btn.textContent = "✕";
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

function createConfigRow(id: string, config: ExportConfig, index: number): HTMLElement {
  const row = document.createElement("div");
  row.className = "config-row";

  const scale = createScaleInput(config.scale, (raw) => {
    config.scale = parseScale(raw);
  }, () => {
    syncExportSettings(id);
  });

  const format = createFormatSelect(config.format, (next) => {
    config.format = next;
    syncExportSettings(id);
  });

  const remove = createRemoveButton(id, index);

  row.append(scale, format, remove);
  return row;
}

function renderList(): void {
  resultsEl.innerHTML = "";

  if (items.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = statusEl.hidden
      ? "まだ画像がありません"
      : statusEl.textContent || "まだ画像がありません";
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

function handleExportResults(results: ExportResultItem[]): void {
  let okCount = 0;
  for (const result of results) {
    if (result.ok && result.bytes) {
      const name = nameOverridesById.get(result.id)?.trim() || result.name;
      downloadBytes(result.bytes, name, result.format);
      rowErrorById.delete(result.id);
      okCount += 1;
    } else {
      rowErrorById.set(
        result.id,
        result.message ?? "書き出しに失敗しました"
      );
    }
  }
  if (okCount > 0) {
    showStatus(`${okCount} 件を書き出しました`);
  }
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
    closeAllExcludeMenus();
  },
  true
);

exportAllBtn.addEventListener("click", () => {
  const targets = items.filter((item) => checkedIds.has(item.id));
  if (targets.length === 0) {
    showError("書き出す画像にチェックを入れてください");
    return;
  }
  const requests: ExportRequest[] = [];
  for (const item of targets) {
    for (const config of configsFor(item.id)) {
      requests.push({
        id: item.id,
        format: config.format,
        scale: config.scale,
        options: excludeOptionsFor(item.id),
      });
    }
  }
  if (requests.length === 0) {
    showError("書き出し設定がありません");
    return;
  }
  showError(null);
  showStatus("書き出し中…");
  postToPlugin({ type: "EXPORT_NODES", items: requests });
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
    targetId = msg.targetId;
    targetPicker?.refresh();
    return;
  }
  if (msg.type === "SELECTION_EMPTY") {
    targetPicker?.openPopover();
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
    handleExportResults(msg.results);
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
postToPlugin({ type: "LIST_FRAME_TARGETS" });
renderList();