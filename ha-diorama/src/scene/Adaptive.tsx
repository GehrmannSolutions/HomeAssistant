import { useFrame, useThree } from '@react-three/fiber'
import { LIVE_FPS } from '#/constants.ts'
import { beating } from '#/scene/live.ts'
import { due } from '#/scene/pace.ts'
import { useEffect, useRef } from 'react'

// The picture is drawn at the screen's own density, up to twice the CSS
// pixels each way, which on a tablet is four times the pixels of a laptop
// screen for a chip a fraction as strong. Rather than guess which devices
// can keep up, this watches how fast frames come while the room is in
// motion, and when they fall behind draws the picture a step less dense,
// then finer again once there is room to spare. A step down is a softer
// picture, not a stutter, and only on a device that was stuttering.

// The densities tried, finest last, capped at what the screen can show.
const STEPS = [1, 1.25, 1.5, 2]
// How many frames in a row are averaged before a step is taken.
const WINDOW = 40
// A gap longer than this between frames is the room standing still, not a
// slow frame, and is not counted. While something moves on its own the
// frames come at its slower pace, and a gap near that is not counted either.
const IDLE_MS = 100
const BEAT_MS = (0.8 * 1000) / LIVE_FPS
// Frames are late when they take this much longer than the fastest seen,
// and comfortable when they take at most this much longer.
const LATE = 1.7
const EASY = 1.15
// How many comfortable windows in a row earn a step back up, and how many
// steps up are allowed in all, so a device on the edge does not flicker
// between two densities.
const PATIENCE = 3
const MAX_UPS = 2

export default function Adaptive() {
  const setDpr = useThree(state => state.setDpr)
  const invalidate = useThree(state => state.invalidate)
  const steps = useRef<number[]>([])
  const level = useRef(0)
  const last = useRef(0)
  const times = useRef<number[]>([])
  const fastest = useRef(Infinity)
  const easy = useRef(0)
  const ups = useRef(0)

  useEffect(() => {
    const max = Math.min(window.devicePixelRatio || 1, 2)
    steps.current = STEPS.filter(s => s < max)
    steps.current.push(max)
    level.current = steps.current.length - 1
  }, [])

  useFrame(state => {
    // Only the frames drawn are timed. The ticks between them cost nothing.
    if (!due(state.clock)) return
    const now = performance.now()
    const gap = now - last.current
    last.current = now
    const idle = beating(invalidate) ? Math.min(IDLE_MS, BEAT_MS) : IDLE_MS
    if (gap > idle || gap <= 0) {
      times.current.length = 0
      return
    }
    fastest.current = Math.max(4, Math.min(fastest.current, gap))
    times.current.push(gap)
    if (times.current.length < WINDOW) return
    const mean = times.current.reduce((a, b) => a + b, 0) / times.current.length
    times.current.length = 0
    const at = level.current
    if (mean > fastest.current * LATE && at > 0) {
      level.current = at - 1
      easy.current = 0
      setDpr(steps.current[level.current])
      invalidate()
    } else if (mean < fastest.current * EASY && at < steps.current.length - 1 && ups.current < MAX_UPS) {
      if (++easy.current < PATIENCE) return
      easy.current = 0
      ups.current++
      level.current = at + 1
      setDpr(steps.current[level.current])
      invalidate()
    } else easy.current = 0
  })
  return null
}
