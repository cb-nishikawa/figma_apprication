import type { PinTarget } from "./types";

type PinKind = "SECTION" | "FRAME";

function kindLabel(kind: PinKind): string {
  return kind === "SECTION" ? "Section" : "Frame";
}

function parentContextName(node: BaseNode): string | null {
  let current: BaseNode | null = node.parent;
  while (current && current.type !== "PAGE" && current.type !== "DOCUMENT") {
    if (current.type === "SECTION" || current.type === "FRAME") {
      return current.name;
    }
    current = current.parent;
  }
  return null;
}

function buildLabel(
  node: SceneNode & { type: PinKind },
  duplicateNames: Set<string>
): string {
  const base = `${kindLabel(node.type)}: ${node.name}`;
  if (!duplicateNames.has(`${node.type}:${node.name}`)) {
    return base;
  }
  const parentName = parentContextName(node);
  if (parentName) {
    return `${base} (${parentName})`;
  }
  return `${base} [${node.id}]`;
}

export function collectPinTargets(): PinTarget[] {
  const nodes = figma.currentPage.findAllWithCriteria({
    types: ["SECTION", "FRAME"],
  }) as Array<SceneNode & { type: PinKind }>;

  const nameCounts = new Map<string, number>();
  for (const node of nodes) {
    const key = `${node.type}:${node.name}`;
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }

  const duplicateNames = new Set<string>();
  for (const [key, count] of nameCounts) {
    if (count > 1) {
      duplicateNames.add(key);
    }
  }

  return nodes.map((node) => ({
    id: node.id,
    name: node.name,
    kind: node.type,
    label: buildLabel(node, duplicateNames),
  }));
}
