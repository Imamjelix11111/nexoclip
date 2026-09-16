type RectLike = {
  left: number
  right: number
  top: number
  bottom: number
  width: number
  height: number
}

export function isUsableCaretRect(rect: RectLike): boolean {
  // Zero width is normal for a collapsed caret; accept width === 0 but
  // require monotonic edges and a positive height so inverted or
  // nonsensical rects are rejected.
  const values = [rect.left, rect.right, rect.top, rect.bottom, rect.width, rect.height]
  return values.every(Number.isFinite)
    && rect.height > 0
    && rect.bottom > rect.top
    && rect.right >= rect.left
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

  // Prevent the computed max bounds from falling below the margin when the
  // menu is wider/taller than the viewport. Use a lower clamped max so the
  // final coordinate never drops below `margin`.
  const maxLeft = Math.max(margin, viewport.width - menu.width - margin)
  const left = Math.min(Math.max(caret.left, margin), maxLeft)

  const maxTop = Math.max(margin, viewport.height - menu.height - margin)
  const top = Math.min(Math.max(rawTop, margin), maxTop)

  return { left, top, placement }
}
