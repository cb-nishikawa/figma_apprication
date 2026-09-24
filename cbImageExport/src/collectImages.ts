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

function parentOf(node: BaseNode): (BaseNode & ChildrenMixin) | null {
  const parent = node.parent;
  if (!parent || parent.type === "PAGE" || parent.type === "DOCUMENT") {
    return null;
  }
  if ("children" in parent) {
    return parent as BaseNode & ChildrenMixin;
  }
  return null;
}

/** Parent that contains an isMask child (the visual mask unit). */
function findMaskContainer(node: SceneNode): SceneNode | null {
  let current: BaseNode | null = node;
  while (current && current.type !== "PAGE" && current.type !== "DOCUMENT") {
    if ("children" in current) {
      const container = current as SceneNode & ChildrenMixin;
      const hasMask = container.children.some(
        (child) => "isMask" in child && (child as SceneNode & { isMask: boolean }).isMask
      );
      if (hasMask && (container.type === "GROUP" || container.type === "FRAME" || container.type === "COMPONENT" || container.type === "INSTANCE")) {
        return container;
      }
    }
    current = current.parent;
  }
  return null;
}

/** Nearest ancestor FRAME/COMPONENT/INSTANCE with clipsContent. */
function findClipFrame(node: SceneNode): FrameNode | ComponentNode | InstanceNode | null {
  let current: BaseNode | null = node.parent;
  while (current && current.type !== "PAGE" && current.type !== "DOCUMENT") {
    if (
      (current.type === "FRAME" ||
        current.type === "COMPONENT" ||
        current.type === "INSTANCE") &&
      "clipsContent" in current &&
      (current as FrameNode).clipsContent
    ) {
      return current as FrameNode | ComponentNode | InstanceNode;
    }
    current = current.parent;
  }
  return null;
}

function resolveExportTarget(node: SceneNode): {
  target: SceneNode;
  kind: ImageListItem["kind"];
} {
  const mask = findMaskContainer(node);
  if (mask) {
    return { target: mask, kind: "mask" };
  }
  const clip = findClipFrame(node);
  if (clip) {
    return { target: clip, kind: "clip" };
  }
  return { target: node, kind: "image" };
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

function canExport(node: SceneNode): boolean {
  return "exportAsync" in node;
}

/**
 * Collect unique export targets under selected frames.
 * Masked / clipped images resolve to the mask parent or clip frame.
 */
export function collectImageTargets(
  roots: FrameNode[]
): Array<{ target: SceneNode; kind: ImageListItem["kind"]; frameName: string }> {
  const byId = new Map<
    string,
    { target: SceneNode; kind: ImageListItem["kind"]; frameName: string }
  >();

  for (const root of roots) {
    if (!isVisible(root)) {
      continue;
    }
    const frameName = root.name || "(untitled)";
    walkVisible(root, (node) => {
      if ("isMask" in node && (node as SceneNode & { isMask: boolean }).isMask) {
        return;
      }
      if (!hasImageFill(node)) {
        return;
      }
      const { target, kind } = resolveExportTarget(node);
      if (!canExport(target) || !isVisible(target)) {
        return;
      }
      if (!byId.has(target.id)) {
        byId.set(target.id, { target, kind, frameName });
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
