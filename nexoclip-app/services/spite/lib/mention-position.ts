export function placeMentionMenu(caret: { left: number; right: number; top: number; bottom: number }, menu: { width: number; height: number }, viewport: { width: number; height: number }, gap = 8) {
  const margin = 8
  const fitsBelow = caret.bottom + gap + menu.height <= viewport.height - margin
  const placement: 'above' | 'below' = fitsBelow ? 'below' : 'above'
  const rawTop = placement === 'below'
    ? caret.bottom + gap
    : caret.top - gap - menu.height
  return {
    left: Math.min(Math.max(caret.left, margin), viewport.width - menu.width - margin),
    top: Math.min(Math.max(rawTop, margin), viewport.height - menu.height - margin),
    placement,
  }
}
