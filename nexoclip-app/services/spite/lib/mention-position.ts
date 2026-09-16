type RectLike = {
  left: number
  right: number
  top: number
  bottom: number
  width: number
  height: number
}

export function isUsableCaretRect(rect: RectLike): boolean {
  const values = [rect.left, rect.right, rect.top, rect.bottom, rect.width, rect.height]
  return values.every(Number.isFinite)
    && rect.height > 0
    && !(rect.left === 0 && rect.right === 0 && rect.top === 0 && rect.bottom === 0)
}

export function placeMentionMenu(
  caret: { left: number; right: number; top: number; bottom: number },
  menu: { width: number; height: number },
  viewport: { width: number; height: number },
  gap = 8,
) {
  const margin = 8
  const fitsAbove = caret.top - gap - menu.height >= margin
  const placement: 'above' | 'below' = fitsAbove ? 'above' : 'below'
  const rawTop = placement === 'above'
    ? caret.top - gap - menu.height
    : caret.bottom + gap

  return {
    left: Math.min(Math.max(caret.left, margin), viewport.width - menu.width - margin),
    top: Math.min(Math.max(rawTop, margin), viewport.height - menu.height - margin),
    placement,
  }
}
