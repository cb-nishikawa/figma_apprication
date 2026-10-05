import type { PluginToUiMessage, UiToPluginMessage } from "./messages";
import { replaceImagePaintsInTree, restoreTemplate } from "./deserialize";
import {
  isComponentRoot,
  isSavableRoot,
  serializeComponentTemplate,
  serializeSelection,
} from "./serialize";
import {
  QUOTA_BYTES,
  QuotaExceededError,
  decodeItem,
  deleteTemplate,
  encodeItem,
  estimateBytes,
  loadIndex,
  loadItem,
  loadTree,
  renameTemplate,
  saveTemplate,
  saveTree,
  updateTemplate,
  usedBytes,
} from "./storage";
import {
  addGroup,
  appendMissingItems,
  insertFragment,
  isGroup,
  moveNode,
  remapTree,
  removeGroup,
  removeItems,
  renameGroup,
  setGroupCollapsed,
} from "./tree";
import {
  TEMPLATE_FILE_FORMAT,
  type ListNode,
  type RestoreReport,
  type SerializedNode,
  type StoredTemplateV2,
  type TemplateContent,
  type TemplateFile,
  type TemplateMeta,
} from "./types";

const UI_WIDTH = 360;
const DEFAULT_UI_HEIGHT = 560;
const MIN_UI_HEIGHT = 320;
const MAX_UI_HEIGHT = 900;
const UI_HEIGHT_STORAGE_KEY = "cbTemplatePalette.uiHeight";
const THUMBNAIL_SIDE = 120;
const THUMBNAIL_VERSION = 2;
const THUMBNAIL_OFFSCREEN_GAP = 1000;
const FILE_SUFFIX = ".cbtemplate.json";
/** Set on a saved component so a template can tell whether its original is in the current file. */
const STAMP_DATA = "cbTemplatePalette.stamp";

function postToUi(message: PluginToUiMessage): void {
  figma.ui.postMessage(message);
}

function clampUiHeight(height: number): number {
  return Math.min(MAX_UI_HEIGHT, Math.max(MIN_UI_HEIGHT, Math.round(height)));
}

function savableSelection(): SceneNode[] {
  return figma.currentPage.selection.filter(isSavableRoot);
}

/** Set while the plugin changes the selection itself, so the next selectionchange is not a user action. */
let pluginInitiatedSelection = false;

function postSelectionState(): void {
  const origin = pluginInitiatedSelection ? "plugin" : "user";
  pluginInitiatedSelection = false;
  const roots = savableSelection();
  postToUi({
    type: "SELECTION_STATE",
    savableCount: roots.length,
    isComponent: componentSelection(roots) !== null,
    selectionCount: figma.currentPage.selection.length,
    origin,
  });
}

function postTemplates(index: TemplateMeta[]): Promise<void> {
  return postTemplatesWithTree(index, loadTree(index));
}

async function postTemplatesWithTree(index: TemplateMeta[], tree: Promise<ListNode[]>): Promise<void> {
  postToUi({
    type: "TEMPLATES",
    templates: index,
    tree: await tree,
    usedBytes: usedBytes(index),
    quotaBytes: QUOTA_BYTES,
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

/** Renders the first root as it would be duplicated (image paints become solid fills). */
async function renderThumbnail(roots: SerializedNode[]): Promise<string> {
  if (roots.length === 0) {
    return "";
  }
  const bounds = figma.viewport.bounds;
  let created: SceneNode[] = [];
  try {
    const { nodes } = await restoreTemplate(
      { roots: [roots[0]] },
      figma.currentPage,
      {
        x: Math.round(bounds.x + bounds.width + THUMBNAIL_OFFSCREEN_GAP),
        y: Math.round(bounds.y),
      },
      { mode: "flatten" }
    );
    created = nodes;
    const node = nodes[0];
    if (!node) {
      return "";
    }
    const constraint: ExportSettingsConstraints =
      node.width >= node.height
        ? { type: "WIDTH", value: THUMBNAIL_SIDE }
        : { type: "HEIGHT", value: THUMBNAIL_SIDE };
    const bytes = await node.exportAsync({ format: "JPG", constraint });
    return `data:image/jpeg;base64,${figma.base64Encode(bytes)}`;
  } catch {
    return "";
  } finally {
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

async function handleSave(): Promise<void> {
  const roots = savableSelection();
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
    const item = encodeItem(serialized.roots, serialized.components);
    const thumbnail = await renderThumbnail(serialized.roots);
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
    if (component) {
      meta.kind = "component";
      meta.source = { nodeId: component.id, stamp: ensureStamp(component) };
    }
    const index = await saveTemplate(meta, item);
    await postTemplates(index);
    postToUi({ type: "SAVED", id: meta.id });
    const label = component ? "コンポーネントとして保存しました" : "保存しました";
    figma.notify(
      serialized.report.skipped > 0
        ? `「${meta.name}」を${label}（対象外の要素 ${serialized.report.skipped} 件はスキップ）`
        : `「${meta.name}」を${label}`
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

function cloneSourceComponent(
  source: ComponentNode | ComponentSetNode,
  topLeft: { x: number; y: number }
): { node: SceneNode; replacedImages: number } {
  const clone = source.clone();
  if (clone.parent !== figma.currentPage) {
    figma.currentPage.appendChild(clone);
  }
  clone.x = topLeft.x;
  clone.y = topLeft.y;
  return { node: clone, replacedImages: replaceImagePaintsInTree(clone) };
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
      const { node, replacedImages } = cloneSourceComponent(source, topLeft);
      pluginInitiatedSelection = true;
      figma.currentPage.selection = [node];
      figma.notify(
        replacedImages > 0
          ? `「${meta.name}」を新しいコンポーネントとして複製しました（画像 ${replacedImages} 件を単色に置き換え）`
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

/** The tree of a file export, without the templates whose body could not be read. */
function exportTree(tree: ListNode[], exported: Set<string>): ListNode[] {
  const nodes: ListNode[] = [];
  for (const node of tree) {
    if (isGroup(node)) {
      const items = node.items.filter((id) => exported.has(id));
      if (items.length > 0) {
        // Rebuilt instead of spread so `collapsed` stays out of the file.
        nodes.push({ type: "group", id: node.id, name: node.name, items });
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
    const file: TemplateFile = { format: TEMPLATE_FILE_FORMAT, version: 3, tree: [], templates: [] };
    for (const meta of targets) {
      const item = await loadItem(meta.id);
      if (item) {
        const content = decodeItem(item);
        file.templates.push(
          content.components
            ? { meta, roots: content.roots, components: content.components }
            : { meta, roots: content.roots }
        );
      }
    }
    const exported = new Set(file.templates.map((entry) => entry.meta.id));
    // A single template is exported flat; its group is not worth recreating on import.
    file.tree = ids
      ? file.templates.map((entry) => ({ type: "item" as const, id: entry.meta.id }))
      : exportTree(await loadTree(index), exported);
    const now = new Date();
    const stamp = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}-${pad2(now.getHours())}${pad2(now.getMinutes())}`;
    const fileName =
      ids && targets.length === 1
        ? `${safeFileName(targets[0].name)}${FILE_SUFFIX}`
        : `cbTemplatePalette-${stamp}${FILE_SUFFIX}`;
    postToUi({ type: "EXPORT_DATA", fileName, text: JSON.stringify(file) });
  } finally {
    postToUi({ type: "BUSY", message: null });
  }
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

function importedMeta(meta: Partial<TemplateMeta>, roots: SerializedNode[], thumbnail: string): TemplateMeta {
  return {
    id: newId(),
    name: typeof meta.name === "string" && meta.name.trim() ? meta.name.trim() : "読み込んだテンプレート",
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
  };
}

function importedComponents(value: unknown): TemplateContent["components"] {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as TemplateContent["components"])
    : undefined;
}

async function handleImport(files: Array<{ name: string; text: string }>): Promise<void> {
  postToUi({ type: "BUSY", message: "読み込んでいます…" });
  try {
    const invalidFiles: string[] = [];
    let imported = 0;
    let overQuota = 0;
    let index = await loadIndex();
    let tree = await loadTree(index);
    for (const file of files) {
      const parsed = parseTemplateFile(file.text);
      if (!parsed) {
        invalidFiles.push(file.name);
        continue;
      }
      // Render everything first so the tree fragment knows every new id before writing.
      const prepared: Array<{ meta: TemplateMeta; item: StoredTemplateV2; oldId: string }> = [];
      for (const entry of parsed.templates) {
        const item = encodeItem(entry.roots, importedComponents(entry.components));
        const meta = importedMeta(entry.meta, entry.roots, await renderThumbnail(entry.roots));
        meta.byteSize = estimateBytes(item, meta.thumbnail);
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
        } catch (err) {
          if (!(err instanceof QuotaExceededError)) {
            throw err;
          }
          overQuota += 1;
        }
      }
      // saveTemplate put each one at the head of the root; restore the file's own order.
      const attempted = prepared.map(({ meta }) => meta.id);
      const fragment = appendMissingItems(
        remapTree(parsed.tree, itemIds, groupIds),
        [...itemIds.values()]
      );
      tree = insertFragment(removeItems(tree, ...attempted), fragment);
      await saveTree(tree);
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
      figma.notify(`${imported} 件を読み込みました`);
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

async function main(): Promise<void> {
  figma.showUI(__html__, {
    width: UI_WIDTH,
    height: await initialHeight(),
    themeColors: false,
  });

  // The UI sends LIST once it is ready; refresh then so BUSY messages are not lost.
  let thumbnailsRefreshed = false;
  figma.ui.onmessage = async (msg: UiToPluginMessage) => {
    try {
      switch (msg.type) {
        case "LIST":
          await postTemplates(await loadIndex());
          postSelectionState();
          if (!thumbnailsRefreshed) {
            thumbnailsRefreshed = true;
            await refreshThumbnails();
          }
          break;
        case "SAVE_SELECTION":
          await handleSave();
          break;
        case "PLACE":
          await handlePlace(msg.id);
          break;
        case "RENAME": {
          const name = msg.name.trim();
          if (name) {
            await postTemplates(await renameTemplate(msg.id, name));
          }
          break;
        }
        case "DELETE":
          await postTemplates(await deleteTemplate(msg.id));
          break;
        case "EXPORT":
          await handleExport(msg.ids);
          break;
        case "IMPORT":
          await handleImport(msg.files);
          break;
        case "CLEAR_CANVAS_SELECTION": {
          // Assigning an already empty selection fires no selectionchange, which would
          // leave the flag set and mislabel the next user selection as the plugin's.
          if (figma.currentPage.selection.length > 0) {
            pluginInitiatedSelection = true;
            figma.currentPage.selection = [];
          }
          break;
        }
        case "ADD_GROUP": {
          const group = {
            type: "group" as const,
            id: msg.id,
            name: msg.name.trim() || "グループ",
            items: [],
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
        case "DELETE_GROUP": {
          await commitTree(await loadIndex(), (tree) => removeGroup(tree, msg.id));
          break;
        }
        case "TOGGLE_GROUP": {
          await commitTree(await loadIndex(), (tree) =>
            setGroupCollapsed(tree, msg.id, msg.collapsed)
          );
          break;
        }
        case "MOVE": {
          const { nodeId, groupId, index: slot } = msg;
          await commitTree(await loadIndex(), (tree) => moveNode(tree, nodeId, groupId, slot));
          break;
        }
        case "RESIZE_UI": {
          const height = clampUiHeight(msg.height);
          figma.ui.resize(UI_WIDTH, height);
          void figma.clientStorage.setAsync(UI_HEIGHT_STORAGE_KEY, height);
          break;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      postToUi({ type: "ERROR", message: `エラーが発生しました: ${message}` });
    }
  };

  figma.on("selectionchange", postSelectionState);
}

void main();
