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

function createSelectToggle(key: string): HTMLLabelElement {
  const label = document.createElement('label')
  label.className = 'toggle'
  label.title = 'キャンバス上で選択 / 解除'

  const input = document.createElement('input')
  input.type = 'checkbox'
  input.checked = activeSelectKeys.has(key)

  const track = document.createElement('span')
  track.className = 'toggle-track'

  input.addEventListener('change', () => {
    if (input.checked) {
      activeSelectKeys.add(key)
    } else {
      activeSelectKeys.delete(key)
    }
    syncCanvasSelection()
    renderComponents()
    if (view === 'instances') {
      renderInstances()
    }
  })

  label.append(input, track)
  return label
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

  row.addEventListener('mouseenter', options.instanceIds ? highlightInstances : highlightComponent)
  row.addEventListener('mouseleave', () => {
    post({ type: 'clear-hover-highlight' })
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
  nameBtn.append(createSquareIcon('filled'), document.createTextNode(label))
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
  actions.append(createSelectToggle(options.toggleKey))

  row.append(main, actions)
  return row
}

function createLayerInstanceElement(item: InstanceItem): HTMLElement {
  const component = item.component
  const selected = activeSelectKeys.has(`item:${item.key}`) || isInstanceHighlighted(item.id)
  const row = document.createElement('div')
  row.className = 'row' + (item.children.length > 0 ? ' has-expand' : '') + (selected ? ' is-selected' : '')

  const highlightInstance = () => {
    post({ type: 'hover-highlight', nodeIds: [item.id], style: 'instance' })
  }
  const highlightMain = () => {
    post({ type: 'hover-highlight', nodeIds: [component.id], style: 'component' })
  }
  row.addEventListener('mouseenter', highlightInstance)
  row.addEventListener('mouseleave', () => {
    post({ type: 'clear-hover-highlight' })
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

  const meta = document.createElement('div')
  meta.className = 'meta'
  const mainLabel = component.name
  const mainEl = document.createElement('span')
  mainEl.textContent = mainLabel
  mainEl.title = mainLabel
  meta.append(mainEl)
  meta.append(createLocalBadge(component.isLocal))

  if (component.canJump) {
    const mainLink = document.createElement('button')
    mainLink.type = 'button'
    mainLink.className = 'link-btn'
    mainLink.textContent = 'メインへ'
    mainLink.addEventListener('click', () => {
      post({ type: 'jump-node', nodeId: component.id })
    })
    mainLink.addEventListener('mouseenter', highlightMain)
    mainLink.addEventListener('mouseleave', highlightInstance)
    meta.append(mainLink)
  }

  main.append(nameBtn, meta)

  const actions = document.createElement('div')
  actions.className = 'actions'
  actions.append(createSelectToggle(`item:${item.key}`))
  row.append(main, actions)

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

function createSetGroup(entry: SetEntry): HTMLDivElement {
  const group = document.createElement('div')
  group.className = 'acc-group'

  const expanded = expandedSetIds.has(entry.id)
  const toggle = () => toggleExpanded(expandedSetIds, entry.id)

  const instanceCount = entry.variants.reduce(
    (sum, variant) => sum + variant.instances.length,
    0,
  )
  const counts = document.createElement('span')
  counts.className = 'acc-count'
  counts.title = `${entry.variants.length} variants · ${instanceCount} instances`
  counts.append(
    createSquareIcon('filled'),
    document.createTextNode(` ${entry.variants.length} `),
    createSquareIcon('empty'),
    document.createTextNode(` ${instanceCount}`),
  )

  const header = createAccordionHeader({
    expanded,
    label: entry.name,
    icon: createSquareIcon('filled'),
    labelTitle: entry.canJump ? entry.name : `${entry.name}（ジャンプ不可）`,
    labelDisabled: !entry.canJump,
    selected:
      activeSelectKeys.has(`set:${entry.id}`) ||
      entry.variants.some((variant) => isComponentHighlighted(variant.id)),
    onToggle: toggle,
    onLabelClick: entry.canJump
      ? () => {
          post({ type: 'jump-node', nodeId: entry.id })
        }
      : undefined,
    meta: [createLocalBadge(entry.isLocal), counts],
    actions: [createSelectToggle(`set:${entry.id}`)],
  })
  attachComponentHover(header, entry.id)
  attachHeaderToggle(header, toggle)
  group.append(header)

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
          onToggle: () => toggleExpanded(expandedGroupIds, item.key),
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
  const toggle = () => toggleExpanded(expandedGroupIds, item.key)
  const toggleKey = `item:${item.key}`

  const instanceCount = item.children.reduce(
    (sum, child) => sum + child.component.instances.length,
    0,
  )
  const counts = document.createElement('span')
  counts.className = 'acc-count'
  counts.title = `${item.children.length} variants · ${instanceCount} instances`
  counts.append(
    createSquareIcon('filled'),
    document.createTextNode(` ${item.children.length} `),
    createSquareIcon('empty'),
    document.createTextNode(` ${instanceCount}`),
  )

  const meta: HTMLElement[] = [createLocalBadge(item.isLocal)]
  meta.push(counts)

  const header = createAccordionHeader({
    expanded,
    label: item.name,
    icon: createSquareIcon('filled'),
    labelTitle: item.canJump ? item.name : `${item.name}（ジャンプ不可）`,
    labelDisabled: !item.canJump,
    selected:
      activeSelectKeys.has(toggleKey) ||
      item.children.some((child) => isComponentHighlighted(child.component.id)),
    onToggle: toggle,
    onLabelClick: item.canJump
      ? () => {
          post({ type: 'jump-node', nodeId: item.id })
        }
      : undefined,
    meta,
    actions: [createSelectToggle(toggleKey)],
  })
  attachComponentHover(header, item.id)
  attachHeaderToggle(header, toggle)
  group.append(header)

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
  const toggle = () => toggleExpanded(expandedGroupIds, item.key)

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
