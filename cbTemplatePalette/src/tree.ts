import type { ListNode, TemplateGroup, TemplateListEntry } from "./types";

export function isGroup(node: ListNode): node is TemplateGroup {
  return node.type === "group";
}

/** Groups in root order. Groups never nest, so this is every group there is. */
export function listGroups(tree: ListNode[]): TemplateGroup[] {
  return tree.filter(isGroup);
}

function clampIndex(index: number, length: number): number {
  if (!Number.isFinite(index)) {
    return length;
  }
  return Math.min(length, Math.max(0, Math.round(index)));
}

function groupAt(tree: ListNode[], id: string): TemplateGroup | undefined {
  return tree.find((node): node is TemplateGroup => isGroup(node) && node.id === id);
}

/**
 * Drops tree entries whose template is gone and puts templates the tree does not
 * know about at the head of the root. Keeps the list consistent when the index
 * and the tree are written at the same time by two plugin windows, and migrates
 * templates that were saved before the tree existed.
 */
export function reconcileTree(tree: ListNode[], templateIds: Iterable<string>): ListNode[] {
  const existing = new Set(templateIds);
  const seen = new Set<string>();
  const kept: ListNode[] = [];
  for (const node of tree) {
    if (isGroup(node)) {
      const items = node.items.filter((id) => existing.has(id) && !seen.has(id));
      for (const id of items) {
        seen.add(id);
      }
      kept.push({ ...node, items });
      continue;
    }
    if (existing.has(node.id) && !seen.has(node.id)) {
      seen.add(node.id);
      kept.push(node);
    }
  }
  const missing: ListNode[] = [];
  for (const id of existing) {
    if (!seen.has(id)) {
      missing.push({ type: "item", id });
    }
  }
  return [...missing, ...kept];
}

/** Removes template entries from every scope. Groups are left alone. */
export function removeItems(tree: ListNode[], ...ids: string[]): ListNode[] {
  if (ids.length === 0) {
    return tree;
  }
  const drop = new Set(ids);
  return tree
    .map((node) =>
      isGroup(node) ? { ...node, items: node.items.filter((id) => !drop.has(id)) } : node
    )
    .filter((node) => !(node.type === "item" && drop.has(node.id)));
}

/** New templates land at the head of the root. */
export function prependItem(tree: ListNode[], id: string): ListNode[] {
  return [{ type: "item", id }, ...removeItems(tree, id)];
}

/** Inserts a fragment built elsewhere at the head of the root, keeping its order. */
export function insertFragment(tree: ListNode[], fragment: ListNode[]): ListNode[] {
  const ids = fragment.flatMap((node) => (isGroup(node) ? node.items : [node.id]));
  return [...fragment, ...removeItems(tree, ...ids)];
}

/** Rewrites ids that were reassigned on import. Items without a mapping are dropped. */
export function remapTree(
  tree: ListNode[],
  itemIds: Map<string, string>,
  groupIds: Map<string, string> = new Map()
): ListNode[] {
  const nodes: ListNode[] = [];
  for (const node of tree) {
    if (!isGroup(node)) {
      const id = itemIds.get(node.id);
      if (id) {
        nodes.push({ type: "item", id });
      }
      continue;
    }
    // `collapsed` is left out on purpose: importing a file gives open groups.
    nodes.push({
      type: "group",
      id: groupIds.get(node.id) ?? node.id,
      name: node.name,
      items: node.items.flatMap((id) => (itemIds.has(id) ? [itemIds.get(id) as string] : [])),
    });
  }
  return nodes;
}

/** Puts templates the fragment does not place at the end of the root, in order. */
export function appendMissingItems(tree: ListNode[], ids: string[]): ListNode[] {
  const placed = new Set(tree.flatMap((node) => (isGroup(node) ? node.items : [node.id])));
  const missing: TemplateListEntry[] = ids
    .filter((id) => !placed.has(id))
    .map((id) => ({ type: "item", id }));
  return missing.length === 0 ? tree : [...tree, ...missing];
}

export function addGroup(tree: ListNode[], group: TemplateGroup): ListNode[] {
  return [...tree.filter((node) => !(isGroup(node) && node.id === group.id)), { ...group, items: [...group.items] }];
}

export function renameGroup(tree: ListNode[], id: string, name: string): ListNode[] {
  return tree.map((node) => (isGroup(node) && node.id === id ? { ...node, name } : node));
}

/** Folds or unfolds a group. Every other operation keeps the flag as it is. */
export function setGroupCollapsed(
  tree: ListNode[],
  id: string,
  collapsed: boolean
): ListNode[] {
  return tree.map((node) =>
    isGroup(node) && node.id === id ? { ...node, collapsed } : node
  );
}

/** Removes the group only. The templates inside it are deleted with it. */
export function dropGroup(tree: ListNode[], id: string): ListNode[] {
  const next = tree.filter((node) => !(isGroup(node) && node.id === id));
  return next.length === tree.length ? tree : next;
}

/** The group a template sits in, or null at the root. */
export function groupOf(tree: ListNode[], id: string): TemplateGroup | null {
  return tree.find((node): node is TemplateGroup => isGroup(node) && node.items.includes(id)) ?? null;
}

/** Where a node currently is, in the terms the move message uses. */
export function locateNode(
  tree: ListNode[],
  id: string
): { groupId: string | null; index: number } | null {
  const at = tree.findIndex((node) => node.id === id);
  if (at >= 0) {
    return { groupId: null, index: at };
  }
  for (const node of tree) {
    if (isGroup(node)) {
      const index = node.items.indexOf(id);
      if (index >= 0) {
        return { groupId: node.id, index };
      }
    }
  }
  return null;
}

/**
 * Moves a node into `groupId` (null = root). `index` is the slot it would occupy
 * in the target list as displayed, so the node's own position is still counted;
 * the shift from detaching it is applied here.
 *
 * Groups live at the root only, so a group dropped onto another group stays put.
 */
export function moveNode(
  tree: ListNode[],
  nodeId: string,
  groupId: string | null,
  index: number
): ListNode[] {
  const group = groupAt(tree, nodeId);
  const from = locateNode(tree, nodeId);
  if (!from) {
    return tree;
  }
  if (group && groupId) {
    return tree;
  }
  const target = groupId ? groupAt(tree, groupId) : undefined;
  if (groupId && !target) {
    return tree;
  }
  const detached = group ? tree.filter((entry) => entry.id !== nodeId) : removeItems(tree, nodeId);
  const node: ListNode = group ?? { type: "item", id: nodeId };
  const shift = from.groupId === groupId && from.index < index ? 1 : 0;
  if (!target) {
    const at = clampIndex(index - shift, detached.length);
    return [...detached.slice(0, at), node, ...detached.slice(at)];
  }
  return detached.map((entry) => {
    if (!isGroup(entry) || entry.id !== target.id) {
      return entry;
    }
    const at = clampIndex(index - shift, entry.items.length);
    return { ...entry, items: [...entry.items.slice(0, at), nodeId, ...entry.items.slice(at)] };
  });
}