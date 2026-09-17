import { collectPinTargets } from './pinTargets'
import { clearHoverHighlight, showHoverHighlight } from './hoverHighlight'
import { scanRoots } from './scan'
import type {
  ComponentInfo,
  PluginToUiMessage,
  SearchMode,
  UiToPluginMessage,
} from './types'

figma.skipInvisibleInstanceChildren = true

figma.showUI(__html__, {
  width: 360,
  height: 560,
  themeColors: true,
})

let mode: SearchMode = 'selection'
let pinnedNodeId: string | null = null
let ignoreNextSelectionChange = false
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let scanGeneration = 0
let latestComponents: ComponentInfo[] = []
let lastPageId = figma.currentPage.id

function post(message: PluginToUiMessage): void {
  figma.ui.postMessage(message)
}

function isCurrentGeneration(generation: number): boolean {
  return generation === scanGeneration
}

function setSelection(nodes: SceneNode[]): void {
  ignoreNextSelectionChange = true
  figma.currentPage.selection = nodes
  syncSelectionHighlight(false)
}

async function getSceneNodesByIds(ids: string[]): Promise<SceneNode[]> {
  const nodes: SceneNode[] = []
  for (const id of ids) {
    const node = await figma.getNodeByIdAsync(id)
    if (node && 'visible' in node) {
      nodes.push(node as SceneNode)
    }
  }
  return nodes
}

async function selectNodes(ids: string[], zoom = false): Promise<void> {
  if (ids.length === 0) {
    setSelection([])
    return
  }
  const nodes = await getSceneNodesByIds(ids)
  if (nodes.length === 0) {
    figma.notify('対象のノードが見つかりません')
    return
  }
  setSelection(nodes)
  if (zoom) {
    figma.viewport.scrollAndZoomIntoView(nodes)
  }
}

function buildInstanceToComponentMap(): Map<string, string> {
  const map = new Map<string, string>()
  for (const component of latestComponents) {
    for (const instance of component.instances) {
      map.set(instance.id, component.id)
    }
  }
  return map
}

function syncSelectionHighlight(clearToggles = false): void {
  const componentIds = new Set<string>()
  const instanceIds = new Set<string>()
  const listedComponentIds = new Set(latestComponents.map((c) => c.id))
  const instanceToComponent = buildInstanceToComponentMap()

  for (const node of figma.currentPage.selection) {
    if (node.type === 'COMPONENT' && listedComponentIds.has(node.id)) {
      componentIds.add(node.id)
      continue
    }
    if (node.type === 'INSTANCE') {
      const componentId = instanceToComponent.get(node.id)
      if (componentId) {
        componentIds.add(componentId)
        instanceIds.add(node.id)
      }
    }
  }

  post({
    type: 'selection-sync',
    componentIds: Array.from(componentIds),
    instanceIds: Array.from(instanceIds),
    clearToggles,
  })
}

async function jumpToNode(nodeId: string): Promise<void> {
  const node = await figma.getNodeByIdAsync(nodeId)
  if (!node || !('visible' in node)) {
    figma.notify('対象のノードが見つかりません')
    return
  }

  const sceneNode = node as SceneNode

  if (sceneNode.type === 'COMPONENT' && sceneNode.remote) {
    figma.notify('ライブラリ由来のComponentにはジャンプできません')
    return
  }

  let current: BaseNode | null = sceneNode
  while (current && current.type !== 'PAGE') {
    current = current.parent
  }
  if (!current || current.id !== figma.currentPage.id) {
    figma.notify('現在のページ外のノードにはジャンプできません')
    return
  }

  setSelection([sceneNode])
  figma.viewport.scrollAndZoomIntoView([sceneNode])
}

function postPinTargets(): void {
  const targets = collectPinTargets()
  if (pinnedNodeId && !targets.some((t) => t.id === pinnedNodeId)) {
    pinnedNodeId = null
  }
  post({
    type: 'pin-targets',
    targets,
    pinnedNodeId,
  })
}

function isPinTargetNode(
  node: BaseNode,
): node is SectionNode | FrameNode {
  return node.type === 'SECTION' || node.type === 'FRAME'
}

/** Prefer selected SECTION/FRAME, else nearest SECTION/FRAME ancestor. */
function resolvePinTargetFromSelection(): string | null {
  const selection = figma.currentPage.selection
  for (const node of selection) {
    if (isPinTargetNode(node)) {
      return node.id
    }
  }

  const first = selection[0]
  if (!first) {
    return null
  }

  let current: BaseNode | null = first.parent
  while (current && current.type !== 'PAGE' && current.type !== 'DOCUMENT') {
    if (isPinTargetNode(current)) {
      return current.id
    }
    current = current.parent
  }
  return null
}

async function runScan(): Promise<void> {
  clearHoverHighlight()
  const generation = ++scanGeneration

  if (mode === 'selection') {
    const selection = figma.currentPage.selection
    if (selection.length === 0) {
      latestComponents = []
      post({
        type: 'no-selection',
        mode,
        message: 'Nodeが選択されていません',
      })
      syncSelectionHighlight()
      return
    }

    post({ type: 'scanning', mode })
    const components = await scanRoots(selection, generation, isCurrentGeneration)
    if (components === null || !isCurrentGeneration(generation)) {
      return
    }
    latestComponents = components
    post({ type: 'result', mode, components })
    syncSelectionHighlight()
    return
  }

  if (mode === 'pinned') {
    if (!pinnedNodeId) {
      latestComponents = []
      post({
        type: 'no-selection',
        mode,
        message: '固定先が未選択です',
      })
      syncSelectionHighlight()
      return
    }

    const node = await figma.getNodeByIdAsync(pinnedNodeId)
    if (
      !node ||
      !('visible' in node) ||
      (node.type !== 'SECTION' && node.type !== 'FRAME')
    ) {
      pinnedNodeId = null
      latestComponents = []
      postPinTargets()
      post({
        type: 'no-selection',
        mode,
        message: '固定先が見つかりません',
      })
      syncSelectionHighlight()
      return
    }

    post({ type: 'scanning', mode })
    const components = await scanRoots(
      [node as SceneNode],
      generation,
      isCurrentGeneration,
    )
    if (components === null || !isCurrentGeneration(generation)) {
      return
    }
    latestComponents = components
    post({ type: 'result', mode, components })
    syncSelectionHighlight()
    return
  }

  // Page mode
  post({ type: 'scanning', mode })
  const components = await scanRoots(
    [figma.currentPage],
    generation,
    isCurrentGeneration,
  )
  if (components === null || !isCurrentGeneration(generation)) {
    return
  }
  latestComponents = components
  post({ type: 'result', mode, components })
  syncSelectionHighlight()
}

function scheduleScan(): void {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer)
  }
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    void runScan()
  }, 150)
}

function handleSelectionOrPageChange(): void {
  const fromPlugin = ignoreNextSelectionChange
  // Always sync highlight; clear toggles only on user-driven selection changes.
  syncSelectionHighlight(!fromPlugin)

  if (ignoreNextSelectionChange) {
    ignoreNextSelectionChange = false
    return
  }

  const pageId = figma.currentPage.id
  const pageChanged = pageId !== lastPageId
  lastPageId = pageId

  if (pageChanged) {
    postPinTargets()
    scheduleScan()
    return
  }

  // Same-page selection changes only rescan in selection mode.
  if (mode === 'selection') {
    scheduleScan()
  }
}

function selectionFingerprint(): string {
  const ids = figma.currentPage.selection.map((node) => node.id).join(',')
  return `${figma.currentPage.id}|${ids}`
}

function startSelectionPolling(): void {
  let lastFingerprint = selectionFingerprint()
  setInterval(() => {
    const next = selectionFingerprint()
    if (next === lastFingerprint) {
      return
    }
    lastFingerprint = next
    handleSelectionOrPageChange()
  }, 300)
}

try {
  figma.on('selectionchange', handleSelectionOrPageChange)
} catch (error) {
  console.warn(
    'selectionchange registration failed; falling back to polling',
    error,
  )
  startSelectionPolling()
}

figma.ui.onmessage = (msg: UiToPluginMessage) => {
  void (async () => {
    switch (msg.type) {
      case 'ready':
        postPinTargets()
        await runScan()
        break

      case 'list-pin-targets':
        postPinTargets()
        break

      case 'set-mode': {
        const previousMode = mode
        mode = msg.mode

        if (mode === 'pinned') {
          // Refresh candidates first.
          const targets = collectPinTargets()

          if (previousMode === 'selection') {
            const fromSelection = resolvePinTargetFromSelection()
            pinnedNodeId =
              fromSelection && targets.some((t) => t.id === fromSelection)
                ? fromSelection
                : null
          } else if (msg.pinnedNodeId !== undefined) {
            pinnedNodeId = msg.pinnedNodeId
          }

          if (pinnedNodeId && !targets.some((t) => t.id === pinnedNodeId)) {
            pinnedNodeId = null
          }

          post({
            type: 'pin-targets',
            targets,
            pinnedNodeId,
          })
        }

        await runScan()
        break
      }

      case 'set-pinned-node':
        pinnedNodeId = msg.pinnedNodeId
        if (mode === 'pinned') {
          await runScan()
        } else {
          postPinTargets()
        }
        break

      case 'set-selection':
        await selectNodes(msg.nodeIds, msg.zoom ?? true)
        break

      case 'clear-selection':
        setSelection([])
        break

      case 'jump-node':
        await jumpToNode(msg.nodeId)
        break

      case 'hover-highlight':
        await showHoverHighlight(msg.nodeIds, msg.style)
        break

      case 'clear-hover-highlight':
        clearHoverHighlight()
        break

      default:
        break
    }
  })()
}

figma.on('close', () => {
  clearHoverHighlight()
})
