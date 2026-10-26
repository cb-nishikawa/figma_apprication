import type { PluginToUiMessage, SitemapNode, UiToPluginMessage } from './types'

const UI_WIDTH = 360
const DEFAULT_UI_HEIGHT = 560
const MIN_UI_HEIGHT = 320
const MAX_UI_HEIGHT = 900
const UI_HEIGHT_STORAGE_KEY = 'uiHeight'

const NODE_W = 160
const NODE_H = 48
const V_GAP = 24
/** 親の箱と子の箱の間（線の部分）の幅。 */
const CONNECTOR_W = 48
/** 兄弟をつなぐ縦線の位置（connector の左端から）。 */
const TRUNK_X = 24
const LINE_COLOR: RGB = { r: 0.15, g: 0.15, b: 0.15 }

function clampUiHeight(height: number): number {
  return Math.min(MAX_UI_HEIGHT, Math.max(MIN_UI_HEIGHT, Math.round(height)))
}

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

function post(message: PluginToUiMessage): void {
  figma.ui.postMessage(message)
}

function validateSitemapRoots(value: unknown): SitemapNode[] | null {
  function valid(node: unknown): node is SitemapNode {
    return (
      !!node &&
      typeof node === 'object' &&
      typeof (node as SitemapNode).id === 'string' &&
      typeof (node as SitemapNode).name === 'string' &&
      Array.isArray((node as SitemapNode).children) &&
      (node as SitemapNode).children.every(valid)
    )
  }
  if (!Array.isArray(value)) {
    return null
  }
  return value.every(valid) ? (value as SitemapNode[]) : null
}

function parseSitemapData(data: string): SitemapNode[] | null {
  try {
    const parsed = JSON.parse(data) as { version?: number; roots?: unknown }
    if (!parsed || parsed.version !== 1) {
      return null
    }
    return validateSitemapRoots(parsed.roots)
  } catch {
    return null
  }
}

function createSitemapFrame(roots: SitemapNode[]): FrameNode {
  const rootColumn = figma.createFrame()
  rootColumn.name = 'サイトマップ'
  rootColumn.layoutMode = 'VERTICAL'
  rootColumn.itemSpacing = V_GAP
  rootColumn.primaryAxisSizingMode = 'AUTO'
  rootColumn.counterAxisSizingMode = 'AUTO'

  for (const root of roots) {
    rootColumn.appendChild(buildSubtree(root))
  }

  rootColumn.setPluginData('sitemap', JSON.stringify({ version: 1, roots }))
  return rootColumn
}

async function findSitemapFrameFromSelection(): Promise<FrameNode | null> {
  const selection = figma.currentPage.selection
  if (selection.length !== 1) {
    return null
  }
  let node: BaseNode | null = selection[0]
  while (node) {
    if (node.type === 'FRAME') {
      const data = node.getPluginData('sitemap')
      if (data && parseSitemapData(data)) {
        return node as FrameNode
      }
    }
    node = node.parent
  }
  return null
}

async function sendSelection(): Promise<void> {
  const frame = await findSitemapFrameFromSelection()
  if (frame) {
    const roots = parseSitemapData(frame.getPluginData('sitemap'))
    if (roots) {
      post({ type: 'sitemap-selected', id: frame.id, name: frame.name, roots })
      return
    }
  }
  post({ type: 'sitemap-selected', id: null })
}

/** 親パーツ。ページ名を書いた箱。 */
function createBox(name: string): FrameNode {
  const frame = figma.createFrame()
  frame.name = '親パーツ'
  frame.resize(NODE_W, NODE_H)
  frame.cornerRadius = 8
  frame.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }]
  frame.strokes = [{ type: 'SOLID', color: LINE_COLOR }]
  frame.strokeWeight = 1
  frame.layoutMode = 'HORIZONTAL'
  frame.primaryAxisAlignItems = 'CENTER'
  frame.counterAxisAlignItems = 'CENTER'
  frame.paddingLeft = 8
  frame.paddingRight = 8
  frame.paddingTop = 4
  frame.paddingBottom = 4

  const text = figma.createText()
  text.fontName = { family: 'Inter', style: 'Regular' }
  text.fontSize = 12
  text.textAlignHorizontal = 'CENTER'
  text.textAlignVertical = 'CENTER'
  text.textAutoResize = 'HEIGHT'
  text.resize(NODE_W - 16, 10)
  text.characters = name
  frame.appendChild(text)

  return frame
}

/** 中身の大きさに合わせて伸び縮みする、塗りなしのオートレイアウト枠。上揃え。 */
function createAutoFrame(name: string, mode: 'HORIZONTAL' | 'VERTICAL'): FrameNode {
  const frame = figma.createFrame()
  frame.name = name
  frame.layoutMode = mode
  frame.itemSpacing = 0
  frame.primaryAxisSizingMode = 'AUTO'
  frame.counterAxisSizingMode = 'AUTO'
  frame.counterAxisAlignItems = 'MIN'
  frame.fills = []
  frame.clipsContent = false
  return frame
}

function createLine(
  parent: FrameNode,
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
  vertical: ConstraintType
): void {
  const line = figma.createRectangle()
  line.name = name
  line.resize(width, height)
  line.x = x
  line.y = y
  line.fills = [{ type: 'SOLID', color: LINE_COLOR }]
  line.constraints = { horizontal: 'MIN', vertical }
  parent.appendChild(line)
}

/**
 * 子パーツの線の部分。子パーツの中で高さを FILL にして、孫を含む中身の高さまで伸ばす。
 * 縦線は STRETCH の制約で一緒に伸びるので、兄弟をつなぐ線が途切れない。
 */
function createConnector(first: boolean, hasNext: boolean): FrameNode {
  const topPad = first ? 0 : V_GAP
  const centerY = topPad + NODE_H / 2
  const height = topPad + NODE_H
  const connector = figma.createFrame()
  connector.name = 'connector'
  connector.resize(CONNECTOR_W, height)
  connector.fills = []
  connector.clipsContent = false

  const lineStart = first ? 0 : TRUNK_X
  createLine(connector, 'line-h', lineStart, centerY, CONNECTOR_W - lineStart, 1, 'MIN')
  if (first && hasNext) {
    createLine(connector, 'line-v', TRUNK_X, centerY, 1, height - centerY, 'STRETCH')
  } else if (!first && hasNext) {
    createLine(connector, 'line-v', TRUNK_X, 0, 1, height, 'STRETCH')
  } else if (!first) {
    createLine(connector, 'line-v', TRUNK_X, 0, 1, centerY + 1, 'MIN')
  }
  return connector
}

/** 子パーツ1（最初の子）・子パーツ2（2 番目以降）。[線の部分, 子の中身] の横並び。 */
function createChildPart(child: SitemapNode, first: boolean, hasNext: boolean): FrameNode {
  const part = createAutoFrame(first ? '子パーツ1' : '子パーツ2', 'HORIZONTAL')
  const connector = createConnector(first, hasNext)
  part.appendChild(connector)

  const subtree = buildSubtree(child)
  if (first) {
    part.appendChild(subtree)
  } else {
    // 兄弟との間は中身の側の余白で空ける（子パーツの余白にすると線の部分も下がり、縦線が途切れる）。
    const content = createAutoFrame('content', 'VERTICAL')
    content.paddingTop = V_GAP
    content.appendChild(subtree)
    part.appendChild(content)
  }
  connector.layoutSizingVertical = 'FILL'
  return part
}

/** 子がなければ親パーツだけ。子があれば親パーツの右に子パーツ1・子パーツ2 を縦に並べる。 */
function buildSubtree(node: SitemapNode): FrameNode {
  const box = createBox(node.name)
  if (node.children.length === 0) {
    return box
  }

  const childrenColumn = createAutoFrame('children', 'VERTICAL')
  node.children.forEach((child, index) => {
    childrenColumn.appendChild(createChildPart(child, index === 0, index < node.children.length - 1))
  })

  const outer = createAutoFrame(node.name, 'HORIZONTAL')
  outer.appendChild(box)
  outer.appendChild(childrenColumn)
  return outer
}

async function handleGenerate(roots: SitemapNode[]): Promise<void> {
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' })

  const frame = createSitemapFrame(roots)
  figma.currentPage.appendChild(frame)
  const center = figma.viewport.center
  frame.x = center.x - frame.width / 2
  frame.y = center.y - frame.height / 2
  figma.currentPage.selection = [frame]
  post({ type: 'generated', id: frame.id })
  figma.viewport.scrollAndZoomIntoView([frame])
}

async function handleUpdate(targetId: string, roots: SitemapNode[]): Promise<void> {
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' })

  const oldNode = await figma.getNodeByIdAsync(targetId)
  if (!oldNode || oldNode.type !== 'FRAME') {
    post({ type: 'error', message: '元のサイトマップが見つかりません。新規に生成してください' })
    return
  }

  const frame = createSitemapFrame(roots)
  const parent = oldNode.parent
  if (!parent || !('insertChild' in parent)) {
    post({ type: 'error', message: '元のサイトマップが見つかりません。新規に生成してください' })
    return
  }
  const index = parent.children.indexOf(oldNode)
  frame.x = oldNode.x
  frame.y = oldNode.y
  frame.name = oldNode.name
  if (index >= 0) {
    parent.insertChild(index, frame)
  } else {
    parent.appendChild(frame)
  }
  oldNode.remove()
  figma.currentPage.selection = [frame]
  post({ type: 'updated', id: frame.id })
}

figma.on('selectionchange', () => {
  void sendSelection()
})

figma.ui.onmessage = (msg: UiToPluginMessage) => {
  void (async () => {
    switch (msg.type) {
      case 'ready':
        await sendSelection()
        break
      case 'resize-ui': {
        const height = clampUiHeight(msg.height)
        figma.ui.resize(UI_WIDTH, height)
        void figma.clientStorage.setAsync(UI_HEIGHT_STORAGE_KEY, height)
        break
      }
      case 'generate':
        try {
          await handleGenerate(msg.roots)
        } catch (error) {
          post({ type: 'error', message: '生成に失敗しました' })
        }
        break
      case 'update':
        try {
          await handleUpdate(msg.targetId, msg.roots)
        } catch (error) {
          post({ type: 'error', message: '更新に失敗しました' })
        }
        break
      case 'clear-target':
        break
      default:
        break
    }
  })()
}