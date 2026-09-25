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
  RecentFrame,
} from "./types";
import { DEFAULT_QUALITY } from "./types";

const UI_WIDTH = 360;
const MIN_UI_HEIGHT = 320;
const MAX_UI_HEIGHT = 900;
const DEFAULT_UI_HEIGHT = 480;
const UI_HEIGHT_STORAGE_KEY = "cbImageExport.uiHeight";
const THUMB_WIDTH = 80;
const EXPORT_SENTINEL_CONTAINER = "__cb_export__";
const EXPORT_SENTINEL_PREFIX = "__cfg__";
const LEGACY_WEBP_SENTINEL_PREFIX = "__cb_webp__";
const RECENT_FRAMES_KEY = "cbImageExport.recentFrames";
const MAX_RECENT_FRAMES = 20;
const ASSET_URL_CONFIG_KEY = "cbImageExport.frameAssetPaths";

let targetNodeId: string | null = null;
/** 過去に選択した対象フレームの履歴（最大 20 件・直近が先頭）。 */
let recentFrames: RecentFrame[] = [];
/** URL コピー用の書き出し先パス（対象フレーム ID → パス）。 */
let frameAssetPaths: Record<string, string> = {};

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
    recent: recentFrames,
    assetUrlPath: currentAssetUrlPath(),
  });
}

// ---- 対象フレームの履歴（clientStorage 永続化） ----

function isRecentFrame(value: unknown): value is RecentFrame {
  if (!value || typeof value !== "object") {
    return false;
  }
  const entry = value as Partial<RecentFrame>;
  return (
    typeof entry.id === "string" &&
    typeof entry.name === "string" &&
    typeof entry.kind === "string" &&
    typeof entry.label === "string"
  );
}

async function loadRecentFrames(): Promise<RecentFrame[]> {
  let stored: unknown;
  try {
    stored = await figma.clientStorage.getAsync(RECENT_FRAMES_KEY);
  } catch {
    return [];
  }
  if (!Array.isArray(stored)) {
    return [];
  }
  const frames = stored.filter(isRecentFrame).slice(0, MAX_RECENT_FRAMES);
  // 起動時クリーンアップ: 見つからない・対象外フレームを履歴から除去
  const kept: RecentFrame[] = [];
  for (const entry of frames) {
    const node = await figma.getNodeByIdAsync(entry.id);
    if (!node || !isFrameTargetNode(node)) {
      continue;
    }
    kept.push(entry);
    if (kept.length >= MAX_RECENT_FRAMES) {
      break;
    }
  }
  if (kept.length !== frames.length) {
    void figma.clientStorage.setAsync(RECENT_FRAMES_KEY, kept);
  }
  return kept;
}

async function loadAssetUrlConfig(): Promise<Record<string, string>> {
  let stored: unknown;
  try {
    stored = await figma.clientStorage.getAsync(ASSET_URL_CONFIG_KEY);
  } catch {
    return {};
  }
  if (!stored || typeof stored !== "object") {
    return {};
  }
  const entries = stored as Record<string, unknown>;
  const result: Record<string, string> = {};
  for (const [nodeId, path] of Object.entries(entries)) {
    if (typeof path === "string" && path.trim()) {
      result[nodeId] = path;
    }
  }
  // 起動時掃除: 存在しない・対象外フレームのパスを除去
  const kept: Record<string, string> = {};
  let changed = false;
  for (const [nodeId, path] of Object.entries(result)) {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (node && isFrameTargetNode(node)) {
      kept[nodeId] = path;
    } else {
      changed = true;
    }
  }
  if (changed) {
    void figma.clientStorage.setAsync(ASSET_URL_CONFIG_KEY, kept);
  }
  return kept;
}

function currentAssetUrlPath(): string {
  return targetNodeId ? (frameAssetPaths[targetNodeId] ?? "") : "";
}

function pushRecentFrame(entry: RecentFrame): void {
  recentFrames = [
    entry,
    ...recentFrames.filter((existing) => existing.id !== entry.id),
  ].slice(0, MAX_RECENT_FRAMES);
  void figma.clientStorage.setAsync(RECENT_FRAMES_KEY, recentFrames);
}

/** 対象フレーム確定時に履歴へ追加する（現在ページ内のフレームのみ）。 */
function recordRecentFrame(nodeId: string): void {
  if (!nodeId) {
    return;
  }
  const target = collectFrameTargets().find((frame) => frame.id === nodeId);
  if (!target) {
    return;
  }
  pushRecentFrame({
    id: target.id,
    name: target.name,
    kind: target.kind,
    label: target.label,
  });
  postFrameTargets();
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
  const sentinelConfigs = restoreSentinelConfigs(
    node as SceneNode,
    new Set(collected.map((target) => target.id))
  );
  const items: ImageListItem[] = [];
  for (const target of collected) {
    const thumbBytes = await makeThumb(target);
    const exportConfigs = exportSettingsToConfigs(target);
    const rowSentinels = sentinelConfigs.get(target.id);
    if (rowSentinels) {
      for (const config of rowSentinels) {
        const index = exportConfigs.findIndex(
          (existing) => existing.format === config.format
        );
        if (index >= 0) {
          exportConfigs[index] = config;
        } else {
          exportConfigs.push(config);
        }
      }
    }
    items.push({
      id: target.id,
      name: target.name || "(untitled)",
      thumbBytes,
      exportConfigs,
    });
  }

  postToUi({
    type: "IMAGE_LIST",
    items,
    message:
      items.length === 0
        ? "表示中の画像やエクスポート設定のあるレイヤーが見つかりませんでした"
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
  if (format === "PNG" || format === "WEBP" || format === "AVIF") {
    // WEBP / AVIF are not supported by Figma's exportSettings, so they are
    // rendered as PNG here and transcoded in the UI.
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
 * Settings actually used to render a row in the plugin. Raster formats whose
 * final encoding happens in the UI (JPG quality / WebP / AVIF / PNG
 * quantization) are rendered as PNG here; SVG and PDF use their own settings.
 */
function renderSettings(
  format: ExportFormat,
  constraint?: ExportConstraint
): ExportSettings {
  const rasterToPng =
    format === "PNG" || format === "JPG" || format === "WEBP" ||
    format === "AVIF";
  return exportSettings(rasterToPng ? "PNG" : format, constraint);
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
        constraint: req.constraint,
        ok: false,
        message: "ノードが見つからないか書き出せません",
      });
      continue;
    }
    const scene = node as SceneNode;
    try {
      const bytes = await exportSceneNode(
        scene,
        renderSettings(req.format, req.constraint),
        req.options
      );
      results.push({
        id: req.id,
        name: scene.name || "(untitled)",
        format: req.format,
        constraint: req.constraint,
        ok: true,
        bytes: Array.from(bytes),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({
        id: req.id,
        name: scene.name || "(untitled)",
        format: req.format,
        constraint: req.constraint,
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

/** UTF-8 バイト列を文字列へデコードする（TextDecoder に依存しない簡易実装）。 */
function decodeUtf8(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  while (i < bytes.length) {
    const first = bytes[i++];
    if (first < 0x80) {
      out += String.fromCharCode(first);
      continue;
    }
    let codePoint: number;
    let extra: number;
    if (first >= 0xc0 && first < 0xe0) {
      codePoint = first & 0x1f;
      extra = 1;
    } else if (first >= 0xe0 && first < 0xf0) {
      codePoint = first & 0x0f;
      extra = 2;
    } else if (first >= 0xf0 && first < 0xf8) {
      codePoint = first & 0x07;
      extra = 3;
    } else {
      out += String.fromCharCode(first);
      continue;
    }
    if (i + extra > bytes.length) {
      out += String.fromCharCode(first);
      continue;
    }
    let valid = true;
    for (let j = 0; j < extra; j++) {
      const b = bytes[i + j];
      if (b < 0x80 || b >= 0xc0) {
        valid = false;
        break;
      }
      codePoint = (codePoint << 6) | (b & 0x3f);
    }
    if (!valid) {
      out += String.fromCharCode(first);
      continue;
    }
    i += extra;
    out +=
      codePoint <= 0xffff
        ? String.fromCharCode(codePoint)
        : String.fromCharCode(
            ((codePoint - 0x10000) >> 10) + 0xd800,
            ((codePoint - 0x10000) & 0x3ff) + 0xdc00
          );
  }
  return out;
}

async function fetchSvgCode(
  nodeId: string,
  constraint: ExportConstraint,
  options: ExportOptions
): Promise<void> {
  const node = resolveNode(nodeId);
  if (!node || !("exportAsync" in node)) {
    postToUi({
      type: "SVG_CODE",
      nodeId,
      svg: "",
      message: "ノードが見つからないか書き出せません",
    });
    return;
  }
  try {
    let bytes: Uint8Array;
    try {
      bytes = await exportSceneNode(
        node as SceneNode,
        renderSettings("SVG", constraint),
        options
      );
    } catch {
      // クローン除去・appendChild 起因の失敗に備え、除外オプション無しで
      // 直接書き出しを一度だけ試す（SVG は除外設定の影響が小さい）。
      bytes = await (node as SceneNode).exportAsync(
        renderSettings("SVG", constraint)
      );
    }
    let svg = decodeUtf8(bytes);
    if (!svg.trim()) {
      postToUi({
        type: "SVG_CODE",
        nodeId,
        svg: "",
        message: "空の SVG が返されました",
      });
      return;
    }
    svg = svg.replace(/^\s*<\?xml[^>]*\?>\s*/i, "");
    postToUi({ type: "SVG_CODE", nodeId, svg });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    postToUi({
      type: "SVG_CODE",
      nodeId,
      svg: "",
      message: `SVG 書き出しに失敗: ${message}`,
    });
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

function constraintToText(constraint: ExportConstraint): string {
  if (constraint.type === "WIDTH") {
    return `${constraint.value}w`;
  }
  if (constraint.type === "HEIGHT") {
    return `${constraint.value}h`;
  }
  return `${constraint.value}x`;
}

function parseConstraintText(text: string): ExportConstraint {
  const unit = text.slice(-1).toLowerCase();
  const value = Number(text.slice(0, -1));
  const safe = Number.isFinite(value) && value > 0 ? value : 1;
  if (unit === "w") {
    return { type: "WIDTH", value: safe };
  }
  if (unit === "h") {
    return { type: "HEIGHT", value: safe };
  }
  return { type: "SCALE", value: safe };
}

function clampQuality(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_QUALITY;
  }
  return Math.min(100, Math.max(1, Math.round(value)));
}

function makeSentinel(
  format: ExportFormat,
  nodeId: string,
  config: ExportConfig
): SceneNode {
  const rect = figma.createRectangle();
  rect.name = [
    EXPORT_SENTINEL_PREFIX,
    format,
    nodeId,
    constraintToText(config.constraint),
    clampQuality(config.quality ?? DEFAULT_QUALITY),
  ].join("|");
  rect.resize(0, 0);
  rect.x = 0;
  rect.y = 0;
  rect.fills = [];
  rect.visible = false;
  rect.locked = true;
  return rect;
}

interface SentinelInfo {
  format: ExportFormat;
  nodeId: string;
  constraintText: string;
  quality: number;
}

function parseSentinelName(name: string): SentinelInfo | null {
  const match = name.match(
    /^__cfg__\|(PNG|JPG|WEBP|AVIF)\|(.+)\|([0-9.]+[whx])\|([0-9]{1,3})$/
  );
  if (!match) {
    return null;
  }
  return {
    format: match[1] as ExportFormat,
    nodeId: match[2],
    constraintText: match[3],
    quality: clampQuality(Number(match[4])),
  };
}

/**
 * Sentinel layers live inside a single hidden+locked container frame
 * ("__cb_export__") under the scanned target frame so the Layers panel stays
 * clean. Each 0x0 rectangle encodes one config that Figma's exportSettings
 * cannot carry (WEBP / AVIF are not formats; PNG/JPG never carry a quality).
 * On rescan the configs are restored (a sentinel overrides the same-format
 * layer entry, e.g. to keep its quality) and orphans/legacy layers are swept.
 */
function restoreSentinelConfigs(
  frame: SceneNode,
  validIds: Set<string>
): Map<string, ExportConfig[]> {
  const map = new Map<string, ExportConfig[]>();
  if (!("children" in frame)) {
    return map;
  }
  const children = [...frame.children];
  for (const child of children) {
    if (child.name.startsWith(LEGACY_WEBP_SENTINEL_PREFIX)) {
      child.remove();
    }
  }
  const container = children.find(
    (child) => child.name === EXPORT_SENTINEL_CONTAINER
  );
  if (!container || !("children" in container)) {
    return map;
  }
  for (const sentinel of [...container.children]) {
    const info = parseSentinelName(sentinel.name);
    if (!info) {
      continue;
    }
    if (!validIds.has(info.nodeId)) {
      sentinel.remove();
      continue;
    }
    const config: ExportConfig = {
      format: info.format,
      constraint: parseConstraintText(info.constraintText),
      quality: info.quality,
    };
    const list = map.get(info.nodeId);
    if (list) {
      list.push(config);
    } else {
      map.set(info.nodeId, [config]);
    }
  }
  if (container.children.length === 0) {
    container.remove();
  }
  return map;
}

/** Upsert / remove the sentinel entries of one row inside the container. */
async function syncExportSentinels(
  nodeId: string,
  configs: ExportConfig[]
): Promise<void> {
  if (!targetNodeId) {
    return;
  }
  const frame = await figma.getNodeByIdAsync(targetNodeId);
  if (!frame || !("children" in frame)) {
    return;
  }
  const frameChildren = [...frame.children];
  const container = frameChildren.find(
    (child) =>
      child.name === EXPORT_SENTINEL_CONTAINER && "children" in child
  ) as (SceneNode & ChildrenMixin) | undefined;
  if (container) {
    for (const sentinel of [...container.children]) {
      const info = parseSentinelName(sentinel.name);
      if (info && info.nodeId === nodeId) {
        sentinel.remove();
      }
    }
  }
  const toPersist = configs.filter(
    (config) =>
      config.format === "WEBP" ||
      config.format === "AVIF" ||
      ((config.format === "JPG" || config.format === "PNG") &&
        config.quality != null)
  );
  if (toPersist.length === 0) {
    if (container && container.children.length === 0) {
      container.remove();
    }
    return;
  }
  let target = container;
  if (!target) {
    const created = figma.createFrame();
    created.name = EXPORT_SENTINEL_CONTAINER;
    created.resize(0, 0);
    created.x = 0;
    created.y = 0;
    created.fills = [];
    created.clipsContent = false;
    created.visible = false;
    created.locked = true;
    (frame as ChildrenMixin).appendChild(created);
    target = created as SceneNode & ChildrenMixin;
  }
  for (const config of toPersist) {
    target.appendChild(makeSentinel(config.format, nodeId, config));
  }
}

/**
 * Reflect the plugin's export configs to the actual Figma layer
 * (node.exportSettings). Empty configs clear the layer's export settings.
 * WEBP / AVIF cannot be written to the layer, and PNG/JPG quality cannot
 * either; these are persisted as sentinel layers instead.
 */
async function applyExportSettings(
  nodeId: string,
  configs: ExportConfig[]
): Promise<void> {
  const node = resolveNode(nodeId);
  if (!node || !("exportSettings" in node)) {
    return;
  }
  const scene = node as SceneNode;
  scene.exportSettings = configs
    .filter(
      (config) => config.format !== "WEBP" && config.format !== "AVIF"
    )
    .map((config) => exportSettings(config.format, config.constraint));
  await syncExportSentinels(nodeId, configs);
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
  recentFrames = await loadRecentFrames();
  frameAssetPaths = await loadAssetUrlConfig();
  const uiHeight = await initUiHeight();
  figma.showUI(__html__, {
    width: UI_WIDTH,
    height: uiHeight,
    themeColors: true,
  });
  postToUi({
    type: "ASSET_URL_CONFIG",
    nodeId: targetNodeId,
    path: currentAssetUrlPath(),
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
          recordRecentFrame(fromSelection);
          postFrameTargets();
          await scanTarget();
          break;
        }
        case "SET_FRAME_NODE":
          targetNodeId = raw.nodeId;
          if (raw.nodeId) {
            recordRecentFrame(raw.nodeId);
          }
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
          await applyExportSettings(raw.nodeId, raw.configs);
          break;
        case "HOVER_ROW":
          showHoverOverlay(raw.nodeId);
          break;
        case "FETCH_SVG_CODE":
          await fetchSvgCode(raw.nodeId, raw.constraint, raw.options);
          break;
        case "SET_ASSET_URL_CONFIG":
          if (!raw.nodeId) {
            postToUi({
              type: "ASSET_URL_CONFIG",
              nodeId: null,
              path: "",
            });
            break;
          }
          if (raw.path.trim()) {
            frameAssetPaths = { ...frameAssetPaths, [raw.nodeId]: raw.path };
          } else {
            const next = { ...frameAssetPaths };
            delete next[raw.nodeId];
            frameAssetPaths = next;
          }
          void figma.clientStorage.setAsync(ASSET_URL_CONFIG_KEY, frameAssetPaths);
          postToUi({
            type: "ASSET_URL_CONFIG",
            nodeId: raw.nodeId,
            path: currentAssetUrlPath(),
          });
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