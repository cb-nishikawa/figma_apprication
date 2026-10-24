import { collectPinTargets, isPinTargetNode } from './pinTargets'
import {
  clearHoverHighlight,
  hideTargetOverlay,
  removeTargetOverlay,
  showHoverHighlight,
  showTargetOverlay,
} from './hoverHighlight'
import { scanRoots } from './scan'
import type {
  ComponentInfo,
  PluginToUiMessage,
  RecentTarget,
  UiToPluginMessage,
} from './types'

const UI_WIDTH = 360
const DEFAULT_UI_HEIGHT = 560
const MIN_UI_HEIGHT = 320
const MAX_UI_HEIGHT = 900
const UI_HEIGHT_STORAGE_KEY = 'uiHeight'
const RECENT_TARGETS_KEY = 'cbComponentExplorer.recentTargets'
const MAX_RECENT_TARGETS = 20

function clampUiHeight(height: number): number {
  return Math.min(MAX_UI_HEIGHT, Math.max(MIN_UI_HEIGHT, Math.round(height)))
}

figma.skipInvisibleInstanceChildren = true

figma.showUI(__html__, {
  width: UI_WIDTH,
  height: DEFAULT_UI_HEIGHT,
  themeColors: true,
})

void (async () => {
  const saved = await figma.clientStorage.getAsync(UI_HEIGHT_STORAGE_KEY)
  if (typeof saved === 'number') {
    figma.ui.resize(UI_WIDTH, clampUiHeight(saved))
  }
})()

let pinnedNodeId: string | null = null
/** 過去に選択した対象フレームの履歴（clientStorage に永続化）。 */
let recentTargets: RecentTarget[] = []
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

// ---- 対象フレームの履歴（clientStorage 永続化） ----

function isRecentTarget(value: unknown): value is RecentTarget {
  if (!value || typeof value !== 'object') {
    return false
  }
  const entry = value as Partial<RecentTarget>
  return (
    typeof entry.id === 'string' &&
    typeof entry.name === 'string' &&
    typeof entry.kind === 'string' &&
    typeof entry.label === 'string'
  )
}

async function loadRecentTargets(): Promise<RecentTarget[]> {
  let stored: unknown
  try {
    stored = await figma.clientStorage.getAsync(RECENT_TARGETS_KEY)
  } catch {
    return []
  }
  if (!Array.isArray(stored)) {
    return []
  }
  const targets = stored.filter(isRecentTarget).slice(0, MAX_RECENT_TARGETS)
  // 起動時クリーンアップ: 見つからない・対象外ノードを履歴から除去
  const kept: RecentTarget[] = []
  for (const entry of targets) {
    const node = await figma.getNodeByIdAsync(entry.id)
    if (!node || !isPinTargetNode(node)) {
      continue
    }
    kept.push(entry)
  }
  if (kept.length !== targets.length) {
    void figma.clientStorage.setAsync(RECENT_TARGETS_KEY, kept)
  }
  return kept
}

/** 対象確定時に履歴へ追加する（現在ページ内のピン対象のみ）。 */
function recordRecentTarget(nodeId: string): void {
  const target = collectPinTargets().find((t) => t.id === nodeId)
  if (!target) {
    return
  }
  recentTargets = [
    {
      id: target.id,
      name: target.name,
      kind: target.kind,
      label: target.label,
    },
    ...recentTargets.filter((existing) => existing.id !== target.id),
  ].slice(0, MAX_RECENT_TARGETS)
  void figma.clientStorage.setAsync(RECENT_TARGETS_KEY, recentTargets)
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
    recent: recentTargets,
  })
}

/** Prefer a selected target node, else the nearest target ancestor. */
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

  if (!pinnedNodeId) {
    latestComponents = []
    post({ type: 'no-selection' })
    syncSelectionHighlight()
    return
  }

  const node = await figma.getNodeByIdAsync(pinnedNodeId)
  if (!node || !isPinTargetNode(node)) {
    pinnedNodeId = null
    latestComponents = []
    postPinTargets()
    post({ type: 'no-selection' })
    syncSelectionHighlight()
    return
  }

  post({ type: 'scanning' })
  const components = await scanRoots([node], generation, isCurrentGeneration)
  if (components === null || !isCurrentGeneration(generation)) {
    return
  }
  latestComponents = components
  post({ type: 'result', components })
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
  ignoreNextSelectionChange = false

  const pageId = figma.currentPage.id
  if (pageId === lastPageId) {
    return
  }
  lastPageId = pageId
  postPinTargets()
  scheduleScan()
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

async function commitPinnedNode(nodeId: string | null): Promise<void> {
  pinnedNodeId = nodeId
  if (nodeId) {
    recordRecentTarget(nodeId)
  }
  postPinTargets()
  await runScan()
}

figma.ui.onmessage = (msg: UiToPluginMessage) => {
  void (async () => {
    switch (msg.type) {
      case 'ready':
        recentTargets = await loadRecentTargets()
        postPinTargets()
        await runScan()
        break

      case 'set-pinned-node':
        await commitPinnedNode(msg.pinnedNodeId)
        break

      case 'set-pinned-from-selection': {
        if (figma.currentPage.selection.length === 0) {
          post({ type: 'selection-empty' })
          break
        }
        const fromSelection = resolvePinTargetFromSelection()
        const targets = collectPinTargets()
        if (!fromSelection || !targets.some((t) => t.id === fromSelection)) {
          post({ type: 'error', message: '選択からターゲットを解決できません' })
          break
        }
        await commitPinnedNode(fromSelection)
        break
      }

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

      case 'show-target-overlay': {
        const node = await figma.getNodeByIdAsync(msg.nodeId)
        if (node && 'absoluteBoundingBox' in node) {
          showTargetOverlay(node as SceneNode)
        } else {
          hideTargetOverlay()
        }
        break
      }

      case 'hide-target-overlay':
        hideTargetOverlay()
        break

      case 'resize-ui': {
        const height = clampUiHeight(msg.height)
        figma.ui.resize(UI_WIDTH, height)
        void figma.clientStorage.setAsync(UI_HEIGHT_STORAGE_KEY, height)
        break
      }

      default:
        break
    }
  })()
}

figma.on('close', () => {
  clearHoverHighlight()
  removeTargetOverlay()
})
