import "./ui.css";
import clearIcon from "./assets/clear.svg?raw";
import copyIcon from "./assets/copy.svg?raw";
import pinIcon from "./assets/pin.svg?raw";
import resetIcon from "./assets/reset.svg?raw";
import selectIcon from "./assets/select.svg?raw";
import sortIcon from "./assets/sort.svg?raw";
import {
  COMPARE_EXACT,
  COMPARE_ONLY_A,
  COMPARE_ONLY_B,
  COMPARE_PARTIAL,
} from "./compare";
import { parseIgnoreInput } from "./search";
import type { PluginToUiMessage, UiToPluginMessage } from "./messages";
import type {
  CheckResult,
  ComparePair,
  CompareSide,
  HighlightColor,
  HoverHighlightItem,
  IgnoreCategories,
  KeywordQuery,
  OcrItem,
  PinTarget,
  SearchMode,
  TextMatch,
  TextNodeLike,
} from "./types";
import { DEFAULT_IGNORE_CATEGORIES } from "./types";

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
const compareInline = document.getElementById(
  "compare-inline"
) as HTMLDivElement;
const comparePairsEl = document.getElementById(
  "compare-pairs"
) as HTMLDivElement;
const addComparePairBtn = document.getElementById(
  "add-compare-pair"
) as HTMLButtonElement;
const imageInline = document.getElementById("image-inline") as HTMLDivElement;
const imageNameEl = document.getElementById("image-name") as HTMLSpanElement;
const imageFromSelectionBtn = document.getElementById(
  "image-from-selection"
) as HTMLButtonElement;
const imageRowActionsEl = document.getElementById(
  "image-row-actions"
) as HTMLDivElement;
const imageTargetInputEl = document.getElementById(
  "image-target-input"
) as HTMLInputElement;
const imageTargetListEl = document.getElementById(
  "image-target-list"
) as HTMLUListElement;
const imageTargetFromSelectionBtn = document.getElementById(
  "image-target-from-selection"
) as HTMLButtonElement;
const ocrStatusEl = document.getElementById("ocr-status") as HTMLDivElement;
const ocrStatusTextEl = document.getElementById(
  "ocr-status-text"
) as HTMLSpanElement;
const pinFromSelectionBtn = document.getElementById(
  "pin-from-selection"
) as HTMLButtonElement;
const keywordsSection = document.getElementById(
  "keywords-section"
) as HTMLElement;
const keywordsDivider = document.getElementById(
  "keywords-divider"
) as HTMLHRElement;
const ignoreStringsEl = document.getElementById(
  "ignore-strings"
) as HTMLInputElement;
const ignoreToggleBtn = document.getElementById(
  "ignore-toggle"
) as HTMLButtonElement;
const ignorePopoverEl = document.getElementById(
  "ignore-popover"
) as HTMLDivElement;
const ignoreEmojiEl = document.getElementById(
  "ignore-emoji"
) as HTMLInputElement;
const ignoreKinsokuEl = document.getElementById(
  "ignore-kinsoku"
) as HTMLInputElement;
const ignoreSymbolEl = document.getElementById(
  "ignore-symbol"
) as HTMLInputElement;
const ignorePunctEl = document.getElementById(
  "ignore-punct"
) as HTMLInputElement;
const ignoreNewlinesEl = document.getElementById(
  "ignore-newlines"
) as HTMLInputElement;
const ignoreWhitespaceEl = document.getElementById(
  "ignore-whitespace"
) as HTMLInputElement;
const keywordRowsEl = document.getElementById("keyword-rows") as HTMLDivElement;
const addKeywordBtn = document.getElementById("add-keyword") as HTMLButtonElement;
const clearAllBtn = document.getElementById("clear-all") as HTMLButtonElement;
const resetSearchBtn = document.getElementById(
  "reset-search"
) as HTMLButtonElement;
const resultsEl = document.getElementById("results") as HTMLUListElement;
const errorEl = document.getElementById("error") as HTMLParagraphElement;
const resizeHandle = document.getElementById("resize-handle") as HTMLDivElement;

interface ComparePairUi {
  idA: string | null;
  idB: string | null;
  filterA: string;
  filterB: string;
  listOpenA: boolean;
  listOpenB: boolean;
  activeIndexA: number;
  activeIndexB: number;
}

function emptyPairUi(): ComparePairUi {
  return {
    idA: null,
    idB: null,
    filterA: "",
    filterB: "",
    listOpenA: false,
    listOpenB: false,
    activeIndexA: -1,
    activeIndexB: -1,
  };
}

let mode: SearchMode = "pinned";
let pinTargets: PinTarget[] = [];
let pinnedNodeId: string | null = null;
let compareTargets: PinTarget[] = [];
let comparePairs: ComparePairUi[] = [emptyPairUi()];
let imageTargets: PinTarget[] = [];
let imageTargetId: string | null = null;
let imageFilterQuery = "";
let imageListOpen = false;
let imageActiveIndex = -1;
let imageNodeId: string | null = null;
let imageNodeName = "";
let imageExportScale = 1;
let ocrItems: OcrItem[] = [];
let ocrBusy = false;
let ocrModelUrls: { detUrl: string; recUrl: string } | null = null;
/** When true, compare results are showing (OCR image highlights paused). */
let imageCompareActive = false;
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
let suppressCompareSync = false;

function postToPlugin(message: UiToPluginMessage): void {
  parent.postMessage({ pluginMessage: message }, "*");
}

function matchToHoverItem(match: TextMatch): HoverHighlightItem {
  if (match.nodeId.startsWith("ocr:") && imageNodeId) {
    const ocrItem = ocrItems.find((item) => item.id === match.nodeId);
    if (ocrItem && ocrItem.poly.length > 0) {
      return {
        nodeId: imageNodeId,
        style: match.exact ? "component" : "instance",
        exact: match.exact,
        ranges: [],
        ocrRegion: {
          id: ocrItem.id,
          exportScale: imageExportScale,
          poly: ocrItem.poly,
        },
      };
    }
  }
  return {
    nodeId: match.nodeId,
    style: match.exact ? "component" : "instance",
    exact: match.exact,
    ranges: match.ranges,
  };
}

function resultKey(result: CheckResult, parentKey?: string): string {
  return parentKey ? `${parentKey}::${result.keyword}` : result.keyword;
}

function findResultByKey(
  results: CheckResult[],
  key: string,
  parentKey?: string
): CheckResult | null {
  for (const result of results) {
    const keyForResult = resultKey(result, parentKey);
    if (keyForResult === key) {
      return result;
    }
    if (result.children) {
      const nested = findResultByKey(result.children, key, keyForResult);
      if (nested) {
        return nested;
      }
    }
  }
  return null;
}

function collectResultMatches(result: CheckResult): TextMatch[] {
  if (result.children && result.children.length > 0) {
    return result.children.flatMap(collectResultMatches);
  }
  return result.matches;
}

function collectResultKeys(
  results: CheckResult[],
  parentKey?: string
): string[] {
  const keys: string[] = [];
  for (const result of results) {
    const key = resultKey(result, parentKey);
    keys.push(key);
    if (result.children) {
      keys.push(...collectResultKeys(result.children, key));
    }
  }
  return keys;
}

function walkResults(
  results: CheckResult[],
  visit: (result: CheckResult, key: string) => void,
  parentKey?: string
): void {
  for (const result of results) {
    const key = resultKey(result, parentKey);
    visit(result, key);
    if (result.children) {
      walkResults(result.children, visit, key);
    }
  }
}

function itemsForKeyword(keyword: string): HoverHighlightItem[] {
  const result = findResultByKey(lastResults, keyword);
  if (!result || result.count === 0) {
    return [];
  }
  return collectResultMatches(result).map(matchToHoverItem);
}

function collectPinnedItems(): HoverHighlightItem[] {
  const items: HoverHighlightItem[] = [];
  for (const keyword of pinnedKeywords) {
    items.push(...itemsForKeyword(keyword));
  }
  return items;
}

function hoverItemKey(item: HoverHighlightItem): string {
  if (item.ocrRegion) {
    const id = item.ocrRegion.id;
    return id.startsWith("ocr:") ? id : `ocr:${id}`;
  }
  const range = item.ranges[0];
  if (range) {
    return `${item.nodeId}:${range.start}:${range.end}`;
  }
  return `${item.nodeId}:exact`;
}

function publishVisibleHighlights(extraItems: HoverHighlightItem[] = []): void {
  const byKey = new Map<string, HoverHighlightItem>();
  for (const item of [...collectPinnedItems(), ...extraItems]) {
    byKey.set(hoverItemKey(item), item);
  }
  const items = [...byKey.values()];
  if (items.length === 0) {
    postToPlugin({ type: "CLEAR_HIGHLIGHT" });
    return;
  }
  postToPlugin({ type: "HOVER_HIGHLIGHT", items });
}

function defaultColorForResult(result: CheckResult): HighlightColor {
  if (result.keyword === COMPARE_ONLY_A || result.keyword === COMPARE_ONLY_B) {
    return "red";
  }
  if (result.keyword === COMPARE_EXACT) {
    return "green";
  }
  if (result.keyword === COMPARE_PARTIAL) {
    return "yellow";
  }
  if (result.matches.length > 0 && result.matches.every((m) => m.side)) {
    if (result.matches.every((m) => m.exact)) {
      return "green";
    }
    if (result.matches.every((m) => !m.exact)) {
      return "yellow";
    }
  }
  return DEFAULT_HIGHLIGHT_COLOR;
}

function colorForResult(result: CheckResult, key: string): HighlightColor {
  return keywordColors.get(key) ?? defaultColorForResult(result);
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
  const valid = new Set(collectResultKeys(lastResults));
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
  walkResults(lastResults, (result, key) => {
    if (result.count === 0) {
      return;
    }
    applyKeywordColor(key, colorForResult(result, key));
  });
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
  const ignoreNewlines = collectIgnoreCategories().newlines;
  const queries: KeywordQuery[] = [];
  keywordRowsEl.querySelectorAll(".keyword-row").forEach((row) => {
    const area = row.querySelector("textarea");
    if (!area) {
      return;
    }
    const value = area.value.trim();
    if (value.length === 0) {
      return;
    }
    queries.push({
      keyword: value,
      ignoreNewlines,
    });
  });
  return queries;
}

function collectIgnoreStrings(): string[] {
  return parseIgnoreInput(ignoreStringsEl.value);
}

function collectIgnoreCategories(): IgnoreCategories {
  return {
    emoji: ignoreEmojiEl.checked,
    kinsoku: ignoreKinsokuEl.checked,
    symbol: ignoreSymbolEl.checked,
    punct: ignorePunctEl.checked,
    newlines: ignoreNewlinesEl.checked,
    whitespace: ignoreWhitespaceEl.checked,
  };
}

function ocrTextsPayload(): TextNodeLike[] {
  return ocrItems.map((item) => ({ id: item.id, characters: item.text }));
}

function setOcrStatus(
  message: string | null,
  options: { busy?: boolean } = {}
): void {
  if (!message) {
    ocrStatusEl.hidden = true;
    ocrStatusEl.classList.remove("is-busy");
    ocrStatusTextEl.textContent = "";
    return;
  }
  ocrStatusEl.hidden = false;
  ocrStatusTextEl.textContent = message;
  ocrStatusEl.classList.toggle("is-busy", Boolean(options.busy));
}

function setImageControlsDisabled(disabled: boolean): void {
  imageFromSelectionBtn.disabled = disabled;
  imageTargetFromSelectionBtn.disabled = disabled;
  imageTargetInputEl.disabled = disabled;
  const menuTrigger = imageRowActionsEl.querySelector(
    ".row-menu-trigger"
  ) as HTMLButtonElement | null;
  if (menuTrigger) {
    menuTrigger.disabled = disabled;
  }
}

function ocrToHighlightItems(items: OcrItem[] = ocrItems): HoverHighlightItem[] {
  if (!imageNodeId) {
    return [];
  }
  return items
    .filter((item) => item.poly.length > 0)
    .map((item) => ({
      nodeId: imageNodeId!,
      style: "component" as const,
      exact: true,
      ranges: [],
      ocrRegion: {
        id: item.id,
        exportScale: imageExportScale,
        poly: item.poly,
      },
    }));
}

function publishOcrHighlights(items?: HoverHighlightItem[]): void {
  if (imageCompareActive) {
    return;
  }
  const list = items ?? ocrToHighlightItems();
  if (list.length === 0) {
    postToPlugin({ type: "CLEAR_HIGHLIGHT" });
    return;
  }
  postToPlugin({ type: "HOVER_HIGHLIGHT", items: list });
}

function buildAndShowOcrHighlights(): void {
  if (imageCompareActive || !imageNodeId || ocrItems.length === 0) {
    return;
  }
  const items = ocrToHighlightItems();
  if (items.length === 0) {
    postToPlugin({ type: "CLEAR_HIGHLIGHT" });
    return;
  }
  postToPlugin({ type: "BUILD_HIGHLIGHT_POOL", items });
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.left = "-9999px";
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    document.body.removeChild(area);
  }
}

function renderOcrList(): void {
  resultsEl.innerHTML = "";
  if (ocrBusy) {
    const li = document.createElement("li");
    li.className = "empty is-loading";
    li.textContent = "読み込み中…";
    resultsEl.appendChild(li);
    return;
  }
  if (ocrItems.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = imageNodeId
      ? "テキストを検出できませんでした"
      : "まだチェック結果がありません";
    resultsEl.appendChild(li);
    return;
  }

  for (const item of ocrItems) {
    const li = document.createElement("li");
    li.className = "ocr-item";
    li.dataset.ocrId = item.id;

    const textEl = document.createElement("div");
    textEl.className = "ocr-item-text";
    textEl.textContent = item.text;

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "ocr-copy-btn";
    copyBtn.title = "コピー";
    copyBtn.setAttribute("aria-label", "コピー");
    copyBtn.innerHTML = copyIcon;
    copyBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      void copyText(item.text);
    });

    li.addEventListener("mouseenter", () => {
      publishOcrHighlights(ocrToHighlightItems([item]));
    });
    li.addEventListener("mouseleave", () => {
      publishOcrHighlights();
    });
    li.addEventListener("click", () => {
      if (imageNodeId) {
        postToPlugin({ type: "FOCUS_NODE", nodeId: imageNodeId });
      }
    });

    li.appendChild(textEl);
    li.appendChild(copyBtn);
    resultsEl.appendChild(li);
  }
}

function clearImageLocal(notifyPlugin = true): void {
  imageNodeId = null;
  imageNodeName = "";
  imageExportScale = 1;
  imageNameEl.textContent = "画像未選択";
  ocrItems = [];
  imageCompareActive = false;
  setOcrStatus(null);
  if (notifyPlugin) {
    postToPlugin({ type: "CLEAR_IMAGE" });
  }
  if (mode === "image") {
    renderOcrList();
    postToPlugin({ type: "CLEAR_HIGHLIGHT" });
  }
}

function clearImageMode(): void {
  clearImageLocal(true);
  commitImageTarget(null);
  showError(null);
}

async function ensureOcrModels(): Promise<{ detUrl: string; recUrl: string }> {
  if (ocrModelUrls) {
    return ocrModelUrls;
  }
  setOcrStatus("OCR モデルを取得しています…", { busy: true });
  const { loadOcrModelUrls } = await import("./ocr/paddle");
  ocrModelUrls = await loadOcrModelUrls();
  return ocrModelUrls;
}

async function processExportedImage(
  bytes: number[],
  nodeId: string,
  name: string,
  exportScale: number
): Promise<void> {
  clearImageLocal(false);
  imageNodeId = nodeId;
  imageNodeName = name;
  imageExportScale = exportScale > 0 ? exportScale : 1;
  imageNameEl.textContent = name || "(untitled)";

  const blob = new Blob([new Uint8Array(bytes)], { type: "image/png" });

  ocrBusy = true;
  imageCompareActive = false;
  setImageControlsDisabled(true);
  setOcrStatus("OCR を準備しています…", { busy: true });
  renderOcrList();
  showError(null);
  try {
    const models = await ensureOcrModels();
    const { getOcrEngine, runOcr } = await import("./ocr/paddle");
    setOcrStatus("OCR エンジンを読み込んでいます…", { busy: true });
    await getOcrEngine(models);
    setOcrStatus("テキストを抽出しています…", { busy: true });
    ocrItems = await runOcr(blob, models);
    setOcrStatus(
      ocrItems.length > 0
        ? `${ocrItems.length} 件のテキストを抽出しました`
        : "テキストを検出できませんでした",
      { busy: false }
    );
    if (imageTargetId) {
      runImageCompare();
    } else {
      renderOcrList();
      buildAndShowOcrHighlights();
    }
  } catch (err) {
    const { formatUnknownError } = await import("./ocr/paddle");
    showError(`OCR に失敗しました: ${formatUnknownError(err)}`);
    setOcrStatus(null);
    ocrItems = [];
    renderOcrList();
  } finally {
    ocrBusy = false;
    setImageControlsDisabled(false);
    if (ocrItems.length > 0 && !imageTargetId) {
      renderOcrList();
    }
  }
}

function runImageCompare(): void {
  if (!imageTargetId || ocrItems.length === 0) {
    imageCompareActive = false;
    renderOcrList();
    buildAndShowOcrHighlights();
    return;
  }
  if (!imageNodeId) {
    showError("画像が未選択です");
    return;
  }
  imageCompareActive = true;
  showError(null);
  postToPlugin({
    type: "RUN_IMAGE_COMPARE",
    ocrTexts: ocrTextsPayload(),
    imageNodeId,
    exportScale: imageExportScale,
    ocrRegions: ocrItems.map((item) => ({
      id: item.id,
      poly: item.poly,
    })),
    ignoreStrings: collectIgnoreStrings(),
    ignoreCategories: collectIgnoreCategories(),
  });
}

function getImageTarget(): PinTarget | null {
  if (!imageTargetId) {
    return null;
  }
  return imageTargets.find((t) => t.id === imageTargetId) ?? null;
}

function filteredImageTargets(): PinTarget[] {
  const query = imageFilterQuery.trim().toLowerCase();
  if (!query) {
    return imageTargets;
  }
  return imageTargets.filter((target) => {
    return (
      target.label.toLowerCase().includes(query) ||
      target.name.toLowerCase().includes(query)
    );
  });
}

function setImageTargetInputToSelection(): void {
  const selected = getImageTarget();
  imageFilterQuery = "";
  imageTargetInputEl.value = selected ? selected.label : "";
}

function closeImageTargetList(): void {
  imageListOpen = false;
  imageActiveIndex = -1;
  imageTargetListEl.hidden = true;
  imageTargetInputEl.setAttribute("aria-expanded", "false");
}

function renderImageTargetList(): void {
  const filtered = filteredImageTargets();
  imageTargetListEl.innerHTML = "";
  filtered.forEach((target, index) => {
    const li = document.createElement("li");
    li.className = "pin-combobox-option";
    li.setAttribute("role", "option");
    li.dataset.id = target.id;
    li.textContent = target.label;
    if (target.id === imageTargetId) {
      li.classList.add("is-selected");
    }
    if (index === imageActiveIndex) {
      li.classList.add("is-active");
    }
    li.addEventListener("mousedown", (event) => {
      event.preventDefault();
      commitImageTarget(target.id);
    });
    imageTargetListEl.appendChild(li);
  });
}

function openImageTargetList(): void {
  closePinList();
  closeAllCompareLists();
  imageListOpen = true;
  imageTargetListEl.hidden = false;
  imageTargetInputEl.setAttribute("aria-expanded", "true");
  renderImageTargetList();
}

function commitImageTarget(nextId: string | null): void {
  imageTargetId = nextId;
  setImageTargetInputToSelection();
  closeImageTargetList();
  postToPlugin({ type: "SET_IMAGE_COMPARE_TARGET", targetId: imageTargetId });
  if (mode === "image") {
    if (imageTargetId && ocrItems.length > 0) {
      runImageCompare();
    } else {
      imageCompareActive = false;
      renderOcrList();
      buildAndShowOcrHighlights();
    }
  }
}

function runSearch(): void {
  showError(null);
  const ignoreStrings = collectIgnoreStrings();
  const ignoreCategories = collectIgnoreCategories();
  if (mode === "compare") {
    postToPlugin({ type: "RUN_COMPARE", ignoreStrings, ignoreCategories });
    return;
  }
  if (mode === "image") {
    if (imageTargetId && ocrItems.length > 0) {
      runImageCompare();
    } else if (imageNodeId) {
      renderOcrList();
    } else {
      postToPlugin({ type: "EXPORT_IMAGE_FROM_SELECTION" });
    }
    return;
  }
  const queries = collectQueries();
  if (queries.length === 0) {
    renderResults([]);
    postToPlugin({ type: "CLEAR_HIGHLIGHT" });
    postToPlugin({
      type: "SEARCH",
      queries: [],
      ignoreStrings,
      ignoreCategories,
    });
    return;
  }

  postToPlugin({ type: "SEARCH", queries, ignoreStrings, ignoreCategories });
}

function updateScopeVisibility(): void {
  pinInline.hidden = mode !== "pinned";
  compareInline.hidden = mode !== "compare";
  imageInline.hidden = mode !== "image";
  const hideKeywords = mode === "compare" || mode === "image";
  keywordsSection.hidden = hideKeywords;
  keywordsDivider.hidden = hideKeywords;
  if (mode === "image" && !(imageTargetId && ocrItems.length > 0)) {
    renderOcrList();
  }
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
  closeAllCompareLists();
  closeImageTargetList();
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

function pairsToPayload(): ComparePair[] {
  return comparePairs.map((p) => ({ idA: p.idA, idB: p.idB }));
}

function syncComparePairsToPlugin(): void {
  if (suppressCompareSync) {
    return;
  }
  postToPlugin({ type: "SET_COMPARE_PAIRS", pairs: pairsToPayload() });
}

function getCompareTarget(pair: ComparePairUi, side: CompareSide): PinTarget | null {
  const id = side === "A" ? pair.idA : pair.idB;
  if (!id) {
    return null;
  }
  return compareTargets.find((t) => t.id === id) ?? null;
}

function filteredCompareTargets(pair: ComparePairUi, side: CompareSide): PinTarget[] {
  const query = (side === "A" ? pair.filterA : pair.filterB).trim().toLowerCase();
  if (!query) {
    return compareTargets;
  }
  return compareTargets.filter((target) => {
    return (
      target.label.toLowerCase().includes(query) ||
      target.name.toLowerCase().includes(query)
    );
  });
}

function closeAllCompareLists(): void {
  for (const pair of comparePairs) {
    pair.listOpenA = false;
    pair.listOpenB = false;
    pair.activeIndexA = -1;
    pair.activeIndexB = -1;
  }
  comparePairsEl
    .querySelectorAll<HTMLUListElement>(".pin-combobox-list")
    .forEach((list) => {
      list.hidden = true;
    });
  comparePairsEl
    .querySelectorAll<HTMLInputElement>(".pin-combobox-input")
    .forEach((input) => {
      input.setAttribute("aria-expanded", "false");
    });
}

function commitCompareNode(
  index: number,
  side: CompareSide,
  nextId: string | null
): void {
  const pair = comparePairs[index];
  if (!pair) {
    return;
  }
  if (side === "A") {
    pair.idA = nextId;
    pair.filterA = "";
  } else {
    pair.idB = nextId;
    pair.filterB = "";
  }
  renderComparePairs();
  postToPlugin({
    type: "SET_COMPARE_PAIR",
    index,
    side,
    nodeId: nextId,
  });
}

function createCompareSide(
  index: number,
  side: CompareSide
): HTMLDivElement {
  const pair = comparePairs[index];
  const sideEl = document.createElement("div");
  sideEl.className = "compare-side";

  const top = document.createElement("div");
  top.className = "compare-side-top";

  const label = document.createElement("span");
  label.className = "compare-side-label";
  label.textContent = side;

  const combobox = document.createElement("div");
  combobox.className = "pin-combobox";

  const listId = `compare-${side.toLowerCase()}-list-${index}`;
  const input = document.createElement("input");
  input.className = "pin-combobox-input";
  input.type = "text";
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", listId);
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-label", `比較 ${side}`);
  input.placeholder = "Section / Frame";
  input.autocomplete = "off";
  const selected = getCompareTarget(pair, side);
  input.value = selected ? selected.label : "";

  const list = document.createElement("ul");
  list.id = listId;
  list.className = "pin-combobox-list";
  list.setAttribute("role", "listbox");
  list.hidden = true;

  const fromSelectionBtn = document.createElement("button");
  fromSelectionBtn.type = "button";
  fromSelectionBtn.className = "btn-icon";
  fromSelectionBtn.title = `選択を ${side} に`;
  fromSelectionBtn.setAttribute("aria-label", fromSelectionBtn.title);
  fromSelectionBtn.innerHTML = selectIcon;
  fromSelectionBtn.addEventListener("click", () => {
    postToPlugin({
      type: "SET_COMPARE_FROM_SELECTION",
      index,
      side,
    });
  });

  function renderList(): void {
    list.replaceChildren();
    const listOpen = side === "A" ? pair.listOpenA : pair.listOpenB;
    let activeIndex = side === "A" ? pair.activeIndexA : pair.activeIndexB;
    if (!listOpen) {
      return;
    }
    if (compareTargets.length === 0) {
      const empty = document.createElement("li");
      empty.className = "pin-combobox-empty";
      empty.textContent = "候補がありません";
      list.append(empty);
      return;
    }
    const filtered = filteredCompareTargets(pair, side);
    if (filtered.length === 0) {
      const empty = document.createElement("li");
      empty.className = "pin-combobox-empty";
      empty.textContent = "該当なし";
      list.append(empty);
      if (side === "A") {
        pair.activeIndexA = -1;
      } else {
        pair.activeIndexB = -1;
      }
      return;
    }
    if (activeIndex >= filtered.length) {
      activeIndex = filtered.length - 1;
      if (side === "A") {
        pair.activeIndexA = activeIndex;
      } else {
        pair.activeIndexB = activeIndex;
      }
    }
    const selectedId = side === "A" ? pair.idA : pair.idB;
    filtered.forEach((target, optIndex) => {
      const item = document.createElement("li");
      item.setAttribute("role", "option");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "pin-combobox-option";
      if (target.id === selectedId) {
        button.classList.add("is-selected");
      }
      if (optIndex === activeIndex) {
        button.classList.add("is-active");
      }
      button.textContent = target.label;
      button.title = target.label;
      button.addEventListener("mousedown", (event) => {
        event.preventDefault();
      });
      button.addEventListener("click", () => {
        commitCompareNode(index, side, target.id);
      });
      item.append(button);
      list.append(item);
    });
  }

  function openList(): void {
    closePinList();
    for (let i = 0; i < comparePairs.length; i++) {
      const other = comparePairs[i];
      if (i === index) {
        if (side === "A") {
          other.listOpenB = false;
          other.activeIndexB = -1;
        } else {
          other.listOpenA = false;
          other.activeIndexA = -1;
        }
      } else {
        other.listOpenA = false;
        other.listOpenB = false;
        other.activeIndexA = -1;
        other.activeIndexB = -1;
      }
    }
    comparePairsEl
      .querySelectorAll<HTMLUListElement>(".pin-combobox-list")
      .forEach((el) => {
        el.hidden = true;
      });
    comparePairsEl
      .querySelectorAll<HTMLInputElement>(".pin-combobox-input")
      .forEach((el) => {
        el.setAttribute("aria-expanded", "false");
      });
    if (side === "A") {
      pair.listOpenA = true;
    } else {
      pair.listOpenB = true;
    }
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    renderList();
  }

  function closeList(): void {
    if (side === "A") {
      pair.listOpenA = false;
      pair.activeIndexA = -1;
    } else {
      pair.listOpenB = false;
      pair.activeIndexB = -1;
    }
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
  }

  input.addEventListener("focus", () => {
    openList();
  });
  input.addEventListener("input", () => {
    if (side === "A") {
      pair.filterA = input.value;
      pair.activeIndexA = 0;
    } else {
      pair.filterB = input.value;
      pair.activeIndexB = 0;
    }
    openList();
  });
  input.addEventListener("keydown", (event) => {
    const filtered = filteredCompareTargets(pair, side);
    const activeIndex = side === "A" ? pair.activeIndexA : pair.activeIndexB;
    const listOpen = side === "A" ? pair.listOpenA : pair.listOpenB;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!listOpen) {
        openList();
      }
      const next = Math.min(activeIndex + 1, filtered.length - 1);
      if (side === "A") {
        pair.activeIndexA = next < 0 && filtered.length > 0 ? 0 : next;
      } else {
        pair.activeIndexB = next < 0 && filtered.length > 0 ? 0 : next;
      }
      renderList();
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      const next = Math.max(activeIndex - 1, 0);
      if (side === "A") {
        pair.activeIndexA = next;
      } else {
        pair.activeIndexB = next;
      }
      renderList();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (activeIndex >= 0 && filtered[activeIndex]) {
        commitCompareNode(index, side, filtered[activeIndex].id);
      }
      return;
    }
    if (event.key === "Escape") {
      closeList();
      const selectedTarget = getCompareTarget(pair, side);
      input.value = selectedTarget ? selectedTarget.label : "";
    }
  });
  input.addEventListener("blur", () => {
    window.setTimeout(() => {
      closeList();
      const selectedTarget = getCompareTarget(pair, side);
      input.value = selectedTarget ? selectedTarget.label : "";
    }, 120);
  });

  combobox.append(input, list);
  top.append(label, combobox, fromSelectionBtn);
  sideEl.append(top);
  return sideEl;
}

function renderComparePairs(): void {
  comparePairsEl.replaceChildren();
  comparePairs.forEach((pair, index) => {
    const row = document.createElement("div");
    row.className = "compare-pair-row";

    const sides = document.createElement("div");
    sides.className = "compare-pair-sides";
    sides.append(createCompareSide(index, "A"), createCompareSide(index, "B"));

    const actions = document.createElement("div");
    actions.className = "compare-pair-actions";
    actions.append(
      createRowMenu({
        onClear: () => {
          pair.idA = null;
          pair.idB = null;
          pair.filterA = "";
          pair.filterB = "";
          renderComparePairs();
          syncComparePairsToPlugin();
        },
        onRemove: () => {
          if (comparePairs.length <= 1) {
            return;
          }
          comparePairs.splice(index, 1);
          renderComparePairs();
          syncComparePairsToPlugin();
        },
        canRemove: () => comparePairs.length > 1,
      })
    );
    row.append(sides, actions);
    comparePairsEl.append(row);
  });
}

function refreshComparePairsFromState(): void {
  for (const pair of comparePairs) {
    if (pair.idA && !compareTargets.some((t) => t.id === pair.idA)) {
      pair.idA = null;
    }
    if (pair.idB && !compareTargets.some((t) => t.id === pair.idB)) {
      pair.idB = null;
    }
  }
  if (comparePairs.length === 0) {
    comparePairs = [emptyPairUi()];
  }
  renderComparePairs();
}

function addComparePair(): void {
  comparePairs.push(emptyPairUi());
  renderComparePairs();
  syncComparePairsToPlugin();
}

function clearComparePairs(): void {
  comparePairs = [emptyPairUi()];
  renderComparePairs();
  syncComparePairsToPlugin();
  renderResults([]);
  postToPlugin({ type: "CLEAR_HIGHLIGHT" });
  showError(null);
}

function closeAllRowMenus(except?: HTMLElement): void {
  document.querySelectorAll<HTMLElement>(".row-menu-panel").forEach((panel) => {
    if (except && panel === except) {
      return;
    }
    panel.hidden = true;
    const trigger = panel
      .closest(".row-menu")
      ?.querySelector(".row-menu-trigger");
    trigger?.setAttribute("aria-expanded", "false");
  });
}

function createRowMenu(options: {
  onClear: () => void;
  onRemove: () => void;
  canRemove: () => boolean;
}): HTMLDivElement {
  const menu = document.createElement("div");
  menu.className = "row-menu";

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "btn-icon row-menu-trigger";
  trigger.title = "行メニュー";
  trigger.setAttribute("aria-label", "行メニュー");
  trigger.setAttribute("aria-haspopup", "menu");
  trigger.setAttribute("aria-expanded", "false");
  trigger.textContent = "⋯";

  const panel = document.createElement("div");
  panel.className = "row-menu-panel";
  panel.hidden = true;
  panel.setAttribute("role", "menu");

  const clearItem = document.createElement("button");
  clearItem.type = "button";
  clearItem.className = "row-menu-item";
  clearItem.setAttribute("role", "menuitem");
  clearItem.textContent = "クリア";
  clearItem.addEventListener("click", (event) => {
    event.stopPropagation();
    closeAllRowMenus();
    options.onClear();
  });

  const removeItem = document.createElement("button");
  removeItem.type = "button";
  removeItem.className = "row-menu-item row-menu-remove";
  removeItem.setAttribute("role", "menuitem");
  removeItem.textContent = "削除";
  removeItem.disabled = !options.canRemove();
  removeItem.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!options.canRemove()) {
      return;
    }
    closeAllRowMenus();
    options.onRemove();
  });

  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    const willOpen = panel.hidden;
    closeAllRowMenus();
    setIgnorePopoverOpen(false);
    if (willOpen) {
      removeItem.disabled = !options.canRemove();
      panel.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
    }
  });

  panel.append(clearItem, removeItem);
  menu.append(trigger, panel);
  return menu;
}

function updateRemoveButtons(): void {
  const rows = keywordRowsEl.querySelectorAll(".keyword-row");
  const canRemove = rows.length > 1;
  rows.forEach((row) => {
    const removeItem = row.querySelector(
      ".row-menu-remove"
    ) as HTMLButtonElement | null;
    if (removeItem) {
      removeItem.disabled = !canRemove;
    }
  });
}

function addKeywordRow(initialValue = ""): void {
  const row = document.createElement("div");
  row.className = "keyword-row";

  const textarea = document.createElement("textarea");
  textarea.rows = 1;
  textarea.placeholder = "検索する文字列";
  textarea.value = initialValue;
  textarea.addEventListener("input", () => debounceSearch());

  const actions = document.createElement("div");
  actions.className = "keyword-row-actions";
  actions.append(
    createRowMenu({
      onClear: () => {
        textarea.value = "";
        textarea.focus();
        debounceSearch();
      },
      onRemove: () => {
        const rows = keywordRowsEl.querySelectorAll(".keyword-row");
        if (rows.length <= 1) {
          return;
        }
        row.remove();
        updateRemoveButtons();
        debounceSearch();
      },
      canRemove: () =>
        keywordRowsEl.querySelectorAll(".keyword-row").length > 1,
    })
  );
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
  const valid = new Set(collectResultKeys(results));
  for (const keyword of [...expandedKeywords]) {
    if (!valid.has(keyword)) {
      expandedKeywords.delete(keyword);
    }
  }
}

function createResultPinButton(
  result: CheckResult,
  key: string
): HTMLButtonElement {
  const pinBtn = document.createElement("button");
  pinBtn.type = "button";
  pinBtn.className = "result-pin";
  const pinned = pinnedKeywords.has(key);
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
    if (pinnedKeywords.has(key)) {
      pinnedKeywords.delete(key);
    } else {
      pinnedKeywords.add(key);
    }
    const nowPinned = pinnedKeywords.has(key);
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

function createResultColorSelect(
  result: CheckResult,
  key: string
): HTMLDivElement {
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

  const current = colorForResult(result, key);
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
      applyKeywordColor(key, color);
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

function createMatchList(result: CheckResult): HTMLUListElement {
  const matchList = document.createElement("ul");
  matchList.className = "match-list";

  for (const match of result.matches) {
    const matchItem = document.createElement("li");
    matchItem.className = "match-item";
    matchItem.title = "クリックでこのテキストへジャンプ";

    const head = document.createElement("div");
    head.className = "match-item-head";

    if (match.side) {
      const side = document.createElement("span");
      side.className = "match-side";
      side.textContent = match.side;
      head.append(side);
    }

    const name = document.createElement("span");
    name.className = "match-name";
    name.textContent = match.preview || result.keyword;
    name.title = match.nodeName;
    head.append(name);

    const preview = document.createElement("span");
    preview.className = "match-preview";
    preview.textContent = match.nodeName;

    matchItem.append(head, preview);

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

  return matchList;
}

function createResultGroup(
  result: CheckResult,
  parentKey?: string
): HTMLLIElement {
  const key = resultKey(result, parentKey);
  const li = document.createElement("li");
  li.className = "result-group";
  if (result.count === 0) {
    li.classList.add("is-empty");
  }
  if (parentKey) {
    li.classList.add("is-nested");
  }

  const header = document.createElement("div");
  header.className = "result-header";

  const expandBtn = document.createElement("button");
  expandBtn.type = "button";
  expandBtn.className = "result-expand";
  expandBtn.setAttribute("aria-label", "詳細を開閉");
  const isExpanded = result.count > 0 && expandedKeywords.has(key);
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
    result.count > 0 ? "クリックで該当テキストへジャンプ" : "一致なし";
  keyword.disabled = result.count === 0;

  const count = document.createElement("button");
  count.type = "button";
  count.className = "count";
  count.textContent = `${result.count}件`;
  count.title =
    result.count > 0 ? "クリックで該当テキストへジャンプ" : "一致なし";
  count.disabled = result.count === 0;

  header.append(
    expandBtn,
    status,
    keyword,
    count,
    createResultPinButton(result, key),
    createResultColorSelect(result, key)
  );

  const jumpAll = () => {
    if (result.count === 0) {
      return;
    }
    postToPlugin({ type: "FOCUS_RESULT", keyword: key });
  };

  keyword.addEventListener("click", jumpAll);
  count.addEventListener("click", jumpAll);

  expandBtn.addEventListener("click", () => {
    if (result.count === 0) {
      return;
    }
    if (expandedKeywords.has(key)) {
      expandedKeywords.delete(key);
    } else {
      expandedKeywords.add(key);
    }
    renderResults(lastResults);
  });

  if (result.count > 0) {
    header.addEventListener("mouseenter", () => {
      publishVisibleHighlights(
        collectResultMatches(result).map(matchToHoverItem)
      );
    });
    header.addEventListener("mouseleave", () => {
      publishVisibleHighlights();
    });
  }

  li.appendChild(header);

  if (isExpanded) {
    if (result.children && result.children.length > 0) {
      const childList = document.createElement("ul");
      childList.className = "result-children";
      for (const child of result.children) {
        childList.appendChild(createResultGroup(child, key));
      }
      li.appendChild(childList);
    } else {
      li.appendChild(createMatchList(result));
    }
  }

  return li;
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
    resultsEl.appendChild(createResultGroup(result));
  }
}

Array.from(
  document.querySelectorAll<HTMLInputElement>('input[name="mode"]')
).forEach((input) => {
  input.addEventListener("change", () => {
    if (!input.checked) {
      return;
    }
    mode = input.value as SearchMode;
    updateScopeVisibility();

    postToPlugin({
      type: "SET_MODE",
      mode,
      pinnedNodeId: mode === "pinned" ? pinnedNodeId : undefined,
      comparePairs: mode === "compare" ? pairsToPayload() : undefined,
      imageTargetId: mode === "image" ? imageTargetId : undefined,
    });

    if (mode === "image") {
      postToPlugin({ type: "LIST_IMAGE_TARGETS" });
      if (!imageNodeId) {
        renderOcrList();
      } else if (!imageTargetId) {
        renderOcrList();
      }
    }
  });
});

pinFromSelectionBtn.innerHTML = selectIcon;
pinFromSelectionBtn.addEventListener("click", () => {
  postToPlugin({ type: "SET_PINNED_FROM_SELECTION" });
});

addComparePairBtn.addEventListener("click", () => {
  addComparePair();
});

function setIgnorePopoverOpen(open: boolean): void {
  ignorePopoverEl.hidden = !open;
  ignoreToggleBtn.setAttribute("aria-expanded", open ? "true" : "false");
}

ignoreToggleBtn.innerHTML = sortIcon;
ignoreToggleBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  closeAllRowMenus();
  const open = ignoreToggleBtn.getAttribute("aria-expanded") === "true";
  setIgnorePopoverOpen(!open);
});

ignorePopoverEl.addEventListener("click", (event) => {
  event.stopPropagation();
});

function onIgnoreOptionsChanged(): void {
  debounceSearch();
}

ignoreStringsEl.addEventListener("input", onIgnoreOptionsChanged);
ignoreEmojiEl.addEventListener("change", onIgnoreOptionsChanged);
ignoreKinsokuEl.addEventListener("change", onIgnoreOptionsChanged);
ignoreSymbolEl.addEventListener("change", onIgnoreOptionsChanged);
ignorePunctEl.addEventListener("change", onIgnoreOptionsChanged);
ignoreNewlinesEl.addEventListener("change", onIgnoreOptionsChanged);
ignoreWhitespaceEl.addEventListener("change", onIgnoreOptionsChanged);

// Ensure defaults match DEFAULT_IGNORE_CATEGORIES
ignoreEmojiEl.checked = DEFAULT_IGNORE_CATEGORIES.emoji;
ignoreKinsokuEl.checked = DEFAULT_IGNORE_CATEGORIES.kinsoku;
ignoreSymbolEl.checked = DEFAULT_IGNORE_CATEGORIES.symbol;
ignorePunctEl.checked = DEFAULT_IGNORE_CATEGORIES.punct;
ignoreNewlinesEl.checked = DEFAULT_IGNORE_CATEGORIES.newlines;
ignoreWhitespaceEl.checked = DEFAULT_IGNORE_CATEGORIES.whitespace;

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
  if (!compareInline.contains(target)) {
    closeAllCompareLists();
  }
  if (!imageInline.contains(target)) {
    closeImageTargetList();
  }
  const ignoreMenu = ignoreToggleBtn.closest(".ignore-menu");
  if (ignoreMenu && !ignoreMenu.contains(target)) {
    setIgnorePopoverOpen(false);
  }
  if (!(target as Element).closest?.(".row-menu")) {
    closeAllRowMenus();
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

function clearAll(): void {
  if (mode === "compare") {
    clearComparePairs();
    return;
  }
  if (mode === "image") {
    clearImageMode();
    return;
  }
  clearKeywords();
}

clearAllBtn.innerHTML = clearIcon;
resetSearchBtn.innerHTML = resetIcon;

clearAllBtn.addEventListener("click", () => {
  clearAll();
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
    if (mode === "image" && !imageTargetId) {
      renderOcrList();
    } else {
      renderResults([]);
    }
    return;
  }

  if (msg.type === "PIN_TARGETS") {
    pinTargets = msg.targets;
    pinnedNodeId = msg.pinnedNodeId;
    refreshPinCombobox();
    return;
  }

  if (msg.type === "COMPARE_STATE") {
    compareTargets = msg.targets;
    suppressCompareSync = true;
    comparePairs = (msg.pairs.length > 0 ? msg.pairs : [{ idA: null, idB: null }]).map(
      (p) => ({
        ...emptyPairUi(),
        idA: p.idA,
        idB: p.idB,
      })
    );
    refreshComparePairsFromState();
    suppressCompareSync = false;
    return;
  }

  if (msg.type === "IMAGE_STATE") {
    imageTargets = msg.targets;
    imageTargetId = msg.targetId;
    if (imageTargetId && !getImageTarget()) {
      imageTargetId = null;
    }
    setImageTargetInputToSelection();
    if (imageListOpen) {
      renderImageTargetList();
    }
    if (mode === "image" && imageTargetId && ocrItems.length > 0 && !ocrBusy) {
      runImageCompare();
    }
    return;
  }

  if (msg.type === "IMAGE_EXPORTED") {
    void processExportedImage(
      msg.bytes,
      msg.nodeId,
      msg.name,
      msg.exportScale
    );
    return;
  }

  if (msg.type === "IMAGE_CLEARED") {
    clearImageLocal(false);
    return;
  }

  if (msg.type === "SEARCH_RESULT") {
    showError(null);
    renderResults(msg.results);
    syncHighlightPrefsAfterSearch();
  }
};

imageFromSelectionBtn.innerHTML = selectIcon;
imageTargetFromSelectionBtn.innerHTML = selectIcon;

imageRowActionsEl.append(
  createRowMenu({
    onClear: () => {
      clearImageMode();
    },
    onRemove: () => {
      /* image mode has a single row */
    },
    canRemove: () => false,
  })
);

imageFromSelectionBtn.addEventListener("click", () => {
  postToPlugin({ type: "EXPORT_IMAGE_FROM_SELECTION" });
});

imageTargetFromSelectionBtn.addEventListener("click", () => {
  postToPlugin({ type: "SET_IMAGE_TARGET_FROM_SELECTION" });
});

imageTargetInputEl.addEventListener("focus", () => {
  openImageTargetList();
});

imageTargetInputEl.addEventListener("input", () => {
  imageFilterQuery = imageTargetInputEl.value;
  imageActiveIndex = 0;
  openImageTargetList();
});

imageTargetInputEl.addEventListener("keydown", (event) => {
  const filtered = filteredImageTargets();
  if (event.key === "ArrowDown") {
    event.preventDefault();
    if (!imageListOpen) {
      openImageTargetList();
    }
    imageActiveIndex = Math.min(imageActiveIndex + 1, filtered.length - 1);
    if (imageActiveIndex < 0 && filtered.length > 0) {
      imageActiveIndex = 0;
    }
    renderImageTargetList();
    return;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    imageActiveIndex = Math.max(imageActiveIndex - 1, 0);
    renderImageTargetList();
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    if (imageActiveIndex >= 0 && imageActiveIndex < filtered.length) {
      commitImageTarget(filtered[imageActiveIndex].id);
    }
    return;
  }
  if (event.key === "Escape") {
    closeImageTargetList();
    setImageTargetInputToSelection();
  }
});

imageTargetInputEl.addEventListener("blur", () => {
  window.setTimeout(() => {
    if (!imageTargetListEl.contains(document.activeElement)) {
      closeImageTargetList();
      setImageTargetInputToSelection();
    }
  }, 0);
});

updateScopeVisibility();
addKeywordRow();
renderComparePairs();
renderResults([]);
postToPlugin({ type: "LIST_PIN_TARGETS" });
postToPlugin({ type: "LIST_COMPARE_TARGETS" });
