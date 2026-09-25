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

/**
 * Parent that contains an isMask child (the visual mask unit).
 * The ascent never crosses an INSTANCE boundary: content placed inside an
 * instance/slot must stay resolved within that instance (image-itself row),
 * not get absorbed by an outer frame.
 */
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
    if (current.type === "INSTANCE") {
      break;
    }
    current = current.parent;
  }
  return null;
}

/**
 * Nearest ancestor with clipsContent (FRAME / COMPONENT / INSTANCE / SLOT).
 * The SLOT frame is included: an image placed into a slot is visually cropped
 * by the slot, so the row must be the slot itself (WYSIWYG), not the raw image.
 * INSTANCE boundary rule as findMaskContainer: the ascent stops at (and never
 * climbs out of) an instance, so content inside an instance is never absorbed
 * by an outer frame — it resolves to the inner clip container or the image.
 */
function findClipFrame(
  node: SceneNode
): FrameNode | ComponentNode | InstanceNode | SlotNode | null {
  let current: BaseNode | null = node.parent;
  while (current && current.type !== "PAGE" && current.type !== "DOCUMENT") {
    if (
      (current.type === "FRAME" ||
        current.type === "COMPONENT" ||
        current.type === "INSTANCE" ||
        current.type === "SLOT") &&
      "clipsContent" in current &&
      (current as FrameNode).clipsContent
    ) {
      return current as FrameNode | ComponentNode | InstanceNode | SlotNode;
    }
    if (current.type === "INSTANCE") {
      break;
    }
    current = current.parent;
  }
  return null;
}

/**
 * Resolve what an image node should be shown as:
 * - a mask container → the container (regardless of image count)
 * - any clipsContent ancestor (frame / component / instance / slot)
 *   → that container (regardless of image count)
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
 * Is the node a non-image layer that has Figma-side export settings (shapes,
 * icons, groups, vectors, text, ...)? It becomes its own list row without any
 * container resolution (unlike image sources).
 */
function isExportSettingSource(node: SceneNode): boolean {
  return (
    !isImageSource(node) &&
    "exportSettings" in node &&
    "exportAsync" in node &&
    node.exportSettings.length > 0
  );
}

// ---- temporary diagnostic helpers (DEBUG only) ----

function debugRead<T>(label: string, fn: () => T): string {
  try {
    const value = fn();
    if (value === null) {
      return `${label}=null`;
    }
    return `${label}=${String(value)}`;
  } catch (err) {
    return `${label}=ERROR(${err instanceof Error ? err.message : String(err)})`;
  }
}

function fillSignature(node: SceneNode): string {
  if (!("fills" in node)) {
    return "no-fills-prop";
  }
  const fills = (node as GeometryMixin).fills;
  if (fills === figma.mixed) {
    return "MIXED";
  }
  if (!Array.isArray(fills)) {
    return `non-array(${typeof fills})`;
  }
  if (fills.length === 0) {
    return "empty";
  }
  return fills
    .map((p) => `${p.type}${"visible" in p && p.visible === false ? "(!invis)" : ""}`)
    .join("|");
}

function walkDebug(node: SceneNode, depth: number, inInstance: boolean): void {
  if (depth > 24) {
    return;
  }
  const indent = "  ".repeat(depth);
  const vis = debugRead("visible", () => node.visible);
  const fills = debugRead("fills", () => fillSignature(node));
  const mask = debugRead("isMask", () =>
    "isMask" in node && (node as SceneNode & { isMask: boolean }).isMask ? "true" : "false"
  );
  const exp = debugRead("exportAsync", () =>
    "exportAsync" in node ? "yes" : "NO"
  );
  const clips = "clipsContent" in node
    ? debugRead("clipsContent", () => (node as FrameNode).clipsContent)
    : "n/a";
  const slotRefs =
    node.type === "SLOT"
      ? debugRead("slotRefs", () =>
          (node as SceneNode & { componentPropertyReferences?: object | null })
            .componentPropertyReferences !== null
        )
      : "n/a";

  console.log(
    `[cbImageExport][DEBUG] ${indent}${node.type} "${node.name}" id=${node.id} inInstance=${inInstance} ${vis} fills=[${fills}] ${mask} ${exp} clips=${clips} slotRefs=${slotRefs}`
  );

  if (!("children" in node)) {
    return;
  }
  const children = (node as SceneNode & ChildrenMixin).children;
  console.log(
    `[cbImageExport][DEBUG] ${indent}(children.length=${children.length})`
  );
  const nested = inInstance || node.type === "INSTANCE";
  for (const child of children) {
    walkDebug(child, depth + 1, nested);
  }
}

function dumpDiagnostics(roots: SceneNode[]): void {
  console.log("[cbImageExport][DEBUG] ===== start subtree diagnostic =====");
  for (const root of roots) {
    console.log(
      `[cbImageExport][DEBUG] root ${root.type} "${root.name}" id=${root.id}`
    );

    const all =
      "findAll" in root ? (root as ChildrenMixin).findAll(() => true) : [];
    console.log(
      `[cbImageExport][DEBUG] findAll(root) returned ${all.length} nodes`
    );
    for (const n of all) {
      console.log(
        `[cbImageExport][DEBUG]   findAll -> ${n.type} "${
          n.name
        }" id=${n.id} parent=${n.parent?.type ?? "-"}`
      );
    }

    walkDebug(root, 0, false);
  }
  console.log("[cbImageExport][DEBUG] ===== end subtree diagnostic ======");
}

// ---- end diagnostic helpers ----

/**
 * Collect the rows shown in the list. Each row is either:
 * - a mask container (any image inside it → the container)
 * - a clipsContent ancestor container (frame / component / instance / slot)
 *   (any image inside it → that container)
 * - an individual image source node
 * - a non-image layer that has Figma-side export settings (its own row)
 *
 * Uses findAll (not manual child recursion) so that content inside
 * instances / slots is reliably included.
 */
export function collectImageTargets(roots: SceneNode[]): SceneNode[] {
  const byId = new Map<string, SceneNode>();
  const rootIds = new Set(roots.map((root) => root.id));

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
      if (rootIds.has(row.id)) {
        // 対象フレーム自身に解決された画像は枠として 1 行にできないため、
        // 画像ノード自身を 1 行として追加する。ここに来るのはマスクや
        // サブクリップフレームに解決されない（隠されていない）画像のみ。
        if (DEBUG) {
          console.log(
            `[cbImageExport][DEBUG] candidate ${node.type} "${node.name}" (${node.id}) -> row ${row.type} "${row.name}" (${row.id}) EXCLUDED (selected frame itself) -> showing the image itself as a row instead`
          );
        }
        if (!byId.has(node.id)) {
          byId.set(node.id, node);
        }
        continue;
      }
      if (DEBUG) {
        console.log(
          `[cbImageExport][DEBUG] candidate ${node.type} "${node.name}" (${node.id}) -> row ${row.type} "${row.name}" (${row.id})`
        );
      }
      if (!byId.has(row.id)) {
        byId.set(row.id, row);
      }
    }

    // 第 2 パス: Figma の export settings を持つ画像以外のレイヤー
    //（図形・アイコンなど）を、ノード自身の行として追加する。
    const exportSources: SceneNode[] = [];
    if (isExportSettingSource(root)) {
      exportSources.push(root);
    }
    if ("findAll" in root) {
      for (const node of (root as ChildrenMixin).findAll(isExportSettingSource)) {
        exportSources.push(node);
      }
    }
    for (const node of exportSources) {
      if (rootIds.has(node.id)) {
        if (DEBUG) {
          console.log(
            `[cbImageExport][DEBUG] export-setting ${node.type} "${node.name}" (${node.id}) EXCLUDED (selected frame itself)`
          );
        }
        continue;
      }
      if (DEBUG) {
        console.log(
          `[cbImageExport][DEBUG] export-setting ${node.type} "${node.name}" (${node.id}) -> row (itself)`
        );
      }
      if (!byId.has(node.id)) {
        byId.set(node.id, node);
      }
    }
  }

  const collected = [...byId.values()];
  if (DEBUG) {
    console.log(
      "[cbImageExport] collected rows:",
      collected.map((n) => `${n.type} ${n.name} (${n.id})`)
    );
    dumpDiagnostics(roots);
  }
  return collected;
}