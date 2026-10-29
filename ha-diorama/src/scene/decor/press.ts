import { claimedSince, LONG_PRESS_MS } from '#/lib/longPress.ts'
import { justDropped } from '#/scene/drags.ts'
import { multiTouchSince } from '#/scene/touches.ts'
import type { ThreeEvent } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import type { Vector3 } from 'three'

// What a press does, told where on the piece it landed.
export type PressAction = (at?: Vector3) => void

// How a click and a press are told apart in 3D. A click acts on the device.
// A right click, or a long press on a touch screen, asks Home Assistant for
// its dialog instead, where brightness, color and the rest live. Double
// click is not used for it: it would toggle the device twice on the way.
// A press that wanders this far is the viewer orbiting, not a long press.
const SLOP_PX = 8

export function usePressActions(onClick?: PressAction, onOpen?: PressAction) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const from = useRef<[number, number] | null>(null)
  // Where the right button went down, until it drags or comes up.
  const rightFrom = useRef<[number, number] | null>(null)
  const opened = useRef(false)
  // When the left button or the finger last went down, by the event's own
  // time, so a busy moment before the release does not make it look long.
  const downAt = useRef(0)
  const hovered = useRef(false)

  const cancel = () => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
    from.current = null
    rightFrom.current = null
  }

  // A piece that leaves the scene mid press must not open its dialog
  // later, nor leave the pointer as a hand.
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
      timer.current = null
      if (hovered.current) document.body.style.cursor = ''
    },
    [],
  )

  if (!onClick && !onOpen) return {}

  return {
    onClick: (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation()
      if (e.nativeEvent.button !== 0) return
      // The release of a drag is not a click.
      if (justDropped()) return
      // The long press already opened the dialog, so this release is spent.
      if (opened.current) {
        opened.current = false
        return
      }
      // A press held this long was a long press, even one that opened
      // nothing, and a long press never clicks.
      if (e.nativeEvent.timeStamp - downAt.current > LONG_PRESS_MS) return
      onClick?.(e.point)
    },
    // The menu is kept away. The right click opens the dialog when it is let
    // go, below, so a right drag that orbits or pans opens nothing.
    onContextMenu: (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation()
      e.nativeEvent.preventDefault()
      // A touch screen asks for the menu when a finger has been held down,
      // and some ask sooner than the timer here runs out. That is the long
      // press, taken there and then.
      if (timer.current === null || !from.current || !onOpen) return
      clearTimeout(timer.current)
      timer.current = null
      if (multiTouchSince(downAt.current) || claimedSince(downAt.current)) return
      opened.current = true
      onOpen(e.point)
    },
    onPointerDown: (e: ThreeEvent<PointerEvent>) => {
      cancel()
      opened.current = false
      if (e.nativeEvent.button === 0) downAt.current = e.nativeEvent.timeStamp
      if (!onOpen) return
      if (e.nativeEvent.button === 2) {
        rightFrom.current = [e.nativeEvent.clientX, e.nativeEvent.clientY]
        return
      }
      // Only the left button presses. Any other is the camera's.
      if (e.nativeEvent.button !== 0) return
      from.current = [e.nativeEvent.clientX, e.nativeEvent.clientY]
      const at = downAt.current
      const point = e.point.clone()
      timer.current = setTimeout(() => {
        timer.current = null
        // Two fingers held still on a piece are a pinch about to start,
        // not a long press on it.
        if (multiTouchSince(at)) return
        // Nor is one that already dragged a blind, held still at the end.
        if (claimedSince(at)) return
        opened.current = true
        onOpen(point)
      }, LONG_PRESS_MS)
    },
    onPointerMove: (e: ThreeEvent<PointerEvent>) => {
      const start = from.current ?? rightFrom.current
      if (!start) return
      const dx = e.nativeEvent.clientX - start[0]
      const dy = e.nativeEvent.clientY - start[1]
      if (Math.hypot(dx, dy) > SLOP_PX) cancel()
    },
    onPointerUp: (e: ThreeEvent<PointerEvent>) => {
      const right = rightFrom.current
      cancel()
      if (right && e.nativeEvent.button === 2) {
        e.stopPropagation()
        onOpen?.(e.point)
      }
    },
    onPointerOver: () => {
      hovered.current = true
      document.body.style.cursor = 'pointer'
    },
    onPointerOut: () => {
      cancel()
      hovered.current = false
      document.body.style.cursor = ''
    },
  }
}
