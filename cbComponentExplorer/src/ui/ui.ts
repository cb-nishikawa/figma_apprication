import type {
  ComponentInfo,
  ComponentSortMode,
  PinTarget,
  PluginToUiMessage,
  SearchMode,
  UiToPluginMessage,
} from '../types'

type View = 'components' | 'instances'

const viewComponentsEl = document.getElementById(
  'view-components',
) as HTMLDivElement
const viewInstancesEl = document.getElementById(
  'view-instances',
) as HTMLDivElement
const componentsEl = document.getElementById('components') as HTMLDivElement
const instancesEl = document.getElementById('instances') as HTMLDivElement
const instancesEmptyEl = document.getElementById(
  'instances-empty',
) as HTMLParagraphElement
const instanceHeadingEl = document.getElementById(
  'instance-heading',
) as HTMLParagraphElement
const statusEl = document.getElementById('status') as HTMLParagraphElement
const backBtn = document.getElementById('back-btn') as HTMLButtonElement
const pinRowEl = document.getElementById('pin-row') as HTMLDivElement
const pinComboboxEl = document.querySelector('.pin-combobox') as HTMLDivElement
const pinInputEl = document.getElementById(
  'pin-combobox-input',
) as HTMLInputElement
const pinListEl = document.getElementById(
  'pin-combobox-list',
) as HTMLUListElement

let mode: SearchMode = 'selection'
let sortMode: ComponentSortMode = 'layer'
let view: View = 'components'
let components: ComponentInfo[] = []
let selectedComponentId: string | null = null
let activeSelectKeys = new Set<string>()
let pinTargets: PinTarget[] = []
let pinnedNodeId: string | null = null
let pinFilterQuery = ''
let pinListOpen = false
let pinActiveIndex = -1
let highlightedComponentIds = new Set<string>()
let highlightedInstanceIds = new Set<string>()

function post(message: UiToPluginMessage): void {
  parent.postMessage({ pluginMessage: message }, '*')
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

function updatePinRowVisibility(): void {
  pinRowEl.hidden = mode !== 'pinned'
}

function goToComponents(): void {
  selectedComponentId = null
  post({ type: 'clear-hover-highlight' })
  showView('components')
  renderComponents()
}

function goToInstances(componentId: string): void {
  selectedComponentId = componentId
  post({ type: 'clear-hover-highlight' })
  showView('instances')
  renderComponents()
  renderInstances()
}

function nodeIdsForActiveKeys(): string[] {
  const ids = new Set<string>()
  for (const key of activeSelectKeys) {
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
    for (const instance of component.instances) {
      valid.add(`instance:${instance.id}`)
    }
  }
  for (const key of Array.from(activeSelectKeys)) {
    if (!valid.has(key)) {
      activeSelectKeys.delete(key)
    }
  }
}

function filteredPinTargets(): PinTarget[] {
  const query = pinFilterQuery.trim().toLowerCase()
  if (!query) {
    return pinTargets
  }
  return pinTargets.filter((target) => {
    return (
      target.label.toLowerCase().includes(query) ||
      target.name.toLowerCase().includes(query)
    )
  })
}

function getPinnedTarget(): PinTarget | null {
  if (!pinnedNodeId) {
    return null
  }
  return pinTargets.find((t) => t.id === pinnedNodeId) ?? null
}

function syncPinnedFromTargets(): void {
  if (pinnedNodeId && !getPinnedTarget()) {
    pinnedNodeId = null
  }
}

function setPinInputToSelection(): void {
  const selected = getPinnedTarget()
  pinFilterQuery = ''
  pinInputEl.value = selected ? selected.label : ''
}

function commitPinnedNode(nextId: string | null): void {
  pinnedNodeId = nextId
  setPinInputToSelection()
  closePinList()
  post({ type: 'set-pinned-node', pinnedNodeId })
}

function openPinList(): void {
  pinListOpen = true
  pinListEl.hidden = false
  pinInputEl.setAttribute('aria-expanded', 'true')
  renderPinList()
}

function closePinList(): void {
  pinListOpen = false
  pinActiveIndex = -1
  pinListEl.hidden = true
  pinInputEl.setAttribute('aria-expanded', 'false')
}

function renderPinList(): void {
  syncPinnedFromTargets()
  pinListEl.replaceChildren()

  if (pinTargets.length === 0) {
    const empty = document.createElement('li')
    empty.className = 'pin-combobox-empty'
    empty.textContent = '候補がありません'
    pinListEl.append(empty)
    return
  }

  const filtered = filteredPinTargets()
  if (filtered.length === 0) {
    const empty = document.createElement('li')
    empty.className = 'pin-combobox-empty'
    empty.textContent = '該当なし'
    pinListEl.append(empty)
    pinActiveIndex = -1
    return
  }

  if (pinActiveIndex >= filtered.length) {
    pinActiveIndex = filtered.length - 1
  }

  filtered.forEach((target, index) => {
    const item = document.createElement('li')
    item.setAttribute('role', 'option')
    item.id = `pin-option-${target.id}`

    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'pin-combobox-option'
    if (target.id === pinnedNodeId) {
      button.classList.add('is-selected')
    }
    if (index === pinActiveIndex) {
      button.classList.add('is-active')
    }
    button.textContent = target.label
    button.title = target.label
    button.addEventListener('mousedown', (event) => {
      // Prevent input blur before click commits.
      event.preventDefault()
    })
    button.addEventListener('click', () => {
      commitPinnedNode(target.id)
    })

    item.append(button)
    pinListEl.append(item)
  })

  if (pinActiveIndex >= 0) {
    const active = pinListEl.children[pinActiveIndex] as HTMLElement | undefined
    active?.scrollIntoView({ block: 'nearest' })
  }
}

function refreshPinCombobox(preserveInput = false): void {
  syncPinnedFromTargets()
  if (!preserveInput) {
    setPinInputToSelection()
  }
  if (pinListOpen) {
    renderPinList()
  }
}

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

function pathSortKey(path: { name: string }[]): string {
  if (path.length === 0) {
    return '\uffff'
  }
  return path.map((p) => p.name).join('\0')
}

function getSortedComponents(): ComponentInfo[] {
  const sorted = [...components]
  if (sortMode === 'name') {
    sorted.sort((a, b) => {
      const byPath = pathSortKey(a.groupPath).localeCompare(
        pathSortKey(b.groupPath),
        'ja',
      )
      if (byPath !== 0) {
        return byPath
      }
      return a.name.localeCompare(b.name, 'ja')
    })
  } else {
    sorted.sort((a, b) => {
      const byLayer = a.layerIndex - b.layerIndex
      if (byLayer !== 0) {
        return byLayer
      }
      return a.name.localeCompare(b.name, 'ja')
    })
  }
  return sorted
}

type PathTreeNode = {
  id: string
  name: string
  kind: 'SECTION' | 'FRAME'
  children: Map<string, PathTreeNode>
  childOrder: string[]
  components: ComponentInfo[]
}

function buildPathTree(sorted: ComponentInfo[]): {
  roots: PathTreeNode[]
  rootComponents: ComponentInfo[]
} {
  const rootMap = new Map<string, PathTreeNode>()
  const rootOrder: string[] = []
  const rootComponents: ComponentInfo[] = []

  for (const component of sorted) {
    if (component.groupPath.length === 0) {
      rootComponents.push(component)
      continue
    }

    let map = rootMap
    let order = rootOrder
    let node: PathTreeNode | undefined

    for (const segment of component.groupPath) {
      node = map.get(segment.id)
      if (!node) {
        node = {
          id: segment.id,
          name: segment.name,
          kind: segment.kind,
          children: new Map(),
          childOrder: [],
          components: [],
        }
        map.set(segment.id, node)
        order.push(segment.id)
      }
      map = node.children
      order = node.childOrder
    }

    node?.components.push(component)
  }

  return {
    roots: rootOrder
      .map((id) => rootMap.get(id))
      .filter((n): n is PathTreeNode => Boolean(n)),
    rootComponents,
  }
}

function headingLabel(kind: 'SECTION' | 'FRAME', name: string): string {
  return kind === 'SECTION' ? `#${name}` : name
}

function createComponentRow(component: ComponentInfo): HTMLDivElement {
  const row = document.createElement('div')
  row.className =
    'row' + (isComponentHighlighted(component.id) ? ' is-selected' : '')

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
      nodeIds: component.instances.map((instance) => instance.id),
      style: 'instance',
    })
  }

  row.addEventListener('mouseenter', highlightComponent)
  row.addEventListener('mouseleave', () => {
    post({ type: 'clear-hover-highlight' })
  })

  const main = document.createElement('div')
  main.className = 'row-main'

  const nameBtn = document.createElement('button')
  nameBtn.type = 'button'
  nameBtn.className = 'name-btn'
  nameBtn.textContent = component.name
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

  const badge = document.createElement('span')
  badge.className = 'badge' + (component.isLocal ? '' : ' is-library')
  badge.textContent = component.isLocal ? 'local' : 'library'

  const countBtn = document.createElement('button')
  countBtn.type = 'button'
  countBtn.className = 'link-btn'
  countBtn.textContent = `${component.instances.length} instances`
  countBtn.addEventListener('click', () => {
    goToInstances(component.id)
  })
  countBtn.addEventListener('mouseenter', highlightInstances)
  countBtn.addEventListener('mouseleave', highlightComponent)

  meta.append(badge, countBtn)
  main.append(nameBtn, meta)

  const actions = document.createElement('div')
  actions.className = 'actions'
  actions.append(createSelectToggle(`component:${component.id}`))

  row.append(main, actions)
  return row
}

function renderPathTreeNode(node: PathTreeNode, depth: number): void {
  const heading = document.createElement('div')
  heading.className = 'group-heading'
  heading.style.setProperty('--group-depth', String(depth))
  heading.textContent = headingLabel(node.kind, node.name)
  componentsEl.append(heading)

  if (node.components.length > 0) {
    const items = document.createElement('div')
    items.className = 'group-items'
    items.style.setProperty('--group-depth', String(depth + 1))
    for (const component of node.components) {
      items.append(createComponentRow(component))
    }
    componentsEl.append(items)
  }

  for (const childId of node.childOrder) {
    const child = node.children.get(childId)
    if (child) {
      renderPathTreeNode(child, depth + 1)
    }
  }
}

function renderComponents(): void {
  post({ type: 'clear-hover-highlight' })
  componentsEl.replaceChildren()

  if (components.length === 0) {
    return
  }

  const { roots, rootComponents } = buildPathTree(getSortedComponents())

  for (const root of roots) {
    renderPathTreeNode(root, 0)
  }

  if (rootComponents.length > 0) {
    const items = document.createElement('div')
    items.className = 'group-items'
    items.style.setProperty('--group-depth', '0')
    for (const component of rootComponents) {
      items.append(createComponentRow(component))
    }
    componentsEl.append(items)
  }
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

  instanceHeadingEl.textContent = selected.name
  instanceHeadingEl.title = selected.name

  if (selected.instances.length === 0) {
    instancesEmptyEl.hidden = false
    instancesEmptyEl.textContent = 'Instanceがありません'
    return
  }

  instancesEmptyEl.hidden = true

  for (const instance of selected.instances) {
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

function applyResult(next: ComponentInfo[]): void {
  components = next
  pruneActiveSelectKeys()
  if (
    selectedComponentId &&
    !components.some((c) => c.id === selectedComponentId)
  ) {
    selectedComponentId = null
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

pinInputEl.addEventListener('focus', () => {
  pinFilterQuery = pinInputEl.value
  // When focusing a committed value, start with full list unless user edits.
  const selected = getPinnedTarget()
  if (selected && pinInputEl.value === selected.label) {
    pinFilterQuery = ''
  }
  openPinList()
})

pinInputEl.addEventListener('input', () => {
  pinFilterQuery = pinInputEl.value
  pinActiveIndex = 0
  if (!pinInputEl.value.trim()) {
    if (pinnedNodeId) {
      pinnedNodeId = null
      post({ type: 'set-pinned-node', pinnedNodeId: null })
    }
  }
  openPinList()
})

pinInputEl.addEventListener('keydown', (event) => {
  const filtered = filteredPinTargets()

  if (event.key === 'ArrowDown') {
    event.preventDefault()
    if (!pinListOpen) {
      openPinList()
    }
    pinActiveIndex = Math.min(pinActiveIndex + 1, filtered.length - 1)
    renderPinList()
    return
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault()
    if (!pinListOpen) {
      openPinList()
    }
    pinActiveIndex = Math.max(pinActiveIndex - 1, 0)
    renderPinList()
    return
  }

  if (event.key === 'Enter') {
    event.preventDefault()
    if (!pinListOpen) {
      openPinList()
      return
    }
    const target = filtered[pinActiveIndex] ?? filtered[0]
    if (target) {
      commitPinnedNode(target.id)
    }
    return
  }

  if (event.key === 'Escape') {
    event.preventDefault()
    if (pinListOpen) {
      setPinInputToSelection()
      closePinList()
      return
    }
    if (pinnedNodeId) {
      commitPinnedNode(null)
    }
  }
})

pinInputEl.addEventListener('blur', () => {
  // Defer so option click can commit first.
  window.setTimeout(() => {
    if (!pinComboboxEl.contains(document.activeElement)) {
      setPinInputToSelection()
      closePinList()
    }
  }, 0)
})

document.addEventListener('mousedown', (event) => {
  const target = event.target
  if (!(target instanceof Node)) {
    return
  }
  if (!pinComboboxEl.contains(target)) {
    if (pinListOpen) {
      setPinInputToSelection()
      closePinList()
    }
  }
})

for (const input of document.querySelectorAll<HTMLInputElement>(
  'input[name="mode"]',
)) {
  input.addEventListener('change', () => {
    if (!input.checked) {
      return
    }
    const previousMode = mode
    mode = input.value as SearchMode
    activeSelectKeys.clear()
    updatePinRowVisibility()
    goToComponents()

    // selection → pinned: let the plugin pick from current canvas selection
    const nextPinnedNodeId =
      mode === 'pinned'
        ? previousMode === 'selection'
          ? undefined
          : pinnedNodeId
        : null

    post({
      type: 'set-mode',
      mode,
      pinnedNodeId: nextPinnedNodeId,
    })
  })
}

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

window.onmessage = (event: MessageEvent) => {
  const msg = event.data?.pluginMessage as PluginToUiMessage | undefined
  if (!msg) {
    return
  }

  switch (msg.type) {
    case 'scanning':
      mode = msg.mode
      updatePinRowVisibility()
      setStatus('検索中…')
      break

    case 'no-selection':
      mode = msg.mode
      updatePinRowVisibility()
      setStatus(msg.message ?? 'Nodeが選択されていません')
      applyResult([])
      break

    case 'result':
      mode = msg.mode
      updatePinRowVisibility()
      setStatus(
        msg.components.length === 0
          ? 'Component / Instance が見つかりませんでした'
          : null,
      )
      applyResult(msg.components)
      break

    case 'pin-targets':
      pinTargets = msg.targets
      pinnedNodeId = msg.pinnedNodeId
      refreshPinCombobox(false)
      updatePinRowVisibility()
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
updatePinRowVisibility()
post({ type: 'ready' })
