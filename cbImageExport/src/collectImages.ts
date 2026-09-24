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

/** Parent that contains an isMask child (the visual mask unit). */
function findMaskContainer(node: SceneNode): SceneNode | null {
  let current: BaseNode | null = node;
  while (current && current.type !== "PAGE" && current.type !== "DOCUMENT") {
    if ("children" in current) {
      const container = current as SceneNode & ChildrenMixin;
      const hasMask = container.children.some(
        (child) =>
          "isMask" in child &&
          (child as SceneNode & { isMask: boolean }).isMask
      );
      if (
        hasMask &&
        (container.type === "GROUP" ||
          container.type === "FRAME" ||
          container.type === "COMPONENT" ||
          container.type === "INSTANCE")
      ) {
        return container;
      }
    }
    current = current.parent;
  }
  return null;
}

/** Nearest ancestor FRAME/COMPONENT/INSTANCE with clipsContent. */
function findClipFrame(
  node: SceneNode
): FrameNode | ComponentNode | InstanceNode | null {
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

/** Count visible image source nodes under a container (mask containers excluded). */
function countImageSourcesIn(root: SceneNode): number {
  let count = 0;
  walkVisible(root, (node) => {
    if (isMaskNode(node)) {
      return;
    }
    if (hasImageFill(node) && "exportAsync" in node) {
      count += 1;
    }
  });
  return count;
}

/**
 * Resolve what an image node should be shown as:
 * - a mask container holding exactly one image → the container
 * - a clipsContent frame holding exactly one image → the frame
 * - otherwise → the image node itself
 */
function resolveRow(node: SceneNode): SceneNode {
  const mask = findMaskContainer(node);
  if (mask && countImageSourcesIn(mask) === 1) {
    return mask;
  }
  const clip = findClipFrame(node);
  if (clip && countImageSourcesIn(clip) === 1) {
    return clip;
  }
  return node;
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

/**
 * Collect the rows shown in the list. Each row is either:
 * - a mask / clipsContent container holding exactly one visible image
 * - or an individual image source node
 */
export function collectImageTargets(roots: SceneNode[]): SceneNode[] {
  const byId = new Map<string, SceneNode>();

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
      const row = resolveRow(node);
      if (!byId.has(row.id)) {
        byId.set(row.id, row);
      }
    });
  }

  return [...byId.values()];
}