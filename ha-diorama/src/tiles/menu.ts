import type { KeyboardEvent } from 'react'

const GAP = 8

// Opens a popover menu beside the box it belongs to. The menu sits in the
// top layer, so it is placed by hand: under the box, or over it when there
// is no room below, at least as wide as it and kept on screen.
export function openMenu(menu: HTMLElement | null, box: DOMRect | undefined) {
  if (!menu || !box) return
  menu.style.minWidth = `${box.width}px`
  menu.style.maxWidth = `max(min(320px, 100vw - 32px), ${box.width}px)`
  menu.showPopover()
  // Its own size, not the one it is scaled to while it fades in.
  const width = menu.offsetWidth
  const height = menu.offsetHeight
  const below = box.bottom + GAP + height <= window.innerHeight
  const top = below ? box.bottom + GAP : Math.max(GAP, box.top - GAP - height)
  const left = Math.min(Math.max(GAP, box.left), window.innerWidth - width - GAP)
  menu.style.top = `${top}px`
  menu.style.left = `${left}px`
  menu.style.setProperty('--_origin', below ? 'top left' : 'bottom left')
  menu.querySelector<HTMLElement>('[aria-checked="true"]')?.focus()
}

// The arrow keys move between the options of a menu, round from the last
// to the first.
export function menuKeys(e: KeyboardEvent<HTMLElement>) {
  e.stopPropagation()
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
  e.preventDefault()
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>('.dio-option')]
  const at = items.indexOf(e.target as HTMLElement)
  const step = e.key === 'ArrowDown' ? 1 : -1
  items[(at + step + items.length) % items.length]?.focus()
}
