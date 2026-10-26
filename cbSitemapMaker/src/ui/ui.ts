import type { PluginToUiMessage, SitemapNode, UiToPluginMessage } from '../types'
import { FILL_COLOR_HEX, HEX_PATTERN, TEXT_COLOR_HEX, resolveColor } from '../palette'

const MIN_UI_HEIGHT = 320
const MAX_UI_HEIGHT = 900

interface Location {
  array: SitemapNode[]
  index: number
  parent: SitemapNode | null
}

let roots: SitemapNode[] = []
let targetId: string | null = null

function post(message: UiToPluginMessage): void {
  parent.postMessage({ pluginMessage: message }, '*')
}

function clampUiHeightLocal(height: number): number {
  return Math.min(MAX_UI_HEIGHT, Math.max(MIN_UI_HEIGHT, Math.round(height)))
}

function newNode(name = '新規ページ'): SitemapNode {
  return { id: `node-${Date.now()}-${Math.random().toString(36).slice(2)}`, name, children: [] }
}

function findNode(id: string, nodes: SitemapNode[] = roots): SitemapNode | null {
  for (const node of nodes) {
    if (node.id === id) {
      return node
    }
    const found = findNode(id, node.children)
    if (found) {
      return found
    }
  }
  return null
}

function findLocation(
  id: string,
  nodes: SitemapNode[] = roots,
  parent: SitemapNode | null = null,
): Location | null {
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].id === id) {
      return { array: nodes, index: i, parent }
    }
    const found = findLocation(id, nodes[i].children, nodes[i])
    if (found) {
      return found
    }
  }
  return null
}

function addRoot(): void {
  roots.push(newNode())
  render()
}

function deleteNode(id: string): void {
  const loc = findLocation(id)
  if (!loc) {
    return
  }
  loc.array.splice(loc.index, 1)
  render()
}

type DropPosition = 'before' | 'after' | 'inside'

/** `id` 自身か、その子孫なら true（そこへは動かせない）。 */
function isSelfOrDescendant(id: string, targetId: string): boolean {
  const node = findNode(id)
  return node !== null && findNode(targetId, [node]) !== null
}

/** `id` のページを `targetId` の前・後・子の末尾へ動かす。 */
function moveTo(id: string, targetId: string, position: DropPosition): void {
  if (isSelfOrDescendant(id, targetId)) {
    return
  }
  const from = findLocation(id)
  if (!from) {
    return
  }
  const [node] = from.array.splice(from.index, 1)
  // 取り出したあとの並びで探し直す（同じ並びの中だと位置がずれるため）。
  const target = findLocation(targetId)
  if (!target) {
    from.array.splice(from.index, 0, node)
    return
  }
  if (position === 'inside') {
    target.array[target.index].children.push(node)
  } else {
    target.array.splice(position === 'before' ? target.index : target.index + 1, 0, node)
  }
  render()
}

const treeEl = document.getElementById('tree') as HTMLDivElement
const statusEl = document.getElementById('status') as HTMLParagraphElement
const editingEl = document.getElementById('editing') as HTMLDivElement
const editingLabelEl = document.getElementById('editing-label') as HTMLSpanElement
const newMapBtn = document.getElementById('new-map') as HTMLButtonElement
const addRootBtn = document.getElementById('add-root') as HTMLButtonElement
const updateBtn = document.getElementById('update') as HTMLButtonElement
const generateBtn = document.getElementById('generate') as HTMLButtonElement
const resizeHandle = document.getElementById('resize-handle') as HTMLDivElement

function setStatus(message: string | null): void {
  if (!message) {
    statusEl.hidden = true
    statusEl.textContent = ''
    return
  }
  statusEl.hidden = false
  statusEl.textContent = message
}

function setTarget(id: string | null, name?: string): void {
  targetId = id
  updateBtn.hidden = !targetId
  if (targetId) {
    editingEl.hidden = false
    editingLabelEl.textContent = name ? `編集中: ${name}` : '編集中'
    updateBtn.classList.add('btn-primary')
    generateBtn.classList.remove('btn-primary')
  } else {
    editingEl.hidden = true
    editingLabelEl.textContent = ''
    updateBtn.classList.remove('btn-primary')
    generateBtn.classList.add('btn-primary')
  }
}

let draggingId: string | null = null
const DROP_CLASSES = ['is-drop-before', 'is-drop-after', 'is-drop-inside']

function clearDropMarks(): void {
  treeEl.querySelectorAll('.node-row').forEach((el) => el.classList.remove(...DROP_CLASSES))
}

/** 行の上 1/4 は前、下 1/4 は後、真ん中は子。 */
function dropPosition(row: HTMLElement, clientY: number): DropPosition {
  const rect = row.getBoundingClientRect()
  const ratio = (clientY - rect.top) / rect.height
  return ratio < 0.25 ? 'before' : ratio > 0.75 ? 'after' : 'inside'
}

function setupDrag(row: HTMLElement, handle: HTMLElement, id: string): void {
  // つまみを押したときだけドラッグできるようにする（名前の入力欄で文字を選べるように）。
  handle.addEventListener('pointerdown', () => {
    row.draggable = true
  })
  handle.addEventListener('pointerup', () => {
    row.draggable = false
  })
  row.addEventListener('dragstart', (event) => {
    draggingId = id
    event.dataTransfer?.setData('text/plain', id)
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move'
    }
    row.classList.add('is-dragging')
  })
  row.addEventListener('dragend', () => {
    draggingId = null
    row.draggable = false
    row.classList.remove('is-dragging')
    clearDropMarks()
  })
  row.addEventListener('dragover', (event) => {
    if (!draggingId || isSelfOrDescendant(draggingId, id)) {
      return
    }
    event.preventDefault()
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move'
    }
    const position = dropPosition(row, event.clientY)
    row.classList.remove(...DROP_CLASSES)
    row.classList.add(`is-drop-${position}`)
  })
  row.addEventListener('dragleave', () => {
    row.classList.remove(...DROP_CLASSES)
  })
  row.addEventListener('drop', (event) => {
    event.preventDefault()
    const sourceId = draggingId
    clearDropMarks()
    if (sourceId) {
      moveTo(sourceId, id, dropPosition(row, event.clientY))
    }
  })
}

function createColorSelect(node: SitemapNode, kind: 'fill' | 'textColor'): HTMLLabelElement {
  const wrap = document.createElement('label')
  wrap.className = 'color-select-trigger'
  wrap.title = kind === 'fill' ? '背景色' : '文字色'
  wrap.setAttribute('aria-label', wrap.title)

  const swatch = document.createElement('span')
  swatch.className = 'color-select-swatch'

  // 文字色は白地に色付きの「A」と下の帯で見せる（背景まで塗ると「A」が見えなくなる）。
  let letter: HTMLSpanElement | null = null
  if (kind === 'textColor') {
    swatch.classList.add('is-text')
    letter = document.createElement('span')
    letter.className = 'color-select-letter'
    letter.textContent = 'A'
    swatch.appendChild(letter)
  }

  const input = document.createElement('input')
  input.type = 'color'
  input.className = 'color-select-input'

  function paint(hex: string): void {
    if (letter) {
      swatch.style.setProperty('--swatch', hex)
      letter.style.color = hex
    } else {
      swatch.style.background = hex
    }
  }

  const current = kind === 'fill' ? node.fill : node.textColor
  const hex = resolveColor(current, kind === 'fill' ? 'fill' : 'text')
  input.value = hex
  paint(hex)

  input.addEventListener('input', () => {
    const value = input.value
    if (kind === 'fill') {
      node.fill = value
    } else {
      node.textColor = value
    }
    paint(value)
  })

  wrap.appendChild(swatch)
  wrap.appendChild(input)
  return wrap
}

function renderNode(node: SitemapNode, container: HTMLElement, depth: number): void {
  const row = document.createElement('div')
  row.className = 'node-row'
  row.style.paddingLeft = `${depth * 16}px`

  const handle = document.createElement('span')
  handle.className = 'node-handle'
  handle.textContent = '⋮⋮'
  handle.title = 'ドラッグで並び替え'
  handle.setAttribute('aria-hidden', 'true')
  row.appendChild(handle)
  setupDrag(row, handle, node.id)

  const input = document.createElement('input')
  input.className = 'node-name'
  input.type = 'text'
  input.value = node.name
  input.addEventListener('input', () => {
    node.name = input.value
  })
  row.appendChild(input)

  row.appendChild(createColorSelect(node, 'fill'))
  row.appendChild(createColorSelect(node, 'textColor'))

  const makeBtn = (label: string, onClick: () => void): HTMLButtonElement => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'btn-small'
    b.textContent = label
    b.addEventListener('click', (event) => {
      event.stopPropagation()
      onClick()
    })
    return b
  }

  row.appendChild(makeBtn('×', () => deleteNode(node.id)))

  container.appendChild(row)

  for (const child of node.children) {
    renderNode(child, container, depth + 1)
  }
}

function render(): void {
  while (treeEl.firstChild) {
    treeEl.removeChild(treeEl.firstChild)
  }
  for (const root of roots) {
    renderNode(root, treeEl, 0)
  }
}

addRootBtn.addEventListener('click', () => {
  addRoot()
})

newMapBtn.addEventListener('click', () => {
  roots = []
  setTarget(null)
  render()
  setStatus(null)
  post({ type: 'clear-target' })
})

updateBtn.addEventListener('click', () => {
  if (!targetId) {
    return
  }
  const copy = JSON.parse(JSON.stringify(roots)) as SitemapNode[]
  post({ type: 'update', targetId, roots: copy })
  setStatus('更新中…')
})

generateBtn.addEventListener('click', () => {
  const copy = JSON.parse(JSON.stringify(roots)) as SitemapNode[]
  post({ type: 'generate', roots: copy })
  setStatus('生成中…')
})



window.onmessage = (event: MessageEvent) => {
  const msg = event.data?.pluginMessage as PluginToUiMessage | undefined
  if (!msg) {
    return
  }
  switch (msg.type) {
    case 'sitemap-selected':
      if (msg.id) {
        if (msg.id !== targetId && msg.roots) {
          roots = JSON.parse(JSON.stringify(msg.roots)) as SitemapNode[]
          setTarget(msg.id, msg.name)
          render()
        } else if (msg.id !== targetId) {
          setTarget(msg.id, msg.name)
        }
      }
      break
    case 'generated':
      setTarget(msg.id, 'サイトマップ')
      setStatus('生成しました')
      break
    case 'updated':
      setTarget(msg.id, 'サイトマップ')
      setStatus('更新しました')
      break
    case 'error':
      setStatus(msg.message)
      break
  }
}

// Resize handle
let resizingUi = false
let resizePointerId: number | null = null

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

post({ type: 'ready' })
render()
