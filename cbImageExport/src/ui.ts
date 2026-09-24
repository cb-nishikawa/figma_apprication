import "./ui.css";
import type { PluginToUiMessage, UiToPluginMessage } from "./messages";
import type {
  ExportFormat,
  ExportResultItem,
  ImageListItem,
} from "./types";
import { EXPORT_FORMATS } from "./types";

const MIN_UI_HEIGHT = 320;
const MAX_UI_HEIGHT = 900;
const DEBOUNCE_MS = 200;

const frameSummaryEl = document.getElementById(
  "frame-summary"
) as HTMLSpanElement;
const rescanBtn = document.getElementById("rescan") as HTMLButtonElement;
const searchInput = document.getElementById("search-input") as HTMLInputElement;
const bulkFormatEl = document.getElementById(
  "bulk-format"
) as HTMLSelectElement;
const exportCheckedBtn = document.getElementById(
  "export-checked"
) as HTMLButtonElement;
const selectAllEl = document.getElementById("select-all") as HTMLInputElement;
const resultsEl = document.getElementById("results") as HTMLUListElement;
const errorEl = document.getElementById("error") as HTMLParagraphElement;
const statusEl = document.getElementById("status") as HTMLParagraphElement;
const resizeHandle = document.getElementById(
  "resize-handle"
) as HTMLDivElement;

let items: ImageListItem[] = [];
let searchQuery = "";
let debounceTimer: number | null = null;
const checkedIds = new Set<string>();
const formatById = new Map<string, ExportFormat>();
const rowErrorById = new Map<string, string>();

function postToPlugin(msg: UiToPluginMessage): void {
  parent.postMessage({ pluginMessage: msg }, "*");
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

function kindLabel(kind: ImageListItem["kind"]): string {
  if (kind === "mask") {
    return "マスク範囲";
  }
  if (kind === "clip") {
    return "フレーム範囲";
  }
  return "画像";
}

function filteredItems(): ImageListItem[] {
  const q = searchQuery.trim().toLowerCase();
  if (!q) {
    return items;
  }
  return items.filter(
    (item) =>
      item.name.toLowerCase().includes(q) ||
      item.frameName.toLowerCase().includes(q)
  );
}

function formatFor(id: string): ExportFormat {
  return formatById.get(id) ?? "PNG";
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
  select.className = "row-format";
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

function renderList(): void {
  resultsEl.innerHTML = "";
  const list = filteredItems();

  if (items.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = statusEl.hidden
      ? "まだ画像がありません"
      : statusEl.textContent || "まだ画像がありません";
    resultsEl.appendChild(li);
    selectAllEl.checked = false;
    return;
  }

  if (list.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "検索に一致する画像がありません";
    resultsEl.appendChild(li);
    return;
  }

  let allChecked = true;
  for (const item of list) {
    if (!checkedIds.has(item.id)) {
      allChecked = false;
    }

    const li = document.createElement("li");
    li.className = "result-row";
    if (rowErrorById.has(item.id)) {
      li.classList.add("is-error");
      li.title = rowErrorById.get(item.id) ?? "";
    }

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

    const meta = document.createElement("div");
    meta.className = "result-meta";
    const name = document.createElement("div");
    name.className = "result-name";
    name.textContent = item.name;
    const kind = document.createElement("div");
    kind.className = "result-kind";
    kind.textContent = `${kindLabel(item.kind)} · ${item.frameName}`;
    meta.append(name, kind);
    meta.addEventListener("click", () => {
      postToPlugin({ type: "FOCUS_NODE", nodeId: item.id });
    });

    const formatSelect = createFormatSelect(formatFor(item.id), (format) => {
      formatById.set(item.id, format);
    });

    const exportBtn = document.createElement("button");
    exportBtn.type = "button";
    exportBtn.className = "btn-row";
    exportBtn.textContent = "書き出し";
    exportBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      showError(null);
      postToPlugin({
        type: "EXPORT_NODES",
        items: [{ id: item.id, format: formatFor(item.id) }],
      });
    });

    li.append(check, thumb, meta, formatSelect, exportBtn);
    resultsEl.appendChild(li);
  }

  selectAllEl.checked = list.length > 0 && allChecked;
}

function applyBulkFormat(format: ExportFormat): void {
  for (const item of items) {
    formatById.set(item.id, format);
  }
  renderList();
}

function handleExportResults(results: ExportResultItem[]): void {
  let okCount = 0;
  for (const result of results) {
    if (result.ok && result.bytes) {
      downloadBytes(result.bytes, result.name, result.format);
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
  postToPlugin({ type: "SCAN_SELECTION" });
});

searchInput.addEventListener("input", () => {
  if (debounceTimer !== null) {
    window.clearTimeout(debounceTimer);
  }
  debounceTimer = window.setTimeout(() => {
    searchQuery = searchInput.value;
    renderList();
  }, DEBOUNCE_MS);
});

bulkFormatEl.addEventListener("change", () => {
  applyBulkFormat(bulkFormatEl.value as ExportFormat);
});

exportCheckedBtn.addEventListener("click", () => {
  const targets = filteredItems().filter((item) => checkedIds.has(item.id));
  if (targets.length === 0) {
    showError("書き出す画像にチェックを入れてください");
    return;
  }
  showError(null);
  showStatus("書き出し中…");
  postToPlugin({
    type: "EXPORT_NODES",
    items: targets.map((item) => ({
      id: item.id,
      format: formatFor(item.id),
    })),
  });
});

selectAllEl.addEventListener("change", () => {
  const list = filteredItems();
  if (selectAllEl.checked) {
    for (const item of list) {
      checkedIds.add(item.id);
    }
  } else {
    for (const item of list) {
      checkedIds.delete(item.id);
    }
  }
  renderList();
});

window.onmessage = (event: MessageEvent) => {
  const msg = event.data?.pluginMessage as PluginToUiMessage | undefined;
  if (!msg) {
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
    for (const id of [...formatById.keys()]) {
      if (!valid.has(id)) {
        formatById.delete(id);
      }
    }
    for (const id of [...rowErrorById.keys()]) {
      if (!valid.has(id)) {
        rowErrorById.delete(id);
      }
    }
    for (const item of items) {
      if (!formatById.has(item.id)) {
        formatById.set(item.id, bulkFormatEl.value as ExportFormat);
      }
    }
    if (msg.frameNames.length === 0) {
      frameSummaryEl.textContent = "未選択";
    } else if (msg.frameNames.length === 1) {
      frameSummaryEl.textContent = msg.frameNames[0];
    } else {
      frameSummaryEl.textContent = `${msg.frameNames.length} 件: ${msg.frameNames.join(", ")}`;
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
postToPlugin({ type: "SCAN_SELECTION" });
renderList();
