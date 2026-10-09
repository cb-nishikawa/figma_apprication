import "./ui.css";
import type { PluginToUiMessage, UiToPluginMessage } from "./messages";
import {
  addGroup,
  groupOf,
  isGroup,
  listGroups,
  moveNode,
  renameGroup,
  setGroupCategory,
  setGroupCollapsed,
} from "./tree";
import {
  IMPORT_CATEGORY_NAME,
  NO_CATEGORY,
  isViewMode,
  VIEW_MODES,
  type ImportMode,
  type ListNode,
  type LinkedCategoryInfo,
  type R2Source,
  type TemplateGroup,
  type TemplateMeta,
  type ViewMode,
} from "./types";

const saveBtn = document.getElementById("save") as HTMLButtonElement;
const selectionHint = document.getElementById("selection-hint") as HTMLParagraphElement;
const countEl = document.getElementById("count") as HTMLSpanElement;
const filterInput = document.getElementById("filter") as HTMLInputElement;
const filterToggleBtn = document.getElementById("filter-toggle") as HTMLButtonElement;
const filterPopover = document.getElementById("filter-popover") as HTMLDivElement;
const viewModeToggleBtn = document.getElementById("view-mode-toggle") as HTMLButtonElement;
const viewModePopover = document.getElementById("view-mode-popover") as HTMLDivElement;
const categoryToggleBtn = document.getElementById("category-toggle") as HTMLButtonElement;
const categoryLabelEl = document.getElementById("category-label") as HTMLSpanElement;
const categoryPopover = document.getElementById("category-popover") as HTMLDivElement;
const listMenuToggleBtn = document.getElementById("list-menu-toggle") as HTMLButtonElement;
const listMenuPopover = document.getElementById("list-menu-popover") as HTMLDivElement;
const addCategoryBtn = document.getElementById("add-category") as HTMLButtonElement;
const addGroupBtn = document.getElementById("add-group") as HTMLButtonElement;
const listMenuItems = document.getElementById("list-menu-items") as HTMLDivElement;
const deleteCategoryBtn = document.getElementById("delete-category") as HTMLButtonElement;
const deleteCategoryConfirm = document.getElementById("delete-category-confirm") as HTMLDivElement;
const deleteCategoryText = document.getElementById("delete-category-text") as HTMLParagraphElement;
const deleteCategoryCancelBtn = document.getElementById("delete-category-cancel") as HTMLButtonElement;
const deleteCategoryOkBtn = document.getElementById("delete-category-ok") as HTMLButtonElement;
const deleteCategoryNote = document.getElementById("delete-category-note") as HTMLParagraphElement;
const addLinkedCategoryBtn = document.getElementById("add-linked-category") as HTMLButtonElement;
const linkedDialog = document.getElementById("linked-dialog") as HTMLDivElement;
const linkedNameInput = document.getElementById("linked-name") as HTMLInputElement;
const linkedR2Url = document.getElementById("linked-r2-url") as HTMLInputElement;
const linkedR2Token = document.getElementById("linked-r2-token") as HTMLInputElement;
const linkedR2Space = document.getElementById("linked-r2-space") as HTMLInputElement;
const linkedTestBtn = document.getElementById("linked-test") as HTMLButtonElement;
const linkedTestResult = document.getElementById("linked-test-result") as HTMLSpanElement;
const linkedCancelBtn = document.getElementById("linked-cancel") as HTMLButtonElement;
const linkedAddBtn = document.getElementById("linked-add") as HTMLButtonElement;
const errorEl = document.getElementById("error") as HTMLParagraphElement;
const storageErrorEl = document.getElementById("storage-error") as HTMLDivElement;
const storageErrorText = document.getElementById("storage-error-text") as HTMLParagraphElement;
const listEl = document.getElementById("list") as HTMLUListElement;
const statusSpinner = document.getElementById("status-spinner") as HTMLSpanElement;
const statusText = document.getElementById("status-text") as HTMLSpanElement;
const usageBar = document.getElementById("usage-bar") as HTMLDivElement;
const usageBarFill = document.getElementById("usage-bar-fill") as HTMLElement;
const placeBtn = document.getElementById("place") as HTMLButtonElement;
const resizeHandle = document.getElementById("resize-handle") as HTMLDivElement;
const importBtn = document.getElementById("import") as HTMLButtonElement;
const exportAllBtn = document.getElementById("export-all") as HTMLButtonElement;
const importFileInput = document.getElementById("import-file") as HTMLInputElement;
const imageDialog = document.getElementById("image-dialog") as HTMLDivElement;
const imageDialogBody = document.getElementById("image-dialog-body") as HTMLParagraphElement;
const imageDialogNote = document.getElementById("image-dialog-note") as HTMLParagraphElement;
const imageCancelBtn = document.getElementById("image-cancel") as HTMLButtonElement;
const imageSkipBtn = document.getElementById("image-skip") as HTMLButtonElement;
const imageKeepBtn = document.getElementById("image-keep") as HTMLButtonElement;
const importDialog = document.getElementById("import-dialog") as HTMLDivElement;
const importDialogTitle = document.getElementById("import-dialog-title") as HTMLParagraphElement;
const importDialogBody = document.getElementById("import-dialog-body") as HTMLParagraphElement;
const importDialogNote = document.getElementById("import-dialog-note") as HTMLParagraphElement;
const importActions = document.getElementById("import-actions") as HTMLDivElement;
const importConfirmActions = document.getElementById("import-confirm-actions") as HTMLDivElement;
const importReplaceBtn = document.getElementById("import-replace") as HTMLButtonElement;
const importAppendBtn = document.getElementById("import-append") as HTMLButtonElement;
const importCategoryBtn = document.getElementById("import-category") as HTMLButtonElement;
const importCancelBtn = document.getElementById("import-cancel") as HTMLButtonElement;
const importBackBtn = document.getElementById("import-back") as HTMLButtonElement;
const importConfirmReplaceBtn = document.getElementById(
  "import-confirm-replace"
) as HTMLButtonElement;

const DRAG_THRESHOLD = 4;
/** この割合以上なら容量のバーを危険色にする。保存が拒まれる手前。 */
const USAGE_WARNING_RATIO = 0.8;

let templates: TemplateMeta[] = [];
let tree: ListNode[] = [];
let selectedId: string | null = null;
let selectedGroupId: string | null = null;
let renamingId: string | null = null;
let renamingGroupId: string | null = null;
let busyMessage: string | null = null;
let viewMode: ViewMode = "detail";
/** 登録済みのカテゴリ。まだ誰も使っていないものも含む（TEMPLATES で受け取る）。 */
let categories: string[] = [];
/** 保存先のカテゴリ。空文字が「未設定」。起動時は必ず未設定（この画面でのみ保持）。 */
let saveCategory = "";
/** カテゴリメニューの入力モード。null は一覧を出している。 */
let categoryInput:
  | { mode: "add"; value: string }
  | { mode: "rename"; from: string }
  | null = null;
/** 読み込み方を選んでいる間だけ持つ。「全て入れ替える」の確認画面もここで持つ。 */
let pendingImport: { files: Array<{ name: string; text: string }>; confirm: boolean } | null = null;
let savableCount = 0;
let canvasSelectionCount = 0;
/** `quota: null` は上限の無い保存先（共有カテゴリの R2）。 */
let usage: { used: number; quota: number | null } = { used: 0, quota: 0 };
/** 共有カテゴリ。名前はこの人の一覧での表示名（TEMPLATES で受け取る）。 */
let linkedCategories: LinkedCategoryInfo[] = [];
/** プラグインに最後に伝えた「今見ているカテゴリ」。変わったときだけ VIEW_CATEGORY を送る。 */
let viewedCategory = "";
let linkedTesting = false;
let linkedAdding = false;
/** 保存中の「画像を含めるか」の確認。開いている間だけ保持する。 */
let imageQuestion: { count: number; bytes: number; remaining: number; tooLarge: boolean } | null = null;

interface DragState {
  nodeId: string;
  isGroup: boolean;
  startX: number;
  startY: number;
  active: boolean;
}

interface DropHint {
  row: HTMLElement;
  mode: "before" | "after" | "into";
  groupId: string | null;
  index: number;
}

let drag: DragState | null = null;
/** A drag ends with a click event that must not select or place anything. */
let suppressClick = false;

function postToPlugin(message: UiToPluginMessage): void {
  parent.postMessage({ pluginMessage: message }, "*");
}

function newUiId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
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
  if (message === null) {
    showStorageError(null);
  }
}

/** 共有カテゴリの保存先に届かないときの案内。 */
function showStorageError(message: string | null): void {
  storageErrorEl.hidden = !message;
  storageErrorText.textContent = message ?? "";
}

function renderStatus(): void {
  statusSpinner.hidden = !busyMessage;
  // 処理中は容量の枠をメッセージが使う。よってバーも一緒に隠す。
  const quota = usage.quota;
  const showUsage = !busyMessage && quota !== null && quota > 0;
  statusText.textContent =
    busyMessage ??
    (showUsage
      ? `使用量 ${formatBytes(usage.used)} / ${formatBytes(quota)}`
      : quota === null
        ? `Cloudflare R2 に保存 ${formatBytes(usage.used)}`
        : "");
  usageBar.hidden = !showUsage;
  if (showUsage) {
    const ratio = usage.used / quota;
    // 上限を超えた分は丸めて 100% に留める（超過時は別のエラーで知らせる）。
    usageBarFill.style.width = `${(Math.min(1, ratio) * 100).toFixed(1)}%`;
    usageBar.classList.toggle("is-warning", ratio >= USAGE_WARNING_RATIO);
  }
  saveBtn.hidden = savableCount === 0;
  saveBtn.disabled = Boolean(busyMessage);
  placeBtn.hidden = !selectedId;
  placeBtn.disabled = Boolean(busyMessage);
  importBtn.disabled = Boolean(busyMessage);
  exportAllBtn.disabled = Boolean(busyMessage) || templates.length === 0;
  addGroupBtn.disabled = Boolean(busyMessage);
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
    Array.from(fileList).map(async (f) => ({ name: f.name, text: await f.text() }))
  );
  if (files.length > 0) {
    openImportDialog({ files, confirm: false });
  }
}

/** 読み込み方の選択画面。「入れ替える」は2段階目の確認に進むだけ。 */
function openImportDialog(state: { files: Array<{ name: string; text: string }>; confirm: boolean }): void {
  pendingImport = state;
  importActions.hidden = state.confirm;
  importConfirmActions.hidden = !state.confirm;
  if (state.confirm) {
    importDialogTitle.textContent = "本当に全て入れ替えますか？";
    importDialogBody.textContent =
      `いまの ${templates.length} 件とグループ ${listGroups(tree).length} 件を消して、` +
      `${state.files.length} 件のファイルに差し替えます。`;
    importDialogNote.hidden = false;
    importDialogNote.textContent = "元に戻せません。";
    importBackBtn.focus();
  } else {
    importDialogTitle.textContent = "読み込み方を選んでください";
    importDialogBody.textContent = `${state.files.length} 件のファイル（${summarizeNames(state.files)}）を読み込みます。`;
    importDialogNote.hidden = true;
    importAppendBtn.focus();
  }
  importDialog.hidden = false;
}

function summarizeNames(files: Array<{ name: string }>): string {
  const names = files.slice(0, 2).map((entry) => entry.name);
  const rest = files.length - names.length;
  return rest > 0 ? `${names.join("、")} ほか ${rest} 件` : names.join("、");
}

function closeImportDialog(): void {
  pendingImport = null;
  importDialog.hidden = true;
}

/** 選んだ読み込み方で plugin 側に渡す。 */
function chooseImport(mode: ImportMode): void {
  const pending = pendingImport;
  if (!pending) {
    return;
  }
  if (mode === "replace" && !pending.confirm) {
    openImportDialog({ ...pending, confirm: true });
    return;
  }
  const files = pending.files;
  closeImportDialog();
  showError(null);
  postToPlugin({ type: "IMPORT", files, mode });
  if (mode === "category") {
    // どこへ入ったかがその場で見えるようにする。カテゴリはこの画面でしか変わらない。
    if (!categories.includes(IMPORT_CATEGORY_NAME)) {
      categories = [...categories, IMPORT_CATEGORY_NAME];
    }
    saveCategory = IMPORT_CATEGORY_NAME;
    syncCategoryToggle();
    renderList();
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

function setListMenuOpen(open: boolean): void {
  listMenuPopover.hidden = !open;
  listMenuToggleBtn.setAttribute("aria-expanded", open ? "true" : "false");
  if (open) {
    // 開くたびにメニューから始める。確認の画面は残さない。
    showListMenuItems();
  }
}

function showListMenuItems(): void {
  listMenuItems.hidden = false;
  deleteCategoryConfirm.hidden = true;
  listMenuPopover.classList.remove("is-confirm");
  deleteCategoryBtn.disabled = saveCategory === "";
  const linked = linkedInfo(saveCategory) !== undefined;
  deleteCategoryBtn.textContent = linked ? "カテゴリを外す" : "カテゴリを削除";
  deleteCategoryBtn.title =
    saveCategory === ""
      ? "未設定は削除できません"
      : linked
        ? `共有カテゴリ「${saveCategory}」を一覧から外す（保存先のデータは残ります）`
        : `カテゴリ「${saveCategory}」を削除`;
}

/** 消える対象。そのカテゴリのグループと中身、そのカテゴリのテンプレート。 */
function categoryDeletionTargets(name: string): { templateIds: Set<string>; groupIds: string[] } {
  const groups = listGroups(tree).filter((group) => group.category === name);
  const templateIds = new Set<string>(groups.flatMap((group) => group.items));
  for (const meta of templates) {
    if (meta.category === name) {
      templateIds.add(meta.id);
    }
  }
  return { templateIds, groupIds: groups.map((group) => group.id) };
}

/* ------------------------------ カテゴリ ------------------------------ */

/** 保存先のカテゴリ。空文字が「未設定」。ヘッダーのメニューだけで切り替える。 */
function categoryLabel(name: string): string {
  return name === "" ? NO_CATEGORY : name;
}

function syncCategoryToggle(): void {
  categoryLabelEl.textContent = categoryLabel(saveCategory);
  categoryToggleBtn.title = `カテゴリ: ${categoryLabel(saveCategory)}`;
  categoryToggleBtn.setAttribute(
    "aria-label",
    `保存するカテゴリを選ぶ（いま ${categoryLabel(saveCategory)}）`
  );
  categoryToggleBtn.classList.toggle("is-active", saveCategory !== "");
  // 共有カテゴリは保存先が別なので、切り替えたらプラグインに読み込み直してもらう。
  if (saveCategory !== viewedCategory) {
    viewedCategory = saveCategory;
    postToPlugin({ type: "VIEW_CATEGORY", category: saveCategory });
  }
}

function linkedInfo(name: string): LinkedCategoryInfo | undefined {
  return linkedCategories.find((link) => link.name === name);
}

function providerTag(provider: LinkedCategoryInfo["provider"]): string {
  return provider === "r2" ? "R2" : "Drive";
}

/** Rebuilt on every open so the chosen category keeps its mark. */
function buildCategoryItems(): void {
  categoryPopover.replaceChildren();
  categoryPopover.classList.remove("is-input");
  const names = categories.filter((name) => name !== NO_CATEGORY);
  const options: Array<{ value: string; label: string }> = [{ value: "", label: NO_CATEGORY }];
  for (const name of names) {
    options.push({ value: name, label: name });
  }
  for (const option of options) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "row-menu-item";
    item.setAttribute("role", "menuitemradio");
    const current = option.value === saveCategory;
    item.setAttribute("aria-checked", current ? "true" : "false");
    item.classList.toggle("is-selected", current);
    item.textContent = option.label;
    const link = linkedInfo(option.value);
    if (link) {
      const tag = document.createElement("span");
      tag.className = "category-source-tag";
      tag.textContent = providerTag(link.provider);
      item.title = `共有カテゴリ（${link.label}）`;
      item.append(tag);
    }
    item.addEventListener("click", (event) => {
      event.stopPropagation();
      chooseSaveCategory(option.value);
    });
    categoryPopover.append(item);
  }
  if (saveCategory !== "") {
    const separator = document.createElement("div");
    separator.className = "category-popover-separator";
    separator.setAttribute("aria-hidden", "true");
    const rename = createMenuButton(
      "名前を変更",
      () => setCategoryInput({ mode: "rename", from: saveCategory }),
      { keepOpen: true }
    );
    categoryPopover.append(separator, rename);
  }
}

function chooseSaveCategory(value: string): void {
  saveCategory = value;
  syncCategoryToggle();
  closeAllPopups();
  // 保存先を選ぶと同時に、そのカテゴリの行だけを見えるようにする。
  renderList();
}

function setCategoryInput(
  next: { mode: "add"; value: string } | { mode: "rename"; from: string }
): void {
  categoryInput = next;
  renderCategoryInput();
}

/** まだ誰にも使われていない「カテゴリ N」を1つ選ぶ。 */
function nextCategoryName(): string {
  const used = new Set(categories);
  let n = 1;
  while (used.has(`カテゴリ ${n}`)) {
    n += 1;
  }
  return `カテゴリ ${n}`;
}

function renderCategoryInput(): void {
  const pending = categoryInput;
  if (!pending) {
    return;
  }
  categoryPopover.replaceChildren();
  categoryPopover.classList.add("is-input");
  const input = createTextInput(
    pending.mode === "add" ? pending.value : pending.from,
    "category-rename",
    commitCategoryInput,
    cancelCategoryInput
  );
  input.setAttribute("aria-label", "カテゴリ名");
  categoryPopover.append(input);
}

/** 入力欄は消えるので、先に状態を空にして二重実行を防ぐ。 */
function commitCategoryInput(value: string): void {
  const pending = categoryInput;
  categoryInput = null;
  if (!pending) {
    return;
  }
  const name = value.trim();
  if (pending.mode === "add") {
    if (name) {
      postToPlugin({ type: "ADD_CATEGORY", name });
      // 作った直後から使えるように、保存先も新しいカテゴリにしておく。
      saveCategory = name;
      syncCategoryToggle();
    }
  } else if (name && name !== pending.from) {
    postToPlugin({ type: "RENAME_CATEGORY", from: pending.from, to: name });
    if (saveCategory === pending.from) {
      saveCategory = name;
      syncCategoryToggle();
    }
  }
  buildCategoryItems();
  // 保存先が変わった分は、TEMPLATES が返る前に見えていたほうがよい。
  renderList();
}

function cancelCategoryInput(): void {
  if (!categoryInput) {
    return;
  }
  categoryInput = null;
  closeAllPopups();
  categoryToggleBtn.focus();
}

function setCategoryPopoverOpen(open: boolean): void {
  categoryPopover.hidden = !open;
  categoryToggleBtn.setAttribute("aria-expanded", open ? "true" : "false");
  if (!open) {
    categoryInput = null;
    return;
  }
  if (categoryInput) {
    renderCategoryInput();
  } else {
    buildCategoryItems();
  }
}

const VIEW_MODE_LABELS: Record<ViewMode, string> = {
  detail: "詳細",
  list: "一覧",
  grid: "サムネイル",
};

/** One 16x16 glyph per mode, so the button shows what the list looks like now. */
const VIEW_MODE_GLYPHS: Record<ViewMode, string> = {
  detail:
    '<rect x="2" y="3" width="5" height="10" rx="1" stroke="currentColor" stroke-width="1.3" />' +
    '<path d="M9.5 5.5h4.5M9.5 8.5h4.5M9.5 11h3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />',
  list: '<path d="M2.5 4h11M2.5 8h11M2.5 12h11" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />',
  grid:
    '<rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" stroke="currentColor" stroke-width="1.3" />' +
    '<rect x="9" y="2.5" width="4.5" height="4.5" rx="1" stroke="currentColor" stroke-width="1.3" />' +
    '<rect x="2.5" y="9" width="4.5" height="4.5" rx="1" stroke="currentColor" stroke-width="1.3" />' +
    '<rect x="9" y="9" width="4.5" height="4.5" rx="1" stroke="currentColor" stroke-width="1.3" />',
};

function syncViewModeToggle(): void {
  const label = VIEW_MODE_LABELS[viewMode];
  viewModeToggleBtn.title = `表示: ${label}`;
  viewModeToggleBtn.setAttribute("aria-label", `表示を切り替える（いま ${label}）`);
  viewModeToggleBtn.innerHTML =
    `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">${VIEW_MODE_GLYPHS[viewMode]}</svg>`;
}

/** Rebuilt on every open so the current mode keeps its mark. */
function buildViewModeItems(): void {
  viewModePopover.replaceChildren();
  for (const mode of VIEW_MODES) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "row-menu-item";
    item.setAttribute("role", "menuitemradio");
    const current = mode === viewMode;
    item.setAttribute("aria-checked", current ? "true" : "false");
    item.classList.toggle("is-selected", current);
    item.textContent = VIEW_MODE_LABELS[mode];
    item.addEventListener("click", (event) => {
      event.stopPropagation();
      setViewMode(mode);
    });
    viewModePopover.append(item);
  }
}

/** Switches how the list looks. The rows themselves are unchanged. */
function setViewMode(mode: ViewMode): void {
  closeAllPopups();
  if (mode === viewMode) {
    return;
  }
  viewMode = mode;
  syncViewModeToggle();
  renderList();
  postToPlugin({ type: "SET_VIEW_MODE", mode });
}

function setViewModePopoverOpen(open: boolean): void {
  viewModePopover.hidden = !open;
  viewModeToggleBtn.setAttribute("aria-expanded", open ? "true" : "false");
  if (open) {
    buildViewModeItems();
  }
}

function closeAllPopups(): void {
  closeAllRowMenus();
  setFilterPopoverOpen(false);
  setViewModePopoverOpen(false);
  setCategoryPopoverOpen(false);
  setListMenuOpen(false);
}

function place(id: string): void {
  if (busyMessage) {
    return;
  }
  showError(null);
  postToPlugin({ type: "PLACE", id });
}

/**
 * 一覧の要素を選ぶ。キャンバス側の選択とは排他なので、Figma 側の選択も解除する。
 * `canvasSelectionCount` を先に 0 へ更新し、連打しても解除要求を二重に送らないようにする。
 */
function selectTemplate(id: string): void {
  selectedId = id;
  selectedGroupId = null;
  if (canvasSelectionCount > 0) {
    canvasSelectionCount = 0;
    postToPlugin({ type: "CLEAR_CANVAS_SELECTION" });
  }
  renderList();
}

/** A group has no body of its own, so it only gets a highlight. */
function selectGroup(id: string): void {
  selectedGroupId = id;
  selectedId = null;
  renderList();
}

/** クリック位置が選択を保持する領域（一覧の行・フッター・絞り込み・一覧メニュー）にあるか。 */
function isInsideKeptArea(target: EventTarget | null): boolean {
  const el = target as Element | null;
  if (!el?.closest) {
    return false;
  }
  return Boolean(
    el.closest(
      ".template-item, .template-group, .footer-actions, .view-menu, .filter-menu, .list-menu"
    )
  );
}

function metaById(id: string): TemplateMeta | undefined {
  return templates.find((meta) => meta.id === id);
}

/**
 * Applies a move locally and tells the plugin, which stores it.
 * `category` を渡すとテンプレートのカテゴリも同じ MOVE で書き換える（"" が未設定）。
 */
function moveNodeTo(
  nodeId: string,
  groupId: string | null,
  index: number,
  category?: string
): void {
  let next = moveNode(tree, nodeId, groupId, index);
  const meta = category === undefined ? undefined : metaById(nodeId);
  const categoryChanged =
    meta !== undefined && normalizedCategory(meta.category) !== category;
  if (JSON.stringify(next) === JSON.stringify(tree) && !categoryChanged) {
    return;
  }
  if (meta && categoryChanged) {
    meta.category = category === "" ? undefined : category;
  }
  // Dropping into a folded group would look like nothing happened, so open it.
  const foldedTarget =
    groupId === null
      ? null
      : listGroups(next).find((group) => group.id === groupId)?.collapsed === true
        ? groupId
        : null;
  if (foldedTarget) {
    next = setGroupCollapsed(next, foldedTarget, false);
  }
  tree = next;
  renderList();
  postToPlugin(
    categoryChanged
      ? { type: "MOVE", nodeId, groupId, index, category: category === "" ? null : category }
      : { type: "MOVE", nodeId, groupId, index }
  );
  if (foldedTarget) {
    postToPlugin({ type: "TOGGLE_GROUP", id: foldedTarget, collapsed: false });
  }
}

/** 移動 submenu から使う「そのグループ（null はルート）の末尾に入れる」。 */
function moveTemplateToGroup(id: string, groupId: string | null, category?: string): void {
  const group = groupId ? listGroups(tree).find((entry) => entry.id === groupId) : undefined;
  if (groupId && !group) {
    return;
  }
  moveNodeTo(id, groupId, group ? group.items.length : tree.length, category);
}

function normalizedCategory(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function categoryTargets(current: string): string[] {
  const values: string[] = [""];
  for (const name of categories) {
    if (name !== NO_CATEGORY && !values.includes(name)) {
      values.push(name);
    }
  }
  if (current !== "" && !values.includes(current)) {
    values.push(current);
  }
  return values;
}

function moveCategoryLabel(value: string): string {
  return value === "" ? NO_CATEGORY : value;
}

function createCategoryLeafButton(
  current: string,
  value: string,
  onSelect: (value: string) => void
): HTMLButtonElement {
  const item = createMenuButton(moveCategoryLabel(value), () => onSelect(value));
  item.disabled = value === current;
  return item;
}

function appendCategoryLeafTargets(
  panel: HTMLDivElement,
  current: string,
  onSelect: (value: string) => void
): void {
  for (const value of categoryTargets(current)) {
    panel.append(createCategoryLeafButton(current, value, onSelect));
  }
}

/**
 * テンプレートを `category` にして、`group` の末尾（null ならルートの末尾）へ入れる。
 * 今いる場所とカテゴリが同じなら押せない。
 */
function createTemplateMoveTarget(
  meta: TemplateMeta,
  category: string,
  group: TemplateGroup | null
): HTMLButtonElement {
  const currentGroupId = groupOf(tree, meta.id)?.id ?? null;
  const currentCategory = normalizedCategory(meta.category);
  const label = group ? `${group.name}（${group.items.length}件）` : moveCategoryLabel(category);
  const item = createMenuButton(label, () => {
    moveTemplateToGroup(meta.id, group ? group.id : null, category);
  });
  item.classList.add(group ? "is-indented" : "row-menu-category");
  item.disabled = currentGroupId === (group?.id ?? null) && currentCategory === category;
  return item;
}

function createMoveItem(meta: TemplateMeta): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "row-menu-item row-menu-item-has-submenu";
  button.setAttribute("aria-haspopup", "true");

  const icon = document.createElement("span");
  icon.className = "row-menu-item-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "←";
  button.append(icon, document.createTextNode("移動"));

  // サブメニューは overflow: auto で左に開くため、さらに入れ子にすると枠で切れる。
  // 1 枚の中にカテゴリの見出しと、字下げしたグループを並べる。
  const panel = document.createElement("div");
  panel.className = "row-menu-submenu";
  panel.setAttribute("role", "menu");

  const groups = listGroups(tree);
  const targets = categoryTargets(normalizedCategory(meta.category));
  for (const group of groups) {
    const category = normalizedCategory(group.category);
    if (!targets.includes(category)) {
      targets.push(category);
    }
  }
  for (const category of targets) {
    panel.append(createTemplateMoveTarget(meta, category, null));
    for (const group of groups) {
      if (normalizedCategory(group.category) === category) {
        panel.append(createTemplateMoveTarget(meta, category, group));
      }
    }
  }

  button.append(panel);
  return button;
}

function createGroupMoveItem(group: TemplateGroup): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "row-menu-item row-menu-item-has-submenu";
  button.setAttribute("aria-haspopup", "true");

  const icon = document.createElement("span");
  icon.className = "row-menu-item-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "↕";
  button.append(icon, document.createTextNode("移動"));

  const current = normalizedCategory(group.category);
  const panel = document.createElement("div");
  panel.className = "row-menu-submenu";
  panel.setAttribute("role", "menu");
  appendCategoryLeafTargets(panel, current, (value) => {
    // 返事を待たずに今の一覧から消えるよう、中のテンプレートのカテゴリも先に揃える。
    const category = value === "" ? undefined : value;
    tree = setGroupCategory(tree, group.id, category);
    for (const id of group.items) {
      const meta = metaById(id);
      if (meta) {
        meta.category = category;
      }
    }
    renderList();
    postToPlugin({
      type: "SET_GROUP_CATEGORY",
      id: group.id,
      category: value === "" ? null : value,
    });
  });

  button.append(panel);
  return button;
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
  const current = metaById(id);
  const name = value.trim();
  if (current && name && name !== current.name) {
    current.name = name;
    postToPlugin({ type: "RENAME", id, name });
  }
  renderList();
}

function startRenameGroup(id: string): void {
  renamingGroupId = id;
  renderList();
}

/** Folds or unfolds the group. The choice is stored with the group. */
function toggleGroup(id: string): void {
  const current = listGroups(tree).find((group) => group.id === id);
  if (!current) {
    return;
  }
  const collapsed = current.collapsed !== true;
  tree = setGroupCollapsed(tree, id, collapsed);
  renderList();
  postToPlugin({ type: "TOGGLE_GROUP", id, collapsed });
}

function commitRenameGroup(id: string, value: string): void {
  if (renamingGroupId !== id) {
    return;
  }
  renamingGroupId = null;
  const current = listGroups(tree).find((group) => group.id === id);
  const name = value.trim();
  if (current && name && name !== current.name) {
    tree = renameGroup(tree, id, name);
    postToPlugin({ type: "RENAME_GROUP", id, name });
  }
  renderList();
}

function createMenuButton(
  label: string,
  onSelect: () => void,
  options: { danger?: boolean; keepOpen?: boolean } = {}
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = options.danger ? "row-menu-item is-danger" : "row-menu-item";
  button.textContent = label;
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!options.keepOpen) {
      closeAllRowMenus();
    }
    onSelect();
  });
  return button;
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

  panel.append(
    createMoveItem(meta),
    createMenuButton("名前を変更", () => startRename(meta.id)),
    createMenuButton("ファイルに書き出す", () => {
      postToPlugin({ type: "EXPORT", ids: [meta.id] });
    }),
    createMenuButton("削除", () => {
      if (selectedId === meta.id) {
        selectedId = null;
      }
      postToPlugin({ type: "DELETE", id: meta.id });
    })
  );

  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    const willOpen = panel.hidden;
    closeAllPopups();
    panel.hidden = !willOpen;
  });
  trigger.addEventListener("dblclick", (event) => event.stopPropagation());

  panel.addEventListener("click", (event) => event.stopPropagation());
  panel.addEventListener("dblclick", (event) => event.stopPropagation());

  wrap.append(trigger, panel);
  return wrap;
}

function createGroupMenu(group: TemplateGroup): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "row-menu";

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "row-menu-trigger";
  trigger.textContent = "⋯";
  trigger.title = "グループメニュー";
  trigger.setAttribute("aria-label", "グループメニュー");

  const panel = document.createElement("div");
  panel.className = "row-menu-panel";
  panel.hidden = true;
  panel.setAttribute("role", "menu");

  // Deleting a group takes its templates with it, so it asks first. The question
  // stays inside this panel: a modal would need its own focus handling, and
  // window.confirm is not dependable in the plugin iframe.
  const confirm = document.createElement("div");
  confirm.className = "row-menu-confirm";
  confirm.hidden = true;
  const question = document.createElement("p");
  question.className = "row-menu-confirm-text";
  question.textContent =
    group.items.length > 0
      ? `「${group.name}」と中の ${group.items.length} 件を削除します`
      : `「${group.name}」を削除します`;
  const note = document.createElement("p");
  note.className = "row-menu-confirm-note";
  note.textContent = "元に戻せません。残すなら先に「ファイルに書き出す」で保存";
  // Every time the panel opens it starts on the menu, never on the question.
  const showMenu = (): void => {
    confirm.hidden = true;
    panel.classList.remove("is-confirm");
    menu.hidden = false;
  };
  const actions = document.createElement("div");
  actions.className = "row-menu-actions";
  actions.append(
    createMenuButton("キャンセル", showMenu, { keepOpen: true }),
    createMenuButton(
      "削除",
      () => {
        if (selectedGroupId === group.id) {
          selectedGroupId = null;
        }
        postToPlugin({ type: "DELETE_GROUP", id: group.id });
      },
      { danger: true }
    )
  );
  confirm.append(question, note, actions);

  const menu = document.createElement("div");
  menu.className = "row-menu-list";
  menu.append(
    createGroupMoveItem(group),
    createMenuButton("名前を変更", () => startRenameGroup(group.id)),
    createMenuButton("ファイルに書き出す", () => {
      postToPlugin({ type: "EXPORT_GROUP", id: group.id });
    }),
    createMenuButton(
      "削除",
      () => {
        menu.hidden = true;
        confirm.hidden = false;
        panel.classList.add("is-confirm");
      },
      { keepOpen: true }
    )
  );

  panel.append(menu, confirm);

  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    const willOpen = panel.hidden;
    closeAllPopups();
    panel.hidden = !willOpen;
    if (willOpen) {
      showMenu();
    }
  });
  trigger.addEventListener("dblclick", (event) => event.stopPropagation());
  panel.addEventListener("click", (event) => event.stopPropagation());
  panel.addEventListener("dblclick", (event) => event.stopPropagation());

  wrap.append(trigger, panel);
  return wrap;
}

function createTextInput(
  value: string,
  className: string,
  onCommit: (value: string) => void,
  onCancel: () => void
): HTMLInputElement {
  const input = document.createElement("input");
  input.className = `text-input ${className}`;
  input.value = value;
  input.addEventListener("click", (event) => event.stopPropagation());
  input.addEventListener("dblclick", (event) => event.stopPropagation());
  input.addEventListener("pointerdown", (event) => event.stopPropagation());
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onCommit(input.value);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    }
  });
  input.addEventListener("blur", () => onCommit(input.value));
  window.setTimeout(() => {
    input.focus();
    input.select();
  }, 0);
  return input;
}

function createNameElement(meta: TemplateMeta): HTMLElement {
  if (renamingId !== meta.id) {
    const name = document.createElement("span");
    name.className = "template-name";
    name.textContent = meta.name;
    name.title = meta.name;
    return name;
  }
  return createTextInput(meta.name, "template-rename", (value) => commitRename(meta.id, value), () => {
    renamingId = null;
    renderList();
  });
}

function createGroupNameElement(group: TemplateGroup): HTMLElement {
  if (renamingGroupId !== group.id) {
    const name = document.createElement("span");
    name.className = "template-group-name";
    name.textContent = group.name;
    name.title = group.name;
    return name;
  }
  return createTextInput(
    group.name,
    "template-group-rename",
    (value) => commitRenameGroup(group.id, value),
    () => {
      renamingGroupId = null;
      renderList();
    }
  );
}

function createGroupItem(group: TemplateGroup, items: TemplateMeta[]): HTMLLIElement {
  const collapsed = group.collapsed === true;
  const li = document.createElement("li");
  li.className = "template-group";
  li.classList.toggle("is-collapsed", collapsed);
  li.classList.toggle("is-selected", group.id === selectedGroupId);
  li.dataset.nodeId = group.id;
  li.setAttribute("role", "treeitem");
  li.setAttribute("aria-level", "1");
  li.setAttribute("aria-expanded", collapsed ? "false" : "true");
  li.setAttribute("aria-selected", group.id === selectedGroupId ? "true" : "false");
  li.title = "名前をダブルクリックで名前変更・ドラッグで並べ替え・テンプレートをここへ移動";

  const head = document.createElement("div");
  head.className = "template-group-head";

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "template-group-toggle";
  toggle.title = collapsed ? "開く" : "たためる";
  toggle.setAttribute("aria-label", collapsed ? `${group.name}を開く` : `${group.name}をたためる`);
  toggle.innerHTML =
    '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">' +
    '<path d="M2.5 4l2.5 2.5L7.5 4" stroke="currentColor" stroke-width="1.4" ' +
    'stroke-linecap="round" stroke-linejoin="round"/></svg>';
  toggle.addEventListener("click", (event) => {
    event.stopPropagation();
    closeAllRowMenus();
    toggleGroup(group.id);
  });

  const icon = document.createElement("span");
  icon.className = "template-group-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML =
    '<svg width="14" height="14" viewBox="0 0 14 14" fill="none">' +
    '<path d="M1.5 3.5h3.2l1.1 1.4h6.7v6.1a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1z" ' +
    'stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>';

  const count = document.createElement("span");
  count.className = "template-group-count";
  count.textContent =
    items.length === group.items.length
      ? `${group.items.length}件`
      : `${group.items.length}件中 ${items.length}件`;

  head.append(toggle, icon, createGroupNameElement(group), count, createGroupMenu(group));
  head.addEventListener("pointerdown", (event) => {
    beginDrag(event, group.id, true);
  });

  li.append(head);
  // Left out of the DOM while folded: hidden rows would confuse the drop maths.
  if (!collapsed) {
    const list = document.createElement("ul");
    list.className = "template-list is-nested";
    markViewMode(list);
    list.dataset.groupId = group.id;
    list.setAttribute("role", "group");
    for (const meta of items) {
      list.append(createItem(meta, 2));
    }
    li.append(list);
  }
  head.addEventListener("click", (event) => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    closeAllRowMenus();
    selectGroup(group.id);
  });
  head.addEventListener("dblclick", (event) => {
    // グループ名のダブルクリックで名前変更。見出しの他の部分は何もしない
    if (!(event.target as Element | null)?.closest?.(".template-group-name")) {
      return;
    }
    selectGroup(group.id);
    startRenameGroup(group.id);
  });
  return li;
}

function createItem(meta: TemplateMeta, level: number): HTMLLIElement {
  const li = document.createElement("li");
  li.className = "template-item";
  li.classList.toggle("is-selected", meta.id === selectedId);
  li.dataset.nodeId = meta.id;
  li.setAttribute("role", "treeitem");
  li.setAttribute("aria-level", String(level));
  li.setAttribute("aria-selected", meta.id === selectedId ? "true" : "false");
  li.title = "クリックで選択・名前をダブルクリックで名前変更・ダブルクリックで複製・ドラッグで並べ替え";

  const thumb = document.createElement("div");
  thumb.className = "template-thumb";
  if (meta.thumbnail) {
    const img = document.createElement("img");
    img.src = meta.thumbnail;
    img.alt = "";
    // Without this the browser starts its own image drag, which cancels the
    // pointer drag as soon as a row is picked up by its thumbnail.
    img.draggable = false;
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
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    closeAllRowMenus();
    selectTemplate(meta.id);
  });
  li.addEventListener("dblclick", (event) => {
    // 名前テキストのダブルクリックは名前変更。それ以外（サムネイル・情報行・
    // バッジ）はこれまでどおり複製する
    const onName = Boolean((event.target as Element | null)?.closest?.(".template-name"));
    selectTemplate(meta.id);
    if (onName) {
      startRename(meta.id);
      return;
    }
    place(meta.id);
  });
  li.addEventListener("pointerdown", (event) => {
    beginDrag(event, meta.id, false);
  });
  return li;
}

/* ------------------------------ ドラッグ＆ドロップ ------------------------------ */

function isDragHandleExcluded(target: EventTarget | null): boolean {
  const el = target as Element | null;
  return Boolean(
    el?.closest?.(
      "input, textarea, .row-menu, .filter-menu, .list-menu, .view-menu, .template-group-toggle"
    )
  );
}

function beginDrag(event: PointerEvent, nodeId: string, group: boolean): void {
  if (event.button !== 0 || busyMessage || isDragHandleExcluded(event.target)) {
    return;
  }
  suppressClick = false;
  drag = {
    nodeId,
    isGroup: group,
    startX: event.clientX,
    startY: event.clientY,
    active: false,
  };
  window.addEventListener("pointermove", onDragMove);
  window.addEventListener("pointerup", onDragEnd);
  window.addEventListener("pointercancel", onDragCancel);
  window.addEventListener("keydown", onDragKey);
}

function onDragMove(event: PointerEvent): void {
  if (!drag) {
    return;
  }
  if (!drag.active) {
    if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < DRAG_THRESHOLD) {
      return;
    }
    drag.active = true;
    document.body.classList.add("is-dragging");
    const source = listEl.querySelector(`[data-node-id="${drag.nodeId}"]`);
    source?.classList.add("is-dragging");
  }
  // Keeps the pointer from selecting text while a row is being dragged.
  event.preventDefault();
  paintDropHint(resolveDropHint(drag, event));
}

function onDragEnd(event: PointerEvent): void {
  const state = drag;
  // Resolved before the drag is released, while the source classes are still in place.
  const hint = state?.active ? resolveDropHint(state, event) : null;
  releaseDrag();
  if (!state?.active) {
    return;
  }
  suppressClick = true;
  // グループのドラッグは必ずルートの前後（groupId: null）なので、入れ込みは発生しない。
  if (!hint) {
    renderList();
    return;
  }
  if (hint.row.dataset.nodeId === state.nodeId) {
    renderList();
    return;
  }
  moveNodeTo(state.nodeId, hint.groupId, hint.index);
}

function onDragCancel(): void {
  if (!drag) {
    return;
  }
  releaseDrag();
  suppressClick = true;
  renderList();
}

function onDragKey(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    onDragCancel();
  }
}

function releaseDrag(): void {
  drag = null;
  document.body.classList.remove("is-dragging");
  listEl.querySelectorAll(".is-dragging").forEach((el) => el.classList.remove("is-dragging"));
  listEl.querySelectorAll(".is-drop-before, .is-drop-after, .is-drop-into").forEach((el) => {
    el.classList.remove("is-drop-before", "is-drop-after", "is-drop-into");
  });
  window.removeEventListener("pointermove", onDragMove);
  window.removeEventListener("pointerup", onDragEnd);
  window.removeEventListener("pointercancel", onDragCancel);
  window.removeEventListener("keydown", onDragKey);
}

function scopeOf(row: HTMLElement): HTMLElement | null {
  const scope = row.parentElement;
  return scope?.classList.contains("template-list") ? (scope as HTMLElement) : null;
}

/** ルートのスロット番号。絞り込みで見えなくても tree の順で取る。 */
function rootSlot(id: string): number {
  return tree.findIndex((node) => node.id === id);
}

/** グループの中のスロット番号。見つからなければ -1。 */
function nestedSlot(groupId: string, id: string): number {
  return listGroups(tree).find((group) => group.id === groupId)?.items.indexOf(id) ?? -1;
}

/**
 * ヒントを引く線の前後。グリッドは列が左から右なので左右、リストは上下。
 * `scope` は入れ先のリスト（グループの中の行ならそのリスト）。
 */
function halfBefore(
  rect: DOMRect,
  scope: HTMLElement,
  event: Pick<PointerEvent, "clientX" | "clientY">
): boolean {
  return scope.classList.contains("is-grid")
    ? event.clientX < rect.left + rect.width / 2
    : event.clientY < rect.top + rect.height / 2;
}

/**
 * グループは入れ込めない。グループの見出しや中の行に載せたときは、
 * そのグループの前後をルートの位置として返す。
 */
function besideGroupHint(
  groupId: string,
  event: Pick<PointerEvent, "clientX" | "clientY">
): DropHint | null {
  const row = listEl.querySelector<HTMLElement>(`.template-group[data-node-id="${groupId}"]`);
  const at = rootSlot(groupId);
  if (!row || at < 0) {
    return null;
  }
  const before = halfBefore(row.getBoundingClientRect(), listEl, event);
  return {
    row,
    mode: before ? "before" : "after",
    groupId: null,
    index: before ? at : at + 1,
  };
}

/**
 * Works out where a drop would land. `index` counts the dragged node itself, so it
 * is the slot the node would occupy in the tree. The slot comes from the tree
 * rather than from the DOM, so filtering the list does not shift it.
 */
function resolveDropHint(
  state: DragState,
  event: Pick<PointerEvent, "clientX" | "clientY">
): DropHint | null {
  const element = document.elementFromPoint(event.clientX, event.clientY);
  const row = element?.closest<HTMLElement>(".template-item, .template-group") ?? null;
  if (!row) {
    return null;
  }
  const scope = scopeOf(row);
  if (!scope) {
    return null;
  }
  const scopeGroupId = scope.dataset.groupId ?? null;
  const rowId = row.dataset.nodeId ?? "";
  if (!rowId) {
    return null;
  }

  if (row.classList.contains("template-group")) {
    const group = listGroups(tree).find((entry) => entry.id === rowId);
    if (!group) {
      return null;
    }
    // グループ同士は入れ込めないので、見出しの前後を入れ替えにする。
    if (state.isGroup) {
      return besideGroupHint(rowId, event);
    }
    return { row, mode: "into", groupId: group.id, index: group.items.length };
  }

  // グループを中の行へ載せても入れ込めない。親グループの前後として受け付ける。
  if (state.isGroup && scopeGroupId) {
    return besideGroupHint(scopeGroupId, event);
  }

  const at = scopeGroupId ? nestedSlot(scopeGroupId, rowId) : rootSlot(rowId);
  if (at < 0) {
    return null;
  }
  const before = halfBefore(row.getBoundingClientRect(), scope, event);
  return {
    row,
    mode: before ? "before" : "after",
    groupId: scopeGroupId,
    index: before ? at : at + 1,
  };
}

function paintDropHint(hint: DropHint | null): void {
  listEl.querySelectorAll(".is-drop-before, .is-drop-after, .is-drop-into").forEach((el) => {
    el.classList.remove("is-drop-before", "is-drop-after", "is-drop-into");
  });
  if (!hint) {
    return;
  }
  hint.row.classList.add(
    hint.mode === "into" ? "is-drop-into" : hint.mode === "before" ? "is-drop-before" : "is-drop-after"
  );
}

/* ----------------------------------- 描画 ----------------------------------- */

interface VisibleGroup {
  type: "group";
  group: TemplateGroup;
  items: TemplateMeta[];
}

interface VisibleItem {
  type: "item";
  meta: TemplateMeta;
}

function visibleNodes(): Array<VisibleGroup | VisibleItem> {
  const query = filterInput.value.trim().toLowerCase();
  // 選んでいるカテゴリの行だけを出す。「未設定」（saveCategory が ""）は
  // category が無いテンプレートに当たる。
  const hits = (meta: TemplateMeta): boolean =>
    (!query || meta.name.toLowerCase().includes(query)) && (meta.category ?? "") === saveCategory;
  const nodes: Array<VisibleGroup | VisibleItem> = [];
  for (const node of tree) {
    if (isGroup(node)) {
      const items = node.items.flatMap((id) => {
        const meta = metaById(id);
        return meta && hits(meta) ? [meta] : [];
      });
      // A group just created has nothing in it yet, so it is shown even when empty;
      // only the filters are allowed to hide a group. 空のグループは中身で絞れないので、
      // グループ自身のカテゴリで出し分ける（出さないと全カテゴリに出てしまう）。
      const emptyHere =
        node.items.length === 0 && !query && normalizedCategory(node.category) === saveCategory;
      if (items.length > 0 || emptyHere) {
        // While filtering, a folded group is drawn open so its hits are visible.
        // A group that loses some of its contents to the filters is opened too;
        // one whose contents all match keeps its stored fold.
        // The stored flag is left alone.
        const hiddenInside = items.length !== node.items.length;
        nodes.push({
          type: "group",
          group: query || hiddenInside ? { ...node, collapsed: false } : node,
          items,
        });
      }
      continue;
    }
    const meta = metaById(node.id);
    if (meta && hits(meta)) {
      nodes.push({ type: "item", meta });
    }
  }
  return nodes;
}

/** Marks a list element so the CSS can lay it out for the current mode. */
function markViewMode(list: HTMLElement): void {
  list.classList.toggle("is-list", viewMode === "list");
  list.classList.toggle("is-grid", viewMode === "grid");
}

function renderList(): void {
  const nodes = visibleNodes();
  // The mode only changes the layout, never which rows are shown.
  markViewMode(listEl);
  countEl.textContent = templates.length > 0 ? `${templates.length}件` : "";
  listEl.replaceChildren();
  if (nodes.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    // A group can exist before it holds anything, so the tree decides whether
    // the list is really empty rather than the template count.
    li.textContent = tree.length === 0 ? "まだ保存した要素がありません" : "該当なし";
    listEl.append(li);
  } else {
    for (const node of nodes) {
      listEl.append(
        node.type === "group" ? createGroupItem(node.group, node.items) : createItem(node.meta, 1)
      );
    }
  }
  renderStatus();
}

function renderSelectionHint(count: number, isComponent: boolean, unsupported: number): void {
  savableCount = count;
  selectionHint.classList.toggle("is-ready", count > 0 && unsupported === 0);
  selectionHint.textContent =
    unsupported > 0
      ? `保存できない要素が ${unsupported} 件あります`
      : count === 0
        ? ""
        : isComponent
          ? "コンポーネントを選択中"
          : `${count} 件を選択中`;
  renderStatus();
}

/* --------------------------------- イベント --------------------------------- */

/** 画像の確認ダイアログを出す。選ぶまで保存は始まらない。 */
function askImages(question: {
  count: number;
  bytes: number;
  remaining: number;
  tooLarge: boolean;
}): void {
  imageQuestion = question;
  imageDialogBody.textContent =
    `選択に画像が ${question.count} 個（${formatBytes(question.bytes)}）含まれています。\n` +
    "画像を含めると容量を使うため、複製時にそのまま表示されます。";
  imageDialogNote.hidden = !question.tooLarge;
  imageDialogNote.textContent = question.tooLarge
    ? `残り容量（${formatBytes(question.remaining)}）より大きいため、「画像を含める」は選べません。`
    : "";
  imageKeepBtn.disabled = question.tooLarge;
  imageKeepBtn.title = question.tooLarge ? "残り容量が足りません" : "";
  imageDialog.hidden = false;
  (question.tooLarge ? imageSkipBtn : imageKeepBtn).focus();
}

function closeImageDialog(): void {
  imageQuestion = null;
  imageDialog.hidden = true;
}

/** 選んだ内容を保存側へ渡す。null は保存をやめる。 */
function answerImages(includeImages: boolean | null): void {
  if (!imageQuestion) {
    return;
  }
  closeImageDialog();
  showError(null);
  if (includeImages === null) {
    return;
  }
  // 画像の確認で1往復するので、カテゴリも同じものをもう一度送る。
  postToPlugin({ type: "SAVE_SELECTION", includeImages, category: saveCategory || undefined });
}

imageCancelBtn.addEventListener("click", () => answerImages(null));
imageSkipBtn.addEventListener("click", () => answerImages(false));
imageKeepBtn.addEventListener("click", () => answerImages(true));
imageDialog.addEventListener("click", (event) => {
  // カードの外（背面）を押したらキャンセル。
  if (event.target === imageDialog) {
    answerImages(null);
  }
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !imageDialog.hidden) {
    event.preventDefault();
    answerImages(null);
  }
});

importReplaceBtn.addEventListener("click", () => chooseImport("replace"));
importAppendBtn.addEventListener("click", () => chooseImport("append"));
importCategoryBtn.addEventListener("click", () => chooseImport("category"));
importCancelBtn.addEventListener("click", closeImportDialog);
importConfirmReplaceBtn.addEventListener("click", () => chooseImport("replace"));
importBackBtn.addEventListener("click", () => {
  const pending = pendingImport;
  if (pending) {
    openImportDialog({ ...pending, confirm: false });
  }
});
importDialog.addEventListener("click", (event) => {
  // カードの外（背面）を押したら選択に戻る。
  if (event.target === importDialog) {
    closeImportDialog();
  }
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !importDialog.hidden) {
    event.preventDefault();
    closeImportDialog();
  }
});

saveBtn.addEventListener("click", () => {
  showError(null);
  postToPlugin({ type: "SAVE_SELECTION", category: saveCategory || undefined });
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

viewModeToggleBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  closeAllPopups();
  setViewModePopoverOpen(viewModePopover.hidden);
});

viewModePopover.addEventListener("click", (event) => event.stopPropagation());

viewModePopover.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    setViewModePopoverOpen(false);
    viewModeToggleBtn.focus();
  }
});

categoryToggleBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  // 開いているかどうかは閉じる前に見る（closeAllPopups が隠してしまうため）。
  const willOpen = categoryPopover.hidden;
  closeAllPopups();
  setCategoryPopoverOpen(willOpen);
});

categoryPopover.addEventListener("click", (event) => event.stopPropagation());

categoryPopover.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    setCategoryPopoverOpen(false);
    categoryToggleBtn.focus();
  }
});

filterToggleBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  closeAllPopups();
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

listMenuToggleBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  closeAllPopups();
  setListMenuOpen(listMenuPopover.hidden);
});

listMenuPopover.addEventListener("click", (event) => event.stopPropagation());

listMenuPopover.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    setListMenuOpen(false);
    listMenuToggleBtn.focus();
  }
});

addCategoryBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  // 「⋯」を閉じてから、カテゴリメニューの中に入力欄を開く。
  closeAllPopups();
  setCategoryInput({ mode: "add", value: nextCategoryName() });
  setCategoryPopoverOpen(true);
});

addGroupBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  closeAllPopups();
  const id = newUiId();
  const name = `グループ ${listGroups(tree).length + 1}`;
  // 空のグループは自分のカテゴリでしか出ないので、今見ているカテゴリを付ける。
  const category = saveCategory || undefined;
  tree = addGroup(tree, { type: "group", id, name, items: [], ...(category ? { category } : {}) });
  renamingGroupId = id;
  selectedGroupId = id;
  selectedId = null;
  renderList();
  // The group lands at the end of the list, so bring it into view when the list is long.
  listEl.querySelector(`[data-node-id="${id}"]`)?.scrollIntoView({ block: "nearest" });
  postToPlugin({ type: "ADD_GROUP", id, name, category });
});

deleteCategoryBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  if (saveCategory === "") {
    return;
  }
  const linked = linkedInfo(saveCategory) !== undefined;
  if (linked) {
    // 共有カテゴリは登録を外すだけ。ほかの人も使っているので中身は消さない。
    deleteCategoryText.textContent = `「${saveCategory}」をこの一覧から外します`;
    deleteCategoryNote.textContent = "保存先のデータは消えません。もう一度追加すれば戻せます";
    deleteCategoryOkBtn.textContent = "外す";
  } else {
    const { templateIds, groupIds } = categoryDeletionTargets(saveCategory);
    const parts = [
      templateIds.size > 0 ? `テンプレート ${templateIds.size} 件` : "",
      groupIds.length > 0 ? `グループ ${groupIds.length} 件` : "",
    ].filter(Boolean);
    deleteCategoryText.textContent =
      parts.length > 0
        ? `「${saveCategory}」と中の${parts.join("・")}を削除します`
        : `「${saveCategory}」を削除します`;
    deleteCategoryNote.textContent = "元に戻せません。残すなら先に「すべて書き出す」で保存";
    deleteCategoryOkBtn.textContent = "削除";
  }
  listMenuItems.hidden = true;
  deleteCategoryConfirm.hidden = false;
  listMenuPopover.classList.add("is-confirm");
});

deleteCategoryCancelBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  showListMenuItems();
});

deleteCategoryOkBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  const name = saveCategory;
  if (name === "") {
    return;
  }
  const { templateIds, groupIds } = categoryDeletionTargets(name);
  if (selectedId && templateIds.has(selectedId)) {
    selectedId = null;
  }
  if (selectedGroupId && groupIds.includes(selectedGroupId)) {
    selectedGroupId = null;
  }
  closeAllPopups();
  postToPlugin({ type: "DELETE_CATEGORY", name });
  categories = categories.filter((entry) => entry !== name);
  saveCategory = "";
  syncCategoryToggle();
  renderList();
});

/* ------------------------------ 共有カテゴリ ------------------------------ */

/** R2 の入力欄から保存先を作る。足りなければ null（整えるのはプラグイン側）。 */
function readR2Inputs(): R2Source | null {
  const endpoint = linkedR2Url.value.trim();
  const token = linkedR2Token.value.trim();
  if (!endpoint || !token) {
    return null;
  }
  return { provider: "r2", endpoint, token, space: linkedR2Space.value.trim() || "default" };
}

function setLinkedTestResult(message: string, tone: "ok" | "error" | null = null): void {
  linkedTestResult.textContent = message;
  linkedTestResult.classList.toggle("is-ok", tone === "ok");
  linkedTestResult.classList.toggle("is-error", tone === "error");
}

function syncLinkedDialog(): void {
  const ready = readR2Inputs() !== null;
  linkedTestBtn.disabled = !ready || linkedTesting || linkedAdding;
  linkedAddBtn.disabled = !ready || linkedAdding;
}

function openLinkedDialog(): void {
  closeAllPopups();
  for (const input of [linkedNameInput, linkedR2Url, linkedR2Token, linkedR2Space]) {
    input.value = "";
  }
  linkedTesting = false;
  linkedAdding = false;
  setLinkedTestResult("");
  syncLinkedDialog();
  linkedDialog.hidden = false;
  linkedNameInput.focus();
}

function closeLinkedDialog(): void {
  linkedDialog.hidden = true;
  listMenuToggleBtn.focus();
}

addLinkedCategoryBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  openLinkedDialog();
});

[linkedR2Url, linkedR2Token, linkedR2Space].forEach((input) => {
  input.addEventListener("input", () => {
    setLinkedTestResult("");
    syncLinkedDialog();
  });
});

linkedTestBtn.addEventListener("click", () => {
  linkedTesting = true;
  setLinkedTestResult("確認しています…");
  syncLinkedDialog();
  postToPlugin({ type: "STORAGE_TEST", source: readR2Inputs() });
});

linkedAddBtn.addEventListener("click", () => {
  const source = readR2Inputs();
  if (!source) {
    return;
  }
  linkedAdding = true;
  setLinkedTestResult("保存先を確認しています…");
  syncLinkedDialog();
  postToPlugin({ type: "ADD_LINKED_CATEGORY", name: linkedNameInput.value.trim(), source });
});

linkedCancelBtn.addEventListener("click", closeLinkedDialog);

linkedDialog.addEventListener("click", (event) => {
  // カードの外（背面）を押したら閉じる。
  if (event.target === linkedDialog) {
    closeLinkedDialog();
  }
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !linkedDialog.hidden) {
    event.preventDefault();
    closeLinkedDialog();
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

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") {
    return;
  }
  // The toggles keep the focus, so a listener inside the popover alone is not enough.
  if (listEl.querySelector(".row-menu-panel:not([hidden])")) {
    closeAllRowMenus();
    return;
  }
  if (!viewModePopover.hidden) {
    setViewModePopoverOpen(false);
    viewModeToggleBtn.focus();
    return;
  }
  if (!categoryPopover.hidden) {
    setCategoryPopoverOpen(false);
    categoryToggleBtn.focus();
    return;
  }
  if (!filterPopover.hidden) {
    setFilterPopoverOpen(false);
    filterToggleBtn.focus();
    return;
  }
  if (!listMenuPopover.hidden) {
    setListMenuOpen(false);
    listMenuToggleBtn.focus();
  }
});

document.addEventListener("click", (event) => {
  closeAllRowMenus();
  const target = event.target as Node | null;
  if (target && !viewModeToggleBtn.closest(".view-menu")?.contains(target)) {
    setViewModePopoverOpen(false);
  }
  if (target && !categoryToggleBtn.closest(".category-menu")?.contains(target)) {
    setCategoryPopoverOpen(false);
  }
  if (target && !filterToggleBtn.closest(".filter-menu")?.contains(target)) {
    setFilterPopoverOpen(false);
  }
  if (target && !listMenuToggleBtn.closest(".list-menu")?.contains(target)) {
    setListMenuOpen(false);
  }
  // 一覧の行以外（余白やヘッダーなども含む）をクリックしたら選択を解除する。
  if ((selectedId || selectedGroupId) && !isInsideKeptArea(event.target)) {
    selectedId = null;
    selectedGroupId = null;
    renderList();
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
    case "TEMPLATES": {
      templates = msg.templates;
      tree = msg.tree;
      // 容量表示はここでしか受け取らない。外し忘れると表示されない。
      usage = { used: msg.usedBytes, quota: msg.quotaBytes };
      // 一覧が届いたなら保存先には届いている。
      showStorageError(null);
      if (isViewMode(msg.viewMode)) {
        viewMode = msg.viewMode;
        syncViewModeToggle();
      }
      if (selectedId && !templates.some((t) => t.id === selectedId)) {
        selectedId = null;
      }
      if (renamingId && !templates.some((t) => t.id === renamingId)) {
        renamingId = null;
      }
      const groups = listGroups(tree);
      if (selectedGroupId && !groups.some((g) => g.id === selectedGroupId)) {
        selectedGroupId = null;
      }
      if (renamingGroupId && !groups.some((g) => g.id === renamingGroupId)) {
        renamingGroupId = null;
      }
      // カテゴリはこのメッセージでしか届かない。開いていたら作り直す。
      categories = msg.categories ?? [];
      linkedCategories = msg.linked ?? [];
      if (saveCategory !== "" && !categories.includes(saveCategory)) {
        saveCategory = "";
        syncCategoryToggle();
      }
      if (!categoryPopover.hidden && !categoryInput) {
        buildCategoryItems();
      }
      renderList();
      break;
    }
    case "SELECTION_STATE":
      renderSelectionHint(msg.savableCount, msg.isComponent, msg.unsupportedCount);
      canvasSelectionCount = msg.selectionCount;
      // ユーザーがキャンバスで選択を変えたときだけ、一覧の選択を解除する。
      if (msg.origin === "user" && (selectedId || selectedGroupId)) {
        selectedId = null;
        selectedGroupId = null;
        renderList();
      }
      break;
    case "ASK_IMAGES":
      askImages(msg);
      break;
    case "BUSY":
      busyMessage = msg.message;
      renderStatus();
      break;
    case "SAVED":
      selectedId = msg.id;
      selectedGroupId = null;
      renamingGroupId = null;
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
    case "STORAGE_TEST_RESULT":
      linkedTesting = false;
      setLinkedTestResult(msg.message, msg.ok ? "ok" : "error");
      syncLinkedDialog();
      break;
    case "LINKED_CATEGORY_RESULT":
      linkedAdding = false;
      if (msg.ok && msg.name) {
        linkedDialog.hidden = true;
        if (!categories.includes(msg.name)) {
          categories = [...categories, msg.name];
        }
        // 追加したカテゴリをそのまま開く。中身はプラグインが読み込んで送ってくる。
        saveCategory = msg.name;
        syncCategoryToggle();
        renderList();
      } else {
        setLinkedTestResult(msg.message ?? "", "error");
        syncLinkedDialog();
      }
      break;
    case "STORAGE_ERROR":
      // 黙ってローカルに戻さず、設定画面で選び直してもらう。
      errorEl.hidden = true;
      showStorageError(msg.message);
      break;
  }
};

// Nothing inside the list may start a browser drag; the pointer events handle it.
listEl.addEventListener("dragstart", (event) => event.preventDefault());

setupResize();
syncViewModeToggle();
syncCategoryToggle();
renderSelectionHint(0, false, 0);
renderList();
postToPlugin({ type: "LIST" });
