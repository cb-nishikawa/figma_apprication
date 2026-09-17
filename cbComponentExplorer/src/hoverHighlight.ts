export const HOVER_HIGHLIGHT_NAME = '__CB_CE_HOVER_HIGHLIGHT__'

export type HoverHighlightStyle = 'component' | 'instance'

const COMPONENT_COLOR = { r: 161 / 255, g: 84 / 255, b: 242 / 255 }
const INSTANCE_COLOR = { r: 0, g: 1, b: 64 / 255 }

export function clearHoverHighlight(): void {
  const page = figma.currentPage
  for (const child of [...page.children]) {
    if (child.type === 'RECTANGLE' && child.name === HOVER_HIGHLIGHT_NAME) {
      child.remove()
    }
  }
}

function isOnCurrentPage(node: BaseNode): boolean {
  let current: BaseNode | null = node
  while (current && current.type !== 'PAGE') {
    current = current.parent
  }
  return Boolean(current && current.id === figma.currentPage.id)
}

function applyHighlightStyle(
  rect: RectangleNode,
  style: HoverHighlightStyle,
): void {
  const color = style === 'component' ? COMPONENT_COLOR : INSTANCE_COLOR
  rect.fills = [
    {
      type: 'SOLID',
      color,
      opacity: 0.4,
    },
  ]
  rect.strokes = [
    {
      type: 'SOLID',
      color,
    },
  ]
  rect.strokeWeight = 1
  rect.dashPattern = [10, 10]
}

export async function showHoverHighlight(
  nodeIds: string[],
  style: HoverHighlightStyle,
): Promise<void> {
  clearHoverHighlight()

  for (const nodeId of nodeIds) {
    const node = await figma.getNodeByIdAsync(nodeId)
    if (!node || !('absoluteBoundingBox' in node)) {
      continue
    }

    const sceneNode = node as SceneNode
    const box = sceneNode.absoluteBoundingBox
    if (!box || box.width <= 0 || box.height <= 0) {
      continue
    }
    if (!isOnCurrentPage(sceneNode)) {
      continue
    }

    const rect = figma.createRectangle()
    rect.name = HOVER_HIGHLIGHT_NAME
    rect.resize(box.width, box.height)
    rect.x = box.x
    rect.y = box.y
    applyHighlightStyle(rect, style)
    rect.locked = true
    rect.visible = true
    figma.currentPage.appendChild(rect)
  }
}
