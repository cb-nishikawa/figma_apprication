import type { HoverHighlightItem, HoverHighlightStyle, MatchRange } from "./types";
import { splitRangeByNewlines } from "./highlightRanges";

export type { HoverHighlightItem, HoverHighlightStyle };
export { splitRangeByNewlines };

export const HOVER_HIGHLIGHT_NAME = "__CB_TC_HIGHLIGHT__";
export const HIGHLIGHT_POOL_NAME = "__CB_TC_HIGHLIGHT_POOL__";

/** Same colors as cbComponentExplorer hoverHighlight. */
const COMPONENT_COLOR = { r: 161 / 255, g: 84 / 255, b: 242 / 255 };
const INSTANCE_COLOR = { r: 0, g: 1, b: 64 / 255 };

const HEIGHT_EPS = 0.5;

let poolRoot: SceneNode | null = null;
const poolEntries = new Map<string, SceneNode>();

export function highlightItemKey(item: HoverHighlightItem): string {
  const range = item.ranges?.[0];
  if (range) {
    return `${item.nodeId}:${range.start}:${range.end}`;
  }
  return `${item.nodeId}:exact`;
}

export function clearHoverHighlight(): void {
  poolEntries.clear();
  poolRoot = null;

  const page = figma.currentPage;
  for (const child of [...page.children]) {
    if (
      (child.type === "RECTANGLE" ||
        child.type === "FRAME" ||
        child.type === "GROUP" ||
        child.type === "TEXT") &&
      (child.name === HOVER_HIGHLIGHT_NAME ||
        child.name === HIGHLIGHT_POOL_NAME ||
        child.name.startsWith(`${HOVER_HIGHLIGHT_NAME}:`))
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
}

function isOnCurrentPage(node: BaseNode): boolean {
  let current: BaseNode | null = node;
  while (current && current.type !== "PAGE") {
    current = current.parent;
  }
  return Boolean(current && current.id === figma.currentPage.id);
}

function styleColor(style: HoverHighlightStyle): RGB {
  return style === "component" ? COMPONENT_COLOR : INSTANCE_COLOR;
}

function applyHighlightPaint(rect: RectangleNode, style: HoverHighlightStyle): void {
  const color = styleColor(style);
  rect.fills = [
    {
      type: "SOLID",
      color,
      opacity: 0.4,
    },
  ];
  rect.strokes = [
    {
      type: "SOLID",
      color,
    },
  ];
  rect.strokeWeight = 1;
  rect.dashPattern = [10, 10];
}

function solidFill(color: RGB, opacity: number): SolidPaint[] {
  return [
    {
      type: "SOLID",
      color,
      opacity,
    },
  ];
}

async function loadTextFonts(textNode: TextNode): Promise<void> {
  const length = textNode.characters.length;
  if (length === 0) {
    return;
  }
  const fonts = textNode.getRangeAllFontNames(0, length);
  for (const font of fonts) {
    await figma.loadFontAsync(font);
  }
}

function collectPartialSegments(
  characters: string,
  ranges: MatchRange[]
): MatchRange[] {
  const segments: MatchRange[] = [];
  for (const range of ranges) {
    segments.push(...splitRangeByNewlines(characters, range));
  }
  return segments;
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
): Promise<T> {
  const probe = source.clone();
  figma.currentPage.appendChild(probe);
  try {
    await loadTextFonts(probe);
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
    await loadTextFonts(probe);
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
  applyHighlightPaint(rect, style);
  rect.visible = true;
  figma.currentPage.appendChild(rect);
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

  const layout = await withFixedWidthProbe(textNode, (probe) => {
    const prefixHeight =
      segment.start === 0
        ? 0
        : probeTextHeight(probe, characters.slice(0, segment.start));

    const atVisualLineStart =
      segment.start === 0 ||
      characters[segment.start - 1] === "\n" ||
      (segment.start < characters.length &&
        probeTextHeight(probe, characters.slice(0, segment.start + 1)) >
          prefixHeight + HEIGHT_EPS);

    let visualLineStart = segment.start;
    if (!atVisualLineStart) {
      visualLineStart = largestIndexWithHeightBelow(
        probe,
        characters,
        segment.start,
        prefixHeight
      );
    }

    const hardEnd = hardLineEndIndex(characters, segment.start);
    const lineHeightTarget =
      atVisualLineStart && segment.start < characters.length
        ? probeTextHeight(probe, characters.slice(0, segment.start + 1))
        : prefixHeight;
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

  const width = Math.max(segmentSize.width, 1);
  const height = Math.max(segmentSize.height, lineHeightPx, 1);
  const x = resolveSegmentX(
    textNode,
    originBox,
    prefixSize.width,
    Math.max(lineSize.width, prefixSize.width + width, 1)
  );

  const rect = figma.createRectangle();
  rect.resize(width, height);
  rect.x = x;
  rect.y = layout.y;
  applyHighlightPaint(rect, style);
  rect.visible = true;
  figma.currentPage.appendChild(rect);
  return rect;
}

async function createPartialTextClone(
  textNode: TextNode,
  style: HoverHighlightStyle,
  segments: MatchRange[],
  box: Rect
): Promise<SceneNode | null> {
  let clone: TextNode | null = null;
  try {
    clone = textNode.clone();
    figma.currentPage.appendChild(clone);
    clone.x = box.x;
    clone.y = box.y;

    await loadTextFonts(clone);
    const length = clone.characters.length;
    if (length === 0) {
      clone.remove();
      return null;
    }

    clone.setRangeFills(0, length, solidFill({ r: 0, g: 0, b: 0 }, 0));
    const color = styleColor(style);
    for (const segment of segments) {
      if (segment.start >= segment.end || segment.end > length) {
        continue;
      }
      clone.setRangeFills(segment.start, segment.end, solidFill(color, 0.4));
    }

    clone.visible = true;
    return clone;
  } catch {
    clone?.remove();
    return null;
  }
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

  const segments = collectPartialSegments(textNode.characters, ranges);
  if (segments.length === 0) {
    return [];
  }

  const lineHeightPx = resolveLineHeightPx(textNode);

  const [rectNodes, clone] = await Promise.all([
    Promise.all(
      segments.map((segment) =>
        createPartialSegmentRect(
          textNode,
          style,
          segment,
          box,
          lineHeightPx
        )
      )
    ),
    createPartialTextClone(textNode, style, segments, box),
  ]);

  const nodes: SceneNode[] = [];
  for (const rect of rectNodes) {
    if (rect) {
      nodes.push(rect);
    }
  }
  if (clone) {
    nodes.push(clone);
  }
  return nodes;
}

function packageEntryNodes(key: string, nodes: SceneNode[]): SceneNode | null {
  if (nodes.length === 0) {
    return null;
  }

  const entry =
    nodes.length === 1
      ? nodes[0]
      : figma.group(nodes, figma.currentPage);

  entry.name = `${HOVER_HIGHLIGHT_NAME}:${key}`;
  entry.locked = true;
  entry.visible = false;
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
    return;
  }

  const group = figma.group(
    packaged.map((p) => p.entry),
    figma.currentPage
  );
  group.name = HIGHLIGHT_POOL_NAME;
  group.locked = true;
  group.visible = true;
  poolRoot = group;
}

/** Show prebuilt pool entries for the given hover items (visibility only). */
export function showHoverHighlight(items: HoverHighlightItem[]): void {
  setHighlightVisibility(items.map((item) => highlightItemKey(item)));
}

/** Hide all pool entries without destroying the pool. */
export function hideAllHighlights(): void {
  setHighlightVisibility(null);
}
