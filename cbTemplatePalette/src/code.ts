import type { PluginToUiMessage, UiToPluginMessage } from "./messages";
import { placeholderImageNodesInTree, restoreTemplate } from "./deserialize";
import {
  collectImageHashes,
  decodeImages,
  encodeImages,
  withoutImagePaints,
  withoutImagePaintsIn,
} from "./images";
import {
  isComponentRoot,
  isSavableRoot,
  serializeComponentTemplate,
  serializeSelection,
} from "./serialize";
import { isMetadata } from "./jsonCodec";
import { METADATA_KEY, adapterForSource, normalizeSource, sameSource, sourceErrorMessage, testSource } from "./sources";
import {
  QuotaExceededError,
  addCategory,
  decodeItem,
  deleteTemplates,
  encodeItem,
  estimateBytes,
  listCategories,
  loadIndex,
  loadItem,
  loadTree,
  removeCategory,
  renameCategory,
  saveTemplate,
  saveTree,
  setTemplatesCategory,
  updateTemplate,
  usedBytes,
} from "./storage";
import { StorageAccessError, storage } from "./storageAdapter";
import {
  activeStore,
  currentViewCategory,
  enqueue,
  homeStore,
  initStores,
  linkByName,
  linkedCategories,
  linkedCategoryInfo,
  setLinkedCategories,
  setViewCategory,
  storeForCategory,
  viewStore,
  withStore,
  type Store,
} from "./stores";
import {
  addGroup,
  appendMissingItems,
  dropGroup,
  isGroup,
  listGroups,
  moveNode,
  remapTree,
  removeItems,
  renameGroup,
  setGroupCategory,
  setGroupCollapsed,
} from "./tree";
import {
  IMPORT_CATEGORY_NAME,
  NO_CATEGORY,
  isImportMode,
  isViewMode,
  TEMPLATE_FILE_FORMAT,
  type ImageMode,
  type ImportMode,
  type ListNode,
  type RestoreReport,
  type SerializedNode,
  type StoredTemplateV3,
  type TemplateContent,
  type TemplateFile,
  type TemplateGroup,
  type TemplateItem,
  type TemplateMeta,
  type ViewMode,
} from "./types";

const UI_WIDTH = 360;
const DEFAULT_UI_HEIGHT = 560;
const MIN_UI_HEIGHT = 320;
const MAX_UI_HEIGHT = 900;
const UI_HEIGHT_STORAGE_KEY = "cbTemplatePalette.uiHeight";
const VIEW_MODE_STORAGE_KEY = "cbTemplatePalette.viewMode";
const THUMBNAIL_SIDE = 120;
const THUMBNAIL_VERSION = 2;
const THUMBNAIL_OFFSCREEN_GAP = 1000;
const FILE_SUFFIX = ".cbtemplate.json";
/** サムネイルのデータ URL とインデックス分の余裕。 */
const THUMBNAIL_RESERVE_BYTES = 64 * 1024;
/** 画像バイト列のキャッシュ上限。ハッシュは内容アドレスなので古いまま使える。 */
const IMAGE_CACHE_BYTES = 8 * 1024 * 1024;
const imageBytesCache = new Map<string, Uint8Array>();
/** Set on a saved component so a template can tell whether its original is in the current file. */
const STAMP_DATA = "cbTemplatePalette.stamp";

function postToUi(message: PluginToUiMessage): void {
  figma.ui.postMessage(message);
}

function clampUiHeight(height: number): number {
  return Math.min(MAX_UI_HEIGHT, Math.max(MIN_UI_HEIGHT, Math.round(height)));
}

/**
 * How many of the selected nodes can be saved. Unsupported ones are never
 * dropped silently: a selection holding one is refused by the save button.
 */
function selectionCounts(): { savable: SceneNode[]; unsupported: number } {
  const savable: SceneNode[] = [];
  let unsupported = 0;
  for (const node of figma.currentPage.selection) {
    if (isSavableRoot(node)) {
      savable.push(node);
    } else {
      unsupported += 1;
    }
  }
  return { savable, unsupported };
}

/** Set while the plugin changes the selection itself, so the next selectionchange is not a user action. */
let pluginInitiatedSelection = false;

function postSelectionState(): void {
  const origin = pluginInitiatedSelection ? "plugin" : "user";
  pluginInitiatedSelection = false;
  const { savable, unsupported } = selectionCounts();
  postToUi({
    type: "SELECTION_STATE",
    savableCount: unsupported > 0 ? 0 : savable.length,
    isComponent: unsupported > 0 ? false : componentSelection(savable) !== null,
    selectionCount: figma.currentPage.selection.length,
    unsupportedCount: unsupported,
    origin,
  });
}

function postTemplates(index: TemplateMeta[]): Promise<void> {
  return postTemplatesWithTree(index, loadTree(index));
}

/**
 * 今使っている保存先の一覧を送る。共有カテゴリの保存先なら、テンプレートとグループに
 * そのカテゴリ名を付ける（保存先の中のカテゴリ名は人によって違うので使わない）。
 */
async function postTemplatesWithTree(index: TemplateMeta[], tree: Promise<ListNode[]>): Promise<void> {
  const resolvedTree = await tree;
  const store = activeStore();
  const link = store.link;
  if (!link) {
    homeCategories = await listCategories(index, resolvedTree);
  }
  const linkedNames = linkedCategories().map((entry) => entry.name);
  listedStoreKey = store.key;
  postToUi({
    type: "TEMPLATES",
    templates: link ? index.map((meta) => ({ ...meta, category: link.name })) : index,
    tree: link
      ? resolvedTree.map((node) => (isGroup(node) ? { ...node, category: link.name } : node))
      : resolvedTree,
    viewMode: await loadViewMode(),
    categories: [...new Set([...homeCategories.filter((name) => !linkedNames.includes(name)), ...linkedNames])],
    linked: linkedCategoryInfo(),
    usedBytes: usedBytes(index),
    quotaBytes: storage().quotaBytes,
  });
}

/** Applies a list change to the tree, saves it, and sends the whole list back. */
async function commitTree(
  index: TemplateMeta[],
  change: (tree: ListNode[]) => ListNode[]
): Promise<void> {
  await postTemplatesWithTree(index, saveTree(change(await loadTree(index))));
}

function newId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * One node to export. Several roots are grouped so the picture covers all of
 * them; a section cannot live inside a group, so those fall back to the first
 * root the way the thumbnail used to be made.
 */
function thumbnailTarget(nodes: SceneNode[]): SceneNode {
  const first = nodes[0];
  if (nodes.length === 1 || !first || nodes.some((node) => node.type === "SECTION")) {
    return first;
  }
  try {
    // Grouping keeps the positions the restore just gave the nodes.
    return figma.group(nodes, figma.currentPage);
  } catch {
    return first;
  }
}

/**
 * Renders the selection as it would be duplicated (image paints become solid
 * fills). Several roots are grouped first, so the picture covers all of them
 * instead of only the first one.
 */
async function renderThumbnail(
  roots: SerializedNode[],
  images?: Record<string, Uint8Array>
): Promise<string> {
  if (roots.length === 0) {
    return "";
  }
  const bounds = figma.viewport.bounds;
  let created: SceneNode[] = [];
  let target: SceneNode | null = null;
  try {
    const { nodes } = await restoreTemplate(
      { roots, ...(images ? { images } : {}) },
      figma.currentPage,
      {
        x: Math.round(bounds.x + bounds.width + THUMBNAIL_OFFSCREEN_GAP),
        y: Math.round(bounds.y),
      },
      { mode: "flatten" }
    );
    created = nodes;
    target = thumbnailTarget(nodes);
    const constraint: ExportSettingsConstraints =
      target.width >= target.height
        ? { type: "WIDTH", value: THUMBNAIL_SIDE }
        : { type: "HEIGHT", value: THUMBNAIL_SIDE };
    const bytes = await target.exportAsync({ format: "JPG", constraint });
    return `data:image/jpeg;base64,${figma.base64Encode(bytes)}`;
  } catch {
    return "";
  } finally {
    // A temporary group is not in `created`; removing it takes the nodes with it.
    // No `return` here: it would throw away the data URL the try block produced.
    if (target && !created.includes(target) && !target.removed) {
      target.remove();
    }
    for (const node of created) {
      if (!node.removed) {
        node.remove();
      }
    }
  }
}

function countNodes(nodes: SceneNode[]): number {
  let total = 0;
  for (const node of nodes) {
    total += 1;
    if ("children" in node) {
      total += countNodes([...node.children]);
    }
  }
  return total;
}

/** A single selected component or component set becomes a component template. */
function componentSelection(roots: SceneNode[]): ComponentNode | ComponentSetNode | null {
  return roots.length === 1 && isComponentRoot(roots[0]) ? roots[0] : null;
}

function ensureStamp(node: ComponentNode | ComponentSetNode): string {
  const existing = node.getPluginData(STAMP_DATA);
  if (existing) {
    return existing;
  }
  const stamp = newId();
  node.setPluginData(STAMP_DATA, stamp);
  return stamp;
}

/** 保存対象の画像ハッシュのバイト列を取り出す。取れなかった画像は省略する。 */
async function collectImageBytes(hashes: string[]): Promise<Record<string, Uint8Array>> {
  const images: Record<string, Uint8Array> = {};
  for (const hash of hashes) {
    const cached = imageBytesCache.get(hash);
    if (cached) {
      images[hash] = cached;
      continue;
    }
    const image = figma.getImageByHash(hash);
    if (!image) {
      continue;
    }
    try {
      const bytes = await image.getBytesAsync();
      images[hash] = bytes;
      if (imageBytesCache.size > 0 && cachedBytes() + bytes.byteLength > IMAGE_CACHE_BYTES) {
        imageBytesCache.clear();
      }
      imageBytesCache.set(hash, bytes);
    } catch {
      // 読めない画像は単色のプレースホルダに任せる。
    }
  }
  return images;
}

function cachedBytes(): number {
  let sum = 0;
  for (const bytes of imageBytesCache.values()) {
    sum += bytes.byteLength;
  }
  return sum;
}

function totalBytes(images: Record<string, Uint8Array>): number {
  return Object.values(images).reduce((sum, bytes) => sum + bytes.byteLength, 0);
}

async function handleSave(includeImages?: boolean, category?: string): Promise<void> {
  const { savable: roots, unsupported } = selectionCounts();
  if (unsupported > 0) {
    postToUi({
      type: "ERROR",
      message: `保存できない要素が ${unsupported} 件混ざっています。保存できる要素だけを選んでください`,
    });
    return;
  }
  if (roots.length === 0) {
    postToUi({
      type: "ERROR",
      message: "選択できる要素がありません",
    });
    return;
  }
  postToUi({ type: "BUSY", message: "保存しています…" });
  try {
    const component = componentSelection(roots);
    const serialized = component
      ? await serializeComponentTemplate(component)
      : await serializeSelection(roots);
    if (!serialized) {
      postToUi({ type: "ERROR", message: "選択した要素のサイズを取得できませんでした" });
      return;
    }

    const hashes = collectImageHashes([
      ...serialized.roots,
      ...Object.values(serialized.components ?? {}),
    ]);
    if (hashes.length > 0 && includeImages === undefined) {
      // 画像を含めるか聞くまで保存しない。
      const bytes = await collectImageBytes(hashes);
      const quota = storage().quotaBytes;
      const remaining =
        quota === null ? Number.MAX_SAFE_INTEGER : Math.max(quota - usedBytes(await loadIndex()), 0);
      const size = totalBytes(bytes);
      postToUi({
        type: "ASK_IMAGES",
        count: hashes.length,
        bytes: size,
        remaining,
        tooLarge: size + THUMBNAIL_RESERVE_BYTES > remaining,
      });
      return;
    }

    const mode: ImageMode = hashes.length > 0 && includeImages ? "keep" : "placeholder";
    const images = mode === "keep" ? await collectImageBytes(hashes) : undefined;
    const savedRoots = mode === "keep" ? serialized.roots : withoutImagePaints(serialized.roots).roots;
    const savedComponents = withoutImagePaintsIn(serialized.components, mode === "keep");
    const item = encodeItem(savedRoots, savedComponents, images);
    const thumbnail = await renderThumbnail(savedRoots, images);
    const meta: TemplateMeta = {
      id: newId(),
      name: roots.length > 1 ? `${roots[0].name} ほか ${roots.length - 1} 件` : roots[0].name,
      width: Math.round(serialized.width),
      height: Math.round(serialized.height),
      createdAt: Date.now(),
      byteSize: estimateBytes(item, thumbnail),
      nodeCount: serialized.report.nodeCount,
      thumbnail,
      thumbnailVersion: THUMBNAIL_VERSION,
    };
    // ヘッダーのカテゴリメニュー。未設定なら何も入れない（`category` 無し＝未設定）。
    const trimmedCategory = category?.trim();
    if (trimmedCategory) {
      meta.category = trimmedCategory;
    }
    if (component) {
      meta.kind = "component";
      meta.source = { nodeId: component.id, stamp: ensureStamp(component) };
      if (hashes.length > 0) {
        meta.imageMode = mode;
      }
    }
    const index = await saveTemplate(meta, item);
    await postTemplates(index);
    postToUi({ type: "SAVED", id: meta.id });
    const label = component ? "コンポーネントとして保存しました" : "保存しました";
    const imageNote = mode === "keep" ? `（画像 ${hashes.length} 個を同梱）` : "";
    figma.notify(
      serialized.report.skipped > 0
        ? `「${meta.name}」を${label}${imageNote}（対象外の要素 ${serialized.report.skipped} 件はスキップ）`
        : `「${meta.name}」を${label}${imageNote}`
    );
  } finally {
    postToUi({ type: "BUSY", message: null });
  }
}

/** The original component when it is still in this file (id and stamp both match). */
async function findSourceComponent(meta: TemplateMeta): Promise<ComponentNode | ComponentSetNode | null> {
  if (meta.kind !== "component" || !meta.source) {
    return null;
  }
  try {
    const node = await figma.getNodeByIdAsync(meta.source.nodeId);
    if (
      node &&
      !node.removed &&
      (node.type === "COMPONENT" || node.type === "COMPONENT_SET") &&
      node.getPluginData(STAMP_DATA) === meta.source.stamp
    ) {
      return node;
    }
  } catch {
    // Not in this file.
  }
  return null;
}

function placementNotes(report: RestoreReport): string[] {
  const notes: string[] = [];
  if (report.createdComponents > 0) {
    notes.push(`部品コンポーネント ${report.createdComponents} 件を作成`);
  }
  if (report.detachedInstances > 0) {
    notes.push(`インスタンス ${report.detachedInstances} 件をフレームに置き換え`);
  }
  if (report.replacedFonts.length > 0) {
    notes.push(`フォント ${report.replacedFonts.length} 種を置き換え`);
  }
  if (report.replacedImages > 0) {
    notes.push(`画像 ${report.replacedImages} 件を単色に置き換え`);
  }
  if (report.failedComponentProps > 0) {
    notes.push(`コンポーネントのプロパティ ${report.failedComponentProps} 件を再現できず`);
  }
  if (report.failedProps > 0) {
    notes.push(`一部のプロパティ ${report.failedProps} 件を復元できず`);
  }
  return notes;
}

async function cloneSourceComponent(
  source: ComponentNode | ComponentSetNode,
  topLeft: { x: number; y: number },
  mode: ImageMode
): Promise<{ node: SceneNode; replacedImages: number }> {
  const clone = source.clone();
  if (clone.parent !== figma.currentPage) {
    figma.currentPage.appendChild(clone);
  }
  clone.x = topLeft.x;
  clone.y = topLeft.y;
  if (mode === "keep") {
    return { node: clone, replacedImages: 0 };
  }
  const { node, replaced } = await placeholderImageNodesInTree(clone);
  return { node, replacedImages: replaced };
}

async function handlePlace(id: string): Promise<void> {
  const index = await loadIndex();
  const meta = index.find((entry) => entry.id === id);
  const item = await loadItem(id);
  if (!meta || !item) {
    postToUi({ type: "ERROR", message: "テンプレートが見つかりません" });
    await postTemplates(index);
    return;
  }
  postToUi({ type: "BUSY", message: "複製しています…" });
  try {
    const center = figma.viewport.center;
    const topLeft = {
      x: Math.round(center.x - meta.width / 2),
      y: Math.round(center.y - meta.height / 2),
    };
    const isComponent = meta.kind === "component";

    const source = await findSourceComponent(meta);
    if (source) {
      const { node, replacedImages } = await cloneSourceComponent(
        source,
        topLeft,
        meta.imageMode ?? "placeholder"
      );
      pluginInitiatedSelection = true;
      figma.currentPage.selection = [node];
      figma.notify(
        replacedImages > 0
          ? `「${meta.name}」を新しいコンポーネントとして複製しました（画像 ${replacedImages} 件を枠線に置き換え）`
          : `「${meta.name}」を新しいコンポーネントとして複製しました`
      );
      return;
    }

    const { nodes, report } = await restoreTemplate(decodeItem(item), figma.currentPage, topLeft, {
      mode: isComponent ? "component" : "layout",
    });
    if (nodes.length === 0) {
      postToUi({ type: "ERROR", message: "複製できる要素がありませんでした" });
      return;
    }
    pluginInitiatedSelection = true;
    figma.currentPage.selection = nodes;
    const notes = placementNotes(report);
    const label = isComponent ? "新しいコンポーネントとして複製しました" : "複製しました";
    figma.notify(
      notes.length > 0
        ? `「${meta.name}」を${label}（${notes.join("・")}）`
        : `「${meta.name}」を${label}（${countNodes(nodes)} 要素）`
    );
  } finally {
    postToUi({ type: "BUSY", message: null });
  }
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim() || "template";
}

/**
 * Renames the entry and the name stored in the saved data, so a later duplicate
 * gets the same layer name. The element on the canvas is left alone.
 * Several roots keep their own names: naming them all the same would lose what
 * each one was called.
 */
function renamedRoots(roots: SerializedNode[], name: string): SerializedNode[] {
  const root = roots.length === 1 ? roots[0] : null;
  if (!root || root.props.name === name) {
    return roots;
  }
  return [{ ...root, props: { ...root.props, name } }];
}

async function handleRename(id: string, rawName: string): Promise<void> {
  const name = rawName.trim();
  if (!name) {
    return;
  }
  const meta = (await loadIndex()).find((entry) => entry.id === id);
  if (!meta) {
    return;
  }
  if (meta.name === name) {
    await postTemplates(await loadIndex());
    return;
  }
  const item = await loadItem(id);
  if (!item) {
    await postTemplates(await updateTemplate(id, { name }));
    return;
  }
  postToUi({ type: "BUSY", message: "名前を変更しています…" });
  try {
    const content = decodeItem(item);
    const roots = renamedRoots(content.roots, name);
    const next = encodeItem(roots, content.components);
    // The picture shows the old name, so it has to be drawn again. A failed
    // render must not wipe the picture that is already there.
    const drawn = await renderThumbnail(roots);
    const thumbnail = drawn || meta.thumbnail;
    await postTemplates(
      await updateTemplate(
        id,
        { name, thumbnail, byteSize: estimateBytes(next, thumbnail) },
        next
      )
    );
    figma.notify(`「${name}」に名前を変更しました`);
  } finally {
    postToUi({ type: "BUSY", message: null });
  }
}

/** Deletes a group and the templates inside it. There is no way back. */
async function handleDeleteGroup(id: string): Promise<void> {
  const index = await loadIndex();
  const group = listGroups(await loadTree(index)).find((entry) => entry.id === id);
  if (!group) {
    await commitTree(index, (tree) => dropGroup(tree, id));
    return;
  }
  const next = await deleteTemplates(group.items, [id]);
  await postTemplatesWithTree(next, loadTree(next));
  const removed = index.length - next.length;
  figma.notify(
    `「${group.name}」を削除しました${removed > 0 ? `（中の ${removed} 件も削除）` : ""}`
  );
}

/** そのカテゴリのグループ（中身ごと）とテンプレートを消し、レジストリからも外す。 */
async function handleDeleteCategory(name: string): Promise<void> {
  const index = await loadIndex();
  const groups = listGroups(await loadTree(index)).filter((group) => group.category === name);
  const ids = new Set<string>(groups.flatMap((group) => group.items));
  for (const meta of index) {
    if (meta.category === name) {
      ids.add(meta.id);
    }
  }
  await removeCategory(name);
  const next = await deleteTemplates(
    [...ids],
    groups.map((group) => group.id)
  );
  await postTemplatesWithTree(next, loadTree(next));
  const removed = index.length - next.length;
  const parts = [
    removed > 0 ? `テンプレート ${removed} 件` : "",
    groups.length > 0 ? `グループ ${groups.length} 件` : "",
  ].filter(Boolean);
  figma.notify(
    `カテゴリ「${name}」を削除しました${parts.length > 0 ? `（${parts.join("・")}も削除）` : ""}`
  );
}

/** The tree of a file export, without the templates whose body could not be read. */
function exportTree(tree: ListNode[], exported: Set<string>): ListNode[] {
  const nodes: ListNode[] = [];
  for (const node of tree) {
    if (isGroup(node)) {
      const items = node.items.filter((id) => exported.has(id));
      if (items.length > 0) {
        // Rebuilt instead of spread so `collapsed` stays out of the file.
        nodes.push({
          type: "group",
          id: node.id,
          name: node.name,
          ...(typeof node.category === "string" && node.category !== "" ? { category: node.category } : {}),
          items,
        });
      }
      continue;
    }
    if (exported.has(node.id)) {
      nodes.push(node);
    }
  }
  return nodes;
}

async function handleExport(ids: string[] | null): Promise<void> {
  const index = await loadIndex();
  const targets = ids ? index.filter((meta) => ids.includes(meta.id)) : index;
  if (targets.length === 0) {
    postToUi({ type: "ERROR", message: "書き出すテンプレートがありません" });
    return;
  }
  postToUi({ type: "BUSY", message: "書き出しています…" });
  try {
    const file = await buildExportFile(targets);
    const exported = new Set(file.templates.map((entry) => entry.meta.id));
    // A single template is exported flat; its group is not worth recreating on import.
    file.tree = ids
      ? file.templates.map((entry) => ({ type: "item" as const, id: entry.meta.id }))
      : exportTree(await loadTree(index), exported);
    const fileName =
      ids && targets.length === 1
        ? `${safeFileName(targets[0].name)}${FILE_SUFFIX}`
        : `cbTemplatePalette-${exportStamp()}${FILE_SUFFIX}`;
    postToUi({ type: "EXPORT_DATA", fileName, text: JSON.stringify(file) });
  } finally {
    postToUi({ type: "BUSY", message: null });
  }
}

/** Writes one group and nothing else. The group itself comes back as one group on import. */
async function handleExportGroup(groupId: string): Promise<void> {
  const index = await loadIndex();
  const tree = await loadTree(index);
  const group = listGroups(tree).find((entry) => entry.id === groupId);
  if (!group) {
    postToUi({ type: "ERROR", message: "書き出すグループがありません" });
    return;
  }
  const exported = new Set(group.items);
  const targets = index.filter((meta) => exported.has(meta.id));
  if (targets.length === 0) {
    postToUi({ type: "ERROR", message: `グループ「${group.name}」には書き出すテンプレートがありません` });
    return;
  }
  postToUi({ type: "BUSY", message: "書き出しています…" });
  try {
    const file = await buildExportFile(targets);
    file.tree = exportTree(tree, new Set(file.templates.map((entry) => entry.meta.id)));
    postToUi({
      type: "EXPORT_DATA",
      fileName: `${safeFileName(group.name)}${FILE_SUFFIX}`,
      text: JSON.stringify(file),
    });
  } finally {
    postToUi({ type: "BUSY", message: null });
  }
}

/** Reads the saved data of every target. Entries whose data is gone are left out. */
async function buildExportFile(targets: TemplateMeta[]): Promise<TemplateFile> {
  const templates: TemplateFile["templates"] = [];
  let withImages = false;
  for (const meta of targets) {
    const item = await loadItem(meta.id);
    if (!item) {
      continue;
    }
    const content = decodeItem(item);
    const images = encodeImages(content.images);
    withImages = withImages || images !== undefined;
    templates.push({
      meta,
      roots: content.roots,
      ...(content.components ? { components: content.components } : {}),
      ...(images ? { images } : {}),
    });
  }
  // 画像を含まないときは version 3 のまま。古いバージョンでも読める。
  const file: TemplateFile = {
    format: TEMPLATE_FILE_FORMAT,
    version: withImages ? 4 : 3,
    tree: [],
    templates,
  };
  return file;
}

function exportStamp(): string {
  const now = new Date();
  return `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}-${pad2(now.getHours())}${pad2(now.getMinutes())}`;
}

interface ParsedTemplateFile {
  templates: TemplateFile["templates"];
  /** Version 2 files have no tree, so every template lands at the root. */
  tree: ListNode[];
}

function parsedFileTree(raw: TemplateFile["tree"]): ListNode[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const nodes: ListNode[] = [];
  for (const node of raw) {
    if (!node || typeof node.id !== "string") {
      continue;
    }
    if (node.type === "group" && Array.isArray(node.items)) {
      const name = typeof node.name === "string" ? node.name.trim() : "";
      // Rebuilt, so a `collapsed` in the file is ignored and the group opens.
      nodes.push({
        type: "group",
        id: node.id,
        name: name || "グループ",
        ...(typeof node.category === "string" && node.category.trim() !== ""
          ? { category: node.category.trim() }
          : {}),
        items: node.items.filter((id): id is string => typeof id === "string"),
      });
      continue;
    }
    if (node.type === "item") {
      nodes.push({ type: "item", id: node.id });
    }
  }
  return nodes;
}

function parseTemplateFile(text: string): ParsedTemplateFile | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const file = parsed as Partial<TemplateFile> | null;
  if (!file || file.format !== TEMPLATE_FILE_FORMAT || !Array.isArray(file.templates)) {
    return null;
  }
  return {
    templates: file.templates.filter(
      (entry) =>
        entry &&
        typeof entry.meta === "object" &&
        entry.meta !== null &&
        Array.isArray(entry.roots) &&
        entry.roots.every((root: SerializedNode) => root && typeof root.type === "string")
    ),
    tree: parsedFileTree(file.tree),
  };
}

/**
 * The name shown in the list. The file's own name wins; a file written by hand or
 * by an older version may not have one, so the saved node's name is the next best
 * thing. Anything still nameless falls back to a plain label.
 */
function importedName(meta: Partial<TemplateMeta>, roots: SerializedNode[]): string {
  const given = typeof meta.name === "string" ? meta.name.trim() : "";
  if (given) {
    return given;
  }
  const nodeName = roots[0]?.props?.name;
  const fromNode = typeof nodeName === "string" ? nodeName.trim() : "";
  return fromNode || "テンプレート";
}

function importedMeta(meta: Partial<TemplateMeta>, roots: SerializedNode[], thumbnail: string): TemplateMeta {
  return {
    id: newId(),
    name: importedName(meta, roots),
    width: Number(meta.width) || 0,
    height: Number(meta.height) || 0,
    createdAt: Number(meta.createdAt) || Date.now(),
    byteSize: 0,
    nodeCount: Number(meta.nodeCount) || roots.length,
    thumbnail,
    thumbnailVersion: THUMBNAIL_VERSION,
    ...(meta.kind === "component" ? { kind: "component" as const } : {}),
    ...(meta.source && typeof meta.source.nodeId === "string" && typeof meta.source.stamp === "string"
      ? { source: { nodeId: meta.source.nodeId, stamp: meta.source.stamp } }
      : {}),
    ...(meta.imageMode === "keep" || meta.imageMode === "placeholder"
      ? { imageMode: meta.imageMode }
      : {}),
    ...(typeof meta.category === "string" && meta.category !== ""
      ? { category: meta.category }
      : {}),
  };
}

function importedComponents(value: unknown): TemplateContent["components"] {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as TemplateContent["components"])
    : undefined;
}

async function handleImport(
  files: Array<{ name: string; text: string }>,
  mode: ImportMode
): Promise<void> {
  postToUi({ type: "BUSY", message: "読み込んでいます…" });
  try {
    if (mode === "replace") {
      // 入れ替えは中身ごと捨てる。グループも同時に落とす（新しいファイルの分は
      // 下で作り直す）。
      const existing = await loadIndex();
      if (existing.length > 0) {
        const groups = listGroups(await loadTree(existing)).map((group) => group.id);
        await deleteTemplates(
          existing.map((meta) => meta.id),
          groups
        );
      }
    }
    const invalidFiles: string[] = [];
    let imported = 0;
    let overQuota = 0;
    let usedImportCategory = false;
    let index = await loadIndex();
    let tree = await loadTree(index);
    for (const file of files) {
      const parsed = parseTemplateFile(file.text);
      if (!parsed) {
        invalidFiles.push(file.name);
        continue;
      }
      // Render everything first so the tree fragment knows every new id before writing.
      const prepared: Array<{ meta: TemplateMeta; item: StoredTemplateV3; oldId: string }> = [];
      for (const entry of parsed.templates) {
        const images = decodeImages(entry.images);
        const item = encodeItem(entry.roots, importedComponents(entry.components), images);
        const meta = importedMeta(entry.meta, entry.roots, await renderThumbnail(entry.roots, images));
        meta.byteSize = estimateBytes(item, meta.thumbnail);
        if (mode === "category") {
          meta.category = IMPORT_CATEGORY_NAME;
        }
        prepared.push({ meta, item, oldId: entry.meta.id });
      }
      const groupIds = new Map<string, string>();
      for (const node of parsed.tree) {
        if (isGroup(node) && !groupIds.has(node.id)) {
          groupIds.set(node.id, newId());
        }
      }
      const itemIds = new Map<string, string>();
      for (const { meta, item, oldId } of prepared) {
        try {
          index = await saveTemplate(meta, item);
          itemIds.set(oldId, meta.id);
          imported += 1;
          if (meta.category === IMPORT_CATEGORY_NAME) {
            usedImportCategory = true;
          }
        } catch (err) {
          if (!(err instanceof QuotaExceededError)) {
            throw err;
          }
          overQuota += 1;
        }
      }
      // saveTemplate put each one at the head of the root; the mode decides where
      // the file's own order sits relative to what was already there.
      const attempted = prepared.map(({ meta }) => meta.id);
      const fragment = appendMissingItems(
        remapTree(parsed.tree, itemIds, groupIds),
        [...itemIds.values()]
      );
      tree = [...removeItems(tree, ...attempted), ...fragment];
      await saveTree(tree);
    }
    if (usedImportCategory) {
      // 2 回読み込んでも 1 つのカテゴリに集まるように、レジストリにも残す。
      await addCategory(IMPORT_CATEGORY_NAME);
    }
    await postTemplatesWithTree(index, Promise.resolve(tree));

    const problems: string[] = [];
    if (invalidFiles.length > 0) {
      problems.push(`テンプレートのファイルではありません: ${invalidFiles.join("、")}`);
    }
    if (overQuota > 0) {
      problems.push(`容量の上限のため ${overQuota} 件は読み込めませんでした`);
    }
    if (problems.length > 0) {
      postToUi({ type: "ERROR", message: problems.join("。") });
    }
    if (imported > 0) {
      figma.notify(
        mode === "category"
          ? `${imported} 件を「${IMPORT_CATEGORY_NAME}」に読み込みました`
          : `${imported} 件を読み込みました`
      );
    }
  } finally {
    postToUi({ type: "BUSY", message: null });
  }
}

async function refreshThumbnails(): Promise<void> {
  const stale = (await loadIndex()).filter((meta) => meta.thumbnailVersion !== THUMBNAIL_VERSION);
  if (stale.length === 0) {
    return;
  }
  postToUi({ type: "BUSY", message: "サムネイルを更新しています…" });
  try {
    let index: TemplateMeta[] | null = null;
    for (const meta of stale) {
      const stored = await loadItem(meta.id);
      if (!stored) {
        continue;
      }
      const { roots, components } = decodeItem(stored);
      const item = stored.version === 1 ? encodeItem(roots, components) : stored;
      const thumbnail = await renderThumbnail(roots);
      index = await updateTemplate(
        meta.id,
        {
          thumbnail,
          thumbnailVersion: THUMBNAIL_VERSION,
          byteSize: estimateBytes(item, thumbnail),
        },
        stored.version === 1 ? item : undefined
      );
    }
    if (index) {
      await postTemplates(index);
    }
  } finally {
    postToUi({ type: "BUSY", message: null });
  }
}

async function initialHeight(): Promise<number> {
  const stored = await figma.clientStorage.getAsync(UI_HEIGHT_STORAGE_KEY);
  return typeof stored === "number" ? clampUiHeight(stored) : DEFAULT_UI_HEIGHT;
}

/** 一覧の見え方は UI ごとの好み。読めなかった値や未知の値は詳細に戻す。 */
async function loadViewMode(): Promise<ViewMode> {
  const stored = await figma.clientStorage.getAsync(VIEW_MODE_STORAGE_KEY);
  return isViewMode(stored) ? stored : "detail";
}

/* ------------------------------ 保存先 ------------------------------ */

const R2_INPUT_MESSAGE = "Worker の URL・アクセストークン・スペース名を入力してください";

/** 保存先ごとに 1 回、一覧を開いたときにサムネイルを作り直す。 */
const thumbnailsRefreshed = new Set<string>();
/** UI に最後に一覧を送った保存先。カテゴリを切り替えても保存先が同じなら送り直さない。 */
let listedStoreKey: string | null = null;
/** ローカルのカテゴリ。共有カテゴリを見ている間もカテゴリのメニューに出すため覚えておく。 */
let homeCategories: string[] = [];

function storageErrorMessage(err: StorageAccessError): string {
  const message = sourceErrorMessage(err.kind);
  return err.category ? `共有カテゴリ「${err.category}」\n${message}` : message;
}

/** 今使っている保存先の一覧を送る。保存先ごとに 1 回だけサムネイルも作り直す。 */
async function listTemplates(): Promise<void> {
  const store = activeStore();
  const remote = store.adapter.type !== "local";
  if (remote) {
    postToUi({ type: "BUSY", message: "Cloudflare R2 から読み込んでいます…" });
  }
  try {
    await postTemplates(await loadIndex());
  } finally {
    if (remote) {
      postToUi({ type: "BUSY", message: null });
    }
  }
  postSelectionState();
  if (!thumbnailsRefreshed.has(store.key)) {
    thumbnailsRefreshed.add(store.key);
    await refreshThumbnails();
  }
}

/** 今 UI で見ているカテゴリの保存先の一覧を送り直す。 */
async function postViewTemplates(): Promise<void> {
  await withStore(viewStore(), async () => postTemplates(await loadIndex()));
}

async function handleStorageTest(raw: unknown): Promise<void> {
  const source = normalizeSource(raw);
  if (!source) {
    postToUi({ type: "STORAGE_TEST_RESULT", ok: false, message: R2_INPUT_MESSAGE });
    return;
  }
  const failure = await testSource(source);
  postToUi({
    type: "STORAGE_TEST_RESULT",
    ok: failure === null,
    message: failure === null ? "接続成功" : sourceErrorMessage(failure),
  });
}

/* ------------------------------ 共有カテゴリ ------------------------------ */

function categoryNameTaken(name: string, except?: string): boolean {
  if (name === NO_CATEGORY) {
    return true;
  }
  const names = [...homeCategories, ...linkedCategories().map((link) => link.name)];
  return names.some((entry) => entry === name && entry !== except);
}

/**
 * 共有カテゴリを足す。保存先を確かめ、印（metadata.json）に名前が無ければ書いておく
 * （他の人が同じ保存先を足すときの名前の初期値になる）。
 */
async function handleAddLinkedCategory(rawName: string, raw: unknown): Promise<void> {
  const fail = (message: string) => postToUi({ type: "LINKED_CATEGORY_RESULT", ok: false, message });
  const source = normalizeSource(raw);
  if (!source) {
    fail(R2_INPUT_MESSAGE);
    return;
  }
  const existing = linkedCategories().find((link) => sameSource(link.source, source));
  if (existing) {
    fail(`この保存先は、共有カテゴリ「${existing.name}」としてすでに追加されています`);
    return;
  }
  const adapter = adapterForSource(source);
  let metadata: unknown;
  try {
    await adapter.verify();
    metadata = await adapter.get(METADATA_KEY);
  } catch (err) {
    fail(sourceErrorMessage(err instanceof StorageAccessError ? err.kind : "network"));
    return;
  }
  const stored = isMetadata(metadata) ? metadata : null;
  const name = rawName.trim() || stored?.name?.trim() || source.space;
  if (categoryNameTaken(name)) {
    fail(`「${name}」というカテゴリはすでにあります。別の名前にしてください`);
    return;
  }
  if (stored && !stored.name) {
    await adapter.set(METADATA_KEY, { ...stored, name }).catch(() => undefined);
  }
  await setLinkedCategories([...linkedCategories(), { id: newId(), name, source }]);
  postToUi({ type: "LINKED_CATEGORY_RESULT", ok: true, name });
  figma.notify(`共有カテゴリ「${name}」を追加しました`);
  await postViewTemplates();
}

/** 共有カテゴリを外す。登録を消すだけで、保存先のデータには触れない。 */
async function handleUnlinkCategory(name: string): Promise<void> {
  const link = linkByName(name);
  if (!link) {
    return;
  }
  if (currentViewCategory() === name) {
    setViewCategory("");
  }
  thumbnailsRefreshed.delete(`link:${link.id}`);
  await setLinkedCategories(linkedCategories().filter((entry) => entry.id !== link.id));
  figma.notify(`共有カテゴリ「${name}」を外しました（保存先のデータはそのまま残っています）`);
  await withStore(viewStore(), listTemplates);
}

async function handleRenameCategory(from: string, to: string): Promise<void> {
  const link = linkByName(from);
  if (link || linkByName(to)) {
    // 共有カテゴリの名前は、自分の端末での表示名だけ。まとめる（重ねる）ことはしない。
    if (!link || categoryNameTaken(to, from)) {
      postToUi({ type: "ERROR", message: `「${to}」というカテゴリはすでにあります。別の名前にしてください` });
      return;
    }
    await setLinkedCategories(linkedCategories().map((entry) => (entry.id === link.id ? { ...entry, name: to } : entry)));
    if (currentViewCategory() === from) {
      setViewCategory(to);
    }
    await postViewTemplates();
    return;
  }
  if (currentViewCategory() === from) {
    setViewCategory(to);
  }
  await withStore(homeStore(), async () => {
    await renameCategory(from, to);
  });
  await postViewTemplates();
}

/* ------------------------------ 保存先をまたぐ移動 ------------------------------ */

/** 移動先の保存先でのカテゴリの値。共有カテゴリはそのカテゴリ名、未設定はキーなし。 */
function categoryFor(store: Store, category: string | undefined): string | undefined {
  return store.link ? store.link.name : category;
}

/**
 * テンプレート（とグループ）を別の保存先へ移す。移動先に保存しきってから移動元を消すので、
 * 途中で失敗しても移動元は残る（移動先に一部が増えることはある）。
 */
async function moveAcross(
  from: Store,
  to: Store,
  ids: string[],
  group: TemplateGroup | null,
  category: string | undefined
): Promise<void> {
  const entries = await withStore(from, async () => {
    const index = await loadIndex();
    const found: Array<{ meta: TemplateMeta; item: TemplateItem }> = [];
    for (const id of ids) {
      const meta = index.find((entry) => entry.id === id);
      const item = meta ? await loadItem(id) : null;
      if (meta && item) {
        found.push({ meta, item });
      }
    }
    return found;
  });
  const targetCategory = categoryFor(to, category);
  await withStore(to, async () => {
    let index = await loadIndex();
    const quota = storage().quotaBytes;
    const adding = entries.reduce((sum, entry) => sum + (entry.meta.byteSize || 0), 0);
    if (quota !== null && usedBytes(index) + adding > quota) {
      throw new QuotaExceededError();
    }
    const taken = new Set(index.map((meta) => meta.id));
    const movedIds: string[] = [];
    // saveTemplate はルートの先頭に足すので、後ろから入れて元の並びにする。
    for (const { meta, item } of [...entries].reverse()) {
      const id = taken.has(meta.id) ? newId() : meta.id;
      const moved: TemplateMeta = { ...meta, id };
      delete moved.category;
      index = await saveTemplate(targetCategory ? { ...moved, category: targetCategory } : moved, item);
      movedIds.unshift(id);
    }
    if (group) {
      const tree = await loadTree(index);
      const groupId = listGroups(tree).some((entry) => entry.id === group.id) ? newId() : group.id;
      await saveTree(
        addGroup(removeItems(tree, ...movedIds), {
          type: "group",
          id: groupId,
          name: group.name,
          items: movedIds,
          ...(targetCategory ? { category: targetCategory } : {}),
        })
      );
    }
  });
  await withStore(from, async () => {
    await deleteTemplates(
      entries.map((entry) => entry.meta.id),
      group ? [group.id] : []
    );
  });
  figma.notify(`「${targetCategory ?? NO_CATEGORY}」に移動しました`);
}

/** テンプレート 1 件のカテゴリを変える。保存先が変わるなら移動する。 */
async function changeTemplateCategory(id: string, rawCategory: string | null): Promise<boolean> {
  const category = rawCategory?.trim() || undefined;
  const from = activeStore();
  const to = storeForCategory(category);
  if (to.key === from.key) {
    return false;
  }
  await moveAcross(from, to, [id], null, category);
  await postViewTemplates();
  return true;
}

/* ------------------------------ メッセージ ------------------------------ */

/** ストレージを触らないメッセージ。キューを待たずにすぐ処理する（接続テストで一覧が止まらないように）。 */
async function handleDirect(msg: UiToPluginMessage): Promise<boolean> {
  switch (msg.type) {
    case "STORAGE_TEST":
      await handleStorageTest(msg.source);
      return true;
    case "CLEAR_CANVAS_SELECTION":
      // Assigning an already empty selection fires no selectionchange, which would
      // leave the flag set and mislabel the next user selection as the plugin's.
      if (figma.currentPage.selection.length > 0) {
        pluginInitiatedSelection = true;
        figma.currentPage.selection = [];
      }
      return true;
    case "SET_VIEW_MODE":
      // 一覧の見え方だけなので、並び順の写し直しはしない。
      if (isViewMode(msg.mode)) {
        void figma.clientStorage.setAsync(VIEW_MODE_STORAGE_KEY, msg.mode);
      }
      return true;
    case "RESIZE_UI": {
      const height = clampUiHeight(msg.height);
      figma.ui.resize(UI_WIDTH, height);
      void figma.clientStorage.setAsync(UI_HEIGHT_STORAGE_KEY, height);
      return true;
    }
    default:
      return false;
  }
}

/** ストレージを触るメッセージ。キューの中で、今見ている保存先を使っている。 */
async function handleStorageMessage(msg: UiToPluginMessage): Promise<void> {
  switch (msg.type) {
    case "LIST":
      await listTemplates();
      break;
    case "VIEW_CATEGORY": {
      setViewCategory(typeof msg.category === "string" ? msg.category : "");
      const store = viewStore();
      if (store.key !== listedStoreKey) {
        await withStore(store, listTemplates);
      }
      break;
    }
    case "ADD_LINKED_CATEGORY":
      await handleAddLinkedCategory(typeof msg.name === "string" ? msg.name : "", msg.source);
      break;
    case "SAVE_SELECTION":
      // 保存先はカテゴリで決まる（共有カテゴリならその保存先）。
      await withStore(storeForCategory(msg.category), () => handleSave(msg.includeImages, msg.category));
      break;
    case "PLACE":
      await handlePlace(msg.id);
      break;
    case "RENAME":
      await handleRename(msg.id, msg.name);
      break;
    case "DELETE":
      await postTemplates(await deleteTemplates([msg.id]));
      break;
    case "EXPORT":
      await handleExport(msg.ids);
      break;
    case "EXPORT_GROUP":
      await handleExportGroup(msg.id);
      break;
    case "IMPORT": {
      const mode = isImportMode(msg.mode) ? msg.mode : "append";
      // 「カテゴリにして追加」は新しい通常のカテゴリになるので、ローカルへ入れる。
      if (mode === "category") {
        await withStore(homeStore(), () => handleImport(msg.files, mode));
      } else {
        await handleImport(msg.files, mode);
      }
      break;
    }
    case "ADD_GROUP": {
      const group = {
        type: "group" as const,
        id: msg.id,
        name: msg.name.trim() || "グループ",
        items: [],
        ...(msg.category?.trim() ? { category: msg.category.trim() } : {}),
      };
      await commitTree(await loadIndex(), (tree) => addGroup(tree, group));
      break;
    }
    case "RENAME_GROUP": {
      const name = msg.name.trim();
      if (name) {
        await commitTree(await loadIndex(), (tree) => renameGroup(tree, msg.id, name));
      }
      break;
    }
    case "DELETE_GROUP":
      await handleDeleteGroup(msg.id);
      break;
    case "ADD_CATEGORY": {
      // カテゴリのレジストリはローカルにある。
      const name = msg.name.trim();
      if (name && !categoryNameTaken(name)) {
        await withStore(homeStore(), () => addCategory(name));
        await postViewTemplates();
      }
      break;
    }
    case "DELETE_CATEGORY": {
      const name = msg.name.trim();
      if (!name) {
        break;
      }
      if (linkByName(name)) {
        await handleUnlinkCategory(name);
      } else {
        await withStore(homeStore(), () => handleDeleteCategory(name));
      }
      break;
    }
    case "RENAME_CATEGORY": {
      const from = msg.from.trim();
      const to = msg.to.trim();
      if (from && to && from !== to) {
        await handleRenameCategory(from, to);
      }
      break;
    }
    case "SET_CATEGORY": {
      if (await changeTemplateCategory(msg.id, msg.category)) {
        break;
      }
      // 未設定はキーごと落とすと `category: undefined` になるが、表示も
      // 書き出しも「無し」と同じ扱いになる。
      const category = msg.category?.trim() || undefined;
      await postTemplates(await updateTemplate(msg.id, { category }));
      break;
    }
    case "SET_GROUP_CATEGORY": {
      // 一覧はテンプレートのカテゴリで絞るので、中のテンプレートも揃えないと
      // グループが今のカテゴリに残って見える。
      const category = msg.category?.trim() || undefined;
      const tree = await loadTree(await loadIndex());
      const group = listGroups(tree).find((entry) => entry.id === msg.id);
      const to = storeForCategory(category);
      if (group && to.key !== activeStore().key) {
        await moveAcross(activeStore(), to, group.items, group, category);
        await postViewTemplates();
        break;
      }
      const index = await setTemplatesCategory(group ? group.items : [], category);
      await postTemplatesWithTree(index, saveTree(setGroupCategory(tree, msg.id, category)));
      break;
    }
    case "TOGGLE_GROUP": {
      await commitTree(await loadIndex(), (tree) => setGroupCollapsed(tree, msg.id, msg.collapsed));
      break;
    }
    case "MOVE": {
      const { nodeId, groupId, index: slot } = msg;
      // 別の保存先のカテゴリへは、移動先のルートに移す（移動先のグループは読み込んでいない）。
      if (msg.category !== undefined && (await changeTemplateCategory(nodeId, msg.category))) {
        break;
      }
      // カテゴリと並びを 1 回で書いて送る。別メッセージにすると返事の順番が入れ替わり、
      // 古い一覧が後から届くことがある。
      const index =
        msg.category === undefined
          ? await loadIndex()
          : await updateTemplate(nodeId, { category: msg.category?.trim() || undefined });
      await commitTree(index, (tree) => moveNode(tree, nodeId, groupId, slot));
      break;
    }
  }
}

async function main(): Promise<void> {
  figma.showUI(__html__, {
    width: UI_WIDTH,
    height: await initialHeight(),
    themeColors: false,
  });
  const storageReady = initStores();

  // The UI sends LIST once it is ready; refresh then so BUSY messages are not lost.
  figma.ui.onmessage = async (msg: UiToPluginMessage) => {
    try {
      await storageReady;
      if (!(await handleDirect(msg))) {
        await enqueue(() => handleStorageMessage(msg));
      }
    } catch (err) {
      if (err instanceof StorageAccessError) {
        postToUi({ type: "STORAGE_ERROR", kind: err.kind, message: storageErrorMessage(err), category: err.category });
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      postToUi({ type: "ERROR", message: `エラーが発生しました: ${message}` });
    }
  };

  figma.on("selectionchange", postSelectionState);
}

void main();
