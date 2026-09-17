export type SearchMode = 'selection' | 'page' | 'pinned'

export type ComponentSortMode = 'layer' | 'name'

export interface GroupPathNode {
  id: string
  name: string
  kind: 'SECTION' | 'FRAME'
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
  ancestorPath: GroupPathNode[]
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
  /** Min layerIndex among instances (representative). */
  layerIndex: number
  /** Ancestor SECTION/FRAME path of the representative instance (root → leaf). */
  groupPath: GroupPathNode[]
}

export interface PinTarget {
  id: string
  name: string
  kind: 'SECTION' | 'FRAME'
  label: string
}

export type UiToPluginMessage =
  | { type: 'set-mode'; mode: SearchMode; pinnedNodeId?: string | null }
  | { type: 'set-pinned-node'; pinnedNodeId: string | null }
  | { type: 'list-pin-targets' }
  | { type: 'set-selection'; nodeIds: string[]; zoom?: boolean }
  | { type: 'clear-selection' }
  | { type: 'jump-node'; nodeId: string }
  | {
      type: 'hover-highlight'
      nodeIds: string[]
      style: 'component' | 'instance'
    }
  | { type: 'clear-hover-highlight' }
  | { type: 'ready' }

export type PluginToUiMessage =
  | { type: 'scanning'; mode: SearchMode }
  | {
      type: 'result'
      mode: SearchMode
      components: ComponentInfo[]
    }
  | { type: 'no-selection'; mode: SearchMode; message?: string }
  | { type: 'pin-targets'; targets: PinTarget[]; pinnedNodeId: string | null }
  | {
      type: 'selection-sync'
      componentIds: string[]
      instanceIds: string[]
      clearToggles?: boolean
    }
  | { type: 'error'; message: string }
