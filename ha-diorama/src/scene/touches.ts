// The fingers on the screen right now, and when there were last two of them
// on it at once. A press that had a second finger down at any point was a
// pinch or a two finger drag, never a tap, whatever the browser makes of the
// finger that lifts last. Only the browser's own events count: the camera
// rig sends the controls presses and releases of its own, and those are not
// fingers. The rig lists the ones it sends here, which tells them from the
// browser's and still lets a test send fingers of its own.
export const sent = new WeakSet<Event>()

const down = new Set<number>()
let multiAt = -Infinity

if (typeof document !== 'undefined') {
  const onDown = (event: PointerEvent) => {
    if (sent.has(event) || event.pointerType !== 'touch') return
    down.add(event.pointerId)
    if (down.size > 1) multiAt = performance.now()
  }
  const onUp = (event: PointerEvent) => {
    if (!sent.has(event)) down.delete(event.pointerId)
  }
  document.addEventListener('pointerdown', onDown, { capture: true, passive: true })
  document.addEventListener('pointerup', onUp, { capture: true, passive: true })
  document.addEventListener('pointercancel', onUp, { capture: true, passive: true })
  window.addEventListener('blur', () => down.clear())
}

// Whether a second finger has been on the screen since the moment given, or
// is on it now.
export function multiTouchSince(at: number) {
  return down.size > 1 || multiAt >= at
}
