export type ComponentSortMode = 'layer' | 'name'

/** Layer tree node in Layers panel order (top to bottom). Other node types are flattened into their parent. */
export interface LayerNode {
  id: string
  name: string
  type: 'SECTION' | 'FRAME' | 'GROUP' | 'COMPONENT_SET' | 'COMPONENT' | 'INSTANCE'
  /** Main component id (INSTANCE only). */
  mainId?: string
  children: LayerNode[]
}

export interface InstanceInfo {
  id: string
  name: string
  pageId: string
  pageName: string
  parentSectionId: string | null
  parentSectionName: string | null
  parentFrameId: string | null
  parentFrameName: string | null
  layerIndex: number
}

export interface ComponentInfo {
  id: string
  name: string
  pageId: string
  pageName: string
  isLocal: boolean
  /** Whether the main component node lives on the current page and can be jumped to. */
  canJump: boolean
  instances: InstanceInfo[]
  /** First appearance (definition or instance) in Layers panel order. */
  layerIndex: number
  /** Parent COMPONENT_SET when this component is a variant. */
  componentSet: { id: string; name: string; canJump: boolean } | null
  /** Variant property string (e.g. "Size=Large"); the component name otherwise. */
  variantName: string
}

export type PinKind = 'SECTION' | 'FRAME' | 'INSTANCE' | 'GROUP'

export interface PinTarget {
  id: string
  name: string
  kind: PinKind
  label: string
}

/** 過去に選択した対象フレーム（clientStorage に保存する履歴）。 */
export interface RecentTarget {
  id: string
  name: string
  kind: PinKind
  label: string
}

export type UiToPluginMessage =
  | { type: 'set-pinned-node'; pinnedNodeId: string | null }
  | { type: 'set-pinned-from-selection' }
  | { type: 'set-selection'; nodeIds: string[]; zoom?: boolean }
  | { type: 'clear-selection' }
  | { type: 'jump-node'; nodeId: string }
  | {
      type: 'hover-highlight'
      nodeIds: string[]
      style: 'component' | 'instance'
    }
  | { type: 'clear-hover-highlight' }
  | { type: 'show-target-overlay'; nodeId: string }
  | { type: 'hide-target-overlay' }
  | { type: 'resize-ui'; height: number }
  | { type: 'ready' }

export type PluginToUiMessage =
  | { type: 'scanning' }
  | { type: 'result'; components: ComponentInfo[]; layerTree: LayerNode[] }
  | { type: 'no-selection' }
  | {
      type: 'pin-targets'
      targets: PinTarget[]
      pinnedNodeId: string | null
      recent: RecentTarget[]
    }
  | { type: 'selection-empty' }
  | {
      type: 'selection-sync'
      componentIds: string[]
      instanceIds: string[]
      clearToggles?: boolean
    }
  | { type: 'error'; message: string }
