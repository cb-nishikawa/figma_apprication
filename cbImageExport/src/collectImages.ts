import type { ImageListItem } from "./types";

function isVisible(node: SceneNode): boolean {
  return node.visible !== false;
}

function hasImageFill(node: SceneNode): boolean {
  if (!("fills" in node)) {
    return false;
  }
  const fills = (node as GeometryMixin).fills;
  if (!Array.isArray(fills)) {
    return false;
  }
  return fills.some(
    (fill) => fill.type === "IMAGE" && fill.visible !== false
  );
}

function isMaskNode(node: SceneNode): boolean {
  return "isMask" in node && (node as SceneNode & { isMask: boolean }).isMask;
}

function walkVisible(
  node: SceneNode,
  visit: (n: SceneNode) => void
): void {
  if (!isVisible(node)) {
    return;
  }
  visit(node);
  if ("children" in node) {
    for (const child of (node as ChildrenMixin).children) {
      walkVisible(child as SceneNode, visit);
    }
  }
}

function parentNameOf(node: SceneNode, root: FrameNode): string {
  const parent = node.parent;
  if (parent && parent.type !== "PAGE" && parent.type !== "DOCUMENT" && "name" in parent) {
    const name = String(parent.name).trim();
    if (name) {
      return name;
    }
  }
  return root.name || "(untitled)";
}

/**
 * Collect every visible image source node under the selected frames.
 * Each IMAGE fill node becomes its own export unit (no mask/clip grouping).
 */
export function collectImageTargets(
  roots: FrameNode[]
): Array<{ target: SceneNode; parentName: string }> {
  const byId = new Map<
    string,
    { target: SceneNode; parentName: string }
  >();

  for (const root of roots) {
    if (!isVisible(root)) {
      continue;
    }
    walkVisible(root, (node) => {
      if (isMaskNode(node)) {
        return;
      }
      if (!hasImageFill(node) || !("exportAsync" in node)) {
        return;
      }
      if (!byId.has(node.id)) {
        byId.set(node.id, { target: node, parentName: parentNameOf(node, root) });
      }
    });
  }

  return [...byId.values()];
}

export function selectedFrames(): FrameNode[] {
  return figma.currentPage.selection.filter(
    (n): n is FrameNode => n.type === "FRAME"
  );
}