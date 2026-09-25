import { collectImageTargets } from "./collectImages";
import type { PluginToUiMessage, UiToPluginMessage } from "./messages";
import type {
  ExportConfig,
  ExportConstraint,
  ExportFormat,
  ExportOptions,
  ExportRequest,
  ExportResultItem,
  FrameTarget,
  FrameTargetKind,
  ImageListItem,
} from "./types";

const UI_WIDTH = 360;
const MIN_UI_HEIGHT = 320;
const MAX_UI_HEIGHT = 900;
const DEFAULT_UI_HEIGHT = 480;
const UI_HEIGHT_STORAGE_KEY = "cbImageExport.uiHeight";
const THUMB_WIDTH = 80;

let targetNodeId: string | null = null;

/**
 * Resolve a collected row by id. Instance-internal nodes (ids like
 * "I…;…;…") cannot be re-resolved via figma.getNodeByIdAsync, so the most
 * recent scan also keeps the SceneNode reference itself as a fallback.
 */
const nodeCache = new Map<string, SceneNode>();

function resolveNode(nodeId: string): SceneNode | null {
  const cached = nodeCache.get(nodeId) ?? null;
  if (cached && !cached.removed) {
    return cached;
  }
  const fromId = figma.getNodeById(nodeId) ?? null;
  if (fromId && "exportAsync" in fromId) {
    return fromId as SceneNode;
  }
  return cached;
}

const HOVER_NAME = "hoverEffect";
let hoverOverlay: RectangleNode | null = null;

const HIGHLIGHT_RGB: RGB = { r: 0, g: 1, b: 64 / 255 };

function applyHighlightPaint(rect: RectangleNode): void {
  rect.fills = [
    { type: "SOLID", color: HIGHLIGHT_RGB, opacity: 0.4 },
  ];
  rect.strokes = [{ type: "SOLID", color: HIGHLIGHT_RGB }];
  rect.strokeWeight = 1;
  rect.dashPattern = [10, 10];
}

function ensureHoverOverlay(): RectangleNode {
  if (hoverOverlay && !hoverOverlay.removed) {
    if (hoverOverlay.parent && hoverOverlay.parent.id !== figma.currentPage.id) {
      figma.currentPage.appendChild(hoverOverlay);
    }
    return hoverOverlay;
  }
  const rect = figma.createRectangle();
  rect.name = HOVER_NAME;
  rect.locked = true;
  rect.visible = false;
  applyHighlightPaint(rect);
  figma.currentPage.appendChild(rect);
  hoverOverlay = rect;
  return rect;
}

function showHoverOverlay(nodeId: string | null): void {
  if (!nodeId) {
    hideHoverOverlay();
    return;
  }
  const node = resolveNode(nodeId);
  if (!node || !("absoluteBoundingBox" in node)) {
    hideHoverOverlay();
    return;
  }
  const box = (node as SceneNode).absoluteBoundingBox;
  if (!box || box.width <= 0 || box.height <= 0) {
    hideHoverOverlay();
    return;
  }
  const rect = ensureHoverOverlay();
  rect.resize(box.width, box.height);
  rect.x = box.x;
  rect.y = box.y;
  figma.currentPage.appendChild(rect);
  rect.visible = true;
}

function hideHoverOverlay(): void {
  if (hoverOverlay && !hoverOverlay.removed) {
    hoverOverlay.visible = false;
  }
}

function clearHoverOverlay(): void {
  if (hoverOverlay && !hoverOverlay.removed) {
    hoverOverlay.remove();
  }
  hoverOverlay = null;
}

function clampUiHeight(height: number): number {
  return Math.min(MAX_UI_HEIGHT, Math.max(MIN_UI_HEIGHT, Math.round(height)));
}

function postToUi(msg: PluginToUiMessage): void {
  figma.ui.postMessage(msg);
}

async function makeThumb(node: SceneNode): Promise<number[] | undefined> {
  if (!("exportAsync" in node)) {
    return undefined;
  }
  try {
    const bytes = await node.exportAsync({
      format: "PNG",
      constraint: { type: "WIDTH", value: THUMB_WIDTH },
    });
    return Array.from(bytes);
  } catch {
    return undefined;
  }
}

function isFrameTargetNode(
  node: BaseNode
): node is FrameNode | SectionNode | InstanceNode | GroupNode {
  return (
    node.type === "FRAME" ||
    node.type === "SECTION" ||
    node.type === "INSTANCE" ||
    node.type === "GROUP"
  );
}

function parentKindName(node: SceneNode): string | null {
  let current: BaseNode | null = node.parent;
  while (current && current.type !== "PAGE" && current.type !== "DOCUMENT") {
    if (isFrameTargetNode(current)) {
      return current.name;
    }
    current = current.parent;
  }
  return null;
}

function buildLabel(
  node: SceneNode,
  kind: FrameTargetKind,
  duplicateNames: Set<string>
): string {
  const base = node.name;
  if (!duplicateNames.has(node.name)) {
    return base;
  }
  const parentName = parentKindName(node);
  if (parentName) {
    return `${base} (${parentName})`;
  }
  return `${base} [${node.id}]`;
}

function collectFrameTargets(): FrameTarget[] {
  const nodes = figma.currentPage.findAllWithCriteria({
    types: ["SECTION", "FRAME", "INSTANCE", "GROUP"],
  }) as Array<SceneNode & { type: FrameTargetKind }>;

  const nameCounts = new Map<string, number>();
  for (const node of nodes) {
    nameCounts.set(node.name, (nameCounts.get(node.name) ?? 0) + 1);
  }

  const duplicateNames = new Set<string>();
  for (const [name, count] of nameCounts) {
    if (count > 1) {
      duplicateNames.add(name);
    }
  }

  return nodes.map((node) => ({
    id: node.id,
    name: node.name,
    kind: node.type,
    label: buildLabel(node, node.type, duplicateNames),
  }));
}

/** Prefer selected target frame, else nearest target-frame ancestor. */
function resolveFrameTargetFromSelection(): string | null {
  const selection = figma.currentPage.selection;
  for (const node of selection) {
    if (isFrameTargetNode(node)) {
      return node.id;
    }
  }

  const first = selection[0];
  if (!first) {
    return null;
  }

  let current: BaseNode | null = first.parent;
  while (current && current.type !== "PAGE" && current.type !== "DOCUMENT") {
    if (isFrameTargetNode(current)) {
      return current.id;
    }
    current = current.parent;
  }
  return null;
}

function postFrameTargets(): void {
  postToUi({
    type: "FRAME_TARGETS",
    targets: collectFrameTargets(),
    targetId: targetNodeId,
  });
}

async function scanTarget(): Promise<void> {
  hideHoverOverlay();
  if (!targetNodeId) {
    postToUi({
      type: "IMAGE_LIST",
      items: [],
      message: "対象フレームを選択してください",
    });
    return;
  }

  const node = await figma.getNodeByIdAsync(targetNodeId);
  if (!node || !isFrameTargetNode(node)) {
    targetNodeId = null;
    postFrameTargets();
    postToUi({
      type: "IMAGE_LIST",
      items: [],
      message: "対象フレームが見つかりません",
    });
    return;
  }

  const collected = collectImageTargets([node as SceneNode]);
  nodeCache.clear();
  for (const target of collected) {
    nodeCache.set(target.id, target);
  }
  const items: ImageListItem[] = [];
  for (const target of collected) {
    const thumbBytes = await makeThumb(target);
    items.push({
      id: target.id,
      name: target.name || "(untitled)",
      thumbBytes,
      exportConfigs: exportSettingsToConfigs(target),
    });
  }

  postToUi({
    type: "IMAGE_LIST",
    items,
    message:
      items.length === 0
        ? "表示中の画像が見つかりませんでした"
        : undefined,
  });
}

function exportSettings(
  format: ExportFormat,
  constraint?: ExportConstraint
): ExportSettings {
  const safe: ExportConstraint = constraint
    ? {
        type: constraint.type,
        value: Number.isFinite(constraint.value) && constraint.value > 0
          ? constraint.value
          : 1,
      }
    : { type: "SCALE", value: 1 };
  if (format === "JPG") {
    return {
      format: "JPG",
      constraint: { type: safe.type, value: safe.value },
      contentsOnly: true,
    };
  }
  if (format === "PNG") {
    return {
      format: "PNG",
      constraint: { type: safe.type, value: safe.value },
      contentsOnly: true,
    };
  }
  if (format === "SVG") {
    return {
      format: "SVG",
      contentsOnly: true,
    };
  }
  return {
    format: "PDF",
    contentsOnly: true,
  };
}

/**
 * Convert the node's layer exportSettings into the plugin's ExportConfig[]
 * so existing layer entries are reflected in the list. Unsupported formats
 * (SVG_STRING / GIF / MP4 / WebM / JSON_REST_V1) are skipped.
 */
function exportSettingsToConfigs(scene: SceneNode): ExportConfig[] {
  if (!("exportSettings" in scene)) {
    return [];
  }
  const configs: ExportConfig[] = [];
  for (const setting of scene.exportSettings) {
    const format = setting.format;
    if (format === "SVG" || format === "PDF") {
      configs.push({ format, constraint: { type: "SCALE", value: 1 } });
      continue;
    }
    if (format === "PNG" || format === "JPG") {
      const constraint = setting.constraint;
      configs.push({
        format,
        constraint:
          constraint && constraint.type !== "SCALE"
            ? { type: constraint.type, value: constraint.value }
            : { type: "SCALE", value: constraint?.value ?? 1 },
      });
      continue;
    }
    // Unsupported format: skip.
  }
  return configs;
}

async function exportNodes(requests: ExportRequest[]): Promise<void> {
  const results: ExportResultItem[] = [];
  for (const req of requests) {
    const node = resolveNode(req.id);
    if (!node || !("exportAsync" in node)) {
      results.push({
        id: req.id,
        name: "(missing)",
        format: req.format,
        ok: false,
        message: "ノードが見つからないか書き出せません",
      });
      continue;
    }
    const scene = node as SceneNode;
    try {
      const bytes = await exportSceneNode(
        scene,
        exportSettings(req.format, req.constraint),
        req.options
      );
      results.push({
        id: req.id,
        name: scene.name || "(untitled)",
        format: req.format,
        ok: true,
        bytes: Array.from(bytes),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({
        id: req.id,
        name: scene.name || "(untitled)",
        format: req.format,
        ok: false,
        message: `${req.format} 書き出しに失敗: ${message}`,
      });
    }
  }
  postToUi({ type: "EXPORT_RESULT", results });
}

/**
 * Strip excluded export options (effects / corner radius / strokes) from the
 * node itself. Rows can be FRAME / COMPONENT / INSTANCE / SLOT / RECTANGLE /
 * GROUP, so each property is only touched when the node type supports it.
 */
function stripExportOptions(node: SceneNode, options: ExportOptions): void {
  if (options.excludeEffects && "effects" in node) {
    (node as SceneNode & { effects: Effect[] }).effects = [];
  }
  if (options.excludeCornerRadius) {
    const shape = node as SceneNode & {
      cornerRadius: number | typeof figma.mixed;
      topLeftRadius: number;
      topRightRadius: number;
      bottomLeftRadius: number;
      bottomRightRadius: number;
    };
    if ("topLeftRadius" in shape) {
      shape.topLeftRadius = 0;
      shape.topRightRadius = 0;
      shape.bottomLeftRadius = 0;
      shape.bottomRightRadius = 0;
    }
    if (typeof shape.cornerRadius === "number" && shape.cornerRadius !== 0) {
      shape.cornerRadius = 0;
    }
  }
  if (options.excludeStrokes && "strokes" in node) {
    (node as SceneNode & { strokes: Paint[] }).strokes = [];
  }
}

/**
 * Export a row honoring the row's exclusion options. When any item is
 * excluded, a throwaway clone is used: the item is stripped from the clone
 * only, the original layer stays untouched, and the clone is removed right
 * after.
 */
async function exportSceneNode(
  node: SceneNode,
  settings: ExportSettings,
  options: ExportOptions
): Promise<Uint8Array> {
  const needsClone =
    options.excludeEffects ||
    options.excludeCornerRadius ||
    options.excludeStrokes;
  if (!needsClone) {
    return node.exportAsync(settings);
  }
  const clone = node.clone();
  stripExportOptions(clone, options);
  figma.currentPage.appendChild(clone);
  try {
    return await clone.exportAsync(settings);
  } finally {
    clone.remove();
  }
}

async function focusNode(nodeId: string): Promise<void> {
  const node = resolveNode(nodeId);
  if (!node || !("x" in node)) {
    return;
  }
  const scene = node as SceneNode;
  figma.currentPage.selection = [scene];
  figma.viewport.scrollAndZoomIntoView([scene]);
}

async function renameNode(nodeId: string, name: string): Promise<void> {
  const node = resolveNode(nodeId);
  if (!node || !("name" in node)) {
    return;
  }
  node.name = name;
}

/**
 * Reflect the plugin's export configs to the actual Figma layer
 * (node.exportSettings). Empty configs clear the layer's export settings.
 */
function applyExportSettings(
  nodeId: string,
  configs: ExportConfig[]
): void {
  const node = resolveNode(nodeId);
  if (!node || !("exportSettings" in node)) {
    return;
  }
  const scene = node as SceneNode;
  scene.exportSettings = configs.map((config) =>
    exportSettings(config.format, config.constraint)
  );
}

async function initUiHeight(): Promise<number> {
  const stored = await figma.clientStorage.getAsync(UI_HEIGHT_STORAGE_KEY);
  if (typeof stored === "number" && Number.isFinite(stored)) {
    return clampUiHeight(stored);
  }
  return DEFAULT_UI_HEIGHT;
}

async function main(): Promise<void> {
  figma.skipInvisibleInstanceChildren = false;
  const uiHeight = await initUiHeight();
  figma.showUI(__html__, {
    width: UI_WIDTH,
    height: uiHeight,
    themeColors: true,
  });

  figma.ui.onmessage = async (raw: UiToPluginMessage) => {
    try {
      switch (raw.type) {
        case "LIST_FRAME_TARGETS":
          postFrameTargets();
          break;
        case "SET_FRAME_FROM_SELECTION": {
          if (figma.currentPage.selection.length === 0) {
            postToUi({ type: "SELECTION_EMPTY" });
            break;
          }
          const fromSelection = resolveFrameTargetFromSelection();
          if (!fromSelection) {
            postToUi({
              type: "ERROR",
              message: "選択から対象フレームを解決できません",
            });
            break;
          }
          targetNodeId = fromSelection;
          postFrameTargets();
          await scanTarget();
          break;
        }
        case "SET_FRAME_NODE":
          targetNodeId = raw.nodeId;
          postFrameTargets();
          await scanTarget();
          break;
        case "SCAN_TARGET":
          await scanTarget();
          break;
        case "FOCUS_NODE":
          await focusNode(raw.nodeId);
          break;
        case "RENAME_NODE":
          await renameNode(raw.nodeId, raw.name);
          break;
        case "SET_EXPORT_SETTINGS":
          applyExportSettings(raw.nodeId, raw.configs);
          break;
        case "HOVER_ROW":
          showHoverOverlay(raw.nodeId);
          break;
        case "EXPORT_NODES":
          await exportNodes(raw.items);
          break;
        case "RESIZE_UI": {
          const height = clampUiHeight(raw.height);
          figma.ui.resize(UI_WIDTH, height);
          void figma.clientStorage.setAsync(UI_HEIGHT_STORAGE_KEY, height);
          break;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      postToUi({ type: "ERROR", message });
    }
  };

  figma.on("currentpagechange", () => {
    hideHoverOverlay();
    postFrameTargets();
    void scanTarget();
  });

  figma.on("close", () => {
    clearHoverOverlay();
  });

  postFrameTargets();
}

void main();