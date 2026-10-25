import type { ComponentInfo, LayerNode } from '../types'

export type GroupItem = {
  kind: 'group'
  key: string
  id: string
  name: string
  nodeKind: 'SECTION' | 'FRAME' | 'GROUP'
  children: LayerItem[]
}

export type InstanceItem = {
  kind: 'instance'
  key: string
  id: string
  name: string
  component: ComponentInfo
  children: LayerItem[]
}

export type ComponentItem = {
  kind: 'component'
  key: string
  component: ComponentInfo
  children: LayerItem[]
}

export type SetItem = {
  kind: 'set'
  key: string
  id: string
  name: string
  canJump: boolean
  isLocal: boolean
  children: ComponentItem[]
}

export type LayerItem = GroupItem | ComponentItem | SetItem | InstanceItem

/**
 * Convert the raw layer tree into display items.
 * Instances are shown as individual rows; empty groups are removed.
 */
export function buildLayerItems(
  nodes: readonly LayerNode[],
  componentsById: ReadonlyMap<string, ComponentInfo>,
  parentKey = '',
): LayerItem[] {
  const items: LayerItem[] = []

  for (const node of nodes) {
    switch (node.type) {
    case 'SECTION':
    case 'FRAME':
    case 'GROUP': {
      const key = `${parentKey}/g:${node.id}`
      const children = buildLayerItems(node.children, componentsById, key)
      if (children.length === 0) {
        break
      }
      items.push({
        kind: 'group',
        key,
        id: node.id,
        name: node.name,
        nodeKind: node.type,
        children,
      })
      break
    }
      case 'COMPONENT_SET': {
        const key = `${parentKey}/cs:${node.id}`
        const children = buildLayerItems(node.children, componentsById, key).filter(
          (item): item is ComponentItem => item.kind === 'component',
        )
        if (children.length === 0) {
          break
        }
        const set = children[0]?.component.componentSet
        items.push({
          kind: 'set',
          key,
          id: node.id,
          name: node.name,
          canJump: set?.canJump ?? false,
          isLocal: children[0]?.component.isLocal ?? true,
          children,
        })
        break
      }
      case 'COMPONENT': {
        const component = componentsById.get(node.id)
        if (!component) {
          items.push(...buildLayerItems(node.children, componentsById, parentKey))
          break
        }
        const key = `${parentKey}/d:${node.id}`
        const children = buildLayerItems(node.children, componentsById, key)
        items.push({
          kind: 'component',
          key,
          component,
          children,
        })
        break
      }
      case 'INSTANCE': {
        const component = node.mainId ? componentsById.get(node.mainId) : undefined
        if (!component) {
          items.push(...buildLayerItems(node.children, componentsById, parentKey))
          break
        }
        const key = `${parentKey}/n:${node.id}`
        const children = buildLayerItems(node.children, componentsById, key)
        items.push({
          kind: 'instance',
          key,
          id: node.id,
          name: node.name,
          component,
          children,
        })
        break
      }
    }
  }

  return items
}

/** Number of rows under a group (instances count as rows, definitions/sets count as rows). */
export function countGroupRows(item: GroupItem): number {
  let count = 0
  for (const child of item.children) {
    if (child.kind === 'group') {
      count += countGroupRows(child)
      continue
    }
    count += 1
  }
  return count
}

/** Index every row key to the canvas node ids it represents (used by toggles). */
export function indexItemNodeIds(
  items: readonly LayerItem[],
  out = new Map<string, string[]>(),
): Map<string, string[]> {
  for (const item of items) {
    if (item.kind === 'group') {
      indexItemNodeIds(item.children, out)
      continue
    }
    if (item.kind === 'set') {
      out.set(item.key, [item.id])
      indexItemNodeIds(item.children, out)
      continue
    }
    if (item.kind === 'component') {
      out.set(item.key, [item.component.id])
      indexItemNodeIds(item.children, out)
      continue
    }
    if (item.kind === 'instance') {
      out.set(item.key, [item.id])
      indexItemNodeIds(item.children, out)
      continue
    }
  }
  return out
}

export type SearchScope = { components: boolean; instances: boolean; local: boolean; library: boolean }

/**
 * Filter items by the search scope and query.
 * Rows of an unchecked kind are removed together with their contents.
 * A matched row keeps its children filtered by scope only; a non-matched row stays only for matched descendants.
 * `expandedKeys` (only with a query) lists rows/headings that should be opened to reveal the matches.
 */
export function collectLibraryContainingKeys(items: readonly LayerItem[]): { components: Set<string>; instances: Set<string> } {
  const components = new Set<string>()
  const instances = new Set<string>()

  const isLibraryItem = (item: LayerItem): boolean => {
    if (item.kind === 'instance') {
      return !item.component.isLocal
    }
    if (item.kind === 'component') {
      return !item.component.isLocal
    }
    if (item.kind === 'set') {
      return item.children.some((child) => !child.component.isLocal)
    }
    return false
  }

  const visit = (item: LayerItem): boolean => {
    const childContains = item.children.some((child) => isLibraryItem(child) || visit(child))
    if (childContains) {
      if (item.kind === 'component') {
        components.add(item.component.id)
      }
      if (item.kind === 'instance') {
        instances.add(item.id)
        components.add(item.component.id)
      }
    }
    return isLibraryItem(item) || childContains
  }

  for (const item of items) {
    visit(item)
  }

  return { components, instances }
}

export function filterLayerItems(
  items: readonly LayerItem[],
  query: string,
  scope: SearchScope = { components: true, instances: true, local: true, library: true },
): { items: LayerItem[]; expandedKeys: string[] } {
  const q = query.trim().toLowerCase()
  const expandedKeys: string[] = []
  const matches = (text: string) => text.toLowerCase().includes(q)
  const passesScope = (isLocal: boolean) => (isLocal ? scope.local : scope.library)
  const containing = collectLibraryContainingKeys(items)

  const scopeOnly = (list: readonly LayerItem[]): LayerItem[] => {
    const out: LayerItem[] = []
    for (const item of list) {
      if (item.kind === 'group') {
        const children = scopeOnly(item.children)
        if (children.length > 0) {
          out.push({ ...item, children })
        }
      } else if (item.kind === 'instance') {
        if (scope.instances && (passesScope(item.component.isLocal) || (scope.library && containing.instances.has(item.id)))) {
          out.push({ ...item, children: scopeOnly(item.children) })
        }
      } else if (item.kind === 'component') {
        if (scope.components && (passesScope(item.component.isLocal) || (scope.library && containing.components.has(item.component.id)))) {
          out.push({ ...item, children: scopeOnly(item.children) })
        }
      } else if (scope.components) {
        const variants = item.children.filter((c) => passesScope(c.component.isLocal) || (scope.library && containing.components.has(c.component.id)))
        if (variants.length > 0) {
          out.push({ ...item, children: variants.map((c) => ({ ...c, children: scopeOnly(c.children) })) })
        }
      }
    }
    return out
  }

  const scopeOnlyVariants = (list: readonly ComponentItem[]): ComponentItem[] =>
    list.map((child) => ({ ...child, children: scopeOnly(child.children) }))

  const filterRow = <T extends InstanceItem | ComponentItem>(
    item: T,
    matched: boolean,
  ): T | null => {
    if (matched) {
      return { ...item, children: scopeOnly(item.children) }
    }
    const children = filter(item.children)
    if (children.length === 0) {
      return null
    }
    expandedKeys.push(item.key)
    return { ...item, children }
  }

  const filter = (list: readonly LayerItem[]): LayerItem[] => {
    const out: LayerItem[] = []
    for (const item of list) {
      if (item.kind === 'group') {
        const children = filter(item.children)
        if (children.length > 0) {
          expandedKeys.push(item.key)
          out.push({ ...item, children })
        }
        continue
      }
      if (item.kind === 'instance') {
        if (!scope.instances || !(passesScope(item.component.isLocal) || (scope.library && containing.instances.has(item.id)))) {
          continue
        }
        const row = filterRow(
          item,
          matches(item.name) ||
            matches(item.component.name) ||
            (scope.library && containing.instances.has(item.id)),
        )
        if (row) {
          out.push(row)
        }
        continue
      }
      if (item.kind === 'component') {
        if (!scope.components || !(passesScope(item.component.isLocal) || (scope.library && (containing.components.has(item.component.id) || item.component.instances.some((inst) => containing.instances.has(inst.id)))))) {
          continue
        }
        const row = filterRow(
          item,
          matches(item.component.name) ||
            (scope.library &&
              (containing.components.has(item.component.id) ||
                item.component.instances.some((inst) => containing.instances.has(inst.id)))),
        )
        if (row) {
          out.push(row)
        }
        continue
      }
      if (!scope.components) {
        continue
      }
      const eligibleChildren = item.children.filter((c) => passesScope(c.component.isLocal) || (scope.library && (containing.components.has(c.component.id) || c.component.instances.some((inst) => containing.instances.has(inst.id)))))
      if (eligibleChildren.length === 0) {
        continue
      }
      const setContainsLibrary = eligibleChildren.some(
        (c) =>
          containing.components.has(c.component.id) ||
          c.component.instances.some((inst) => containing.instances.has(inst.id)),
      )
      if (matches(item.name) || (scope.library && setContainsLibrary)) {
        out.push({ ...item, children: eligibleChildren.map((c) => ({ ...c, children: scopeOnly(c.children) })) })
        continue
      }
      const variants: ComponentItem[] = []
      for (const child of eligibleChildren) {
        const row = filterRow(
          child,
          matches(child.component.variantName) ||
            matches(child.component.name) ||
            (scope.library &&
              (containing.components.has(child.component.id) ||
                child.component.instances.some((inst) => containing.instances.has(inst.id)))),
        )
        if (row) {
          variants.push(row)
        }
      }
      if (variants.length > 0) {
        expandedKeys.push(item.key)
        out.push({ ...item, children: variants })
      }
    }
    return out
  }

  return { items: q ? filter(items) : scopeOnly(items), expandedKeys }
}
