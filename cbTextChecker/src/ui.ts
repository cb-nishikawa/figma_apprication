import "./ui.css";
import clearIcon from "./assets/clear.svg?raw";
import pinIcon from "./assets/pin.svg?raw";
import resetIcon from "./assets/reset.svg?raw";
import type { PluginToUiMessage, UiToPluginMessage } from "./messages";
import type {
  CheckResult,
  HighlightColor,
  HoverHighlightItem,
  KeywordQuery,
  PinTarget,
  SearchMode,
  TextMatch,
} from "./types";

const DEBOUNCE_MS = 300;
const MIN_UI_HEIGHT = 320;
const MAX_UI_HEIGHT = 900;
const DEFAULT_HIGHLIGHT_COLOR: HighlightColor = "green";
const HIGHLIGHT_COLOR_SWATCHES: Record<HighlightColor, string> = {
  red: "#ff3b30",
  yellow: "#ffcc00",
  green: "#00c853",
  purple: "#a154f2",
};
const HIGHLIGHT_COLOR_OPTIONS: HighlightColor[] = [
  "red",
  "yellow",
  "green",
  "purple",
];

const pinInline = document.getElementById("pin-inline") as HTMLDivElement;
const pinInputEl = document.getElementById(
  "pin-combobox-input"
) as HTMLInputElement;
const pinListEl = document.getElementById(
  "pin-combobox-list"
) as HTMLUListElement;
const keywordRowsEl = document.getElementById("keyword-rows") as HTMLDivElement;
const addKeywordBtn = document.getElementById("add-keyword") as HTMLButtonElement;
const clearKeywordsBtn = document.getElementById(
  "clear-keywords"
) as HTMLButtonElement;
const resetSearchBtn = document.getElementById(
  "reset-search"
) as HTMLButtonElement;
const resultsEl = document.getElementById("results") as HTMLUListElement;
const errorEl = document.getElementById("error") as HTMLParagraphElement;
const resizeHandle = document.getElementById("resize-handle") as HTMLDivElement;

let mode: SearchMode = "selection";
let pinTargets: PinTarget[] = [];
let pinnedNodeId: string | null = null;
let pinFilterQuery = "";
let pinListOpen = false;
let pinActiveIndex = -1;
let searchTimer: ReturnType<typeof setTimeout> | null = null;
/** Keywords whose accordion is expanded. */
const expandedKeywords = new Set<string>();
/** Keywords whose highlights stay visible. */
const pinnedKeywords = new Set<string>();
/** Per-keyword highlight color. */
const keywordColors = new Map<string, HighlightColor>();
let lastResults: CheckResult[] = [];

function postToPlugin(message: UiToPluginMessage): void {
  parent.postMessage({ pluginMessage: message }, "*");
}

function matchToHoverItem(match: TextMatch): HoverHighlightItem {
  return {
    nodeId: match.nodeId,
    style: match.exact ? "component" : "instance",
    exact: match.exact,
    ranges: match.ranges,
  };
}

function itemsForKeyword(keyword: string): HoverHighlightItem[] {
  const result = lastResults.find((r) => r.keyword === keyword);
  if (!result || result.count === 0) {
    return [];
  }
  return result.matches.map(matchToHoverItem);
}

function collectPinnedItems(): HoverHighlightItem[] {
  const items: HoverHighlightItem[] = [];
  for (const keyword of pinnedKeywords) {
    items.push(...itemsForKeyword(keyword));
  }
  return items;
}

function publishVisibleHighlights(extraItems: HoverHighlightItem[] = []): void {
  const byKey = new Map<string, HoverHighlightItem>();
  for (const item of [...collectPinnedItems(), ...extraItems]) {
    const range = item.ranges[0];
    const key = range
      ? `${item.nodeId}:${range.start}:${range.end}`
      : `${item.nodeId}:exact`;
    byKey.set(key, item);
  }
  const items = [...byKey.values()];
  if (items.length === 0) {
    postToPlugin({ type: "CLEAR_HIGHLIGHT" });
    return;
  }
  postToPlugin({ type: "HOVER_HIGHLIGHT", items });
}

function colorForKeyword(keyword: string): HighlightColor {
  return keywordColors.get(keyword) ?? DEFAULT_HIGHLIGHT_COLOR;
}

function applyKeywordColor(keyword: string, color: HighlightColor): void {
  keywordColors.set(keyword, color);
  const items = itemsForKeyword(keyword);
  if (items.length === 0) {
    return;
  }
  postToPlugin({ type: "SET_HIGHLIGHT_COLOR", color, items });
}

function syncHighlightPrefsAfterSearch(): void {
  const valid = new Set(lastResults.map((r) => r.keyword));
  for (const keyword of [...pinnedKeywords]) {
    if (!valid.has(keyword)) {
      pinnedKeywords.delete(keyword);
    }
  }
  for (const keyword of [...keywordColors.keys()]) {
    if (!valid.has(keyword)) {
      keywordColors.delete(keyword);
    }
  }
  for (const result of lastResults) {
    if (result.count === 0) {
      continue;
    }
    applyKeywordColor(result.keyword, colorForKeyword(result.keyword));
  }
  publishVisibleHighlights();
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

function debounceSearch(): void {
  if (searchTimer !== null) {
    clearTimeout(searchTimer);
  }
  searchTimer = setTimeout(() => {
    searchTimer = null;
    runSearch();
  }, DEBOUNCE_MS);
}

function collectQueries(): KeywordQuery[] {
  const queries: KeywordQuery[] = [];
  keywordRowsEl.querySelectorAll(".keyword-row").forEach((row) => {
    const area = row.querySelector("textarea");
    const brBtn = row.querySelector(".br-toggle") as HTMLButtonElement | null;
    if (!area) {
      return;
    }
    const value = area.value.trim();
    if (value.length === 0) {
      return;
    }
    queries.push({
      keyword: value,
      ignoreNewlines: brBtn?.getAttribute("aria-pressed") !== "false",
    });
  });
  return queries;
}

function runSearch(): void {
  showError(null);
  const queries = collectQueries();
  if (queries.length === 0) {
    renderResults([]);
    postToPlugin({ type: "CLEAR_HIGHLIGHT" });
    postToPlugin({ type: "SEARCH", queries: [] });
    return;
  }

  postToPlugin({ type: "SEARCH", queries });
}

function updatePinRowVisibility(): void {
  pinInline.hidden = mode !== "pinned";
}

function syncBrToggle(btn: HTMLButtonElement, ignoreNewlines: boolean): void {
  btn.setAttribute("aria-pressed", ignoreNewlines ? "true" : "false");
  btn.title = ignoreNewlines ? "改行を無視する" : "改行を含めて検索";
  btn.classList.toggle("is-on", ignoreNewlines);
  btn.classList.toggle("is-off", !ignoreNewlines);
}

function filteredPinTargets(): PinTarget[] {
  const query = pinFilterQuery.trim().toLowerCase();
  if (!query) {
    return pinTargets;
  }
  return pinTargets.filter((target) => {
    return (
      target.label.toLowerCase().includes(query) ||
      target.name.toLowerCase().includes(query)
    );
  });
}

function getPinnedTarget(): PinTarget | null {
  if (!pinnedNodeId) {
    return null;
  }
  return pinTargets.find((t) => t.id === pinnedNodeId) ?? null;
}

function syncPinnedFromTargets(): void {
  if (pinnedNodeId && !getPinnedTarget()) {
    pinnedNodeId = null;
  }
}

function setPinInputToSelection(): void {
  const selected = getPinnedTarget();
  pinFilterQuery = "";
  pinInputEl.value = selected ? selected.label : "";
}

function commitPinnedNode(nextId: string | null): void {
  pinnedNodeId = nextId;
  setPinInputToSelection();
  closePinList();
  postToPlugin({ type: "SET_PINNED_NODE", pinnedNodeId });
}

function openPinList(): void {
  pinListOpen = true;
  pinListEl.hidden = false;
  pinInputEl.setAttribute("aria-expanded", "true");
  renderPinList();
}

function closePinList(): void {
  pinListOpen = false;
  pinActiveIndex = -1;
  pinListEl.hidden = true;
  pinInputEl.setAttribute("aria-expanded", "false");
}

function renderPinList(): void {
  syncPinnedFromTargets();
  pinListEl.replaceChildren();

  if (pinTargets.length === 0) {
    const empty = document.createElement("li");
    empty.className = "pin-combobox-empty";
    empty.textContent = "候補がありません";
    pinListEl.append(empty);
    return;
  }

  const filtered = filteredPinTargets();
  if (filtered.length === 0) {
    const empty = document.createElement("li");
    empty.className = "pin-combobox-empty";
    empty.textContent = "該当なし";
    pinListEl.append(empty);
    pinActiveIndex = -1;
    return;
  }

  if (pinActiveIndex >= filtered.length) {
    pinActiveIndex = filtered.length - 1;
  }

  filtered.forEach((target, index) => {
    const item = document.createElement("li");
    item.setAttribute("role", "option");
    item.id = `pin-option-${target.id}`;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "pin-combobox-option";
    if (target.id === pinnedNodeId) {
      button.classList.add("is-selected");
    }
    if (index === pinActiveIndex) {
      button.classList.add("is-active");
    }
    button.textContent = target.label;
    button.title = target.label;
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });
    button.addEventListener("click", () => {
      commitPinnedNode(target.id);
    });

    item.append(button);
    pinListEl.append(item);
  });

  if (pinActiveIndex >= 0) {
    const active = pinListEl.children[pinActiveIndex] as HTMLElement | undefined;
    active?.scrollIntoView({ block: "nearest" });
  }
}

function refreshPinCombobox(preserveInput = false): void {
  syncPinnedFromTargets();
  if (!preserveInput) {
    setPinInputToSelection();
  }
  if (pinListOpen) {
    renderPinList();
  }
}

function updateRemoveButtons(): void {
  const rows = keywordRowsEl.querySelectorAll(".keyword-row");
  rows.forEach((row) => {
    const removeBtn = row.querySelector(".btn-remove") as HTMLButtonElement;
    removeBtn.disabled = rows.length <= 1;
  });
}

function addKeywordRow(
  initialValue = "",
  ignoreNewlines = true
): void {
  const row = document.createElement("div");
  row.className = "keyword-row";

  const textarea = document.createElement("textarea");
  textarea.rows = 1;
  textarea.placeholder = "検索する文字列";
  textarea.value = initialValue;
  textarea.addEventListener("input", () => debounceSearch());

  const actions = document.createElement("div");
  actions.className = "keyword-row-actions";

  const brBtn = document.createElement("button");
  brBtn.type = "button";
  brBtn.className = "br-toggle";
  brBtn.textContent = "br";
  syncBrToggle(brBtn, ignoreNewlines);
  brBtn.addEventListener("click", () => {
    const next = brBtn.getAttribute("aria-pressed") !== "true";
    syncBrToggle(brBtn, next);
    debounceSearch();
  });

  const clearRowBtn = document.createElement("button");
  clearRowBtn.type = "button";
  clearRowBtn.className = "btn-icon btn-clear-row";
  clearRowBtn.title = "この行をクリア";
  clearRowBtn.setAttribute("aria-label", "この行をクリア");
  clearRowBtn.innerHTML = clearIcon;
  clearRowBtn.addEventListener("click", () => {
    textarea.value = "";
    textarea.focus();
    debounceSearch();
  });

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "btn-icon btn-remove";
  removeBtn.title = "削除";
  removeBtn.setAttribute("aria-label", "削除");
  removeBtn.textContent = "-";
  removeBtn.addEventListener("click", () => {
    const rows = keywordRowsEl.querySelectorAll(".keyword-row");
    if (rows.length <= 1) {
      return;
    }
    row.remove();
    updateRemoveButtons();
    debounceSearch();
  });

  actions.append(brBtn, clearRowBtn, removeBtn);
  row.append(textarea, actions);

  row.addEventListener("mouseenter", () => {
    const keyword = textarea.value.trim();
    if (!keyword) {
      return;
    }
    const result = lastResults.find((r) => r.keyword === keyword);
    if (!result || result.count === 0) {
      return;
    }
    publishVisibleHighlights(result.matches.map(matchToHoverItem));
  });
  row.addEventListener("mouseleave", () => {
    publishVisibleHighlights();
  });

  keywordRowsEl.appendChild(row);
  updateRemoveButtons();
}

function pruneExpandedKeywords(results: CheckResult[]): void {
  const valid = new Set(results.map((r) => r.keyword));
  for (const keyword of [...expandedKeywords]) {
    if (!valid.has(keyword)) {
      expandedKeywords.delete(keyword);
    }
  }
}

function createResultPinButton(result: CheckResult): HTMLButtonElement {
  const pinBtn = document.createElement("button");
  pinBtn.type = "button";
  pinBtn.className = "result-pin";
  const pinned = pinnedKeywords.has(result.keyword);
  pinBtn.setAttribute("aria-pressed", pinned ? "true" : "false");
  pinBtn.classList.toggle("is-on", pinned);
  pinBtn.title = pinned ? "ハイライト固定を解除" : "ハイライトを固定";
  pinBtn.setAttribute("aria-label", pinBtn.title);
  pinBtn.innerHTML = pinIcon;
  pinBtn.disabled = result.count === 0;
  pinBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    if (result.count === 0) {
      return;
    }
    if (pinnedKeywords.has(result.keyword)) {
      pinnedKeywords.delete(result.keyword);
    } else {
      pinnedKeywords.add(result.keyword);
    }
    const nowPinned = pinnedKeywords.has(result.keyword);
    pinBtn.setAttribute("aria-pressed", nowPinned ? "true" : "false");
    pinBtn.classList.toggle("is-on", nowPinned);
    pinBtn.title = nowPinned ? "ハイライト固定を解除" : "ハイライトを固定";
    pinBtn.setAttribute("aria-label", pinBtn.title);
    publishVisibleHighlights();
  });
  return pinBtn;
}

function closeAllColorMenus(): void {
  document.querySelectorAll(".result-color-menu").forEach((el) => {
    (el as HTMLElement).hidden = true;
  });
  document.querySelectorAll(".result-color-trigger").forEach((el) => {
    el.setAttribute("aria-expanded", "false");
  });
}

document.addEventListener("pointerdown", (event) => {
  const target = event.target as Node | null;
  if (target && (target as Element).closest?.(".result-color")) {
    return;
  }
  closeAllColorMenus();
});

function setColorTriggerSwatch(
  trigger: HTMLButtonElement,
  color: HighlightColor
): void {
  const swatch = trigger.querySelector(".result-color-swatch") as HTMLElement | null;
  if (swatch) {
    swatch.style.background = HIGHLIGHT_COLOR_SWATCHES[color];
  }
  trigger.dataset.color = color;
}

function createResultColorSelect(result: CheckResult): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "result-color";

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "result-color-trigger";
  trigger.title = "ハイライト色";
  trigger.setAttribute("aria-label", "ハイライト色");
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  trigger.disabled = result.count === 0;

  const currentSwatch = document.createElement("span");
  currentSwatch.className = "result-color-swatch";
  trigger.appendChild(currentSwatch);

  const menu = document.createElement("div");
  menu.className = "result-color-menu";
  menu.hidden = true;
  menu.setAttribute("role", "listbox");

  const current = colorForKeyword(result.keyword);
  setColorTriggerSwatch(trigger, current);

  for (const color of HIGHLIGHT_COLOR_OPTIONS) {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "result-color-option";
    option.setAttribute("role", "option");
    option.dataset.color = color;
    option.title =
      color === "red"
        ? "赤"
        : color === "yellow"
          ? "黄"
          : color === "green"
            ? "緑"
            : "紫";
    option.setAttribute("aria-label", option.title);
    option.setAttribute(
      "aria-selected",
      color === current ? "true" : "false"
    );
    const swatch = document.createElement("span");
    swatch.className = "result-color-swatch";
    swatch.style.background = HIGHLIGHT_COLOR_SWATCHES[color];
    option.appendChild(swatch);
    if (color === current) {
      option.classList.add("is-selected");
    }
    option.addEventListener("click", (event) => {
      event.stopPropagation();
      applyKeywordColor(result.keyword, color);
      setColorTriggerSwatch(trigger, color);
      menu.querySelectorAll(".result-color-option").forEach((child) => {
        const btn = child as HTMLButtonElement;
        const selected = btn.dataset.color === color;
        btn.classList.toggle("is-selected", selected);
        btn.setAttribute("aria-selected", selected ? "true" : "false");
      });
      menu.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
    });
    menu.appendChild(option);
  }

  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    if (trigger.disabled) {
      return;
    }
    const willOpen = menu.hidden;
    closeAllColorMenus();
    if (willOpen) {
      menu.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
    }
  });

  wrap.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  wrap.append(trigger, menu);
  return wrap;
}

function renderResults(results: CheckResult[]): void {
  lastResults = results;
  pruneExpandedKeywords(results);
  resultsEl.innerHTML = "";

  if (results.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "まだチェック結果がありません";
    resultsEl.appendChild(li);
    return;
  }

  for (const result of results) {
    const li = document.createElement("li");
    li.className = "result-group";
    if (result.count === 0) {
      li.classList.add("is-empty");
    }

    const header = document.createElement("div");
    header.className = "result-header";

    const expandBtn = document.createElement("button");
    expandBtn.type = "button";
    expandBtn.className = "result-expand";
    expandBtn.setAttribute("aria-label", "詳細を開閉");
    const isExpanded =
      result.count > 0 && expandedKeywords.has(result.keyword);
    expandBtn.setAttribute("aria-expanded", isExpanded ? "true" : "false");
    expandBtn.disabled = result.count === 0;
    expandBtn.textContent = isExpanded ? "▾" : "▸";

    const status = document.createElement("span");
    status.className = `status ${result.count > 0 ? "ok" : "ng"}`;
    status.textContent = result.count > 0 ? "✓" : "✕";

    const keyword = document.createElement("button");
    keyword.type = "button";
    keyword.className = "keyword";
    keyword.textContent = result.keyword;
    keyword.title =
      result.count > 0
        ? "クリックで該当テキストへジャンプ"
        : "一致なし";
    keyword.disabled = result.count === 0;

    const count = document.createElement("button");
    count.type = "button";
    count.className = "count";
    count.textContent = `${result.count}件`;
    count.title =
      result.count > 0
        ? "クリックで該当テキストへジャンプ"
        : "一致なし";
    count.disabled = result.count === 0;

    header.append(
      expandBtn,
      status,
      keyword,
      count,
      createResultPinButton(result),
      createResultColorSelect(result)
    );

    const jumpAll = () => {
      if (result.count === 0) {
        return;
      }
      postToPlugin({ type: "FOCUS_RESULT", keyword: result.keyword });
    };

    keyword.addEventListener("click", jumpAll);
    count.addEventListener("click", jumpAll);

    expandBtn.addEventListener("click", () => {
      if (result.count === 0) {
        return;
      }
      if (expandedKeywords.has(result.keyword)) {
        expandedKeywords.delete(result.keyword);
      } else {
        expandedKeywords.add(result.keyword);
      }
      renderResults(lastResults);
    });

    if (result.count > 0) {
      header.addEventListener("mouseenter", () => {
        publishVisibleHighlights(result.matches.map(matchToHoverItem));
      });
      header.addEventListener("mouseleave", () => {
        publishVisibleHighlights();
      });
    }

    li.appendChild(header);

    if (isExpanded) {
      const matchList = document.createElement("ul");
      matchList.className = "match-list";

      for (const match of result.matches) {
        const matchItem = document.createElement("li");
        matchItem.className = "match-item";
        matchItem.title = "クリックでこのテキストへジャンプ";

        const name = document.createElement("span");
        name.className = "match-name";
        name.textContent = match.preview || result.keyword;
        name.title = match.nodeName;

        const preview = document.createElement("span");
        preview.className = "match-preview";
        preview.textContent = match.nodeName;

        matchItem.append(name, preview);

        matchItem.addEventListener("mouseenter", () => {
          publishVisibleHighlights([matchToHoverItem(match)]);
        });
        matchItem.addEventListener("mouseleave", () => {
          publishVisibleHighlights();
        });
        matchItem.addEventListener("click", () => {
          postToPlugin({ type: "FOCUS_NODE", nodeId: match.nodeId });
        });

        matchList.appendChild(matchItem);
      }

      li.appendChild(matchList);
    }

    resultsEl.appendChild(li);
  }
}

Array.from(
  document.querySelectorAll<HTMLInputElement>('input[name="mode"]')
).forEach((input) => {
  input.addEventListener("change", () => {
    if (!input.checked) {
      return;
    }
    const previousMode = mode;
    mode = input.value as SearchMode;
    updatePinRowVisibility();

    const nextPinnedNodeId =
      mode === "pinned"
        ? previousMode === "selection"
          ? undefined
          : pinnedNodeId
        : null;

    postToPlugin({
      type: "SET_MODE",
      mode,
      pinnedNodeId: nextPinnedNodeId,
    });
  });
});

pinInputEl.addEventListener("focus", () => {
  openPinList();
});

pinInputEl.addEventListener("input", () => {
  pinFilterQuery = pinInputEl.value;
  pinActiveIndex = 0;
  openPinList();
});

pinInputEl.addEventListener("keydown", (event) => {
  const filtered = filteredPinTargets();
  if (event.key === "ArrowDown") {
    event.preventDefault();
    if (!pinListOpen) {
      openPinList();
    }
    pinActiveIndex = Math.min(pinActiveIndex + 1, filtered.length - 1);
    if (pinActiveIndex < 0 && filtered.length > 0) {
      pinActiveIndex = 0;
    }
    renderPinList();
    return;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    pinActiveIndex = Math.max(pinActiveIndex - 1, 0);
    renderPinList();
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    if (pinActiveIndex >= 0 && filtered[pinActiveIndex]) {
      commitPinnedNode(filtered[pinActiveIndex].id);
    }
    return;
  }
  if (event.key === "Escape") {
    closePinList();
    setPinInputToSelection();
  }
});

pinInputEl.addEventListener("blur", () => {
  window.setTimeout(() => {
    if (!pinListEl.contains(document.activeElement)) {
      closePinList();
      setPinInputToSelection();
    }
  }, 0);
});

document.addEventListener("click", (event) => {
  const target = event.target as Node;
  if (!pinInline.contains(target)) {
    closePinList();
  }
});

addKeywordBtn.addEventListener("click", () => {
  addKeywordRow();
  const areas = keywordRowsEl.querySelectorAll("textarea");
  const last = areas[areas.length - 1];
  last?.focus();
});

function clearKeywords(): void {
  keywordRowsEl.innerHTML = "";
  addKeywordRow("");
  debounceSearch();
  const area = keywordRowsEl.querySelector("textarea");
  area?.focus();
}

clearKeywordsBtn.innerHTML = clearIcon;
resetSearchBtn.innerHTML = resetIcon;

clearKeywordsBtn.addEventListener("click", () => {
  clearKeywords();
});

resetSearchBtn.addEventListener("click", () => {
  if (searchTimer !== null) {
    clearTimeout(searchTimer);
    searchTimer = null;
  }
  runSearch();
});

let resizingUi = false;
let resizePointerId: number | null = null;

function clampUiHeightLocal(height: number): number {
  return Math.min(MAX_UI_HEIGHT, Math.max(MIN_UI_HEIGHT, Math.round(height)));
}

function endUiResize(event?: PointerEvent): void {
  if (!resizingUi) {
    return;
  }
  resizingUi = false;
  document.body.classList.remove("is-resizing");
  if (
    event &&
    resizePointerId !== null &&
    resizeHandle.hasPointerCapture(resizePointerId)
  ) {
    resizeHandle.releasePointerCapture(resizePointerId);
  }
  resizePointerId = null;
}

resizeHandle.addEventListener("pointerdown", (event) => {
  resizingUi = true;
  resizePointerId = event.pointerId;
  document.body.classList.add("is-resizing");
  resizeHandle.setPointerCapture(event.pointerId);
  event.preventDefault();
});

resizeHandle.addEventListener("pointermove", (event) => {
  if (!resizingUi) {
    return;
  }
  const next = clampUiHeightLocal(event.clientY);
  postToPlugin({ type: "RESIZE_UI", height: next });
});

resizeHandle.addEventListener("pointerup", (event) => {
  endUiResize(event);
});
resizeHandle.addEventListener("pointercancel", (event) => {
  endUiResize(event);
});
window.addEventListener("pointerup", () => {
  endUiResize();
});
window.addEventListener("pointercancel", () => {
  endUiResize();
});

window.onmessage = (event: MessageEvent) => {
  const msg = event.data?.pluginMessage as PluginToUiMessage | undefined;
  if (!msg) {
    return;
  }

  if (msg.type === "ERROR") {
    showError(msg.message);
    pinnedKeywords.clear();
    postToPlugin({ type: "CLEAR_HIGHLIGHT" });
    renderResults([]);
    return;
  }

  if (msg.type === "PIN_TARGETS") {
    pinTargets = msg.targets;
    pinnedNodeId = msg.pinnedNodeId;
    refreshPinCombobox();
    return;
  }

  if (msg.type === "SEARCH_RESULT") {
    showError(null);
    renderResults(msg.results);
    syncHighlightPrefsAfterSearch();
  }
};

updatePinRowVisibility();
addKeywordRow();
renderResults([]);
postToPlugin({ type: "LIST_PIN_TARGETS" });
