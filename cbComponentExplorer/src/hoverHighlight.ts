export const OVERLAY_NAME_PREFIX = '__CB_CE_'
export const HOVER_HIGHLIGHT_NAME = '__CB_CE_HOVER_HIGHLIGHT__'

/** Per-launch id so concurrent users do not remove each other's overlay. */
const SESSION_ID = Math.random().toString(36).slice(2, 10)
const TARGET_OVERLAY_NAME = `__CB_CE_TARGET_OVERLAY__@${SESSION_ID}`

export type HoverHighlightStyle = 'component' | 'instance'

const COMPONENT_COLOR = { r: 161 / 255, g: 84 / 255, b: 242 / 255 }
const INSTANCE_COLOR = { r: 0, g: 1, b: 64 / 255 }
const TARGET_COLOR = { r: 0, g: 1, b: 64 / 255 }

let targetOverlay: RectangleNode | null = null

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

const HIGHLIGHT_COLOR_HEX: Record<string, { r: number; g: number; b: number }> = {
  red: { r: 1, g: 59 / 255, b: 48 / 255 },
  yellow: { r: 1, g: 204 / 255, b: 0 },
  green: { r: 0, g: 1, b: 64 / 255 },
  purple: { r: 161 / 255, g: 84 / 255, b: 242 / 255 },
}

export async function showHoverHighlight(
  nodeIds: string[],
  style: HoverHighlightStyle,
  color?: string,
): Promise<void> {
  clearHoverHighlight()

  const override = color ? HIGHLIGHT_COLOR_HEX[color] : null

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
    if (override) {
      rect.fills = [{ type: 'SOLID', color: override, opacity: 0.4 }]
      rect.strokes = [{ type: 'SOLID', color: override }]
      rect.strokeWeight = 1
      rect.dashPattern = [10, 10]
    } else {
      applyHighlightStyle(rect, style)
    }
    rect.locked = true
    rect.visible = true
    figma.currentPage.appendChild(rect)
  }
}

function ensureTargetOverlay(): RectangleNode {
  if (targetOverlay && !targetOverlay.removed) {
    return targetOverlay
  }
  const rect = figma.createRectangle()
  rect.name = TARGET_OVERLAY_NAME
  rect.fills = []
  rect.strokes = [{ type: 'SOLID', color: TARGET_COLOR }]
  rect.strokeWeight = 10
  rect.strokeAlign = 'OUTSIDE'
  rect.dashPattern = [10, 10]
  rect.locked = true
  rect.visible = false
  figma.currentPage.appendChild(rect)
  targetOverlay = rect
  return rect
}

/** Outline the target's bounding box with a dashed frame. */
export function showTargetOverlay(node: SceneNode): void {
  const box = isOnCurrentPage(node) ? node.absoluteBoundingBox : null
  if (!box || box.width <= 0 || box.height <= 0) {
    hideTargetOverlay()
    return
  }
  const rect = ensureTargetOverlay()
  rect.resize(box.width, box.height)
  rect.x = box.x
  rect.y = box.y
  figma.currentPage.appendChild(rect)
  rect.visible = true
}

export function hideTargetOverlay(): void {
  if (targetOverlay && !targetOverlay.removed) {
    targetOverlay.visible = false
  }
}

export function removeTargetOverlay(): void {
  if (targetOverlay && !targetOverlay.removed) {
    targetOverlay.remove()
  }
  targetOverlay = null
}
