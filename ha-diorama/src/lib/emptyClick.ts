import { SIDE_PANEL } from '#/tiles/sidePanel.ts'
import { useEffect, useRef } from 'react'

// What a click can land on that is not empty space: a card, a badge, or
// anything that can be pressed.
const CARDS = new Set(['hui-card', 'ha-card', 'hui-badge', 'hui-heading-badge'])
const PRESSABLE = new Set(['a', 'button', 'input', 'select', 'textarea', 'label', 'summary'])
const ROLES = new Set(['button', 'link', 'slider', 'checkbox', 'switch', 'menuitem', 'tab', 'option'])

// Whether a click fell on empty space in the dashboard's view: the gaps
// between cards and sections, the view's own background, or the side
// panel's room around its tiles. Clicks in a dialog or the header are not
// in the view, so they never count.
function onEmptySpace(event: MouseEvent) {
  for (const target of event.composedPath()) {
    if (!(target instanceof Element)) continue
    const name = target.localName
    // The side panel and the card it is in are only what holds the tiles.
    if (name === SIDE_PANEL || name === 'hui-view') return true
    if (CARDS.has(name) || PRESSABLE.has(name)) return false
    if (ROLES.has(target.getAttribute('role') ?? '')) return false
  }
  return false
}

// While `enabled`, a click on empty space anywhere in the dashboard's view
// calls `onEmpty`.
export function useEmptyClick(enabled: boolean, onEmpty: () => void) {
  const call = useRef(onEmpty)
  useEffect(() => {
    call.current = onEmpty
  })
  useEffect(() => {
    if (!enabled) return
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0 || event.defaultPrevented || !onEmptySpace(event)) return
      call.current()
    }
    addEventListener('click', onClick)
    return () => removeEventListener('click', onClick)
  }, [enabled])
}
