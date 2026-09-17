import type { HoverHighlightItem, HoverHighlightStyle, MatchRange } from "./types";
import { splitRangeByNewlines } from "./highlightRanges";

export type { HoverHighlightItem, HoverHighlightStyle };
export { splitRangeByNewlines };

export const HOVER_HIGHLIGHT_NAME = "__CB_TC_HIGHLIGHT__";

/** Same colors as cbComponentExplorer hoverHighlight. */
const COMPONENT_COLOR = { r: 161 / 255, g: 84 / 255, b: 242 / 255 };
const INSTANCE_COLOR = { r: 0, g: 1, b: 64 / 255 };

export function clearHoverHighlight(): void {
  const page = figma.currentPage;
  for (const child of [...page.children]) {
    if (
      (child.type === "RECTANGLE" ||
        child.type === "FRAME" ||
        child.type === "GROUP" ||
        child.type === "TEXT") &&
      child.name === HOVER_HIGHLIGHT_NAME
    ) {
      child.remove();
    }
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

async function createPartialHighlight(
  textNode: TextNode,
  style: HoverHighlightStyle,
  ranges: MatchRange[]
): Promise<SceneNode | null> {
  const box = textNode.absoluteBoundingBox;
  if (!box || box.width <= 0 || box.height <= 0) {
    return null;
  }

  const segments = collectPartialSegments(textNode.characters, ranges);
  if (segments.length === 0) {
    return null;
  }

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

function finalizeHighlightNodes(nodes: SceneNode[]): void {
  if (nodes.length === 0) {
    return;
  }

  if (nodes.length === 1) {
    nodes[0].name = HOVER_HIGHLIGHT_NAME;
    nodes[0].locked = true;
    return;
  }

  const group = figma.group(nodes, figma.currentPage);
  group.name = HOVER_HIGHLIGHT_NAME;
  group.locked = true;
}

function mergeHoverItems(items: HoverHighlightItem[]): HoverHighlightItem[] {
  const byNode = new Map<string, HoverHighlightItem>();

  for (const item of items) {
    const existing = byNode.get(item.nodeId);
    if (!existing) {
      byNode.set(item.nodeId, {
        nodeId: item.nodeId,
        style: item.style,
        exact: item.exact,
        ranges: [...(item.ranges ?? [])],
      });
      continue;
    }

    existing.exact = existing.exact && item.exact;
    existing.style = existing.exact ? "component" : "instance";
    existing.ranges.push(...(item.ranges ?? []));
  }

  return [...byNode.values()];
}

export async function showHoverHighlight(
  items: HoverHighlightItem[]
): Promise<void> {
  clearHoverHighlight();

  const created: SceneNode[] = [];
  const merged = mergeHoverItems(items);

  for (const item of merged) {
    const node = await figma.getNodeByIdAsync(item.nodeId);
    if (!node || !("absoluteBoundingBox" in node)) {
      continue;
    }

    const sceneNode = node as SceneNode;
    if (!isOnCurrentPage(sceneNode)) {
      continue;
    }

    if (item.exact || sceneNode.type !== "TEXT") {
      const exactNode = await createExactHighlight(sceneNode, item.style);
      if (exactNode) {
        created.push(exactNode);
      }
      continue;
    }

    const partialNode = await createPartialHighlight(
      sceneNode,
      item.style,
      item.ranges ?? []
    );
    if (partialNode) {
      created.push(partialNode);
    }
  }

  finalizeHighlightNodes(created);
}
