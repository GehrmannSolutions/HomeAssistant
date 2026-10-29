import { useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react'
import { claimedSince, LONG_PRESS_MS } from '#/lib/longPress.ts'
import { haptic } from '#/tiles/actions.ts'

// How far a finger can drift before the press counts as a scroll.
const SLOP_PX = 10
// A touch long press can also raise a context menu. One hold, not two.
const SETTLE_MS = 800

type Options = { onTap?: () => void; onHold?: () => void; haptics?: boolean }

// Tap, long press, right click and keyboard on a tile. A tap runs on click,
// so a press that turned into a scroll or a hold never also taps. Inner
// buttons stop their events so they never reach these, and a click that
// did not start with a press on the tile itself, like the end of a drag
// along a slider inside it, never taps it. A long press is only ever a
// press on the tile itself held still, never one on a control inside it,
// one that moved, or one that something else took on the way.
export function useTileGestures({ onTap, onHold, haptics = true }: Options) {
  const [pressed, setPressed] = useState(false)
  const press = useRef({
    timer: 0,
    x: 0,
    y: 0,
    down: false,
    held: false,
    heldAt: 0,
    moved: false,
    // When the last press went down, and whether it went down on a control
    // inside the tile that kept it, rather than on the tile.
    at: 0,
    inner: false,
    // Whether the tile's own press is still held down.
    holding: false,
  })

  const cancel = () => {
    clearTimeout(press.current.timer)
    press.current.timer = 0
    setPressed(false)
  }

  const hold = () => {
    const now = Date.now()
    if (now - press.current.heldAt < SETTLE_MS) return
    press.current.held = true
    press.current.heldAt = now
    if (haptics) haptic('medium')
    onHold?.()
  }

  const tap = () => {
    if (!onTap) return
    if (haptics) haptic('light')
    onTap()
  }

  return {
    pressed,
    handlers: {
      // Seen before any control inside gets the press, and kept as inner
      // until the press reaches the tile itself.
      onPointerDownCapture: () => {
        press.current.at = performance.now()
        press.current.inner = true
      },
      onPointerDown: (e: PointerEvent) => {
        const p = press.current
        p.inner = false
        p.holding = e.button === 0
        if (e.button !== 0) return
        Object.assign(p, { x: e.clientX, y: e.clientY, down: true, held: false, moved: false })
        setPressed(true)
        clearTimeout(p.timer)
        p.timer = window.setTimeout(() => {
          cancel()
          if (!claimedSince(p.at)) hold()
        }, LONG_PRESS_MS)
      },
      onPointerMove: (e: PointerEvent) => {
        const p = press.current
        if (!p.timer || Math.hypot(e.clientX - p.x, e.clientY - p.y) < SLOP_PX) return
        p.moved = true
        cancel()
      },
      onPointerUp: () => {
        press.current.holding = false
        cancel()
      },
      onPointerCancel: () => {
        press.current.moved = true
        press.current.holding = false
        cancel()
      },
      onPointerLeave: cancel,
      onClick: (e: MouseEvent) => {
        const p = press.current
        const pressed = p.down && !p.held && !p.moved
        p.down = p.held = p.moved = false
        if (!pressed) return
        e.preventDefault()
        tap()
      },
      // A right click, or the menu a phone raises for a finger held down.
      // One raised for a control inside the tile is that control's, and one
      // for a finger on the tile only counts while the finger still could
      // make a long press there.
      onContextMenu: (e: MouseEvent) => {
        e.preventDefault()
        const p = press.current
        if (p.inner || claimedSince(p.at)) return
        if (p.holding && !p.timer) return
        cancel()
        hold()
      },
      onKeyDown: (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          if (!e.repeat) tap()
        } else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
          e.preventDefault()
          hold()
        }
      },
    },
  }
}

// Spread on a button inside a tile, so pressing it never presses the tile.
export const insideTile = {
  onPointerDown: (e: PointerEvent) => e.stopPropagation(),
  onKeyDown: (e: KeyboardEvent) => e.stopPropagation(),
}

// Spread on a menu or a sheet that pops up from inside a tile, so picking
// anything in it never also presses the tile under it.
export const popsOver = {
  onPointerDown: (e: PointerEvent) => e.stopPropagation(),
  onClick: (e: MouseEvent) => e.stopPropagation(),
  onKeyDown: (e: KeyboardEvent) => e.stopPropagation(),
}
