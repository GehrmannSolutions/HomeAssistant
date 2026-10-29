// Whatever acts only on a second tap or press, so a stray one never does.
import { haptic } from '#/tiles/actions.ts'
import { useEffect, useRef, useState, type CSSProperties } from 'react'

// How long the first tap waits for the second.
export const CONFIRM_MS = 4000
// How much of the tile the first tap lights, or leaves lit on a tile that
// is on, before it runs back.
export const CONFIRM_FILL = 50
// How long a second tap waits for Home Assistant to say it took, before the
// tile goes back to how it was.
const SENT_MS = 10_000

// How long the lit part takes to ease from where it was to where the first
// tap puts it.
const EASE_MS = 300

// How long a power button waits for the second press that turns it off.
export const ARMED_MS = 3000

// A power button that turns on at once, but turns off only on a second
// press within a few seconds, so it is never turned off by mistake. Give
// `className` and `style` to the button, which then lights up and runs
// back over the time the second press has.
export function useArmed(off: boolean, turn: (() => void) | null) {
  const [waiting, setArmed] = useState(false)
  const armed = waiting && !off
  const disarm = useRef(0)
  useEffect(() => () => clearTimeout(disarm.current), [])
  const press = () => {
    if (!turn) return
    clearTimeout(disarm.current)
    if (off || armed) {
      haptic(off ? 'selection' : 'medium')
      setArmed(false)
      turn()
      return
    }
    haptic('selection')
    setArmed(true)
    disarm.current = window.setTimeout(() => setArmed(false), ARMED_MS)
  }
  return {
    armed,
    press,
    className: armed ? 'dio-armed' : undefined,
    style: { '--_armed-ms': `${ARMED_MS}ms` } as CSSProperties,
  }
}

// The first and the second tap of a tile that only acts on the second, and
// the lit part that shows how long the second has. The first tap on what
// is off lights half of it, which runs back to nothing over the time the
// second tap has. On what is on, it cuts the lit part back to half, which
// grows back to all of it. The second tap lights it all, or none of it,
// and sends. `lit` goes on the lit copy.
export function useConfirm(on: boolean, onConfirm: () => void) {
  // Whether the first tap is waiting for the second.
  const [waiting, setWaiting] = useState(false)
  // What the second tap sent it to, until Home Assistant says it is.
  const [goal, setGoal] = useState<boolean | null>(null)
  const lit = useRef<HTMLDivElement>(null)
  // Back to the start once it turns on or off.
  const [seen, setSeen] = useState(on)
  if (seen !== on) {
    setSeen(on)
    setWaiting(false)
    setGoal(null)
  }
  useEffect(() => {
    if (goal === null) return
    const timer = setTimeout(() => setGoal(null), SENT_MS)
    return () => clearTimeout(timer)
  }, [goal])
  const shown = goal ?? on
  // The lit part moves frame by frame, since a browser may not repaint a
  // clip that only CSS animates until something else moves. It eases from
  // where it was into the run back, so the first tap does not jump.
  useEffect(() => {
    const box = lit.current
    if (!box) return
    const clip = (part: number) => (box.style.clipPath = `inset(0 ${100 - part}% 0 0)`)
    if (!waiting) return void clip(shown ? 100 : 0)
    const from = on ? 100 : 0
    const start = performance.now()
    let frame = 0
    const tick = (now: number) => {
      const elapsed = now - start
      const done = elapsed / CONFIRM_MS
      if (done >= 1) return setWaiting(false)
      const run = on ? CONFIRM_FILL + (100 - CONFIRM_FILL) * done : CONFIRM_FILL * (1 - done)
      const ease = 1 - (1 - Math.min(1, elapsed / EASE_MS)) ** 3
      clip(from + (run - from) * ease)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [waiting, on, shown])
  const tap = () => {
    if (goal !== null) return
    if (!waiting) return setWaiting(true)
    setWaiting(false)
    setGoal(!on)
    onConfirm()
  }
  return { lit, waiting, shown, step: waiting ? 1 : goal !== null ? 2 : 0, tap }
}
