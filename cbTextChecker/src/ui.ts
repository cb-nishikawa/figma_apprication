import "./ui.css";
import clearIcon from "./assets/clear.svg?raw";
import pinIcon from "./assets/pin.svg?raw";
import resetIcon from "./assets/reset.svg?raw";
import selectIcon from "./assets/select.svg?raw";
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
  CompareSide,
  HighlightColor,
  HoverHighlightItem,
  IgnoreCategories,
  KeywordQuery,
  PinTarget,
  SearchMode,
  TextMatch,
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
const compareAInput = document.getElementById(
  "compare-a-input"
) as HTMLInputElement;
const compareAList = document.getElementById(
  "compare-a-list"
) as HTMLUListElement;
const compareBInput = document.getElementById(
  "compare-b-input"
) as HTMLInputElement;
const compareBList = document.getElementById(
  "compare-b-list"
) as HTMLUListElement;
const compareAFromSelectionBtn = document.getElementById(
  "compare-a-from-selection"
) as HTMLButtonElement;
const compareBFromSelectionBtn = document.getElementById(
  "compare-b-from-selection"
) as HTMLButtonElement;
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
const ignoreBodyEl = document.getElementById("ignore-body") as HTMLDivElement;
const ignoreToggleChevron = ignoreToggleBtn.querySelector(
  ".ignore-toggle-chevron"
) as HTMLSpanElement;
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
const ignoreWhitespaceEl = document.getElementById(
  "ignore-whitespace"
) as HTMLInputElement;
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
let compareNodeIdA: string | null = null;
let compareNodeIdB: string | null = null;
let compareTargets: PinTarget[] = [];
let pinFilterQuery = "";
let pinListOpen = false;
let pinActiveIndex = -1;
let compareFilterA = "";
let compareFilterB = "";
let compareListOpenA = false;
let compareListOpenB = false;
let compareActiveIndexA = -1;
let compareActiveIndexB = -1;
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

function collectIgnoreStrings(): string[] {
  return parseIgnoreInput(ignoreStringsEl.value);
}

function collectIgnoreCategories(): IgnoreCategories {
  return {
    emoji: ignoreEmojiEl.checked,
    kinsoku: ignoreKinsokuEl.checked,
    symbol: ignoreSymbolEl.checked,
    punct: ignorePunctEl.checked,
    whitespace: ignoreWhitespaceEl.checked,
  };
}

function runSearch(): void {
  showError(null);
  const ignoreStrings = collectIgnoreStrings();
  const ignoreCategories = collectIgnoreCategories();
  if (mode === "compare") {
    postToPlugin({ type: "RUN_COMPARE", ignoreStrings, ignoreCategories });
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
  const hideKeywords = mode === "compare";
  keywordsSection.hidden = hideKeywords;
  keywordsDivider.hidden = hideKeywords;
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
  closeCompareList("A");
  closeCompareList("B");
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

function getCompareTarget(side: CompareSide): PinTarget | null {
  const id = side === "A" ? compareNodeIdA : compareNodeIdB;
  if (!id) {
    return null;
  }
  return compareTargets.find((t) => t.id === id) ?? null;
}

function filteredCompareTargets(side: CompareSide): PinTarget[] {
  const query = (side === "A" ? compareFilterA : compareFilterB)
    .trim()
    .toLowerCase();
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

function setCompareInputToSelection(side: CompareSide): void {
  const selected = getCompareTarget(side);
  const input = side === "A" ? compareAInput : compareBInput;
  if (side === "A") {
    compareFilterA = "";
  } else {
    compareFilterB = "";
  }
  input.value = selected ? selected.label : "";
}

function closeCompareList(side: CompareSide): void {
  const list = side === "A" ? compareAList : compareBList;
  const input = side === "A" ? compareAInput : compareBInput;
  if (side === "A") {
    compareListOpenA = false;
    compareActiveIndexA = -1;
  } else {
    compareListOpenB = false;
    compareActiveIndexB = -1;
  }
  list.hidden = true;
  input.setAttribute("aria-expanded", "false");
}

function renderCompareList(side: CompareSide): void {
  const list = side === "A" ? compareAList : compareBList;
  const selectedId = side === "A" ? compareNodeIdA : compareNodeIdB;
  let activeIndex = side === "A" ? compareActiveIndexA : compareActiveIndexB;
  list.replaceChildren();

  if (compareTargets.length === 0) {
    const empty = document.createElement("li");
    empty.className = "pin-combobox-empty";
    empty.textContent = "候補がありません";
    list.append(empty);
    return;
  }

  const filtered = filteredCompareTargets(side);
  if (filtered.length === 0) {
    const empty = document.createElement("li");
    empty.className = "pin-combobox-empty";
    empty.textContent = "該当なし";
    list.append(empty);
    if (side === "A") {
      compareActiveIndexA = -1;
    } else {
      compareActiveIndexB = -1;
    }
    return;
  }

  if (activeIndex >= filtered.length) {
    activeIndex = filtered.length - 1;
    if (side === "A") {
      compareActiveIndexA = activeIndex;
    } else {
      compareActiveIndexB = activeIndex;
    }
  }

  filtered.forEach((target, index) => {
    const item = document.createElement("li");
    item.setAttribute("role", "option");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pin-combobox-option";
    if (target.id === selectedId) {
      button.classList.add("is-selected");
    }
    if (index === activeIndex) {
      button.classList.add("is-active");
    }
    button.textContent = target.label;
    button.title = target.label;
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });
    button.addEventListener("click", () => {
      commitCompareNode(side, target.id);
    });
    item.append(button);
    list.append(item);
  });
}

function openCompareList(side: CompareSide): void {
  closeCompareList(side === "A" ? "B" : "A");
  closePinList();
  const list = side === "A" ? compareAList : compareBList;
  const input = side === "A" ? compareAInput : compareBInput;
  if (side === "A") {
    compareListOpenA = true;
  } else {
    compareListOpenB = true;
  }
  list.hidden = false;
  input.setAttribute("aria-expanded", "true");
  renderCompareList(side);
}

function commitCompareNode(side: CompareSide, nextId: string | null): void {
  if (side === "A") {
    compareNodeIdA = nextId;
  } else {
    compareNodeIdB = nextId;
  }
  setCompareInputToSelection(side);
  closeCompareList(side);
  postToPlugin({ type: "SET_COMPARE_NODE", side, nodeId: nextId });
}

function refreshCompareComboboxes(): void {
  if (
    compareNodeIdA &&
    !compareTargets.some((t) => t.id === compareNodeIdA)
  ) {
    compareNodeIdA = null;
  }
  if (
    compareNodeIdB &&
    !compareTargets.some((t) => t.id === compareNodeIdB)
  ) {
    compareNodeIdB = null;
  }
  setCompareInputToSelection("A");
  setCompareInputToSelection("B");
  if (compareListOpenA) {
    renderCompareList("A");
  }
  if (compareListOpenB) {
    renderCompareList("B");
  }
}

function wireCompareCombobox(side: CompareSide): void {
  const input = side === "A" ? compareAInput : compareBInput;
  input.addEventListener("focus", () => {
    openCompareList(side);
  });
  input.addEventListener("input", () => {
    if (side === "A") {
      compareFilterA = input.value;
      compareActiveIndexA = 0;
    } else {
      compareFilterB = input.value;
      compareActiveIndexB = 0;
    }
    openCompareList(side);
  });
  input.addEventListener("keydown", (event) => {
    const filtered = filteredCompareTargets(side);
    const activeIndex =
      side === "A" ? compareActiveIndexA : compareActiveIndexB;
    const listOpen = side === "A" ? compareListOpenA : compareListOpenB;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!listOpen) {
        openCompareList(side);
      }
      const next = Math.min(activeIndex + 1, filtered.length - 1);
      if (side === "A") {
        compareActiveIndexA = next < 0 && filtered.length > 0 ? 0 : next;
      } else {
        compareActiveIndexB = next < 0 && filtered.length > 0 ? 0 : next;
      }
      renderCompareList(side);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      const next = Math.max(activeIndex - 1, 0);
      if (side === "A") {
        compareActiveIndexA = next;
      } else {
        compareActiveIndexB = next;
      }
      renderCompareList(side);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (activeIndex >= 0 && filtered[activeIndex]) {
        commitCompareNode(side, filtered[activeIndex].id);
      }
      return;
    }
    if (event.key === "Escape") {
      closeCompareList(side);
      setCompareInputToSelection(side);
    }
  });
  input.addEventListener("blur", () => {
    window.setTimeout(() => {
      closeCompareList(side);
      setCompareInputToSelection(side);
    }, 120);
  });
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
    const previousMode = mode;
    mode = input.value as SearchMode;
    updateScopeVisibility();

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
      compareNodeIdA: mode === "compare" ? compareNodeIdA : undefined,
      compareNodeIdB: mode === "compare" ? compareNodeIdB : undefined,
    });
  });
});

wireCompareCombobox("A");
wireCompareCombobox("B");

compareAFromSelectionBtn.innerHTML = selectIcon;
compareBFromSelectionBtn.innerHTML = selectIcon;
pinFromSelectionBtn.innerHTML = selectIcon;

compareAFromSelectionBtn.addEventListener("click", () => {
  postToPlugin({ type: "SET_COMPARE_FROM_SELECTION", side: "A" });
});
compareBFromSelectionBtn.addEventListener("click", () => {
  postToPlugin({ type: "SET_COMPARE_FROM_SELECTION", side: "B" });
});
pinFromSelectionBtn.addEventListener("click", () => {
  postToPlugin({ type: "SET_PINNED_FROM_SELECTION" });
});

ignoreToggleBtn.addEventListener("click", () => {
  const open = ignoreToggleBtn.getAttribute("aria-expanded") === "true";
  const nextOpen = !open;
  ignoreToggleBtn.setAttribute("aria-expanded", nextOpen ? "true" : "false");
  ignoreBodyEl.hidden = !nextOpen;
  ignoreToggleChevron.textContent = nextOpen ? "▾" : "▸";
});

function onIgnoreOptionsChanged(): void {
  debounceSearch();
}

ignoreStringsEl.addEventListener("input", onIgnoreOptionsChanged);
ignoreEmojiEl.addEventListener("change", onIgnoreOptionsChanged);
ignoreKinsokuEl.addEventListener("change", onIgnoreOptionsChanged);
ignoreSymbolEl.addEventListener("change", onIgnoreOptionsChanged);
ignorePunctEl.addEventListener("change", onIgnoreOptionsChanged);
ignoreWhitespaceEl.addEventListener("change", onIgnoreOptionsChanged);

// Ensure defaults match DEFAULT_IGNORE_CATEGORIES
ignoreEmojiEl.checked = DEFAULT_IGNORE_CATEGORIES.emoji;
ignoreKinsokuEl.checked = DEFAULT_IGNORE_CATEGORIES.kinsoku;
ignoreSymbolEl.checked = DEFAULT_IGNORE_CATEGORIES.symbol;
ignorePunctEl.checked = DEFAULT_IGNORE_CATEGORIES.punct;
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

  if (msg.type === "COMPARE_STATE") {
    compareTargets = msg.targets;
    compareNodeIdA = msg.nodeIdA;
    compareNodeIdB = msg.nodeIdB;
    refreshCompareComboboxes();
    return;
  }

  if (msg.type === "SEARCH_RESULT") {
    showError(null);
    renderResults(msg.results);
    syncHighlightPrefsAfterSearch();
  }
};

updateScopeVisibility();
addKeywordRow();
renderResults([]);
postToPlugin({ type: "LIST_PIN_TARGETS" });
