import type { ComponentInfo, InstanceInfo, LayerNode } from './types'

const YIELD_EVERY = 300

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

function canJumpToComponent(main: ComponentNode | ComponentSetNode): boolean {
  if (main.remote) {
    return false
  }
  const page = getPageInfo(main)
  return page.pageId === figma.currentPage.id
}

function getComponentSet(
  main: ComponentNode,
): ComponentInfo['componentSet'] {
  const parent = main.parent
  if (!parent || parent.type !== 'COMPONENT_SET') {
    return null
  }
  return {
    id: parent.id,
    name: parent.name,
    canJump: canJumpToComponent(parent),
  }
}

type SearchRoot = SceneNode | PageNode

type Ancestors = {
  section: { id: string; name: string } | null
  frame: { id: string; name: string } | null
}

type ScanContext = {
  generation: number
  isCurrent: (generation: number) => boolean
  page: { pageId: string; pageName: string }
  visited: number
  order: number
  groups: Map<string, { main: ComponentNode; instances: InstanceInfo[]; layerIndex: number }>
}

function hasChildren(node: BaseNode): node is BaseNode & ChildrenMixin {
  return 'children' in node
}

function touchGroup(ctx: ScanContext, main: ComponentNode, layerIndex: number) {
  let group = ctx.groups.get(main.id)
  if (!group) {
    group = { main, instances: [], layerIndex }
    ctx.groups.set(main.id, group)
  }
  return group
}

/** Walk children in Layers panel order (last child first). Returns null when the scan is outdated. */
async function walkChildren(
  parent: BaseNode,
  insideComponent: boolean,
  ancestors: Ancestors,
  ctx: ScanContext,
): Promise<LayerNode[] | null> {
  if (!hasChildren(parent)) {
    return []
  }
  const out: LayerNode[] = []
  const children = parent.children
  for (let i = children.length - 1; i >= 0; i--) {
    const result = await walkNode(children[i], insideComponent, ancestors, ctx)
    if (result === null) {
      return null
    }
    out.push(...result)
  }
  return out
}

async function walkNode(
  node: SceneNode,
  insideComponent: boolean,
  ancestors: Ancestors,
  ctx: ScanContext,
): Promise<LayerNode[] | null> {
  ctx.visited++
  if (ctx.visited % YIELD_EVERY === 0) {
    await yieldToMain()
    if (!ctx.isCurrent(ctx.generation)) {
      return null
    }
  }

  switch (node.type) {
    case 'INSTANCE': {
      const layerIndex = ctx.order++
      const main = await node.getMainComponentAsync()
      const children = await walkChildren(node, true, ancestors, ctx)
      if (children === null) {
        return null
      }
      if (!main) {
        return children
      }
      touchGroup(ctx, main, layerIndex).instances.push({
        id: node.id,
        name: node.name,
        pageId: ctx.page.pageId,
        pageName: ctx.page.pageName,
        parentSectionId: ancestors.section?.id ?? null,
        parentSectionName: ancestors.section?.name ?? null,
        parentFrameId: ancestors.frame?.id ?? null,
        parentFrameName: ancestors.frame?.name ?? null,
        layerIndex,
      })
      return [{ id: node.id, name: node.name, type: 'INSTANCE', mainId: main.id, children }]
    }
    case 'COMPONENT': {
      touchGroup(ctx, node, ctx.order++)
      const children = await walkChildren(node, true, ancestors, ctx)
      if (children === null) {
        return null
      }
      return [{ id: node.id, name: node.name, type: 'COMPONENT', children }]
    }
    case 'COMPONENT_SET': {
      const children = await walkChildren(node, true, ancestors, ctx)
      if (children === null) {
        return null
      }
      return [{ id: node.id, name: node.name, type: 'COMPONENT_SET', children }]
    }
    case 'SECTION': {
      const children = await walkChildren(
        node,
        insideComponent,
        { section: { id: node.id, name: node.name }, frame: ancestors.frame },
        ctx,
      )
      if (children === null) {
        return null
      }
      return [{ id: node.id, name: node.name, type: 'SECTION', children }]
    }
    case 'FRAME': {
      if (insideComponent) {
        return walkChildren(node, true, ancestors, ctx)
      }
      const children = await walkChildren(
        node,
        false,
        { section: ancestors.section, frame: { id: node.id, name: node.name } },
        ctx,
      )
      if (children === null) {
        return null
      }
      return [{ id: node.id, name: node.name, type: 'FRAME', children }]
    }
    default:
      return walkChildren(node, insideComponent, ancestors, ctx)
  }
}

export type ScanResult = {
  components: ComponentInfo[]
  layerTree: LayerNode[]
}

/** Scan the target in Layers panel order. The target itself is not part of the tree unless it is an INSTANCE. */
export async function scanRoot(
  root: SearchRoot,
  generation: number,
  isCurrent: (generation: number) => boolean,
): Promise<ScanResult | null> {
  const ctx: ScanContext = {
    generation,
    isCurrent,
    page: getPageInfo(root),
    visited: 0,
    order: 0,
    groups: new Map(),
  }

  let ancestors: Ancestors = { section: null, frame: null }
  let current: BaseNode | null = root.parent
  while (current && current.type !== 'PAGE' && current.type !== 'DOCUMENT') {
    if (current.type === 'SECTION' && !ancestors.section) {
      ancestors = { ...ancestors, section: { id: current.id, name: current.name } }
    }
    if (current.type === 'FRAME' && !ancestors.frame) {
      ancestors = { ...ancestors, frame: { id: current.id, name: current.name } }
    }
    current = current.parent
  }
  if (root.type === 'SECTION') {
    ancestors = { ...ancestors, section: { id: root.id, name: root.name } }
  }
  if (root.type === 'FRAME') {
    ancestors = { ...ancestors, frame: { id: root.id, name: root.name } }
  }

  let layerTree: LayerNode[] | null
  if (
    root.type === 'INSTANCE' ||
    root.type === 'COMPONENT' ||
    root.type === 'COMPONENT_SET'
  ) {
    layerTree = await walkNode(root, false, ancestors, ctx)
  } else if (
    root.type === 'SECTION' ||
    root.type === 'FRAME' ||
    root.type === 'GROUP'
  ) {
    const children = await walkChildren(root, false, ancestors, ctx)
    if (children === null) {
      return null
    }
    layerTree = [{ id: root.id, name: root.name, type: root.type as LayerNode['type'], children }]
  } else {
    layerTree = await walkChildren(root, false, ancestors, ctx)
  }
  if (layerTree === null || !isCurrent(generation)) {
    return null
  }

  const components: ComponentInfo[] = Array.from(ctx.groups.values()).map(
    ({ main, instances, layerIndex }) => {
      const page = getPageInfo(main)
      return {
        id: main.id,
        name: getComponentDisplayName(main),
        pageId: page.pageId,
        pageName: page.pageName,
        isLocal: isLocalComponent(main),
        canJump: canJumpToComponent(main),
        instances,
        layerIndex,
        componentSet: getComponentSet(main),
        variantName: main.name,
      }
    },
  )

  return { components, layerTree }
}
