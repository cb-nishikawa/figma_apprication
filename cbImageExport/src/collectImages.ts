export const DEBUG = true;

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

/**
 * Resolve what an image node should be shown as:
 * - a mask container → the container (regardless of image count)
 * - any clipsContent ancestor → that frame (regardless of image count)
 * - otherwise → the image node itself
 */
function resolveRow(node: SceneNode): SceneNode {
  const mask = findMaskContainer(node);
  if (mask) {
    return mask;
  }
  const clip = findClipFrame(node);
  if (clip) {
    return clip;
  }
  return node;
}

/** Is the node a collectible image source (has a visible IMAGE fill). */
function isImageSource(node: SceneNode): boolean {
  return !isMaskNode(node) && hasImageFill(node) && "exportAsync" in node;
}

/**
 * Collect the rows shown in the list. Each row is either:
 * - a mask container (any image inside it → the container)
 * - a clipsContent ancestor frame (any image inside it → that frame)
 * - or an individual image source node
 *
 * Uses findAll (not manual child recursion) so that content inside
 * instances / slots is reliably included.
 */
export function collectImageTargets(roots: SceneNode[]): SceneNode[] {
  const byId = new Map<string, SceneNode>();

  for (const root of roots) {
    if (!isVisible(root)) {
      continue;
    }

    const candidates: SceneNode[] = [];
    if (isImageSource(root)) {
      candidates.push(root);
    }
    if ("findAll" in root) {
      for (const node of (root as ChildrenMixin).findAll(isImageSource)) {
        candidates.push(node);
      }
    }

    for (const node of candidates) {
      const row = resolveRow(node);
      if (!byId.has(row.id)) {
        byId.set(row.id, row);
      }
    }
  }

  const collected = [...byId.values()];
  if (DEBUG) {
    console.log(
      "[cbImageExport] collected rows:",
      collected.map((n) => `${n.type} ${n.name} (${n.id})`)
    );
  }
  return collected;
}