import { createTargetPicker } from '../targetPicker'
import {
  buildLayerItems,
  countGroupRows,
  indexItemNodeIds,
  type ComponentItem,
  type GroupItem,
  type InstanceItem,
  type LayerItem,
  type SetItem,
  filterLayerItems,
} from './layerItems'
import type {
  ComponentInfo,
  ComponentSortMode,
  LayerNode,
  PinTarget,
  PluginToUiMessage,
  RecentTarget,
  UiToPluginMessage,
} from '../types'

type View = 'components' | 'instances'

const MIN_UI_HEIGHT = 320
const MAX_UI_HEIGHT = 900

const viewComponentsEl = document.getElementById(
  'view-components',
) as HTMLDivElement
const viewInstancesEl = document.getElementById(
  'view-instances',
) as HTMLDivElement
const componentsEl = document.getElementById('components') as HTMLDivElement
const componentsEmptyEl = document.getElementById('components-empty') as HTMLParagraphElement
const componentSearchToggle = document.getElementById('component-search-toggle') as HTMLButtonElement
const componentSearchPopover = document.getElementById('component-search-popover') as HTMLDivElement
const componentSearchInput = document.getElementById('component-search-input') as HTMLInputElement
const reloadListBtn = document.getElementById('reload-list') as HTMLButtonElement
const searchScopeComponentsEl = document.getElementById('search-scope-components') as HTMLInputElement
const searchScopeInstancesEl = document.getElementById('search-scope-instances') as HTMLInputElement
const instancesEl = document.getElementById('instances') as HTMLDivElement
const instancesEmptyEl = document.getElementById(
  'instances-empty',
) as HTMLParagraphElement
const instanceHeadingEl = document.getElementById(
  'instance-heading',
) as HTMLParagraphElement
const statusEl = document.getElementById('status') as HTMLParagraphElement
const backBtn = document.getElementById('back-btn') as HTMLButtonElement
const pinPickerRoot = document.getElementById(
  'pin-picker-root',
) as HTMLDivElement
const resizeHandle = document.getElementById('resize-handle') as HTMLDivElement

let sortMode: ComponentSortMode = 'layer'
let view: View = 'components'
let components: ComponentInfo[] = []
let layerItems: LayerItem[] = []
let allLayerItems: LayerItem[] = []
let autoOpenedTargetId: string | null = null
/** Row key (`item:<path>`) to the canvas node ids that the row's toggle selects. */
let itemNodeIds = new Map<string, string[]>()
let activeSelectKeys = new Set<string>()
const expandedSetIds = new Set<string>()
const expandedGroupIds = new Set<string>()
let selectedComponentId: string | null = null
/** Instances shown in the Instance view; null shows all instances of the component. */
let selectedInstanceIds: string[] | null = null
let componentSearchQuery = ""
let searchScopeComponents = true
let searchScopeInstances = true
const pinnedHighlightKeys = new Set<string>()
const highlightColorByKey = new Map<string, 'red' | 'yellow' | 'green' | 'purple'>()
let pinTargets: PinTarget[] = []
let pinnedNodeId: string | null = null
let recentTargets: RecentTarget[] = []
let highlightedComponentIds = new Set<string>()
let highlightedInstanceIds = new Set<string>()

function post(message: UiToPluginMessage): void {
  parent.postMessage({ pluginMessage: message }, '*')
}

function isSearchFilterActive(): boolean {
  return (
    componentSearchQuery.trim() !== '' ||
    !searchScopeComponents ||
    !searchScopeInstances
  )
}

function setSearchPopoverOpen(open: boolean): void {
  componentSearchPopover.hidden = !open
  componentSearchToggle.setAttribute('aria-expanded', open ? 'true' : 'false')
  if (open) {
    componentSearchInput.focus()
  }
}

function applyComponentSearch(): void {
  componentSearchQuery = componentSearchInput.value
  componentSearchToggle.classList.toggle('is-active', isSearchFilterActive())
  renderComponents()
}

function setStatus(text: string | null): void {
  if (!text) {
    statusEl.hidden = true
    statusEl.textContent = ''
    return
  }
  statusEl.hidden = false
  statusEl.textContent = text
}

function getSelectedComponent(): ComponentInfo | null {
  if (!selectedComponentId) {
    return null
  }
  return components.find((c) => c.id === selectedComponentId) ?? null
}

function showView(next: View): void {
  view = next
  viewComponentsEl.hidden = next !== 'components'
  viewInstancesEl.hidden = next !== 'instances'
}

function goToComponents(): void {
  selectedComponentId = null
  selectedInstanceIds = null
  post({ type: 'clear-hover-highlight' })
  showView('components')
  renderComponents()
}

function goToInstances(componentId: string, instanceIds?: string[]): void {
  selectedComponentId = componentId
  selectedInstanceIds = instanceIds ?? null
  post({ type: 'clear-hover-highlight' })
  showView('instances')
  renderComponents()
  renderInstances()
}

function nodeIdsForActiveKeys(): string[] {
  const ids = new Set<string>()
  for (const key of activeSelectKeys) {
    if (key.startsWith('item:')) {
      for (const id of itemNodeIds.get(key.slice('item:'.length)) ?? []) {
        ids.add(id)
      }
      continue
    }
    if (key.startsWith('component:')) {
      const componentId = key.slice('component:'.length)
      const component = components.find((c) => c.id === componentId)
      if (component) {
        for (const instance of component.instances) {
          ids.add(instance.id)
        }
      }
      continue
    }
    if (key.startsWith('set:')) {
      const setId = key.slice('set:'.length)
      for (const component of components) {
        if (component.componentSet?.id !== setId) {
          continue
        }
        for (const instance of component.instances) {
          ids.add(instance.id)
        }
      }
      continue
    }
    if (key.startsWith('instance:')) {
      ids.add(key.slice('instance:'.length))
    }
  }
  return Array.from(ids)
}

function syncCanvasSelection(): void {
  const nodeIds = nodeIdsForActiveKeys()
  if (nodeIds.length === 0) {
    post({ type: 'clear-selection' })
    return
  }
  post({ type: 'set-selection', nodeIds, zoom: true })
}

const SELECT_ICON = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 7.0005C6.26522 7.0005 6.51957 6.89514 6.70711 6.70761C6.89464 6.52007 7 6.26572 7 6.0005C7 5.73528 6.89464 5.48093 6.70711 5.29339C6.51957 5.10586 6.26522 5.0005 6 5.0005C5.73478 5.0005 5.48043 5.10586 5.29289 5.29339C5.10536 5.48093 5 5.73528 5 6.0005C5 6.26572 5.10536 6.52007 5.29289 6.70761C5.48043 6.89514 5.73478 7.0005 6 7.0005ZM2.5 6.0005C2.5 5.07224 2.86875 4.182 3.52513 3.52563C4.1815 2.86925 5.07174 2.5005 6 2.5005C6.92826 2.5005 7.8185 2.86925 8.47487 3.52563C9.13125 4.182 9.5 5.07224 9.5 6.0005C9.5 6.92876 9.13125 7.819 8.47487 8.47537C7.8185 9.13175 6.92826 9.5005 6 9.5005C5.07174 9.5005 4.1815 9.13175 3.52513 8.47537C2.86875 7.819 2.5 6.92876 2.5 6.0005ZM6 3.5005C5.33696 3.5005 4.70107 3.76389 4.23223 4.23273C3.76339 4.70157 3.5 5.33746 3.5 6.0005C3.5 6.66354 3.76339 7.29943 4.23223 7.76827C4.70107 8.23711 5.33696 8.5005 6 8.5005C6.66304 8.5005 7.29893 8.23711 7.76777 7.76827C8.23661 7.29943 8.5 6.66354 8.5 6.0005C8.5 5.33746 8.23661 4.70157 7.76777 4.23273C7.29893 3.76389 6.66304 3.5005 6 3.5005ZM0 6.0005C0 4.40907 0.632194 2.88282 1.75751 1.75751C2.88282 0.632194 4.40907 0 6.0005 0C7.59193 0 9.11818 0.632194 10.2435 1.75751C11.3688 2.88282 12.001 4.40907 12.001 6.0005C12.001 7.59193 11.3688 9.11818 10.2435 10.2435C9.11818 11.3688 7.59193 12.001 6.0005 12.001C4.40907 12.001 2.88282 11.3688 1.75751 10.2435C0.632194 9.11818 0 7.59193 0 6.0005ZM6 1.0005C4.67378 1.0005 3.40189 1.52734 2.46411 2.46511C1.52634 3.40289 0.9995 4.67478 0.9995 6.001C0.9995 7.32721 1.52634 8.59911 2.46411 9.53689C3.40189 10.4747 4.67378 11.0015 6 11.0015C7.32622 11.0015 8.59811 10.4747 9.53589 9.53689C10.4737 8.59911 11.0005 7.32721 11.0005 6.001C11.0005 4.67478 10.4737 3.40289 9.53589 2.46511C8.59811 1.52734 7.32622 1.0005 6 1.0005Z" fill="currentColor"/></svg>`

const PIN_ICON = `<svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7.052 0.439332C6.88682 0.274156 6.68535 0.149841 6.46363 0.0762917C6.24192 0.00274231 6.00609 -0.0180083 5.77494 0.0156933C5.54379 0.0493949 5.3237 0.136617 5.13222 0.27041C4.94073 0.404203 4.78314 0.580869 4.672 0.786332L3.145 3.61133L0.815 4.53933C0.738051 4.56993 0.669905 4.61915 0.616682 4.68259C0.563459 4.74603 0.526826 4.8217 0.510071 4.90279C0.493317 4.98389 0.496966 5.06787 0.520691 5.14721C0.544417 5.22655 0.587475 5.29875 0.646 5.35733L2.293 7.00433L0.147 9.15033L0 10.0043L0.854 9.85733L3 7.71133L4.646 9.35733C4.70451 9.41588 4.77665 9.45899 4.85593 9.48278C4.93522 9.50658 5.01917 9.51032 5.10025 9.49366C5.18134 9.47701 5.25702 9.44049 5.32051 9.38737C5.38399 9.33425 5.4333 9.26621 5.464 9.18933L6.397 6.85733L9.218 5.33133C9.42346 5.22019 9.60013 5.0626 9.73392 4.87112C9.86772 4.67963 9.95494 4.45955 9.98864 4.22839C10.0223 3.99724 10.0016 3.76141 9.92804 3.5397C9.85449 3.31798 9.73018 3.11651 9.565 2.95133L7.052 0.439332Z" fill="currentColor"/></svg>`

function createHoverPinButton(
  key: string,
  nodeIds: string[],
  style: 'component' | 'instance',
): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'hover-pin' + (pinnedHighlightKeys.has(key) ? ' is-on' : '')
  btn.title = pinnedHighlightKeys.has(key) ? 'ハイライト固定を解除' : 'ハイライトを固定'
  btn.innerHTML = PIN_ICON
  btn.addEventListener('click', (event) => {
    event.stopPropagation()
    if (pinnedHighlightKeys.has(key)) {
      pinnedHighlightKeys.delete(key)
      btn.classList.remove('is-on')
      btn.title = 'ハイライトを固定'
      post({ type: 'clear-hover-highlight' })
    } else {
      pinnedHighlightKeys.add(key)
      btn.classList.add('is-on')
      btn.title = 'ハイライト固定を解除'
      post({
        type: 'hover-highlight',
        nodeIds,
        style,
        color: highlightColorByKey.get(key),
      })
    }
  })
  return btn
}

function createHoverColorSelect(
  key: string,
  nodeIds: string[],
  style: 'component' | 'instance',
): HTMLDivElement {
  const wrap = document.createElement('div')
  wrap.className = 'hover-color'

  const trigger = document.createElement('button')
  trigger.type = 'button'
  trigger.className = 'hover-color-trigger'
  trigger.title = 'ハイライト色'
  trigger.setAttribute('aria-label', 'ハイライト色')
  const swatch = document.createElement('span')
  swatch.className = 'hover-color-swatch'
  const current = highlightColorByKey.get(key) ?? (style === 'component' ? 'purple' : 'green')
  swatch.style.background =
    current === 'red' ? '#ff3b30' : current === 'yellow' ? '#ffcc00' : current === 'green' ? '#00ff40' : '#a154f2'
  trigger.append(swatch)

  const menu = document.createElement('div')
  menu.className = 'hover-color-menu'
  menu.hidden = true

  const colors: Array<'red' | 'yellow' | 'green' | 'purple'> = ['red', 'yellow', 'green', 'purple']
  const hex: Record<string, string> = {
    red: '#ff3b30',
    yellow: '#ffcc00',
    green: '#00ff40',
    purple: '#a154f2',
  }
  for (const color of colors) {
    const option = document.createElement('button')
    option.type = 'button'
    option.className = 'hover-color-option'
    option.title = color
    const s = document.createElement('span')
    s.className = 'hover-color-swatch'
    s.style.background = hex[color]
    option.append(s)
    option.addEventListener('click', (event) => {
      event.stopPropagation()
      highlightColorByKey.set(key, color)
      swatch.style.background = hex[color]
      menu.hidden = true
      if (pinnedHighlightKeys.has(key)) {
        post({
          type: 'hover-highlight',
          nodeIds,
          style,
          color,
        })
      }
    })
    menu.append(option)
  }

  trigger.addEventListener('click', (event) => {
    event.stopPropagation()
    const willOpen = menu.hidden
    document.querySelectorAll('.hover-color-menu').forEach((el) => {
      (el as HTMLElement).hidden = true
    })
    if (willOpen) {
      menu.hidden = false
    }
  })

  wrap.addEventListener('click', (event) => {
    event.stopPropagation()
  })

  wrap.append(trigger, menu)
  return wrap
}

function createSelectToggle(key: string): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'select-btn' + (activeSelectKeys.has(key) ? ' is-on' : '')
  btn.title = 'キャンバス上で選択 / 解除'
  btn.innerHTML = SELECT_ICON

  btn.addEventListener('click', (event) => {
    event.stopPropagation()
    if (activeSelectKeys.has(key)) {
      activeSelectKeys.delete(key)
    } else {
      activeSelectKeys.add(key)
    }
    syncCanvasSelection()
    renderComponents()
    if (view === 'instances') {
      renderInstances()
    }
  })

  return btn
}

function pruneActiveSelectKeys(): void {
  const valid = new Set<string>()
  for (const component of components) {
    valid.add(`component:${component.id}`)
    if (component.componentSet) {
      valid.add(`set:${component.componentSet.id}`)
    }
    for (const instance of component.instances) {
      valid.add(`instance:${instance.id}`)
    }
  }
  for (const key of itemNodeIds.keys()) {
    valid.add(`item:${key}`)
  }
  for (const key of Array.from(activeSelectKeys)) {
    if (!valid.has(key)) {
      activeSelectKeys.delete(key)
    }
  }
}

function getPinnedTarget(): PinTarget | null {
  if (!pinnedNodeId) {
    return null
  }
  return pinTargets.find((t) => t.id === pinnedNodeId) ?? null
}

function commitPinnedNode(nextId: string): void {
  pinnedNodeId = nextId
  pinPicker.refresh()
  post({ type: 'set-pinned-node', pinnedNodeId })
}

const pinPicker = createTargetPicker({
  emptyLabel: 'ターゲット未選択',
  ariaLabel: '検索ターゲット',
  getLabel: () => getPinnedTarget()?.label ?? '',
  getSelectedId: () => pinnedNodeId,
  getTargets: () => pinTargets,
  getRecent: () => recentTargets,
  onHoverTarget: (nodeId) => {
    if (nodeId) {
      post({ type: 'show-target-overlay', nodeId })
    } else {
      post({ type: 'hide-target-overlay' })
    }
  },
  onApplySelection: () => {
    post({ type: 'set-pinned-from-selection' })
  },
  onPick: (id) => {
    commitPinnedNode(id)
  },
  onPickRecent: (id) => {
    commitPinnedNode(id)
  },
})
pinPickerRoot.append(pinPicker.root)

function isComponentHighlighted(componentId: string): boolean {
  return (
    highlightedComponentIds.has(componentId) ||
    activeSelectKeys.has(`component:${componentId}`)
  )
}

function isInstanceHighlighted(instanceId: string): boolean {
  return (
    highlightedInstanceIds.has(instanceId) ||
    activeSelectKeys.has(`instance:${instanceId}`)
  )
}

type SetEntry = {
  kind: 'set'
  id: string
  name: string
  canJump: boolean
  isLocal: boolean
  variants: ComponentInfo[]
}

type ListEntry =
  | { kind: 'component'; component: ComponentInfo }
  | SetEntry
  | { kind: 'instance'; item: InstanceItem }

function entryName(entry: ListEntry): string {
  if (entry.kind === 'set') {
    return entry.name
  }
  return entry.kind === 'instance' ? entry.item.name : entry.component.name
}

function nameOrderInstanceItems(): InstanceItem[] {
  return components.flatMap((component) =>
    component.instances.map((instance) => ({
      kind: 'instance' as const,
      key: `name/n:${instance.id}`,
      id: instance.id,
      name: instance.name,
      component,
      children: [],
    })),
  )
}

/** Name order: group variants by their COMPONENT_SET and sort everything by name. */
function getSortedEntries(): ListEntry[] {
  const entries: ListEntry[] = []
  const sets = new Map<string, SetEntry>()

  for (const component of components) {
    const set = component.componentSet
    if (!set) {
      entries.push({ kind: 'component', component })
      continue
    }
    let entry = sets.get(set.id)
    if (!entry) {
      entry = {
        kind: 'set',
        id: set.id,
        name: set.name,
        canJump: set.canJump,
        isLocal: component.isLocal,
        variants: [],
      }
      sets.set(set.id, entry)
      entries.push(entry)
    }
    entry.variants.push(component)
  }

  for (const entry of sets.values()) {
    entry.variants.sort((a, b) =>
      a.variantName.localeCompare(b.variantName, 'ja'),
    )
  }

  entries.sort((a, b) => entryName(a).localeCompare(entryName(b), 'ja'))
  return entries
}

function headingLabel(kind: 'SECTION' | 'FRAME' | 'GROUP', name: string): string {
  if (kind === 'SECTION') {
    return `#${name}`
  }
  return name
}

type AccordionHeaderOptions = {
  expanded: boolean
  label: string
  icon?: HTMLElement
  count?: number
  onToggle: (event?: MouseEvent) => void
  onLabelClick?: () => void
  labelDisabled?: boolean
  labelTitle?: string
  selected?: boolean
  meta?: HTMLElement[]
  actions?: HTMLElement[]
}

function createAccordionHeader(
  options: AccordionHeaderOptions,
): HTMLDivElement {
  const header = document.createElement('div')
  header.className =
    'acc-header' + (options.selected ? ' is-selected' : '')

  const expandBtn = document.createElement('button')
  expandBtn.type = 'button'
  expandBtn.className = 'acc-expand'
  expandBtn.textContent = options.expanded ? '▾' : '▸'
  expandBtn.setAttribute('aria-expanded', String(options.expanded))
  expandBtn.setAttribute('aria-label', options.expanded ? '閉じる' : '開く')
  expandBtn.addEventListener('click', (event) => {
    event.stopPropagation()
    options.onToggle(event)
  })

  const label = document.createElement('button')
  label.type = 'button'
  label.className = 'acc-label'
  if (options.icon) {
    label.append(options.icon)
  }
  label.append(document.createTextNode(options.label))
  label.title = options.labelTitle ?? options.label
  label.disabled = options.labelDisabled ?? false
  if (options.onLabelClick) {
    label.addEventListener('click', options.onLabelClick)
  }

  header.append(expandBtn, label)

  if (options.count !== undefined) {
    const count = document.createElement('span')
    count.className = 'acc-count'
    count.textContent = `${options.count}件`
    header.append(count)
  }

  for (const element of options.meta ?? []) {
    header.append(element)
  }

  if (options.actions && options.actions.length > 0) {
    const actions = document.createElement('div')
    actions.className = 'actions'
    actions.append(...options.actions)
    header.append(actions)
  }

  return header
}

type RowOptions = {
  label?: string
  /** Instances represented by this row; undefined means all instances of the component. */
  instanceIds?: string[]
  toggleKey: string
  expand?: { expanded: boolean; onToggle: (event?: MouseEvent) => void } | 'spacer'
}

function createBadge(text: string, className = ''): HTMLSpanElement {
  const badge = document.createElement('span')
  badge.className = 'badge' + (className ? ` ${className}` : '')
  badge.textContent = text
  return badge
}

function createSquareIcon(kind: 'filled' | 'empty'): HTMLSpanElement {
  const icon = document.createElement('span')
  icon.className = 'sq-icon' + (kind === 'filled' ? ' is-filled' : ' is-empty')
  icon.setAttribute('aria-hidden', 'true')
  return icon
}

function createLocalBadge(isLocal: boolean): HTMLSpanElement {
  return createBadge(isLocal ? 'local' : 'library', isLocal ? '' : 'is-library')
}

function createComponentRow(
  component: ComponentInfo,
  options: RowOptions,
): HTMLDivElement {
  const label = options.label ?? component.name
  const rowInstanceIds =
    options.instanceIds ?? component.instances.map((instance) => instance.id)
  const selected =
    activeSelectKeys.has(options.toggleKey) ||
    (options.instanceIds
      ? options.instanceIds.some((id) => isInstanceHighlighted(id))
      : isComponentHighlighted(component.id) ||
        component.instances.some((i) => isInstanceHighlighted(i.id)))

  const row = document.createElement('div')
  row.className =
    'row' +
    (options.expand ? ' has-expand' : '') +
    (selected ? ' is-selected' : '')

  const highlightComponent = () => {
    post({
      type: 'hover-highlight',
      nodeIds: [component.id],
      style: 'component',
    })
  }

  const highlightInstances = () => {
    post({
      type: 'hover-highlight',
      nodeIds: rowInstanceIds,
      style: 'instance',
    })
  }

  const highlightKey = `component:${component.id}`
  const primaryStyle: 'component' | 'instance' = options.instanceIds ? 'instance' : 'component'
  const primaryNodeIds = options.instanceIds ? rowInstanceIds : [component.id]
  const sendHighlight = () => {
    post({
      type: 'hover-highlight',
      nodeIds: primaryNodeIds,
      style: primaryStyle,
      color: highlightColorByKey.get(highlightKey),
    })
  }
  row.addEventListener('mouseenter', () => {
    sendHighlight()
  })
  row.addEventListener('mouseleave', () => {
    if (!pinnedHighlightKeys.has(highlightKey)) {
      post({ type: 'clear-hover-highlight' })
    }
  })

  if (options.expand === 'spacer') {
    const spacer = document.createElement('span')
    spacer.className = 'acc-expand'
    spacer.setAttribute('aria-hidden', 'true')
    row.append(spacer)
  } else if (options.expand) {
    const { expanded, onToggle } = options.expand
    const expandBtn = document.createElement('button')
    expandBtn.type = 'button'
    expandBtn.className = 'acc-expand'
    expandBtn.textContent = expanded ? '▾' : '▸'
    expandBtn.setAttribute('aria-expanded', String(expanded))
    expandBtn.setAttribute('aria-label', expanded ? '閉じる' : '開く')
    expandBtn.addEventListener('click', (event) => {
      event.stopPropagation()
      onToggle(event)
    })
    row.append(expandBtn)
  }

  const main = document.createElement('div')
  main.className = 'row-main'

  const nameBtn = document.createElement('button')
  nameBtn.type = 'button'
  nameBtn.className = 'name-btn'
  nameBtn.append(document.createTextNode(label))
  nameBtn.title = component.name
  if (component.canJump) {
    nameBtn.addEventListener('click', () => {
      post({ type: 'jump-node', nodeId: component.id })
    })
  } else {
    nameBtn.disabled = true
    nameBtn.title = `${component.name}（ジャンプ不可）`
  }

  const meta = document.createElement('div')
  meta.className = 'meta'
  meta.append(createLocalBadge(component.isLocal))

  if (!options.instanceIds) {
    const countBtn = document.createElement('button')
    countBtn.type = 'button'
    countBtn.className = 'link-btn'
    countBtn.title = `${rowInstanceIds.length} instances`
    countBtn.append(createSquareIcon('empty'), document.createTextNode(String(rowInstanceIds.length)))
    countBtn.addEventListener('click', () => {
      goToInstances(component.id, options.instanceIds)
    })
    countBtn.addEventListener('mouseenter', highlightInstances)
    countBtn.addEventListener('mouseleave', highlightComponent)
    meta.append(countBtn)
  }
  main.append(nameBtn, meta)

  const actions = document.createElement('div')
  actions.className = 'actions'
  actions.append(
    createHoverPinButton(highlightKey, primaryNodeIds, primaryStyle),
    createHoverColorSelect(highlightKey, primaryNodeIds, primaryStyle),
    createSelectToggle(options.toggleKey),
  )

  row.append(main, actions)
  return row
}

function createLayerInstanceElement(item: InstanceItem): HTMLElement {
  const component = item.component
  const selected = activeSelectKeys.has(`item:${item.key}`) || isInstanceHighlighted(item.id)
  const row = document.createElement('div')
  row.className = 'row' + (item.children.length > 0 ? ' has-expand' : '') + (selected ? ' is-selected' : '')

  const highlightKey = `instance:${item.id}`
  const highlightInstance = () => {
    post({
      type: 'hover-highlight',
      nodeIds: [item.id],
      style: 'instance',
      color: highlightColorByKey.get(highlightKey),
    })
  }
  const highlightMain = () => {
    post({ type: 'hover-highlight', nodeIds: [component.id], style: 'component' })
  }
  row.addEventListener('mouseenter', highlightInstance)
  row.addEventListener('mouseleave', () => {
    if (!pinnedHighlightKeys.has(highlightKey)) {
      post({ type: 'clear-hover-highlight' })
    }
  })

  if (item.children.length > 0) {
    const expandable = expandedGroupIds.has(item.key)
    const expandBtn = document.createElement('button')
    expandBtn.type = 'button'
    expandBtn.className = 'acc-expand'
    expandBtn.textContent = expandable ? '▾' : '▸'
    expandBtn.setAttribute('aria-expanded', String(expandable))
    expandBtn.setAttribute('aria-label', expandable ? '閉じる' : '開く')
    expandBtn.addEventListener('click', (event) => {
      event.stopPropagation()
      toggleExpanded(expandedGroupIds, item.key, event)
    })
    row.append(expandBtn)
  }

  const main = document.createElement('div')
  main.className = 'row-main'

  const nameBtn = document.createElement('button')
  nameBtn.type = 'button'
  nameBtn.className = 'name-btn'
  nameBtn.append(createSquareIcon('empty'), document.createTextNode(item.name))
  nameBtn.title = item.name
  nameBtn.addEventListener('click', () => {
    post({ type: 'jump-node', nodeId: item.id })
  })

  const topLine = document.createElement('div')
  topLine.className = 'row-top'
  topLine.append(nameBtn)

  const meta = document.createElement('div')
  meta.className = 'meta'
  const mainLabel = component.name
  const mainEl = document.createElement('button')
  mainEl.type = 'button'
  mainEl.className = 'link-btn'
  mainEl.textContent = mainLabel
  mainEl.title = mainLabel
  if (component.canJump) {
    mainEl.addEventListener('click', () => {
      post({ type: 'jump-node', nodeId: component.id })
    })
  } else {
    mainEl.disabled = true
    mainEl.title = `${mainLabel}（ジャンプ不可）`
  }
  meta.append(mainEl)
  meta.append(createLocalBadge(component.isLocal))


  const icons = document.createElement('div')
  icons.className = 'row-icons'
  icons.append(
    createHoverPinButton(highlightKey, [item.id], 'instance'),
    createHoverColorSelect(highlightKey, [item.id], 'instance'),
    createSelectToggle(`item:${item.key}`),
  )
  topLine.append(icons)

  main.append(topLine, meta)
  row.append(main)

  if (item.children.length > 0 && expandedGroupIds.has(item.key)) {
    const group = document.createElement('div')
    group.className = 'acc-group'
    group.append(row)
    const children = document.createElement('div')
    children.className = 'acc-children'
    children.append(createLayerList(item.children))
    group.append(children)
    return group
  }

  return row
}

function collectDescendantKeys(
  items: readonly LayerItem[],
  targetKey: string,
): string[] {
  const result: string[] = []
  const find = (list: readonly LayerItem[]): boolean => {
    for (const item of list) {
      if (item.key === targetKey) {
        const collect = (list2: readonly LayerItem[]) => {
          for (const child of list2) {
            result.push(child.key)
            if ('children' in child && Array.isArray(child.children)) {
              collect(child.children)
            }
          }
        }
        if ('children' in item && Array.isArray(item.children)) {
          collect(item.children)
        }
        return true
      }
      if ('children' in item && Array.isArray(item.children)) {
        if (find(item.children)) {
          return true
        }
      }
    }
    return false
  }
  find(items)
  return result
}

function toggleExpanded(
  ids: Set<string>,
  id: string,
  event?: MouseEvent,
): void {
  if (event?.shiftKey) {
    const isExpanded = ids.has(id)
    if (isExpanded) {
      ids.delete(id)
      const descendants = collectDescendantKeys(layerItems, id)
      for (const key of descendants) {
        ids.delete(key)
      }
    } else {
      ids.add(id)
      const descendants = collectDescendantKeys(layerItems, id)
      for (const key of descendants) {
        ids.add(key)
      }
    }
    renderComponents()
    return
  }
  if (ids.has(id)) {
    ids.delete(id)
  } else {
    ids.add(id)
  }
  renderComponents()
}

function attachHeaderToggle(header: HTMLElement, onToggle: (event?: MouseEvent) => void): void {
  header.addEventListener('click', (event) => {
    const target = event.target
    if (target instanceof Element && target.closest('button, label')) {
      return
    }
    onToggle(event)
  })
}

function attachComponentHover(header: HTMLElement, nodeId: string): void {
  header.addEventListener('mouseenter', () => {
    post({ type: 'hover-highlight', nodeIds: [nodeId], style: 'component' })
  })
  header.addEventListener('mouseleave', () => {
    post({ type: 'clear-hover-highlight' })
  })
}

type SetRowOptions = {
  name: string
  canJump: boolean
  isLocal: boolean
  variantCount: number
  instanceCount: number
  instanceIds: string[]
  nodeId: string
  selected: boolean
  expanded: boolean
  toggle: (event?: MouseEvent) => void
  toggleKey: string
  onJump?: () => void
}

function createSetRow(options: SetRowOptions): HTMLDivElement {
  const row = document.createElement('div')
  row.className = 'row has-expand' + (options.selected ? ' is-selected' : '')

  const highlightKey = `set:${options.nodeId}`
  const highlightSet = () => {
    post({
      type: 'hover-highlight',
      nodeIds: [options.nodeId],
      style: 'component',
      color: highlightColorByKey.get(highlightKey),
    })
  }
  const highlightInstances = () => {
    post({ type: 'hover-highlight', nodeIds: options.instanceIds, style: 'instance' })
  }
  row.addEventListener('mouseenter', highlightSet)
  row.addEventListener('mouseleave', () => {
    if (!pinnedHighlightKeys.has(highlightKey)) {
      post({ type: 'clear-hover-highlight' })
    }
  })

  const expandBtn = document.createElement('button')
  expandBtn.type = 'button'
  expandBtn.className = 'acc-expand'
  expandBtn.textContent = options.expanded ? '▾' : '▸'
  expandBtn.setAttribute('aria-expanded', String(options.expanded))
  expandBtn.setAttribute('aria-label', options.expanded ? '閉じる' : '開く')
  expandBtn.addEventListener('click', (event) => {
    event.stopPropagation()
    options.toggle(event)
  })
  row.append(expandBtn)

  const main = document.createElement('div')
  main.className = 'row-main'

  const nameBtn = document.createElement('button')
  nameBtn.type = 'button'
  nameBtn.className = 'name-btn'
  nameBtn.append(document.createTextNode(options.name))
  nameBtn.title = options.name
  if (options.canJump) {
    nameBtn.addEventListener('click', () => {
      if (options.onJump) {
        options.onJump()
      } else {
        post({ type: 'jump-node', nodeId: options.nodeId })
      }
    })
  } else {
    nameBtn.disabled = true
    nameBtn.title = `${options.name}（ジャンプ不可）`
  }

  const meta = document.createElement('div')
  meta.className = 'meta'
  meta.append(createLocalBadge(options.isLocal))

  const variantCountEl = document.createElement('span')
  variantCountEl.title = `${options.variantCount} variants`
  variantCountEl.append(createSquareIcon('filled'), document.createTextNode(` ${options.variantCount}`))
  meta.append(variantCountEl)

  const instanceCountEl = document.createElement('button')
  instanceCountEl.type = 'button'
  instanceCountEl.className = 'link-btn'
  instanceCountEl.title = `${options.instanceCount} instances`
  instanceCountEl.append(createSquareIcon('empty'), document.createTextNode(` ${options.instanceCount}`))
  instanceCountEl.addEventListener('click', () => {
    // no-op; could open instances
  })
  instanceCountEl.addEventListener('mouseenter', highlightInstances)
  instanceCountEl.addEventListener('mouseleave', highlightSet)
  meta.append(instanceCountEl)

  main.append(nameBtn, meta)

  const actions = document.createElement('div')
  actions.className = 'actions'
  actions.append(
    createHoverPinButton(highlightKey, [options.nodeId], 'component'),
    createHoverColorSelect(highlightKey, [options.nodeId], 'component'),
    createSelectToggle(options.toggleKey),
  )

  row.append(main, actions)

  row.addEventListener('click', (event) => {
    const target = event.target
    if (target instanceof Element && target.closest('button, label')) {
      return
    }
    options.toggle(event)
  })

  return row
}

function createSetGroup(entry: SetEntry): HTMLDivElement {
  const group = document.createElement('div')
  group.className = 'acc-group'

  const expanded = expandedSetIds.has(entry.id)
  const toggle = (event?: MouseEvent) => toggleExpanded(expandedSetIds, entry.id, event)

  const instanceCount = entry.variants.reduce(
    (sum, variant) => sum + variant.instances.length,
    0,
  )
  const instanceIds = entry.variants.flatMap((variant) =>
    variant.instances.map((instance) => instance.id),
  )

  const row = createSetRow({
    name: entry.name,
    canJump: entry.canJump,
    isLocal: entry.isLocal,
    variantCount: entry.variants.length,
    instanceCount,
    instanceIds,
    nodeId: entry.id,
    selected:
      activeSelectKeys.has(`set:${entry.id}`) ||
      entry.variants.some((variant) => isComponentHighlighted(variant.id)),
    expanded,
    toggle,
    toggleKey: `set:${entry.id}`,
    onJump: entry.canJump
      ? () => {
          post({ type: 'jump-node', nodeId: entry.id })
        }
      : undefined,
  })
  attachComponentHover(row, entry.id)
  group.append(row)

  if (expanded) {
    const variants = document.createElement('div')
    variants.className = 'acc-children'
    const list = document.createElement('div')
    list.className = 'list'
    for (const variant of entry.variants) {
      list.append(
        createComponentRow(variant, {
          label: variant.variantName,
          toggleKey: `component:${variant.id}`,
        }),
      )
    }
    variants.append(list)
    group.append(variants)
  }

  return group
}

function createEntryElement(entry: ListEntry): HTMLElement {
  if (entry.kind === 'set') {
    return createSetGroup(entry)
  }
  if (entry.kind === 'instance') {
    return createLayerInstanceElement(entry.item)
  }
  return createComponentRow(entry.component, {
    toggleKey: `component:${entry.component.id}`,
  })
}

function createLayerList(items: readonly LayerItem[], inSet = false): HTMLDivElement {
  const list = document.createElement('div')
  list.className = 'list'
  const hasExpandable = items.some(
    (item) =>
      (item.kind === 'component' && item.children.length > 0) ||
      (item.kind === 'instance' && item.children.length > 0),
  )
  for (const item of items) {
    list.append(createLayerItemElement(item, inSet, hasExpandable))
  }
  return list
}

function createLayerItemElement(
  item: LayerItem,
  inSet: boolean,
  alignWithExpandable: boolean,
): HTMLElement {
  if (item.kind === 'group') {
    return createLayerGroupElement(item)
  }
  if (item.kind === 'set') {
    return createLayerSetElement(item)
  }
  if (item.kind === 'instance') {
    return createLayerInstanceElement(item)
  }
  return createLayerComponentElement(item, inSet, alignWithExpandable)
}

function createLayerComponentElement(
  item: ComponentItem,
  inSet: boolean,
  alignWithExpandable: boolean,
): HTMLElement {
  const expandable = item.children.length > 0
  const expanded = expandable && expandedGroupIds.has(item.key)
  const row = createComponentRow(item.component, {
    label: inSet ? item.component.variantName : item.component.name,
    instanceIds: undefined,
    toggleKey: `item:${item.key}`,
    expand: expandable
      ? {
          expanded,
          onToggle: (event) => toggleExpanded(expandedGroupIds, item.key, event),
        }
      : alignWithExpandable
        ? 'spacer'
        : undefined,
  })
  if (!expandable) {
    return row
  }

  const group = document.createElement('div')
  group.className = 'acc-group'
  group.append(row)
  if (expanded) {
    const children = document.createElement('div')
    children.className = 'acc-children'
    children.append(createLayerList(item.children))
    group.append(children)
  }
  return group
}

function createLayerSetElement(item: SetItem): HTMLDivElement {
  const group = document.createElement('div')
  group.className = 'acc-group'

  const expanded = expandedGroupIds.has(item.key)
  const toggle = (event?: MouseEvent) => toggleExpanded(expandedGroupIds, item.key, event)
  const toggleKey = `item:${item.key}`

  const instanceCount = item.children.reduce(
    (sum, child) => sum + child.component.instances.length,
    0,
  )
  const instanceIds = item.children.flatMap((child) =>
    child.component.instances.map((instance) => instance.id),
  )

  const row = createSetRow({
    name: item.name,
    canJump: item.canJump,
    isLocal: item.isLocal,
    variantCount: item.children.length,
    instanceCount,
    instanceIds,
    nodeId: item.id,
    selected:
      activeSelectKeys.has(toggleKey) ||
      item.children.some((child) => isComponentHighlighted(child.component.id)),
    expanded,
    toggle,
    toggleKey,
    onJump: item.canJump
      ? () => {
          post({ type: 'jump-node', nodeId: item.id })
        }
      : undefined,
  })
  attachComponentHover(row, item.id)
  group.append(row)

  if (expanded) {
    const children = document.createElement('div')
    children.className = 'acc-children'
    children.append(createLayerList(item.children, true))
    group.append(children)
  }

  return group
}

function createLayerGroupElement(item: GroupItem): HTMLDivElement {
  const group = document.createElement('div')
  group.className = 'acc-group'

  const expanded = expandedGroupIds.has(item.key)
  const toggle = (event?: MouseEvent) => toggleExpanded(expandedGroupIds, item.key, event)

  const header = createAccordionHeader({
    expanded,
    label: headingLabel(item.nodeKind, item.name),
    count: countGroupRows(item),
    onToggle: toggle,
    onLabelClick: () => {
      post({ type: 'jump-node', nodeId: item.id })
    },
  })

  header.addEventListener('mouseenter', () => {
    post({ type: 'show-target-overlay', nodeId: item.id })
  })
  header.addEventListener('mouseleave', () => {
    post({ type: 'hide-target-overlay' })
  })
  attachHeaderToggle(header, toggle)

  group.append(header)

  if (expanded) {
    const children = document.createElement('div')
    children.className = 'acc-children'
    children.append(createLayerList(item.children))
    group.append(children)
  }

  return group
}

function getFilteredLayerItemsForRender(): LayerItem[] {
  if (!isSearchFilterActive()) {
    return allLayerItems
  }
  const result = filterLayerItems(allLayerItems, componentSearchQuery, {
    components: searchScopeComponents,
    instances: searchScopeInstances,
  })
  for (const key of result.expandedKeys) {
    expandedGroupIds.add(key)
  }
  return result.items
}

function getFilteredSortedEntriesForRender(): ListEntry[] {
  const q = componentSearchQuery.trim().toLowerCase()
  const matches = (text: string) => !q || text.toLowerCase().includes(q)
  const entries: ListEntry[] = []

  if (searchScopeComponents) {
    for (const entry of getSortedEntries()) {
      if (entry.kind === 'component') {
        if (matches(entry.component.name)) {
          entries.push(entry)
        }
        continue
      }
      if (entry.kind !== 'set') {
        continue
      }
      if (matches(entry.name)) {
        entries.push(entry)
        continue
      }
      const variants = entry.variants.filter(
        (v) => matches(v.variantName) || matches(v.name),
      )
      if (variants.length > 0) {
        expandedSetIds.add(entry.id)
        entries.push({ ...entry, variants })
      }
    }
  }

  if (searchScopeInstances) {
    for (const item of nameOrderInstanceItems()) {
      if (matches(item.name) || matches(item.component.name)) {
        entries.push({ kind: 'instance', item })
      }
    }
  }

  entries.sort((a, b) => entryName(a).localeCompare(entryName(b), 'ja'))
  return entries
}

function renderComponents(): void {
  post({ type: 'clear-hover-highlight' })
  post({ type: 'hide-target-overlay' })
  componentsEl.replaceChildren()
  if (componentsEmptyEl) {
    componentsEmptyEl.hidden = true
  }

  if (components.length === 0) {
    return
  }

  if (sortMode === 'name') {
    const entries = getFilteredSortedEntriesForRender()
    if (entries.length === 0) {
      if (isSearchFilterActive() && componentsEmptyEl) {
        componentsEmptyEl.hidden = false
      }
      return
    }
    const items = document.createElement('div')
    items.className = 'list'
    for (const entry of entries) {
      items.append(createEntryElement(entry))
    }
    componentsEl.append(items)
    return
  }

  const itemsToShow = getFilteredLayerItemsForRender()
  if (itemsToShow.length === 0) {
    if (isSearchFilterActive() && componentsEmptyEl) {
      componentsEmptyEl.hidden = false
    }
    return
  }
  componentsEl.append(createLayerList(itemsToShow))
}

function renderInstances(): void {
  post({ type: 'clear-hover-highlight' })
  instancesEl.replaceChildren()
  const selected = getSelectedComponent()

  if (!selected) {
    instanceHeadingEl.textContent = ''
    instancesEmptyEl.hidden = false
    instancesEmptyEl.textContent = 'Componentが見つかりません'
    return
  }

  const scopeIds = selectedInstanceIds ? new Set(selectedInstanceIds) : null
  const list = scopeIds
    ? selected.instances.filter((i) => scopeIds.has(i.id))
    : selected.instances

  instanceHeadingEl.textContent = selected.name
  instanceHeadingEl.title = selected.name

  if (list.length === 0) {
    instancesEmptyEl.hidden = false
    instancesEmptyEl.textContent = 'Instanceがありません'
    return
  }

  instancesEmptyEl.hidden = true

  for (const instance of list) {
    const row = document.createElement('div')
    row.className =
      'row' + (isInstanceHighlighted(instance.id) ? ' is-selected' : '')

    row.addEventListener('mouseenter', () => {
      post({
        type: 'hover-highlight',
        nodeIds: [instance.id],
        style: 'instance',
      })
    })
    row.addEventListener('mouseleave', () => {
      post({ type: 'clear-hover-highlight' })
    })

    const main = document.createElement('div')
    main.className = 'row-main'

    const nameBtn = document.createElement('button')
    nameBtn.type = 'button'
    nameBtn.className = 'name-btn'
    nameBtn.textContent = instance.name
    nameBtn.title = instance.name
    nameBtn.addEventListener('click', () => {
      post({ type: 'jump-node', nodeId: instance.id })
    })

    const pageLine = document.createElement('div')
    pageLine.className = 'subline'
    pageLine.textContent = instance.pageName
    pageLine.title = instance.pageName

    const sectionLine = document.createElement('div')
    sectionLine.className = 'subline'
    const sectionLabel = instance.parentSectionName
      ? `#${instance.parentSectionName}`
      : '#Sectionなし'
    sectionLine.textContent = sectionLabel
    sectionLine.title = sectionLabel

    main.append(nameBtn, pageLine, sectionLine)

    const actions = document.createElement('div')
    actions.className = 'actions'
    actions.append(createSelectToggle(`instance:${instance.id}`))

    row.append(main, actions)
    instancesEl.append(row)
  }
}

function applyResult(next: ComponentInfo[], layerTree: LayerNode[]): void {
  components = next
  layerItems = buildLayerItems(
    layerTree,
    new Map(components.map((component) => [component.id, component])),
  )
  allLayerItems = layerItems
  itemNodeIds = indexItemNodeIds(layerItems)
  const root = layerItems[0]
  if (root && root.kind === 'group' && autoOpenedTargetId !== root.id) {
    expandedGroupIds.add(root.key)
    autoOpenedTargetId = root.id
  }
  for (const item of nameOrderInstanceItems()) {
    itemNodeIds.set(item.key, [item.id])
  }
  pruneActiveSelectKeys()
  if (
    selectedComponentId &&
    !components.some((c) => c.id === selectedComponentId)
  ) {
    selectedComponentId = null
    selectedInstanceIds = null
    showView('components')
  }
  renderComponents()
  if (view === 'instances') {
    renderInstances()
  }
}

backBtn.addEventListener('click', () => {
  goToComponents()
})

document.addEventListener('click', (event) => {
  const target = event.target
  if (target instanceof Node && pinPicker.root.contains(target)) {
    return
  }
  pinPicker.closePopover()
  if (
    target instanceof Node &&
    (componentSearchPopover.contains(target) || componentSearchToggle.contains(target))
  ) {
    return
  }
  setSearchPopoverOpen(false)
  document.querySelectorAll('.hover-color-menu').forEach((el) => {
    (el as HTMLElement).hidden = true
  })
})

let resizingUi = false
let resizePointerId: number | null = null

function clampUiHeightLocal(height: number): number {
  return Math.min(MAX_UI_HEIGHT, Math.max(MIN_UI_HEIGHT, Math.round(height)))
}

function endUiResize(event?: PointerEvent): void {
  if (!resizingUi) {
    return
  }
  resizingUi = false
  document.body.classList.remove('is-resizing')
  if (
    event &&
    resizePointerId !== null &&
    resizeHandle.hasPointerCapture(resizePointerId)
  ) {
    resizeHandle.releasePointerCapture(resizePointerId)
  }
  resizePointerId = null
}

resizeHandle.addEventListener('pointerdown', (event) => {
  resizingUi = true
  resizePointerId = event.pointerId
  document.body.classList.add('is-resizing')
  resizeHandle.setPointerCapture(event.pointerId)
  event.preventDefault()
})

resizeHandle.addEventListener('pointermove', (event) => {
  if (!resizingUi) {
    return
  }
  post({ type: 'resize-ui', height: clampUiHeightLocal(event.clientY) })
})

resizeHandle.addEventListener('pointerup', (event) => {
  endUiResize(event)
})
resizeHandle.addEventListener('pointercancel', (event) => {
  endUiResize(event)
})
window.addEventListener('pointerup', () => {
  endUiResize()
})
window.addEventListener('pointercancel', () => {
  endUiResize()
})

reloadListBtn.addEventListener('click', (event) => {
  event.stopPropagation()
  post({ type: 'reload' })
})

for (const input of document.querySelectorAll<HTMLInputElement>(
  'input[name="sort"]',
)) {
  input.addEventListener('change', () => {
    if (!input.checked) {
      return
    }
    sortMode = input.value as ComponentSortMode
    renderComponents()
  })
}

componentSearchToggle.addEventListener('click', (event) => {
  event.stopPropagation()
  if (componentSearchPopover.hidden) {
    setSearchPopoverOpen(true)
  } else {
    setSearchPopoverOpen(false)
  }
})

componentSearchInput.addEventListener('input', () => {
  applyComponentSearch()
})

if (searchScopeComponentsEl) {
  searchScopeComponentsEl.checked = true
  searchScopeComponents = true
  searchScopeComponentsEl.addEventListener('change', () => {
    searchScopeComponents = searchScopeComponentsEl.checked
    applyComponentSearch()
  })
}
if (searchScopeInstancesEl) {
  searchScopeInstancesEl.checked = true
  searchScopeInstances = true
  searchScopeInstancesEl.addEventListener('change', () => {
    searchScopeInstances = searchScopeInstancesEl.checked
    applyComponentSearch()
  })
}

componentSearchPopover.addEventListener('click', (event) => {
  event.stopPropagation()
})

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    setSearchPopoverOpen(false)
  }
})

window.onmessage = (event: MessageEvent) => {
  const msg = event.data?.pluginMessage as PluginToUiMessage | undefined
  if (!msg) {
    return
  }

  switch (msg.type) {
    case 'scanning':
      setStatus('検索中…')
      break

    case 'no-selection':
      setStatus(null)
      applyResult([], [])
      break

    case 'result':
      setStatus(
        msg.components.length === 0
          ? 'Component / Instance が見つかりませんでした'
          : null,
      )
      applyResult(msg.components, msg.layerTree)
      break

    case 'pin-targets':
      pinTargets = msg.targets
      pinnedNodeId = msg.pinnedNodeId
      recentTargets = msg.recent
      pinPicker.refresh()
      break

    case 'selection-empty':
      pinPicker.openHistoryPopover()
      break

    case 'selection-sync':
      highlightedComponentIds = new Set(msg.componentIds)
      highlightedInstanceIds = new Set(msg.instanceIds)
      if (msg.clearToggles) {
        activeSelectKeys.clear()
      }
      renderComponents()
      if (view === 'instances') {
        renderInstances()
      }
      break

    case 'error':
      setStatus(msg.message)
      break

    default:
      break
  }
}

showView('components')
post({ type: 'ready' })
