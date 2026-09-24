import type {
  HighlightColor,
  HoverHighlightItem,
  HoverHighlightStyle,
  MatchRange,
} from "./types";
import {
  splitRangeByHeightBreaks,
  splitRangeByNewlines,
} from "./highlightRanges";

export type { HighlightColor, HoverHighlightItem, HoverHighlightStyle };
export { splitRangeByHeightBreaks, splitRangeByNewlines };

export const HOVER_HIGHLIGHT_NAME = "__CB_TC_HIGHLIGHT__";
export const HIGHLIGHT_POOL_NAME = "__CB_TC_HIGHLIGHT_POOL__";
export const OCR_LABEL_NAME = "__CB_TC_OCR_LABEL__";

const HIGHLIGHT_COLORS: Record<HighlightColor, RGB> = {
  red: { r: 1, g: 59 / 255, b: 48 / 255 },
  yellow: { r: 1, g: 204 / 255, b: 0 },
  green: { r: 0, g: 1, b: 64 / 255 },
  purple: { r: 161 / 255, g: 84 / 255, b: 242 / 255 },
};

const DEFAULT_HIGHLIGHT_COLOR: HighlightColor = "green";
const OCR_LABEL_FONT_SIZE = 8;

const HEIGHT_EPS = 0.5;

let poolRoot: SceneNode | null = null;
const poolEntries = new Map<string, SceneNode>();
const ocrLabelEntries = new Map<string, TextNode>();

/** Per-text-node scale when fallback fonts were used for measurement. */
type MeasureScale = { scaleX: number; scaleY: number; replaced: boolean };
const measureScaleCache = new Map<string, MeasureScale>();

export function highlightItemKey(item: HoverHighlightItem): string {
  if (item.ocrRegion) {
    const id = item.ocrRegion.id;
    return id.startsWith("ocr:") ? id : `ocr:${id}`;
  }
  const range = item.ranges?.[0];
  if (range) {
    return `${item.nodeId}:${range.start}:${range.end}`;
  }
  return `${item.nodeId}:exact`;
}

export function clearHoverHighlight(): void {
  poolEntries.clear();
  poolRoot = null;
  measureScaleCache.clear();
  ocrLabelEntries.clear();

  const page = figma.currentPage;
  for (const child of [...page.children]) {
    if (
      (child.type === "RECTANGLE" ||
        child.type === "FRAME" ||
        child.type === "GROUP" ||
        child.type === "TEXT") &&
      (child.name === HOVER_HIGHLIGHT_NAME ||
        child.name === HIGHLIGHT_POOL_NAME ||
        child.name.startsWith(`${HOVER_HIGHLIGHT_NAME}:`) ||
        child.name.startsWith(`${OCR_LABEL_NAME}:`))
    ) {
      child.remove();
    }
  }
}

export function setHighlightVisibility(keys: string[] | null): void {
  const enabled = new Set(keys ?? []);
  for (const [key, node] of poolEntries) {
    if (node.removed) {
      continue;
    }
    node.visible = enabled.has(key);
  }
  for (const [key, node] of ocrLabelEntries) {
    if (node.removed) {
      continue;
    }
    node.visible = enabled.has(key);
  }
}

function isOnCurrentPage(node: BaseNode): boolean {
  let current: BaseNode | null = node;
  while (current && current.type !== "PAGE") {
    current = current.parent;
  }
  return Boolean(current && current.id === figma.currentPage.id);
}

function colorRgb(color: HighlightColor): RGB {
  return HIGHLIGHT_COLORS[color];
}

function applyHighlightPaint(
  rect: RectangleNode,
  color: HighlightColor = DEFAULT_HIGHLIGHT_COLOR
): void {
  const rgb = colorRgb(color);
  rect.fills = [
    {
      type: "SOLID",
      color: rgb,
      opacity: 0.4,
    },
  ];
  rect.strokes = [
    {
      type: "SOLID",
      color: rgb,
    },
  ];
  rect.strokeWeight = 1;
  rect.dashPattern = [10, 10];
}

function recolorNodeTree(node: SceneNode, color: HighlightColor): void {
  if (node.type === "RECTANGLE") {
    applyHighlightPaint(node, color);
    return;
  }
  if ("children" in node) {
    for (const child of node.children) {
      recolorNodeTree(child as SceneNode, color);
    }
  }
}

export function recolorHighlightItems(
  items: HoverHighlightItem[],
  color: HighlightColor
): void {
  for (const item of items) {
    const entry = poolEntries.get(highlightItemKey(item));
    if (!entry || entry.removed) {
      continue;
    }
    recolorNodeTree(entry, color);
  }
}

function fontKey(font: FontName): string {
  return `${font.family}::${font.style}`;
}

function fontsEqual(a: FontName, b: FontName): boolean {
  return a.family === b.family && a.style === b.style;
}

async function tryLoadFont(font: FontName): Promise<boolean> {
  try {
    await figma.loadFontAsync(font);
    return true;
  } catch {
    return false;
  }
}

/** Cache: original font key → resolved fallback (or null if none). */
const fallbackFontCache = new Map<string, FontName | null>();

async function resolveFallbackFont(original: FontName): Promise<FontName | null> {
  const key = fontKey(original);
  if (fallbackFontCache.has(key)) {
    return fallbackFontCache.get(key) ?? null;
  }

  const candidates: FontName[] = [
    { family: original.family, style: "Regular" },
    { family: original.family, style: "Medium" },
    { family: original.family, style: "Bold" },
    { family: "Noto Sans JP", style: "Regular" },
    { family: "Inter", style: "Regular" },
    { family: "Roboto", style: "Regular" },
  ];

  for (const candidate of candidates) {
    if (fontsEqual(candidate, original)) {
      continue;
    }
    if (await tryLoadFont(candidate)) {
      fallbackFontCache.set(key, candidate);
      return candidate;
    }
  }

  fallbackFontCache.set(key, null);
  return null;
}

/**
 * Load fonts used by the text node. Missing/unloadable fonts are replaced
 * with a fallback via setRangeFontName.
 */
async function ensureTextFontsLoaded(
  textNode: TextNode
): Promise<{ ok: boolean; replaced: boolean }> {
  const length = textNode.characters.length;
  if (length === 0) {
    return { ok: true, replaced: false };
  }

  const fonts = textNode.getRangeAllFontNames(0, length);
  const failed: FontName[] = [];

  for (const font of fonts) {
    if (!(await tryLoadFont(font))) {
      failed.push(font);
    }
  }

  if (failed.length === 0) {
    return { ok: true, replaced: false };
  }

  const replacements = new Map<string, FontName>();
  for (const font of failed) {
    const fallback = await resolveFallbackFont(font);
    if (!fallback) {
      return { ok: false, replaced: false };
    }
    replacements.set(fontKey(font), fallback);
  }

  let runStart = 0;
  let runFont = textNode.getRangeFontName(0, 1);

  for (let i = 1; i <= length; i++) {
    const atEnd = i === length;
    const nextFont = atEnd ? null : textNode.getRangeFontName(i, i + 1);
    const same =
      !atEnd &&
      runFont !== figma.mixed &&
      nextFont !== figma.mixed &&
      fontsEqual(runFont as FontName, nextFont as FontName);

    if (same) {
      continue;
    }

    if (runFont !== figma.mixed) {
      const replacement = replacements.get(fontKey(runFont as FontName));
      if (replacement) {
        textNode.setRangeFontName(runStart, i, replacement);
      }
    }

    if (!atEnd && nextFont !== null) {
      runStart = i;
      runFont = nextFont;
    }
  }

  return { ok: true, replaced: true };
}

function clampMeasureScale(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 1;
  }
  return Math.min(Math.max(value, 0.25), 4);
}

/**
 * When fallback fonts are used (or source has missing fonts), scale probe
 * measurements to the source node's absoluteBoundingBox.
 */
async function getMeasureScale(
  source: TextNode,
  originBox: Rect
): Promise<MeasureScale> {
  const cached = measureScaleCache.get(source.id);
  if (cached) {
    return cached;
  }

  const probe = source.clone();
  figma.currentPage.appendChild(probe);
  try {
    const result = await ensureTextFontsLoaded(probe);
    if (!result.ok) {
      const scale: MeasureScale = { scaleX: 1, scaleY: 1, replaced: false };
      measureScaleCache.set(source.id, scale);
      return scale;
    }

    const needScale = result.replaced || source.hasMissingFont;
    if (!needScale) {
      const scale: MeasureScale = { scaleX: 1, scaleY: 1, replaced: false };
      measureScaleCache.set(source.id, scale);
      return scale;
    }

    applyFixedWidthLayout(probe, source);
    probe.characters = source.characters;
    const probeW = Math.max(probe.width, 0);
    const probeH = Math.max(probe.height, 0);
    const scale: MeasureScale = {
      scaleX: clampMeasureScale(probeW > 0 ? originBox.width / probeW : 1),
      scaleY: clampMeasureScale(probeH > 0 ? originBox.height / probeH : 1),
      replaced: true,
    };
    measureScaleCache.set(source.id, scale);
    return scale;
  } finally {
    probe.remove();
  }
}

async function collectPartialSegments(
  textNode: TextNode,
  ranges: MatchRange[]
): Promise<MatchRange[]> {
  const characters = textNode.characters;
  const hardSegments: MatchRange[] = [];
  for (const range of ranges) {
    hardSegments.push(...splitRangeByNewlines(characters, range));
  }
  if (hardSegments.length === 0) {
    return [];
  }

  const visual = await withFixedWidthProbe(textNode, (probe) => {
    const segments: MatchRange[] = [];
    for (const hard of hardSegments) {
      segments.push(
        ...splitRangeByHeightBreaks(hard, (endExclusive) => {
          if (endExclusive <= 0) {
            return 0;
          }
          return probeTextHeight(probe, characters.slice(0, endExclusive));
        })
      );
    }
    return segments;
  });

  // If fonts cannot be loaded, keep hard-newline splits only.
  return visual ?? hardSegments;
}

/** Height used for y placement; trailing hard newline must not count as an empty line. */
function prefixHeightForPlacement(
  probe: TextNode,
  characters: string,
  start: number
): number {
  if (start <= 0) {
    return 0;
  }
  if (characters[start - 1] === "\n") {
    return probeTextHeight(probe, characters.slice(0, start - 1));
  }
  return probeTextHeight(probe, characters.slice(0, start));
}

function resolveLineHeightPx(textNode: TextNode): number {
  const fontSize =
    textNode.fontSize === figma.mixed ? 12 : (textNode.fontSize as number);
  const lineHeight = textNode.lineHeight;
  if (lineHeight === figma.mixed) {
    return fontSize * 1.2;
  }
  if (lineHeight.unit === "PIXELS") {
    return lineHeight.value;
  }
  if (lineHeight.unit === "PERCENT") {
    return (fontSize * lineHeight.value) / 100;
  }
  return fontSize * 1.2;
}

function applyFixedWidthLayout(probe: TextNode, source: TextNode): void {
  const width = Math.max(source.width, 1);
  if (source.textAutoResize === "NONE") {
    probe.textAutoResize = "NONE";
    probe.resize(width, Math.max(source.height, 1));
    return;
  }
  probe.textAutoResize = "HEIGHT";
  probe.resize(width, Math.max(probe.height, 1));
}

function probeTextHeight(probe: TextNode, text: string): number {
  probe.characters = text;
  return Math.max(probe.height, 0);
}

async function withFixedWidthProbe<T>(
  source: TextNode,
  run: (probe: TextNode) => T | Promise<T>
): Promise<T | null> {
  const probe = source.clone();
  figma.currentPage.appendChild(probe);
  try {
    const result = await ensureTextFontsLoaded(probe);
    if (!result.ok) {
      return null;
    }
    applyFixedWidthLayout(probe, source);
    return await run(probe);
  } finally {
    probe.remove();
  }
}

async function measureHugSize(
  source: TextNode,
  text: string
): Promise<{ width: number; height: number }> {
  if (!text) {
    return { width: 0, height: 0 };
  }

  const probe = source.clone();
  figma.currentPage.appendChild(probe);
  try {
    const result = await ensureTextFontsLoaded(probe);
    if (!result.ok) {
      return { width: 0, height: 0 };
    }
    probe.textAutoResize = "WIDTH_AND_HEIGHT";
    probe.characters = text;
    return {
      width: Math.max(probe.width, 0),
      height: Math.max(probe.height, 0),
    };
  } finally {
    probe.remove();
  }
}

function resolveSegmentX(
  textNode: TextNode,
  originBox: Rect,
  prefixWidth: number,
  lineWidth: number
): number {
  const align = textNode.textAlignHorizontal;
  if (align === "RIGHT") {
    return originBox.x + originBox.width - lineWidth + prefixWidth;
  }
  if (align === "CENTER") {
    return originBox.x + (originBox.width - lineWidth) / 2 + prefixWidth;
  }
  return originBox.x + prefixWidth;
}

function largestIndexWithHeightBelow(
  probe: TextNode,
  characters: string,
  start: number,
  targetHeight: number
): number {
  let left = 0;
  let right = start;
  let answer = 0;
  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const height = probeTextHeight(probe, characters.slice(0, mid));
    if (height < targetHeight - HEIGHT_EPS) {
      answer = mid;
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }
  return answer;
}

function firstIndexWithHeightAbove(
  probe: TextNode,
  characters: string,
  start: number,
  end: number,
  targetHeight: number
): number {
  let left = start + 1;
  let right = end;
  let answer = end;
  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const height = probeTextHeight(probe, characters.slice(0, mid));
    if (height > targetHeight + HEIGHT_EPS) {
      answer = mid;
      right = mid - 1;
    } else {
      left = mid + 1;
    }
  }
  return answer;
}

function hardLineEndIndex(characters: string, index: number): number {
  const found = characters.indexOf("\n", index);
  return found === -1 ? characters.length : found;
}

async function createExactHighlight(
  sceneNode: SceneNode,
  style: HoverHighlightStyle
): Promise<SceneNode | null> {
  const box = sceneNode.absoluteBoundingBox;
  if (!box || box.width <= 0 || box.height <= 0) {
    return null;
  }

  const rect = figma.createRectangle();
  rect.resize(box.width, box.height);
  rect.x = box.x;
  rect.y = box.y;
  applyHighlightPaint(rect);
  rect.visible = true;
  figma.currentPage.appendChild(rect);
  return rect;
}

function localToAbsolute(
  transform: Transform,
  x: number,
  y: number
): { x: number; y: number } {
  return {
    x: transform[0][0] * x + transform[0][1] * y + transform[0][2],
    y: transform[1][0] * x + transform[1][1] * y + transform[1][2],
  };
}

async function createOcrCopyLabel(
  key: string,
  text: string,
  box: { x: number; y: number; width: number; height: number }
): Promise<void> {
  const content = text.trim();
  if (!content || box.width <= 0 || box.height <= 0) {
    return;
  }

  const fontCandidates: FontName[] = [
    { family: "Noto Sans JP", style: "Regular" },
    { family: "Inter", style: "Regular" },
    { family: "Roboto", style: "Regular" },
  ];
  let font: FontName | null = null;
  for (const candidate of fontCandidates) {
    if (await tryLoadFont(candidate)) {
      font = candidate;
      break;
    }
  }
  if (!font) {
    return;
  }

  // createText requires the default font to be loaded first.
  await tryLoadFont({ family: "Inter", style: "Regular" });

  const label = figma.createText();
  label.name = `${OCR_LABEL_NAME}:${key}`;
  label.locked = false;
  figma.currentPage.appendChild(label);
  label.fontName = font;
  label.fontSize = OCR_LABEL_FONT_SIZE;
  label.fills = [
    {
      type: "SOLID",
      color: { r: 0, g: 0, b: 0 },
      opacity: 0.9,
    },
  ];
  label.lineHeight = { unit: "PIXELS", value: OCR_LABEL_FONT_SIZE + 2 };
  label.textAutoResize = "HEIGHT";
  const maxWidth = Math.max(box.width, 1);
  const maxHeight = Math.max(box.height, 1);
  label.resize(maxWidth, OCR_LABEL_FONT_SIZE);
  label.characters = content;

  if (label.height > maxHeight + HEIGHT_EPS) {
    let lo = 0;
    let hi = content.length;
    let best = "";
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const candidate = content.slice(0, mid);
      label.characters = candidate;
      if (label.height <= maxHeight + HEIGHT_EPS) {
        best = candidate;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    label.characters = best.length > 0 ? best : content.slice(0, 1);
  }

  label.x = box.x;
  label.y = box.y;
  label.visible = false;
  ocrLabelEntries.set(key, label);
}

async function createOcrRegionHighlight(
  sceneNode: SceneNode,
  region: NonNullable<HoverHighlightItem["ocrRegion"]>
): Promise<SceneNode | null> {
  const poly = region.poly;
  if (!poly || poly.length === 0) {
    return null;
  }
  const scale = region.exportScale > 0 ? region.exportScale : 1;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of poly) {
    const lx = Number(point[0]) / scale;
    const ly = Number(point[1]) / scale;
    if (!Number.isFinite(lx) || !Number.isFinite(ly)) {
      continue;
    }
    minX = Math.min(minX, lx);
    minY = Math.min(minY, ly);
    maxX = Math.max(maxX, lx);
    maxY = Math.max(maxY, ly);
  }
  if (!Number.isFinite(minX) || maxX <= minX || maxY <= minY) {
    return null;
  }

  const transform = sceneNode.absoluteTransform;
  const corners = [
    localToAbsolute(transform, minX, minY),
    localToAbsolute(transform, maxX, minY),
    localToAbsolute(transform, maxX, maxY),
    localToAbsolute(transform, minX, maxY),
  ];
  const absMinX = Math.min(...corners.map((c) => c.x));
  const absMinY = Math.min(...corners.map((c) => c.y));
  const absMaxX = Math.max(...corners.map((c) => c.x));
  const absMaxY = Math.max(...corners.map((c) => c.y));
  const width = absMaxX - absMinX;
  const height = absMaxY - absMinY;
  if (width <= 0 || height <= 0) {
    return null;
  }

  const rect = figma.createRectangle();
  rect.resize(width, height);
  rect.x = absMinX;
  rect.y = absMinY;
  applyHighlightPaint(rect);
  rect.visible = true;
  figma.currentPage.appendChild(rect);

  const key = region.id.startsWith("ocr:") ? region.id : `ocr:${region.id}`;
  await createOcrCopyLabel(key, region.text ?? "", {
    x: absMinX,
    y: absMinY,
    width,
    height,
  });

  return rect;
}

async function createPartialSegmentRect(
  textNode: TextNode,
  style: HoverHighlightStyle,
  segment: MatchRange,
  originBox: Rect,
  lineHeightPx: number
): Promise<SceneNode | null> {
  const characters = textNode.characters;
  const segmentText = characters.slice(segment.start, segment.end);
  if (!segmentText) {
    return null;
  }

  const scale = await getMeasureScale(textNode, originBox);

  const layout = await withFixedWidthProbe(textNode, (probe) => {
    const prefixHeight = prefixHeightForPlacement(
      probe,
      characters,
      segment.start
    );
    // Raw height including a trailing \n (used only for soft-wrap detection).
    const rawPrefixHeight =
      segment.start === 0
        ? 0
        : probeTextHeight(probe, characters.slice(0, segment.start));

    const atVisualLineStart =
      segment.start === 0 ||
      characters[segment.start - 1] === "\n" ||
      (segment.start < characters.length &&
        probeTextHeight(probe, characters.slice(0, segment.start + 1)) >
          rawPrefixHeight + HEIGHT_EPS);

    let visualLineStart = segment.start;
    if (!atVisualLineStart) {
      visualLineStart = largestIndexWithHeightBelow(
        probe,
        characters,
        segment.start,
        rawPrefixHeight
      );
    }

    const hardEnd = hardLineEndIndex(characters, segment.start);
    const lineHeightTarget =
      atVisualLineStart && segment.start < characters.length
        ? probeTextHeight(probe, characters.slice(0, segment.start + 1))
        : rawPrefixHeight;
    const softEnd = firstIndexWithHeightAbove(
      probe,
      characters,
      segment.start,
      hardEnd,
      lineHeightTarget
    );
    const visualLineEnd =
      softEnd > segment.start && softEnd <= hardEnd ? softEnd - 1 : hardEnd;

    const y = atVisualLineStart
      ? originBox.y + prefixHeight
      : originBox.y + Math.max(0, prefixHeight - lineHeightPx);

    return {
      visualLineStart,
      visualLineEnd: Math.max(visualLineEnd, segment.end),
      y,
    };
  });

  if (!layout) {
    return null;
  }

  const prefixOnLine = characters.slice(layout.visualLineStart, segment.start);
  const lineText = characters.slice(
    layout.visualLineStart,
    Math.max(layout.visualLineEnd, segment.end)
  );

  const [prefixSize, segmentSize, lineSize] = await Promise.all([
    measureHugSize(textNode, prefixOnLine),
    measureHugSize(textNode, segmentText),
    measureHugSize(textNode, lineText),
  ]);

  const rawWidth = Math.max(segmentSize.width, 1);
  const rawHeight = Math.max(segmentSize.height, lineHeightPx, 1);
  const rawX = resolveSegmentX(
    textNode,
    originBox,
    prefixSize.width,
    Math.max(lineSize.width, prefixSize.width + rawWidth, 1)
  );
  const rawY = layout.y;

  const width = Math.max(rawWidth * scale.scaleX, 1);
  const height = Math.max(rawHeight * scale.scaleY, 1);
  const x = originBox.x + (rawX - originBox.x) * scale.scaleX;
  const y = originBox.y + (rawY - originBox.y) * scale.scaleY;

  const rect = figma.createRectangle();
  rect.resize(width, height);
  rect.x = x;
  rect.y = y;
  applyHighlightPaint(rect);
  rect.visible = true;
  figma.currentPage.appendChild(rect);
  return rect;
}

async function createPartialHighlight(
  textNode: TextNode,
  style: HoverHighlightStyle,
  ranges: MatchRange[]
): Promise<SceneNode[]> {
  const box = textNode.absoluteBoundingBox;
  if (!box || box.width <= 0 || box.height <= 0) {
    return [];
  }

  const segments = await collectPartialSegments(textNode, ranges);
  if (segments.length === 0) {
    return [];
  }

  const lineHeightPx = resolveLineHeightPx(textNode);
  // Warm scale cache once before parallel segment measurement.
  await getMeasureScale(textNode, box);
  const rectNodes = await Promise.all(
    segments.map((segment) =>
      createPartialSegmentRect(textNode, style, segment, box, lineHeightPx)
    )
  );

  const nodes: SceneNode[] = [];
  for (const rect of rectNodes) {
    if (rect) {
      nodes.push(rect);
    }
  }
  return nodes;
}

function packageEntryNodes(key: string, nodes: SceneNode[]): SceneNode | null {
  if (nodes.length === 0) {
    return null;
  }

  if (nodes.length === 1) {
    const entry = nodes[0];
    entry.name = `${HOVER_HIGHLIGHT_NAME}:${key}`;
    entry.locked = true;
    entry.visible = false;
    return entry;
  }

  const entry = figma.group(nodes, figma.currentPage);
  entry.name = `${HOVER_HIGHLIGHT_NAME}:${key}`;
  entry.locked = true;
  entry.visible = false;
  entry.expanded = false;
  return entry;
}

async function createHighlightForItem(
  item: HoverHighlightItem
): Promise<SceneNode[]> {
  const node = await figma.getNodeByIdAsync(item.nodeId);
  if (!node || !("absoluteBoundingBox" in node)) {
    return [];
  }

  const sceneNode = node as SceneNode;
  if (!isOnCurrentPage(sceneNode)) {
    return [];
  }

  if (item.ocrRegion) {
    const ocrNode = await createOcrRegionHighlight(sceneNode, item.ocrRegion);
    return ocrNode ? [ocrNode] : [];
  }

  if (item.exact || sceneNode.type !== "TEXT") {
    const exactNode = await createExactHighlight(sceneNode, item.style);
    return exactNode ? [exactNode] : [];
  }

  return createPartialHighlight(sceneNode, item.style, item.ranges ?? []);
}

export async function buildHighlightPool(
  items: HoverHighlightItem[]
): Promise<void> {
  clearHoverHighlight();

  if (items.length === 0) {
    return;
  }

  const packaged = (
    await Promise.all(
      items.map(async (item) => {
        const key = highlightItemKey(item);
        const nodes = await createHighlightForItem(item);
        const entry = packageEntryNodes(key, nodes);
        return entry ? { key, entry } : null;
      })
    )
  ).filter((value): value is { key: string; entry: SceneNode } => value !== null);

  if (packaged.length === 0) {
    return;
  }

  for (const { key, entry } of packaged) {
    poolEntries.set(key, entry);
  }

  if (packaged.length === 1) {
    poolRoot = packaged[0].entry;
  } else {
    const group = figma.group(
      packaged.map((p) => p.entry),
      figma.currentPage
    );
    group.name = HIGHLIGHT_POOL_NAME;
    group.locked = true;
    group.visible = true;
    group.expanded = false;
    poolRoot = group;
  }

  // Keep unlocked OCR labels above the locked pool for selection/copy.
  for (const label of ocrLabelEntries.values()) {
    if (!label.removed) {
      figma.currentPage.appendChild(label);
    }
  }
}

/** Show prebuilt pool entries for the given hover items (visibility only). */
export function showHoverHighlight(items: HoverHighlightItem[]): void {
  setHighlightVisibility(items.map((item) => highlightItemKey(item)));
}

/** Hide all pool entries without destroying the pool. */
export function hideAllHighlights(): void {
  setHighlightVisibility(null);
}
