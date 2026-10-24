import type { ComponentInfo, LayerNode } from '../types'

export type GroupItem = {
  kind: 'group'
  key: string
  id: string
  name: string
  nodeKind: 'SECTION' | 'FRAME'
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
      case 'FRAME': {
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
