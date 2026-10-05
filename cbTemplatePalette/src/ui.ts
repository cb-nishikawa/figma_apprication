import "./ui.css";
import type { PluginToUiMessage, UiToPluginMessage } from "./messages";
import type { TemplateMeta } from "./types";

const saveBtn = document.getElementById("save") as HTMLButtonElement;
const selectionHint = document.getElementById("selection-hint") as HTMLParagraphElement;
const countEl = document.getElementById("count") as HTMLSpanElement;
const filterInput = document.getElementById("filter") as HTMLInputElement;
const filterToggleBtn = document.getElementById("filter-toggle") as HTMLButtonElement;
const filterPopover = document.getElementById("filter-popover") as HTMLDivElement;
const errorEl = document.getElementById("error") as HTMLParagraphElement;
const listEl = document.getElementById("list") as HTMLUListElement;
const statusSpinner = document.getElementById("status-spinner") as HTMLSpanElement;
const statusText = document.getElementById("status-text") as HTMLSpanElement;
const placeBtn = document.getElementById("place") as HTMLButtonElement;
const resizeHandle = document.getElementById("resize-handle") as HTMLDivElement;
const importBtn = document.getElementById("import") as HTMLButtonElement;
const exportAllBtn = document.getElementById("export-all") as HTMLButtonElement;
const importFileInput = document.getElementById("import-file") as HTMLInputElement;

let templates: TemplateMeta[] = [];
let selectedId: string | null = null;
let renamingId: string | null = null;
let busyMessage: string | null = null;
let savableCount = 0;
let usage = { used: 0, quota: 0 };

function postToPlugin(message: UiToPluginMessage): void {
  parent.postMessage({ pluginMessage: message }, "*");
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }
  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)}KB`;
  }
  return `${bytes}B`;
}

function showError(message: string | null): void {
  errorEl.hidden = !message;
  errorEl.textContent = message ?? "";
}

function renderStatus(): void {
  statusSpinner.hidden = !busyMessage;
  statusText.textContent =
    busyMessage ??
    (usage.quota > 0 ? `使用量 ${formatBytes(usage.used)} / ${formatBytes(usage.quota)}` : "");
  saveBtn.hidden = savableCount === 0;
  saveBtn.disabled = Boolean(busyMessage);
  placeBtn.hidden = !selectedId;
  placeBtn.disabled = Boolean(busyMessage);
  importBtn.disabled = Boolean(busyMessage);
  exportAllBtn.disabled = Boolean(busyMessage) || templates.length === 0;
}

function downloadText(text: string, fileName: string): void {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importFiles(fileList: FileList): Promise<void> {
  const files = await Promise.all(
    Array.from(fileList).map(async (file) => ({ name: file.name, text: await file.text() }))
  );
  if (files.length > 0) {
    showError(null);
    postToPlugin({ type: "IMPORT", files });
  }
}

function closeAllRowMenus(): void {
  listEl.querySelectorAll<HTMLDivElement>(".row-menu-panel").forEach((panel) => {
    panel.hidden = true;
  });
}

function syncFilterActiveState(): void {
  filterToggleBtn.classList.toggle("is-active", filterInput.value.trim() !== "");
}

function setFilterPopoverOpen(open: boolean): void {
  filterPopover.hidden = !open;
  filterToggleBtn.setAttribute("aria-expanded", open ? "true" : "false");
  syncFilterActiveState();
  if (open) {
    window.setTimeout(() => filterInput.focus(), 0);
  }
}

function place(id: string): void {
  if (busyMessage) {
    return;
  }
  showError(null);
  postToPlugin({ type: "PLACE", id });
}

function startRename(id: string): void {
  renamingId = id;
  renderList();
}

function commitRename(id: string, value: string): void {
  if (renamingId !== id) {
    return;
  }
  renamingId = null;
  const current = templates.find((t) => t.id === id);
  const name = value.trim();
  if (current && name && name !== current.name) {
    current.name = name;
    postToPlugin({ type: "RENAME", id, name });
  }
  renderList();
}

function createRowMenu(meta: TemplateMeta): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "row-menu";

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "row-menu-trigger";
  trigger.textContent = "⋯";
  trigger.title = "メニュー";
  trigger.setAttribute("aria-label", "メニュー");

  const panel = document.createElement("div");
  panel.className = "row-menu-panel";
  panel.hidden = true;
  panel.setAttribute("role", "menu");

  const renameItem = document.createElement("button");
  renameItem.type = "button";
  renameItem.className = "row-menu-item";
  renameItem.textContent = "名前を変更";
  renameItem.addEventListener("click", (event) => {
    event.stopPropagation();
    closeAllRowMenus();
    startRename(meta.id);
  });

  const exportItem = document.createElement("button");
  exportItem.type = "button";
  exportItem.className = "row-menu-item";
  exportItem.textContent = "ファイルに書き出す";
  exportItem.addEventListener("click", (event) => {
    event.stopPropagation();
    closeAllRowMenus();
    postToPlugin({ type: "EXPORT", ids: [meta.id] });
  });

  const deleteItem = document.createElement("button");
  deleteItem.type = "button";
  deleteItem.className = "row-menu-item";
  deleteItem.textContent = "削除";
  deleteItem.addEventListener("click", (event) => {
    event.stopPropagation();
    closeAllRowMenus();
    if (selectedId === meta.id) {
      selectedId = null;
    }
    postToPlugin({ type: "DELETE", id: meta.id });
  });

  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    const willOpen = panel.hidden;
    closeAllRowMenus();
    setFilterPopoverOpen(false);
    panel.hidden = !willOpen;
  });
  trigger.addEventListener("dblclick", (event) => event.stopPropagation());

  panel.append(renameItem, exportItem, deleteItem);
  wrap.append(trigger, panel);
  return wrap;
}

function createNameElement(meta: TemplateMeta): HTMLElement {
  if (renamingId !== meta.id) {
    const name = document.createElement("span");
    name.className = "template-name";
    name.textContent = meta.name;
    name.title = meta.name;
    return name;
  }
  const input = document.createElement("input");
  input.className = "text-input template-rename";
  input.value = meta.name;
  input.addEventListener("click", (event) => event.stopPropagation());
  input.addEventListener("dblclick", (event) => event.stopPropagation());
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitRename(meta.id, input.value);
    } else if (event.key === "Escape") {
      event.preventDefault();
      renamingId = null;
      renderList();
    }
  });
  input.addEventListener("blur", () => commitRename(meta.id, input.value));
  window.setTimeout(() => {
    input.focus();
    input.select();
  }, 0);
  return input;
}

function createItem(meta: TemplateMeta): HTMLLIElement {
  const li = document.createElement("li");
  li.className = "template-item";
  li.classList.toggle("is-selected", meta.id === selectedId);
  li.setAttribute("role", "option");
  li.setAttribute("aria-selected", meta.id === selectedId ? "true" : "false");
  li.title = "クリックで選択・ダブルクリックで複製";

  const thumb = document.createElement("div");
  thumb.className = "template-thumb";
  if (meta.thumbnail) {
    const img = document.createElement("img");
    img.src = meta.thumbnail;
    img.alt = "";
    thumb.append(img);
  }

  const info = document.createElement("div");
  info.className = "template-info";
  const metaLine = document.createElement("span");
  metaLine.className = "template-meta";
  metaLine.textContent = `${meta.width}×${meta.height} · ${meta.nodeCount} 要素 · ${formatBytes(meta.byteSize)}`;
  const title = document.createElement("div");
  title.className = "template-title";
  title.append(createNameElement(meta));
  if (meta.kind === "component") {
    const badge = document.createElement("span");
    badge.className = "template-badge";
    badge.textContent = "コンポーネント";
    title.append(badge);
  }
  info.append(title, metaLine);

  li.append(thumb, info, createRowMenu(meta));

  li.addEventListener("click", () => {
    selectedId = meta.id;
    closeAllRowMenus();
    renderList();
  });
  li.addEventListener("dblclick", () => {
    selectedId = meta.id;
    renderList();
    place(meta.id);
  });
  return li;
}

function renderList(): void {
  const query = filterInput.value.trim().toLowerCase();
  const visible = query
    ? templates.filter((t) => t.name.toLowerCase().includes(query))
    : templates;

  countEl.textContent = templates.length > 0 ? `${templates.length}件` : "";
  listEl.replaceChildren();
  if (visible.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent =
      templates.length === 0 ? "まだ保存した要素がありません" : "該当なし";
    listEl.append(li);
  } else {
    for (const meta of visible) {
      listEl.append(createItem(meta));
    }
  }
  renderStatus();
}

function renderSelectionHint(count: number, isComponent: boolean): void {
  savableCount = count;
  selectionHint.classList.toggle("is-ready", count > 0);
  selectionHint.textContent =
    count === 0 ? "" : isComponent ? "コンポーネントを選択中" : `${count} 件を選択中`;
  renderStatus();
}

saveBtn.addEventListener("click", () => {
  showError(null);
  postToPlugin({ type: "SAVE_SELECTION" });
});

placeBtn.addEventListener("click", () => {
  if (selectedId) {
    place(selectedId);
  }
});

filterInput.addEventListener("input", () => {
  syncFilterActiveState();
  renderList();
});

filterToggleBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  closeAllRowMenus();
  setFilterPopoverOpen(filterPopover.hidden);
});

filterPopover.addEventListener("click", (event) => event.stopPropagation());

filterPopover.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    setFilterPopoverOpen(false);
    filterToggleBtn.focus();
  }
});

importBtn.addEventListener("click", () => importFileInput.click());

importFileInput.addEventListener("change", () => {
  const fileList = importFileInput.files;
  if (fileList) {
    void importFiles(fileList).finally(() => {
      importFileInput.value = "";
    });
  }
});

exportAllBtn.addEventListener("click", () => {
  showError(null);
  postToPlugin({ type: "EXPORT", ids: null });
});

document.addEventListener("click", (event) => {
  closeAllRowMenus();
  const filterRoot = filterToggleBtn.closest(".filter-menu");
  const target = event.target as Node | null;
  if (target && !filterRoot?.contains(target)) {
    setFilterPopoverOpen(false);
  }
});

function setupResize(): void {
  let dragging = false;
  let startY = 0;
  let startHeight = 0;

  const onMove = (event: PointerEvent) => {
    if (!dragging) {
      return;
    }
    const next = Math.round(startHeight + (event.clientY - startY));
    postToPlugin({ type: "RESIZE_UI", height: next });
  };

  const onUp = () => {
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

window.onmessage = (event: MessageEvent) => {
  const msg = event.data?.pluginMessage as PluginToUiMessage | undefined;
  if (!msg) {
    return;
  }
  switch (msg.type) {
    case "TEMPLATES":
      templates = msg.templates;
      usage = { used: msg.usedBytes, quota: msg.quotaBytes };
      if (selectedId && !templates.some((t) => t.id === selectedId)) {
        selectedId = null;
      }
      renderList();
      break;
    case "SELECTION_STATE":
      renderSelectionHint(msg.savableCount, msg.isComponent);
      break;
    case "BUSY":
      busyMessage = msg.message;
      renderStatus();
      break;
    case "SAVED":
      selectedId = msg.id;
      filterInput.value = "";
      syncFilterActiveState();
      renderList();
      break;
    case "EXPORT_DATA":
      downloadText(msg.text, msg.fileName);
      break;
    case "ERROR":
      showError(msg.message);
      break;
  }
};

setupResize();
renderSelectionHint(0, false);
renderList();
postToPlugin({ type: "LIST" });
