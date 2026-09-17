import type { ComponentInfo, GroupPathNode, InstanceInfo } from './types'

const CHUNK_SIZE = 200

function yieldToMain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function getPageInfo(node: BaseNode): { pageId: string; pageName: string } {
  let current: BaseNode | null = node
  while (current && current.type !== 'PAGE') {
    current = current.parent
  }
  if (current && current.type === 'PAGE') {
    return { pageId: current.id, pageName: current.name }
  }
  return {
    pageId: figma.currentPage.id,
    pageName: figma.currentPage.name,
  }
}

/** Collect SECTION/FRAME ancestors from root (outer) to leaf (inner). */
function resolveAncestorPath(
  node: BaseNode,
  cache: Map<string, GroupPathNode[]>,
): GroupPathNode[] {
  const startParent = node.parent
  if (!startParent) {
    return []
  }

  if (cache.has(startParent.id)) {
    return cache.get(startParent.id)!
  }

  const upward: GroupPathNode[] = []
  let current: BaseNode | null = startParent

  while (current && current.type !== 'PAGE' && current.type !== 'DOCUMENT') {
    if (current.type === 'SECTION' || current.type === 'FRAME') {
      upward.push({
        id: current.id,
        name: current.name,
        kind: current.type,
      })
    }
    current = current.parent
  }

  const path = upward.reverse()
  cache.set(startParent.id, path)
  return path
}

function nearestOfKind(
  path: GroupPathNode[],
  kind: 'SECTION' | 'FRAME',
): GroupPathNode | null {
  for (let i = path.length - 1; i >= 0; i--) {
    if (path[i].kind === kind) {
      return path[i]
    }
  }
  return null
}

function getComponentDisplayName(main: ComponentNode): string {
  const parent = main.parent
  if (parent && parent.type === 'COMPONENT_SET') {
    return `${parent.name} / ${main.name}`
  }
  return main.name
}

function isLocalComponent(main: ComponentNode): boolean {
  const parent = main.parent
  if (parent && parent.type === 'COMPONENT_SET') {
    return !parent.remote
  }
  return !main.remote
}

function canJumpToComponent(main: ComponentNode): boolean {
  if (main.remote) {
    return false
  }
  const page = getPageInfo(main)
  return page.pageId === figma.currentPage.id
}

type SearchRoot = SceneNode | PageNode

function hasFindAllWithCriteria(
  node: BaseNode,
): node is BaseNode & {
  findAllWithCriteria: (criteria: { types: ['INSTANCE'] }) => InstanceNode[]
} {
  return 'findAllWithCriteria' in node
}

function collectInstances(roots: readonly SearchRoot[]): InstanceNode[] {
  const found = new Map<string, InstanceNode>()

  for (const root of roots) {
    if (root.type === 'INSTANCE') {
      found.set(root.id, root)
    }
    if (hasFindAllWithCriteria(root)) {
      for (const node of root.findAllWithCriteria({ types: ['INSTANCE'] })) {
        found.set(node.id, node)
      }
    }
  }

  return Array.from(found.values())
}

export async function scanRoots(
  roots: readonly SearchRoot[],
  generation: number,
  isCurrent: (generation: number) => boolean,
): Promise<ComponentInfo[] | null> {
  const instances = collectInstances(roots)
  if (!isCurrent(generation)) {
    return null
  }

  const pathCache = new Map<string, GroupPathNode[]>()
  const groups = new Map<
    string,
    {
      main: ComponentNode
      instances: InstanceInfo[]
    }
  >()

  const indexed = instances.map((instance, layerIndex) => ({
    instance,
    layerIndex,
  }))

  for (let i = 0; i < indexed.length; i += CHUNK_SIZE) {
    if (!isCurrent(generation)) {
      return null
    }

    const chunk = indexed.slice(i, i + CHUNK_SIZE)
    const resolved = await Promise.all(
      chunk.map(async ({ instance, layerIndex }) => {
        const main = await instance.getMainComponentAsync()
        return { instance, main, layerIndex }
      }),
    )

    for (const { instance, main, layerIndex } of resolved) {
      if (!main) {
        continue
      }

      let group = groups.get(main.id)
      if (!group) {
        group = { main, instances: [] }
        groups.set(main.id, group)
      }

      const page = getPageInfo(instance)
      const ancestorPath = resolveAncestorPath(instance, pathCache)
      const section = nearestOfKind(ancestorPath, 'SECTION')
      const frame = nearestOfKind(ancestorPath, 'FRAME')

      group.instances.push({
        id: instance.id,
        name: instance.name,
        pageId: page.pageId,
        pageName: page.pageName,
        parentSectionId: section?.id ?? null,
        parentSectionName: section?.name ?? null,
        parentFrameId: frame?.id ?? null,
        parentFrameName: frame?.name ?? null,
        ancestorPath,
        layerIndex,
      })
    }

    if (i + CHUNK_SIZE < indexed.length) {
      await yieldToMain()
    }
  }

  if (!isCurrent(generation)) {
    return null
  }

  const components: ComponentInfo[] = Array.from(groups.values()).map(
    ({ main, instances: instanceInfos }) => {
      instanceInfos.sort((a, b) => a.layerIndex - b.layerIndex)
      const representative = instanceInfos[0]
      const page = getPageInfo(main)
      return {
        id: main.id,
        name: getComponentDisplayName(main),
        pageId: page.pageId,
        pageName: page.pageName,
        isLocal: isLocalComponent(main),
        canJump: canJumpToComponent(main),
        instances: instanceInfos,
        layerIndex: representative?.layerIndex ?? Number.MAX_SAFE_INTEGER,
        groupPath: representative?.ancestorPath ?? [],
      }
    },
  )

  return components
}
